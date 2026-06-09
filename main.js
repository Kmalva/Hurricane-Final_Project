/* ════════════════════════════════════════════════════════════════════
   Viz 1 — Atlantic Sea Surface Temperature scrollytelling
   Skills applied: d3-scrollytelling (one sticky graphic, meaningful change
   per step) + d3-chart-patterns (margins, labeled axes, tooltip, annotations).
   Wrapped in an IIFE so globals don't leak into the other visualizations.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── DATA LOADING ──
  let DATA_HIST, DATA_126, DATA_245, DATA_585;

  function parseRows(rows) {
    return rows.map(d => ({ year: +d.year, sst: +(d.sst ?? d.avg_sst ?? d.projected_sst ?? d.observed_sst) }));
  }

  // Shift a projection dataset so its first value exactly matches the last
  // historical value — removes the visual step at the model run boundary.
  function stitchToHistory(hist, proj) {
    const delta = hist[hist.length - 1].sst - proj[0].sst;
    return proj.map(d => ({ year: d.year, sst: d.sst + delta }));
  }

  async function loadData() {
    [DATA_HIST, DATA_126, DATA_245, DATA_585] = await Promise.all([
      d3.csv('data/cmip6_historical.csv'),
      d3.csv('data/ssp126.csv'),
      d3.csv('data/ssp245.csv'),
      d3.csv('data/ssp585.csv'),
    ]);
    DATA_HIST = parseRows(DATA_HIST);
    DATA_126  = stitchToHistory(DATA_HIST, parseRows(DATA_126));
    DATA_245  = stitchToHistory(DATA_HIST, parseRows(DATA_245));
    DATA_585  = stitchToHistory(DATA_HIST, parseRows(DATA_585));
    // Extend historical one year so the line visually meets the SSP start point
    const lastH = DATA_HIST[DATA_HIST.length - 1];
    DATA_HIST = [...DATA_HIST, { year: lastH.year + 1, sst: lastH.sst }];
  }

  // ── CHART ──
  const svgEl = document.getElementById('main-chart');
  const M = { top: 24, right: 28, bottom: 38, left: 50 };
  // explicit hex (var() is not reliably resolved inside SVG presentation attributes)
  const C = { hist: '#2563eb', ssp126: '#16a34a', ssp245: '#d97706', ssp585: '#dc2626' };

  let W, H, svg, xS, yS, lineGen, histPath, p126, p245, p585;
  let currentStep = -1;

  // Scroll-driven transition helpers (shared by the red-iris handoff)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const smooth = p => p * p * (3 - 2 * p);
  const motionOK = () => !reduceMotion.matches && window.innerWidth > 880;

  const LAST_OBS_YEAR = 2014;   // CMIP6 historical run ends here
  const FIRST_PROJ    = 2015;   // SSP126/245 projections begin
  const PROJ_START = { '126': 2015, '245': 2015, '585': 2015 };

  function build() {
    if (!DATA_HIST) return;
    const wrap = document.getElementById('chart-wrap');
    W = wrap.clientWidth - M.left - M.right;
    H = Math.min(Math.max(window.innerHeight * 0.46, 260), 420);

    svgEl.setAttribute('viewBox', `0 0 ${W + M.left + M.right} ${H + M.top + M.bottom}`);
    svgEl.innerHTML = '';

    svg = d3.select(svgEl).append('g').attr('transform', `translate(${M.left},${M.top})`);

    const allY = [...DATA_HIST, ...DATA_126, ...DATA_245, ...DATA_585].map(d => d.sst);
    xS = d3.scaleLinear().domain([1900, 2100]).range([0, W]);
    yS = d3.scaleLinear().domain([d3.min(allY) - 0.15, d3.max(allY) + 0.3]).range([H, 0]);
    lineGen = d3.line().x(d => xS(d.year)).y(d => yS(d.sst)).curve(d3.curveCatmullRom.alpha(0.5));

    // Horizontal grid
    svg.append('g')
      .call(d3.axisLeft(yS).tickSize(-W).tickFormat('').ticks(5))
      .call(g => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', 'var(--line-soft, #eef4f7)'); });

    // X axis
    svg.append('g').attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(xS).tickFormat(d3.format('d')).ticks(10))
      .call(g => {
        g.select('.domain').attr('stroke', '#cbd9e1');
        g.selectAll('text').attr('fill', '#6b8090').attr('font-family', 'Inter, Arial').attr('font-size', '11');
        g.selectAll('.tick line').attr('stroke', '#e5edf1');
      });

    // Y axis
    svg.append('g')
      .call(d3.axisLeft(yS).ticks(5).tickFormat(d => `${d.toFixed(1)}°`))
      .call(g => {
        g.select('.domain').remove();
        g.selectAll('text').attr('fill', '#6b8090').attr('font-family', 'Inter, Arial').attr('font-size', '11');
        g.selectAll('.tick line').remove();
      });

    // Y-axis label
    svg.append('text').attr('transform', 'rotate(-90)')
      .attr('x', -H / 2).attr('y', -38).attr('text-anchor', 'middle')
      .attr('fill', '#6b8090').attr('font-family', 'Inter, Arial').attr('font-size', '10.5')
      .text('Sea surface temperature (°C)');

    // Axis break marker
    const bx = -M.left + 6, by = H + 6;
    svg.append('polyline')
      .attr('points', `${bx},${by} ${bx+6},${by-5} ${bx+12},${by+5} ${bx+18},${by-5} ${bx+24},${by}`)
      .attr('fill', 'none').attr('stroke', '#9fb2bd').attr('stroke-width', 1.4);

    // Clip paths
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'ch').append('rect').attr('y', 0).attr('width', 0).attr('height', H);
    ['126', '245', '585'].forEach(s => {
      defs.append('clipPath').attr('id', `c${s}`)
        .append('rect').attr('x', xS(PROJ_START[s])).attr('y', 0).attr('width', 0).attr('height', H);
    });

    // Recent-warming highlight band (1990–2025) — shown on step 0
    svg.append('rect').attr('class', 'recent-band')
      .attr('x', xS(1990)).attr('y', 0)
      .attr('width', xS(2014) - xS(1990)).attr('height', H)
      .attr('fill', 'url(#recentGrad)').attr('opacity', 0);
    const rg = defs.append('linearGradient').attr('id', 'recentGrad').attr('x1', '0').attr('x2', '1');
    rg.append('stop').attr('offset', '0%').attr('stop-color', '#ef4444').attr('stop-opacity', 0);
    rg.append('stop').attr('offset', '100%').attr('stop-color', '#ef4444').attr('stop-opacity', 0.10);

    svg.append('text').attr('class', 'recent-label')
      .attr('x', xS(1992)).attr('y', 16)
      .attr('fill', '#c2410c').attr('font-family', 'Inter, Arial').attr('font-size', '10.5').attr('font-weight', 600)
      .attr('opacity', 0).text('Fastest warming in recent decades');

    // Future background shade
    svg.append('rect').attr('class', 'fut-shade')
      .attr('x', xS(FIRST_PROJ)).attr('y', 0)
      .attr('width', xS(2100) - xS(FIRST_PROJ)).attr('height', H)
      .attr('fill', '#f1f6f9').attr('opacity', 0);

    // SSP projection lines
    p126 = svg.append('path').datum(DATA_126).attr('fill', 'none').attr('stroke', C.ssp126).attr('stroke-width', 2).attr('clip-path', 'url(#c126)').attr('d', lineGen).attr('opacity', 0);
    p245 = svg.append('path').datum(DATA_245).attr('fill', 'none').attr('stroke', C.ssp245).attr('stroke-width', 2).attr('clip-path', 'url(#c245)').attr('d', lineGen).attr('opacity', 0);
    p585 = svg.append('path').datum(DATA_585).attr('fill', 'none').attr('stroke', C.ssp585).attr('stroke-width', 2).attr('clip-path', 'url(#c585)').attr('d', lineGen).attr('opacity', 0);

    // Historical line (on top)
    histPath = svg.append('path').datum(DATA_HIST).attr('fill', 'none').attr('stroke', C.hist).attr('stroke-width', 2.4).attr('clip-path', 'url(#ch)').attr('d', lineGen);

    // Hurricane annotations
    // above:true → label above the line; stemLen controls tick length
    const STORMS = [
      { year: 1935, name: 'Labor Day', cat: 5, above: true,  stemLen: 28 },
      { year: 1969, name: 'Camille',   cat: 5, above: true, stemLen: 28 },
      { year: 1992, name: 'Andrew',    cat: 5, above: true,  stemLen: 28 },
      { year: 2005, name: 'Katrina',   cat: 5, above: true, stemLen: 36 },
      { year: 2012, name: 'Sandy',     cat: 3, above: false,  stemLen: 30 },
    ];
    const stormG = svg.append('g').attr('class', 'storm-annots');
    STORMS.forEach(s => {
      const row = DATA_HIST.find(d => d.year === s.year);
      if (!row) return;
      const cx = xS(s.year);
      const cy = yS(row.sst);
      const dir = s.above ? -1 : 1;
      // Stem
      stormG.append('line')
        .attr('x1', cx).attr('y1', cy + dir * 5)
        .attr('x2', cx).attr('y2', cy + dir * s.stemLen)
        .attr('stroke', '#b45309').attr('stroke-width', 1).attr('stroke-dasharray', '2,2');
      // Dot on the line
      stormG.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 4.5)
        .attr('fill', '#f59e0b').attr('stroke', 'white').attr('stroke-width', 1.5);
      // Label
      stormG.append('text')
        .attr('x', cx).attr('y', cy + dir * (s.stemLen + 10))
        .attr('text-anchor', 'middle').attr('dominant-baseline', s.above ? 'auto' : 'hanging')
        .attr('fill', '#92400e').attr('font-family', 'Inter, Arial')
        .attr('font-size', '9.5').attr('font-weight', 700)
        .text(s.name);
      stormG.append('text')
        .attr('x', cx).attr('y', cy + dir * (s.stemLen + 10))
        .attr('dy', s.above ? '-10' : '12')
        .attr('text-anchor', 'middle').attr('dominant-baseline', s.above ? 'auto' : 'hanging')
        .attr('fill', '#a16207').attr('font-family', 'Inter, Arial')
        .attr('font-size', '8.5')
        .text(`Cat ${s.cat} · ${s.year}`);
    });

    // "Observed ends / Projection begins" divider + annotation
    svg.append('line').attr('class', 'now-line')
      .attr('x1', xS(FIRST_PROJ)).attr('x2', xS(FIRST_PROJ)).attr('y1', 0).attr('y2', H)
      .attr('stroke', '#94a8b3').attr('stroke-dasharray', '3,4').attr('opacity', 0);

    const annot = svg.append('g').attr('class', 'obs-annot').attr('opacity', 0);
    annot.append('text').attr('x', xS(FIRST_PROJ) - 6).attr('y', 13).attr('text-anchor', 'end')
      .attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', '10').attr('font-weight', 600)
      .text('← CMIP6 historical ends 2014');
    annot.append('text').attr('x', xS(FIRST_PROJ) + 6).attr('y', 13).attr('text-anchor', 'start')
      .attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', '10').attr('font-weight', 600)
      .text('SSP projections begin →');

    buildHover();
    drawStep(currentStep < 0 ? 0 : currentStep, true);
  }

  function buildHover() {
    const bisect = d3.bisector(d => d.year).left;
    const tip = document.getElementById('tooltip');

    const hoverLine = svg.append('line').attr('y1', 0).attr('y2', H)
      .attr('stroke', '#94a8b3').attr('stroke-width', 1).attr('pointer-events', 'none').attr('opacity', 0);

    const dotHist = svg.append('circle').attr('r', 4).attr('fill', C.hist).attr('opacity', 0).attr('pointer-events', 'none');
    const dot126  = svg.append('circle').attr('r', 4).attr('fill', C.ssp126).attr('opacity', 0).attr('pointer-events', 'none');
    const dot245  = svg.append('circle').attr('r', 4).attr('fill', C.ssp245).attr('opacity', 0).attr('pointer-events', 'none');
    const dot585  = svg.append('circle').attr('r', 4).attr('fill', C.ssp585).attr('opacity', 0).attr('pointer-events', 'none');

    function getVal(dataset, yr) {
      const i = bisect(dataset, yr, 1);
      return dataset[Math.min(i, dataset.length - 1)];
    }

    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
      .on('mousemove', function (e) {
        const yr = Math.round(xS.invert(d3.pointer(e)[0]));
        hoverLine.attr('x1', xS(yr)).attr('x2', xS(yr)).attr('opacity', 1);

        const isFuture = yr > LAST_OBS_YEAR;
        const hist = getVal(DATA_HIST, yr);

        if (!isFuture && hist) dotHist.attr('cx', xS(hist.year)).attr('cy', yS(hist.sst)).attr('opacity', 1);
        else dotHist.attr('opacity', 0);

        const v126 = isFuture ? getVal(DATA_126, yr) : null;
        const v245 = isFuture ? getVal(DATA_245, yr) : null;
        const v585 = isFuture ? getVal(DATA_585, yr) : null;

        dot126.attr('opacity', v126 && currentStep >= 1 ? 1 : 0);
        dot245.attr('opacity', v245 && currentStep >= 2 ? 1 : 0);
        dot585.attr('opacity', v585 && currentStep >= 3 ? 1 : 0);
        if (v126) dot126.attr('cx', xS(v126.year)).attr('cy', yS(v126.sst));
        if (v245) dot245.attr('cx', xS(v245.year)).attr('cy', yS(v245.sst));
        if (v585) dot585.attr('cx', xS(v585.year)).attr('cy', yS(v585.sst));

        let html = `<div style="font-weight:600;margin-bottom:5px;color:#0c1f2a">${yr}</div>`;
        if (!isFuture && hist) {
          html += row(C.hist, 'CMIP6 Historical', hist.sst);
        }
        if (isFuture) {
          if (v126 && currentStep >= 1) html += row(C.ssp126, 'SSP1-2.6', v126.sst);
          if (v245 && currentStep >= 2) html += row(C.ssp245, 'SSP2-4.5', v245.sst);
          if (v585 && currentStep >= 3) html += row(C.ssp585, 'SSP5-8.5', v585.sst);
        }

        tip.style.opacity = '1';
        tip.style.left = (e.clientX + 16) + 'px';
        tip.style.top = (e.clientY - 10) + 'px';
        tip.innerHTML = html;
      })
      .on('mouseleave', () => {
        hoverLine.attr('opacity', 0);
        dotHist.attr('opacity', 0); dot126.attr('opacity', 0); dot245.attr('opacity', 0); dot585.attr('opacity', 0);
        tip.style.opacity = '0';
      });

    function row(color, label, val) {
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>
        <span style="color:#6b8090">${label}</span>
        <span style="margin-left:auto;font-weight:600">${val.toFixed(2)} °C</span></div>`;
    }
  }

  function drawStep(step, force) {
    if (step === currentStep && !force) return;
    currentStep = step;

    // Historical line is always fully visible (resting state never depends on an animation).
    // On first load, animate a soft "draw-on" wipe as an enhancement only.
    const chRect = d3.select('#ch rect');
    chRect.attr('width', W);
    if (step === 0 && force) {
      chRect.attr('width', 0).transition().duration(1400).ease(d3.easeCubicInOut).attr('width', W)
        .on('interrupt cancel', () => chRect.attr('width', W));
      // safety nets in case rAF is throttled (background tab / reduced motion)
      setTimeout(() => chRect.interrupt().attr('width', W), 1600);
      requestAnimationFrame(() => setTimeout(() => chRect.attr('width', W), 1600));
    }

    // Recent-warming highlight only on the opening step
    const showRecent = step === 0;
    svg.select('.recent-band').transition().duration(400).attr('opacity', showRecent ? 1 : 0);
    svg.select('.recent-label').transition().duration(400).attr('opacity', showRecent ? 1 : 0);

    const showFuture = step >= 1;
    svg.select('.fut-shade').transition().duration(400).attr('opacity', showFuture ? 1 : 0);
    svg.select('.now-line').transition().duration(400).attr('opacity', showFuture ? 1 : 0);
    svg.select('.obs-annot').transition().duration(400).attr('opacity', showFuture ? 1 : 0);

    const show126 = step >= 1;
    const w126 = xS(2100) - xS(PROJ_START['126']);
    p126.transition().duration(300).attr('opacity', show126 ? 1 : 0);
    d3.select('#c126 rect').transition().duration(show126 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show126 ? w126 : 0);

    const show245 = step >= 2;
    const w245 = xS(2100) - xS(PROJ_START['245']);
    p245.transition().duration(300).attr('opacity', show245 ? 1 : 0);
    d3.select('#c245 rect').transition().duration(show245 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show245 ? w245 : 0);

    const show585 = step >= 3;
    const w585 = xS(2100) - xS(PROJ_START['585']);
    p585.transition().duration(300).attr('opacity', show585 ? 1 : 0);
    d3.select('#c585 rect').transition().duration(show585 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show585 ? w585 : 0);

    document.getElementById('legend').classList.toggle('visible', step >= 1);
  }

  // ── SCROLL WIRING (scoped to Viz 1 steps only) ──
  function setupScroll() {
    const scroller = scrollama();
    scroller.setup({ step: '#steps .step', offset: 0.6 })
      .onStepEnter(({ element, index }) => {
        document.querySelectorAll('#steps .step').forEach(s => s.classList.remove('is-active'));
        element.classList.add('is-active');
        drawStep(index);
      })
      .onStepExit(({ index, direction }) => {
        if (direction === 'up' && index > 0) {
          const prev = document.querySelectorAll('#steps .step')[index - 1];
          document.querySelectorAll('#steps .step').forEach(s => s.classList.remove('is-active'));
          if (prev) prev.classList.add('is-active');
          drawStep(index - 1);
        }
      });
    window.addEventListener('resize', () => scroller.resize());
  }

  // ── RED-IRIS HANDOFF (chart → AND) ──
  // A red veil is revealed by a clip-path circle that grows from the center to
  // fill the screen as you scroll; the AND message fades in over the red. Both
  // are driven by the same scroll progress, so the effect reverses on scroll up.
  function setupIris() {
    const section = document.getElementById('heat-iris');
    if (!section) return;
    const veil = section.querySelector('.iris-veil');
    const content = section.querySelector('.iris-content');
    if (!veil || !content) return;
    let raf = 0;

    function render() {
      raf = 0;
      if (!motionOK()) {
        veil.style.clipPath = 'circle(150% at 50% 50%)';
        content.style.opacity = '1';
        content.style.transform = 'none';
        return;
      }
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-rect.top / travel) : (rect.top <= 0 ? 1 : 0);
      const wipe = smooth(clamp01(p / 0.5));          // circle fills over first half
      const tP = smooth(clamp01((p - 0.45) / 0.35));  // message fades in over the red
      veil.style.clipPath = 'circle(' + (wipe * 75).toFixed(2) + '% at 50% 50%)';
      content.style.opacity = tP.toFixed(3);
      content.style.transform = 'translateY(' + ((1 - tP) * 20).toFixed(1) + 'px)';
    }

    function onScroll() { if (!raf) raf = requestAnimationFrame(render); }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    render();
  }

  loadData().then(() => {
    build();
    setupScroll();
    setupIris();
    window.addEventListener('resize', build);
  }).catch(err => console.warn('[viz1] data load failed:', err));

})();
