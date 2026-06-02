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

  async function loadData() {
    [DATA_HIST, DATA_126, DATA_245, DATA_585] = await Promise.all([
      d3.csv('data/atlantic_sst_annual.csv'),
      d3.csv('data/ssp126.csv'),
      d3.csv('data/ssp245.csv'),
      d3.csv('data/ssp585.csv'),
    ]);
    DATA_HIST = parseRows(DATA_HIST);
    DATA_126  = parseRows(DATA_126);
    DATA_245  = parseRows(DATA_245);
    DATA_585  = parseRows(DATA_585);
  }

  // ── CHART ──
  const svgEl = document.getElementById('main-chart');
  const M = { top: 24, right: 28, bottom: 38, left: 50 };
  // explicit hex (var() is not reliably resolved inside SVG presentation attributes)
  const C = { hist: '#2563eb', ssp126: '#16a34a', ssp245: '#d97706', ssp585: '#dc2626' };

  let W, H, svg, xS, yS, lineGen, histPath, p126, p245, p585;
  let currentStep = -1;

  const LAST_OBS_YEAR = 2025;   // observed data ends here
  const FIRST_PROJ    = 2026;   // projections begin

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
        .append('rect').attr('x', xS(2015)).attr('y', 0).attr('width', 0).attr('height', H);
    });

    // Recent-warming highlight band (1990–2025) — shown on step 0
    svg.append('rect').attr('class', 'recent-band')
      .attr('x', xS(1990)).attr('y', 0)
      .attr('width', xS(LAST_OBS_YEAR) - xS(1990)).attr('height', H)
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

    // "Observed ends / Projection begins" divider + annotation
    svg.append('line').attr('class', 'now-line')
      .attr('x1', xS(FIRST_PROJ)).attr('x2', xS(FIRST_PROJ)).attr('y1', 0).attr('y2', H)
      .attr('stroke', '#94a8b3').attr('stroke-dasharray', '3,4').attr('opacity', 0);

    const annot = svg.append('g').attr('class', 'obs-annot').attr('opacity', 0);
    annot.append('text').attr('x', xS(FIRST_PROJ) - 6).attr('y', 13).attr('text-anchor', 'end')
      .attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', '10').attr('font-weight', 600)
      .text('← Observed ends 2025');
    annot.append('text').attr('x', xS(FIRST_PROJ) + 6).attr('y', 13).attr('text-anchor', 'start')
      .attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', '10').attr('font-weight', 600)
      .text('Projections begin →');

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
          html += row(C.hist, 'Observed', hist.sst);
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

    const futW = xS(2100) - xS(2015);

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
    p126.transition().duration(300).attr('opacity', show126 ? 1 : 0);
    d3.select('#c126 rect').transition().duration(show126 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show126 ? futW : 0);

    const show245 = step >= 2;
    p245.transition().duration(300).attr('opacity', show245 ? 1 : 0);
    d3.select('#c245 rect').transition().duration(show245 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show245 ? futW : 0);

    const show585 = step >= 3;
    p585.transition().duration(300).attr('opacity', show585 ? 1 : 0);
    d3.select('#c585 rect').transition().duration(show585 ? 1200 : 0).ease(d3.easeCubicInOut).attr('width', show585 ? futW : 0);

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

  loadData().then(() => {
    build();
    setupScroll();
    window.addEventListener('resize', build);
  }).catch(err => console.warn('[viz1] data load failed:', err));

})();
