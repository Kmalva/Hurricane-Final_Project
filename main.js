// ── DATA LOADING ──
// Put your CSV files in the same folder as index.html.
// Each CSV needs a "year" column and an "sst" column.

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
// chart.js
// Builds and redraws the D3 chart. Depends on data.js being loaded first.

const svgEl = document.getElementById('main-chart');
const M = { top: 16, right: 24, bottom: 36, left: 46 };

let W, H, svg, xS, yS, lineGen, histPath, p126, p245, p585;
let currentStep = -1;

function build() {
  const wrap = document.getElementById('chart-wrap');
  W = wrap.clientWidth - M.left - M.right;
  H = Math.min(Math.max(window.innerHeight * 0.44, 240), 380);

  svgEl.setAttribute('viewBox', `0 0 ${W + M.left + M.right} ${H + M.top + M.bottom}`);
  svgEl.innerHTML = '';

  svg = d3.select(svgEl)
    .append('g')
    .attr('transform', `translate(${M.left},${M.top})`);

  const allY = [...DATA_HIST, ...DATA_126, ...DATA_245, ...DATA_585].map(d => d.sst);
  xS      = d3.scaleLinear().domain([1900, 2100]).range([0, W]);
  yS      = d3.scaleLinear().domain([d3.min(allY) - 0.15, d3.max(allY) + 0.25]).range([H, 0]);
  lineGen = d3.line().x(d => xS(d.year)).y(d => yS(d.sst)).curve(d3.curveCatmullRom.alpha(0.5));

  // Light grid
  svg.append('g')
    .call(d3.axisLeft(yS).tickSize(-W).tickFormat('').ticks(5))
    .call(g => {
      g.select('.domain').remove();
      g.selectAll('line').attr('stroke', '#f3f4f6');
    });

  // X axis
  svg.append('g')
    .attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xS).tickFormat(d3.format('d')).ticks(10))
    .call(g => {
      g.select('.domain').attr('stroke', '#d1d5db');
      g.selectAll('text').attr('fill', '#9ca3af').attr('font-family', 'Arial').attr('font-size', '10.5');
      g.selectAll('.tick line').attr('stroke', '#e5e7eb');
    });

  // Y axis
  svg.append('g')
    .call(d3.axisLeft(yS).ticks(5).tickFormat(d => `${d.toFixed(1)}°`))
    .call(g => {
      g.select('.domain').remove();
      g.selectAll('text').attr('fill', '#9ca3af').attr('font-family', 'Arial').attr('font-size', '10.5');
      g.selectAll('.tick line').remove();
    });

  // Y-axis label
  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -H / 2).attr('y', -36)
    .attr('text-anchor', 'middle')
    .attr('fill', '#9ca3af').attr('font-family', 'Arial').attr('font-size', '10')
    .text('°C');

  // Axis break marker (zigzag at bottom of y axis)
  const bx = -M.left + 4;
  const by = H + 6;
  svg.append('polyline')
    .attr('points', `${bx},${by} ${bx+6},${by-5} ${bx+12},${by+5} ${bx+18},${by-5} ${bx+24},${by}`)
    .attr('fill', 'none').attr('stroke', '#9ca3af').attr('stroke-width', 1.5);
  svg.append('text')
    .attr('x', bx - 2).attr('y', by + 14)
    .attr('fill', '#9ca3af').attr('font-family', 'Arial').attr('font-size', '9')
    .text('axis break');

  // Clip paths
  const defs = svg.append('defs');
  defs.append('clipPath').attr('id', 'ch')
    .append('rect').attr('y', 0).attr('width', 0).attr('height', H);
  ['126', '245', '585'].forEach(s => {
    defs.append('clipPath').attr('id', `c${s}`)
      .append('rect').attr('x', xS(2015)).attr('y', 0).attr('width', 0).attr('height', H);
  });

  // Future background shade
  svg.append('rect').attr('class', 'fut-shade')
    .attr('x', xS(2026)).attr('y', 0)
    .attr('width', xS(2100) - xS(2026)).attr('height', H)
    .attr('fill', '#f9fafb').attr('opacity', 0);

  // SSP projection lines
  p126 = svg.append('path').datum(DATA_126).attr('fill', 'none')
    .attr('stroke', 'var(--ssp126)').attr('stroke-width', 2)
    .attr('clip-path', 'url(#c126)').attr('d', lineGen).attr('opacity', 0);

  p245 = svg.append('path').datum(DATA_245).attr('fill', 'none')
    .attr('stroke', 'var(--ssp245)').attr('stroke-width', 2)
    .attr('clip-path', 'url(#c245)').attr('d', lineGen).attr('opacity', 0);

  p585 = svg.append('path').datum(DATA_585).attr('fill', 'none')
    .attr('stroke', 'var(--ssp585)').attr('stroke-width', 2)
    .attr('clip-path', 'url(#c585)').attr('d', lineGen).attr('opacity', 0);

  // Historical line (drawn on top)
  histPath = svg.append('path').datum(DATA_HIST).attr('fill', 'none')
    .attr('stroke', 'var(--hist)').attr('stroke-width', 2.2)
    .attr('clip-path', 'url(#ch)').attr('d', lineGen);

  // "Today" divider
  svg.append('line').attr('class', 'now-line')
    .attr('x1', xS(2026)).attr('x2', xS(2026))
    .attr('y1', 0).attr('y2', H)
    .attr('stroke', '#d1d5db').attr('stroke-dasharray', '3,4').attr('opacity', 0);

  svg.append('text').attr('class', 'now-label')
    .attr('x', xS(2026) + 5).attr('y', 13)
    .attr('fill', '#9ca3af').attr('font-family', 'Arial').attr('font-size', '10')
    .text('today').attr('opacity', 0);

  // Hover — vertical crosshair + dots + multi-value tooltip
  const bisect = d3.bisector(d => d.year).left;
  const tip = document.getElementById('tooltip');

  // Vertical hover line
  const hoverLine = svg.append('line')
    .attr('y1', 0).attr('y2', H)
    .attr('stroke', '#d1d5db').attr('stroke-width', 1)
    .attr('pointer-events', 'none').attr('opacity', 0);

  // One dot per series
  const dotHist = svg.append('circle').attr('r', 4).attr('fill', 'var(--hist)').attr('opacity', 0).attr('pointer-events', 'none');
  const dot126  = svg.append('circle').attr('r', 4).attr('fill', 'var(--ssp126)').attr('opacity', 0).attr('pointer-events', 'none');
  const dot245  = svg.append('circle').attr('r', 4).attr('fill', 'var(--ssp245)').attr('opacity', 0).attr('pointer-events', 'none');
  const dot585  = svg.append('circle').attr('r', 4).attr('fill', 'var(--ssp585)').attr('opacity', 0).attr('pointer-events', 'none');

  function getVal(dataset, yr) {
    const i = bisect(dataset, yr, 1);
    return dataset[Math.min(i, dataset.length - 1)];
  }

  svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
    .on('mousemove', function(e) {
      const yr = Math.round(xS.invert(d3.pointer(e)[0]));
      hoverLine.attr('x1', xS(yr)).attr('x2', xS(yr)).attr('opacity', 1);

      const isFuture = yr > 2026;
      const hist = getVal(DATA_HIST, yr);

      // Historical dot — only in historical range
      if (!isFuture && hist) {
        dotHist.attr('cx', xS(hist.year)).attr('cy', yS(hist.sst)).attr('opacity', 1);
      } else {
        dotHist.attr('opacity', 0);
      }

      // Future dots — only in future range
      const v126 = isFuture ? getVal(DATA_126, yr) : null;
      const v245 = isFuture ? getVal(DATA_245, yr) : null;
      const v585 = isFuture ? getVal(DATA_585, yr) : null;

      dot126.attr('opacity', v126 && currentStep >= 1 ? 1 : 0);
      dot245.attr('opacity', v245 && currentStep >= 2 ? 1 : 0);
      dot585.attr('opacity', v585 && currentStep >= 3 ? 1 : 0);
      if (v126) dot126.attr('cx', xS(v126.year)).attr('cy', yS(v126.sst));
      if (v245) dot245.attr('cx', xS(v245.year)).attr('cy', yS(v245.sst));
      if (v585) dot585.attr('cx', xS(v585.year)).attr('cy', yS(v585.sst));

      // Build tooltip
      let html = `<div style="font-weight:600;margin-bottom:5px;color:#374151">${yr}</div>`;
      if (!isFuture && hist) {
        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--hist);display:inline-block"></span>
          <span style="color:#6b7280">Observed</span>
          <span style="margin-left:auto;font-weight:500">${hist.sst.toFixed(2)} °C</span></div>`;
      }
      if (isFuture) {
        if (v126 && currentStep >= 1) html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--ssp126);display:inline-block"></span>
          <span style="color:#6b7280">SSP1-2.6</span>
          <span style="margin-left:auto;font-weight:500">${v126.sst.toFixed(2)} °C</span></div>`;
        if (v245 && currentStep >= 2) html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--ssp245);display:inline-block"></span>
          <span style="color:#6b7280">SSP2-4.5</span>
          <span style="margin-left:auto;font-weight:500">${v245.sst.toFixed(2)} °C</span></div>`;
        if (v585 && currentStep >= 3) html += `<div style="display:flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--ssp585);display:inline-block"></span>
          <span style="color:#6b7280">SSP5-8.5</span>
          <span style="margin-left:auto;font-weight:500">${v585.sst.toFixed(2)} °C</span></div>`;
      }

      tip.style.opacity = '1';
      tip.style.left = (e.clientX + 16) + 'px';
      tip.style.top  = (e.clientY - 10) + 'px';
      tip.innerHTML  = html;
    })
    .on('mouseleave', () => {
      hoverLine.attr('opacity', 0);
      dotHist.attr('opacity', 0); dot126.attr('opacity', 0);
      dot245.attr('opacity', 0);  dot585.attr('opacity', 0);
      tip.style.opacity = '0';
    });

  drawStep(currentStep < 0 ? 0 : currentStep, true);
}

function drawStep(step, force) {
  if (step === currentStep && !force) return;
  currentStep = step;

  const futW = xS(2100) - xS(2015);

  // Historical always visible; animate on first load
  d3.select('#ch rect').attr('width', W);
  if (step === 0 && force) {
    d3.select('#ch rect').attr('width', 0)
      .transition().duration(1600).ease(d3.easeCubicInOut).attr('width', W);
  }

  const showFuture = step >= 1;
  svg.select('.fut-shade').transition().duration(400).attr('opacity', showFuture ? 1 : 0);
  svg.select('.now-line').transition().duration(400).attr('opacity', showFuture ? 1 : 0);
  svg.select('.now-label').transition().duration(400).attr('opacity', showFuture ? 1 : 0);

  const show126 = step >= 1;
  p126.transition().duration(300).attr('opacity', show126 ? 1 : 0);
  d3.select('#c126 rect').transition().duration(show126 ? 1200 : 0)
    .ease(d3.easeCubicInOut).attr('width', show126 ? futW : 0);

  const show245 = step >= 2;
  p245.transition().duration(300).attr('opacity', show245 ? 1 : 0);
  d3.select('#c245 rect').transition().duration(show245 ? 1200 : 0)
    .ease(d3.easeCubicInOut).attr('width', show245 ? futW : 0);

  const show585 = step >= 3;
  p585.transition().duration(300).attr('opacity', show585 ? 1 : 0);
  d3.select('#c585 rect').transition().duration(show585 ? 1200 : 0)
    .ease(d3.easeCubicInOut).attr('width', show585 ? futW : 0);

  document.getElementById('legend').classList.toggle('visible', step >= 1);
}

loadData().then(() => {
  build();
  window.addEventListener('resize', build);
});
// scroll.js
// Sets up Scrollama and wires scroll steps to chart state transitions.

const scroller = scrollama();

scroller.setup({ step: '.step', offset: 0.55 })
  .onStepEnter(({ element, index }) => {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('is-active'));
    element.classList.add('is-active');
    drawStep(index);
  })
  .onStepExit(({ index, direction }) => {
    if (direction === 'up' && index > 0) {
      const prev = document.querySelectorAll('.step')[index - 1];
      document.querySelectorAll('.step').forEach(s => s.classList.remove('is-active'));
      if (prev) prev.classList.add('is-active');
      drawStep(index - 1);
    }
  });