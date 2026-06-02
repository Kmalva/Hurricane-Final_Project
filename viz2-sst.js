/* ════════════════════════════════════════════════════════════════════
   Viz 2 — GOES Atlantic sea surface temperature heatmap ("the fuel tank")
   Skill: d3-chart-patterns (margins, labeled axes, units legend, tooltip,
   annotation, responsive). Artifact-flexible: renders a D3 heatmap from the
   JSON grid if present, otherwise falls back to the rendered WebP, otherwise
   shows a graceful note. Reads data/goes_metadata.json first so a missing
   artifact never triggers a 404 in the console.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const fmtLon = d => (d < 0 ? `${Math.abs(Math.round(d))}°W` : `${Math.round(d)}°E`);
  const fmtLat = d => `${Math.round(d)}°N`;
  const color = d3.scaleSequential(d3.interpolateTurbo);

  let META = null, GRID = null;

  async function init() {
    try {
      META = await d3.json('data/goes_metadata.json');
    } catch (e) {
      return showFallback('Satellite SST map unavailable.');
    }
    const sub = document.getElementById('sst-map-sub');
    if (META && META.sst && META.sst.day) {
      sub.textContent = `GOES-16 ABI · clear-sky composite, ${META.sst.day} · °C`;
    } else {
      sub.textContent = 'GOES-16 ABI · sea surface temperature · °C';
    }

    const hasGrid = META.artifacts && META.artifacts.sst_grid;
    if (hasGrid) {
      try {
        GRID = await d3.json(META.artifacts.sst_grid);
        color.domain([GRID.vmin, GRID.vmax]);
        draw();
        window.addEventListener('resize', draw);
        return;
      } catch (e) { /* fall through */ }
    }
    // Fallback: rendered image layer
    if (META.artifacts && META.artifacts.sst_layer) {
      showImageFallback(META.artifacts.sst_layer);
    } else {
      showFallback('Satellite SST map unavailable.');
    }
  }

  function draw() {
    const svg = d3.select('#sst-map');
    svg.selectAll('*').remove();

    const wrap = document.getElementById('sst-map-wrap');
    const M = { top: 14, right: 16, bottom: 34, left: 44 };
    const fullW = Math.max(wrap.clientWidth, 320);
    const lonSpan = GRID.lon1 - GRID.lon0;        // east - west (positive)
    const latSpan = Math.abs(GRID.lat0 - GRID.lat1);
    const plotW = fullW - M.left - M.right;
    const plotH = plotW * (latSpan / lonSpan);
    const fullH = plotH + M.top + M.bottom;

    svg.attr('viewBox', `0 0 ${fullW} ${fullH}`).style('height', fullH + 'px');
    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const north = GRID.lat0, south = GRID.lat1; // lat0 = north (row 0)
    const x = d3.scaleLinear().domain([GRID.lon0, GRID.lon1]).range([0, plotW]);
    const y = d3.scaleLinear().domain([south, north]).range([plotH, 0]);

    // land / no-data background
    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', '#dde6ec');

    // cells
    const cw = plotW / GRID.nx, ch = plotH / GRID.ny;
    const tip = document.getElementById('tooltip');
    const cells = [];
    for (let r = 0; r < GRID.ny; r++) {
      for (let c = 0; c < GRID.nx; c++) {
        const v = GRID.values[r * GRID.nx + c];
        if (v == null) continue;
        cells.push({ r, c, v });
      }
    }
    g.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', d => d.c * cw).attr('y', d => d.r * ch)
      .attr('width', cw + 0.5).attr('height', ch + 0.5)
      .attr('fill', d => color(d.v))
      .attr('shape-rendering', 'crispEdges');

    // interaction surface (hover anywhere)
    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', 'transparent')
      .on('mousemove', function (e) {
        const [mx, my] = d3.pointer(e);
        const c = Math.floor(mx / cw), r = Math.floor(my / ch);
        if (r < 0 || r >= GRID.ny || c < 0 || c >= GRID.nx) return;
        const v = GRID.values[r * GRID.nx + c];
        const lon = GRID.lon0 + (c + 0.5) / GRID.nx * lonSpan;
        const lat = north - (r + 0.5) / GRID.ny * latSpan;
        tip.style.opacity = '1';
        tip.style.left = (e.clientX + 16) + 'px';
        tip.style.top = (e.clientY - 10) + 'px';
        tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#0c1f2a">${fmtLat(lat)}, ${fmtLon(lon)}</div>` +
          (v == null
            ? `<div style="color:#6b8090">Land / no retrieval</div>`
            : `<div style="display:flex;gap:10px;align-items:center"><span style="color:#6b8090">Sea surface</span><span style="margin-left:auto;font-weight:600">${v.toFixed(1)} °C</span></div>`);
      })
      .on('mouseleave', () => { tip.style.opacity = '0'; });

    // axes
    g.append('g').attr('transform', `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(7).tickFormat(fmtLon))
      .call(ax => { ax.select('.domain').attr('stroke', '#b9cad4'); ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11); ax.selectAll('.tick line').attr('stroke', '#cdd9e0'); });
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmtLat))
      .call(ax => { ax.select('.domain').attr('stroke', '#b9cad4'); ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11); ax.selectAll('.tick line').attr('stroke', '#cdd9e0'); });

    // Main Development Region annotation (10–20°N, 20–60°W)
    const mdr = { lon0: -60, lon1: -20, lat0: 10, lat1: 20 };
    g.append('rect')
      .attr('x', x(mdr.lon0)).attr('y', y(mdr.lat1))
      .attr('width', x(mdr.lon1) - x(mdr.lon0)).attr('height', y(mdr.lat0) - y(mdr.lat1))
      .attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', 1.6).attr('stroke-dasharray', '5,4').attr('opacity', 0.9);
    g.append('text')
      .attr('x', x(mdr.lon0)).attr('y', y(mdr.lat1) - 6)
      .attr('fill', '#ffffff').attr('font-family', 'Inter, Arial').attr('font-size', 11).attr('font-weight', 600)
      .attr('paint-order', 'stroke').attr('stroke', 'rgba(0,0,0,0.45)').attr('stroke-width', 2.6)
      .text('Main development region');

    // 26.5 °C "hurricane threshold" callout near the warm Gulf
    g.append('text')
      .attr('x', x(-89)).attr('y', y(24.5))
      .attr('fill', '#fff').attr('font-family', 'Inter, Arial').attr('font-size', 10.5).attr('font-weight', 600)
      .attr('paint-order', 'stroke').attr('stroke', 'rgba(0,0,0,0.5)').attr('stroke-width', 2.6)
      .text('Warm enough (≈26.5 °C+) to fuel storms');

    drawLegend();
  }

  function drawLegend() {
    const el = document.getElementById('sst-legend');
    el.innerHTML = '';
    const steps = 40;
    const grad = d3.range(steps).map(i => color(GRID.vmin + (i / (steps - 1)) * (GRID.vmax - GRID.vmin)));
    const bar = document.createElement('div');
    bar.className = 'legend-bar';
    bar.style.background = `linear-gradient(to right, ${grad.join(',')})`;
    const lo = document.createElement('span'); lo.className = 'legend-tick'; lo.textContent = `${GRID.vmin.toFixed(0)} °C`;
    const hi = document.createElement('span'); hi.className = 'legend-tick'; hi.textContent = `${GRID.vmax.toFixed(0)} °C`;
    const lab = document.createElement('span'); lab.textContent = 'Cooler'; lab.style.color = '#6b8090';
    const lab2 = document.createElement('span'); lab2.textContent = 'Warmer'; lab2.style.color = '#6b8090';
    el.append(lab, lo, bar, hi, lab2);
  }

  function showImageFallback(src) {
    const wrap = document.getElementById('sst-map-wrap');
    document.getElementById('sst-map').setAttribute('hidden', '');
    const fb = document.getElementById('sst-map-fallback');
    fb.hidden = false;
    fb.innerHTML = '';
    const img = document.createElement('img');
    img.src = src; img.alt = 'GOES sea surface temperature map';
    img.style.width = '100%'; img.style.borderRadius = '8px'; img.style.display = 'block';
    fb.style.minHeight = 'auto'; fb.style.border = 'none'; fb.style.background = 'none'; fb.style.padding = '0';
    fb.appendChild(img);
  }

  function showFallback(msg) {
    const fb = document.getElementById('sst-map-fallback');
    document.getElementById('sst-map').setAttribute('hidden', '');
    fb.hidden = false;
    fb.innerHTML = `<strong>Map unavailable</strong><span>${msg}</span>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
