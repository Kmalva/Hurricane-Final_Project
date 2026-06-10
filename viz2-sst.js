/* ════════════════════════════════════════════════════════════════════
   Viz 2 — GOES Atlantic SST heatmap — stacked hurricane / off-season
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const fmtLon = d => (d < 0 ? `${Math.abs(Math.round(d))}°W` : `${Math.round(d)}°E`);
  const fmtLat = d => (d >= 0 ? `${Math.round(d)}°N` : `${Math.abs(Math.round(d))}°S`);
  const color = d3.scaleSequential(d3.interpolateTurbo);

  const MDR = { lon0: -60, lon1: -20, lat0: 10, lat1: 20 };

  // Full Atlantic extent
  const ATL_LON0 = -98, ATL_LON1 = -15;
  const ATL_LAT0 = 33,  ATL_LAT1 = 7; // north, south

  const ANNOTATIONS = {
    hurricane: {
      fuel: { lon: -60, lat: 12, text: 'Warm enough (≈26.5 °C+) to fuel storms' },
      mdrExtra: null,
    },
    offseason: {
      fuel: { lon: -42, lat: 15, text: 'Most of the basin below ~26.5 °C — limited hurricane fuel' },
      mdrExtra: { lon: -58, lat: 21, text: 'Storms are rare Dec–May even here' },
    },
  };

  const SEASON_LABELS = {
    hurricane: 'Hurricane season (Sep)',
    offseason: 'Non-hurricane season (Feb)',
  };

  let META = null;
  let GRIDS = {};
  let colorDomain = null;
  let landFeatures = null;

  async function init() {
    try {
      const world = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
      landFeatures = topojson.feature(world, world.objects.countries);
    } catch (e) { /* not fatal */ }

    try {
      META = await d3.json('data/goes_metadata.json');
    } catch (e) {
      return showFallback('Satellite SST map unavailable.');
    }

    const seasons = META.sst_seasons;
    if (!seasons || !seasons.hurricane) return legacySingleGrid();

    colorDomain = seasons.color_domain || {
      vmin: Math.min(seasons.hurricane.vmin, seasons.offseason?.vmin ?? seasons.hurricane.vmin),
      vmax: Math.max(seasons.hurricane.vmax, seasons.offseason?.vmax ?? seasons.hurricane.vmax),
    };
    color.domain([colorDomain.vmin, colorDomain.vmax]);

    try {
      GRIDS.hurricane = await d3.json(seasons.hurricane.grid);
    } catch (e) {
      return showFallback('Hurricane-season SST grid unavailable.');
    }

    if (seasons.offseason?.grid) {
      try { GRIDS.offseason = await d3.json(seasons.offseason.grid); } catch (e) { /* skip */ }
    }

    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;

    buildStackedLayout();
    window.addEventListener('resize', buildStackedLayout);
  }

  function buildStackedLayout() {
    const wrap = document.getElementById('sst-map-wrap');
    wrap.innerHTML = '';

    const orig = document.getElementById('sst-map');
    if (orig) orig.hidden = true;

    const seasons = ['hurricane', 'offseason'].filter(s => GRIDS[s]);
    seasons.forEach(id => {
      const container = document.createElement('div');
      container.className = 'sst-panel';
      container.dataset.season = id;

      const header = document.createElement('div');
      header.className = 'sst-panel-label';
      header.textContent = SEASON_LABELS[id] || id;

      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.id = `sst-map-${id}`;
      svgEl.setAttribute('role', 'img');
      svgEl.setAttribute('aria-label', `Atlantic SST — ${SEASON_LABELS[id]}`);
      svgEl.style.display = 'block';
      svgEl.style.width = '100%';
      svgEl.style.borderRadius = '8px';
      svgEl.style.overflow = 'visible';

      container.appendChild(header);
      container.appendChild(svgEl);
      wrap.appendChild(container);

      drawPanel(id, svgEl);
    });

    updateSeasonNote();
    drawLegend();
  }

  function drawPanel(seasonId, svgEl) {
    const GRID = GRIDS[seasonId];
    if (!GRID) return;

    const wrap = document.getElementById('sst-map-wrap');
    const M = { top: 10, right: 16, bottom: 34, left: 44 };

    // Use panel width (half of wrap since side by side)
    const panelEl = svgEl.parentElement;
    const fullW = Math.max(panelEl ? panelEl.clientWidth : wrap.clientWidth / 2, 200);

    const lonSpan = ATL_LON1 - ATL_LON0;
    const latSpan = ATL_LAT0 - ATL_LAT1;
    const plotW = fullW - M.left - M.right;
    const plotH = plotW * (latSpan / lonSpan);
    const fullH = plotH + M.top + M.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${fullW} ${fullH}`).style('height', fullH + 'px');

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Scales locked to full Atlantic viewport
    const x = d3.scaleLinear().domain([ATL_LON0, ATL_LON1]).range([0, plotW]);
    const y = d3.scaleLinear().domain([ATL_LAT1, ATL_LAT0]).range([plotH, 0]);

    // Ocean background
    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', '#ffffff');

    // SST cells — filtered to Atlantic viewport
    const north = GRID.lat0;
    const south = GRID.lat1;
    const fullLonSpan = GRID.lon1 - GRID.lon0;
    const fullLatSpan = Math.abs(north - south);
    const cw = plotW / GRID.nx * (fullLonSpan / lonSpan);
    const ch = plotH / GRID.ny * (fullLatSpan / latSpan);

    const cells = [];
    for (let r = 0; r < GRID.ny; r++) {
      for (let c = 0; c < GRID.nx; c++) {
        const v = GRID.values[r * GRID.nx + c];
        const cellLon = GRID.lon0 + (c + 0.5) / GRID.nx * fullLonSpan;
        const cellLat = north - (r + 0.5) / GRID.ny * fullLatSpan;
        if (cellLon < ATL_LON0 || cellLon > ATL_LON1) continue;
        if (cellLat < ATL_LAT1 || cellLat > ATL_LAT0) continue;
        cells.push({ v, cellLon, cellLat });
      }
    }

    g.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', d => x(d.cellLon) - cw / 2)
      .attr('y', d => y(d.cellLat) - ch / 2)
      .attr('width', cw + 0.5)
      .attr('height', ch + 0.5)
      .attr('fill', d => d.v == null ? '#ffffff' : color(d.v))
      .attr('shape-rendering', 'crispEdges');

    // ── Land polygons using same x/y scales as SST cells ──
    if (landFeatures) {
      const clipId = `land-clip-${seasonId}`;
      g.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', plotW).attr('height', plotH);

      const projectPoint = function (lon, lat) {
        this.stream.point(x(lon), y(lat));
      };
      const path = d3.geoPath(d3.geoTransform({ point: projectPoint }));

      const atlasFeatures = landFeatures.features.filter(f => {
        const b = d3.geoBounds(f);
        return b[1][0] >= ATL_LON0 && b[0][0] <= ATL_LON1 &&
               b[1][1] >= ATL_LAT1 && b[0][1] <= ATL_LAT0;
      });

      g.append('g')
        .attr('clip-path', `url(#${clipId})`)
        .selectAll('path')
        .data(atlasFeatures)
        .join('path')
        .attr('d', path)
        .attr('fill', '#738372')
        .attr('stroke', '#32392f')
        .attr('stroke-width', 0.8);
    }

    // Tooltip overlay
    const tip = document.getElementById('tooltip');
    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', 'transparent')
      .on('mousemove', function (e) {
        const [mx, my] = d3.pointer(e);
        const lon = ATL_LON0 + (mx / plotW) * lonSpan;
        const lat = ATL_LAT0 - (my / plotH) * latSpan;
        const c = Math.round((lon - GRID.lon0) / fullLonSpan * GRID.nx - 0.5);
        const r = Math.round((north - lat) / fullLatSpan * GRID.ny - 0.5);
        const v = (r >= 0 && r < GRID.ny && c >= 0 && c < GRID.nx)
          ? GRID.values[r * GRID.nx + c] : null;
        tip.style.opacity = '1';
        tip.style.left = (e.clientX + 16) + 'px';
        tip.style.top = (e.clientY - 10) + 'px';
        tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#0c1f2a">${fmtLat(lat)}, ${fmtLon(lon)}</div>` +
          (v == null
            ? `<div style="color:#6b8090">Land</div>`
            : `<div style="display:flex;gap:10px;align-items:center"><span style="color:#6b8090">Sea surface</span><span style="margin-left:auto;font-weight:600">${v.toFixed(1)} °C</span></div>`);
      })
      .on('mouseleave', () => { tip.style.opacity = '0'; });

    // Axes
    g.append('g').attr('transform', `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(fmtLon))
      .call(ax => {
        ax.select('.domain').attr('stroke', '#b9cad4');
        ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11);
        ax.selectAll('.tick line').attr('stroke', '#cdd9e0');
      });
    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat(fmtLat))
      .call(ax => {
        ax.select('.domain').attr('stroke', '#b9cad4');
        ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11);
        ax.selectAll('.tick line').attr('stroke', '#cdd9e0');
      });

    drawAnnotations(g, x, y, seasonId);
  }

  function legacySingleGrid() {
    const sub = document.getElementById('sst-map-sub');
    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;
    if (META.sst?.day) sub.textContent = `GOES-16 ABI · clear-sky composite, ${META.sst.day} · °C`;
    const path = META.artifacts?.sst_grid;
    if (!path) return showFallback('Satellite SST map unavailable.');
    d3.json(path).then(grid => {
      GRIDS.hurricane = grid;
      color.domain([grid.vmin, grid.vmax]);
      colorDomain = { vmin: grid.vmin, vmax: grid.vmax };
      buildStackedLayout();
      window.addEventListener('resize', buildStackedLayout);
    }).catch(() => showFallback('Satellite SST map unavailable.'));
  }

  function annotText(g, x, y, lon, lat, text, fill) {
    g.append('text')
      .attr('x', x(lon)).attr('y', y(lat))
      .attr('fill', fill || '#fff')
      .attr('font-family', 'Inter, Arial')
      .attr('font-size', 10.5)
      .attr('font-weight', 600)
      .attr('paint-order', 'stroke')
      .attr('stroke', 'rgba(0,0,0,0.5)')
      .attr('stroke-width', 2.6)
      .text(text);
  }

  function drawAnnotations(g, x, y, seasonId) {
    // Only draw MDR box if it falls within the viewport
    g.append('rect')
      .attr('x', x(MDR.lon0)).attr('y', y(MDR.lat1))
      .attr('width', x(MDR.lon1) - x(MDR.lon0))
      .attr('height', y(MDR.lat0) - y(MDR.lat1))
      .attr('fill', 'none')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.6)
      .attr('stroke-dasharray', '5,4')
      .attr('opacity', 0.9);
    annotText(g, x, y, MDR.lon0, MDR.lat1 - 0.4, 'Main development region', '#fff');
    const cfg = ANNOTATIONS[seasonId] || ANNOTATIONS.hurricane;
    if (cfg.fuel) annotText(g, x, y, cfg.fuel.lon, cfg.fuel.lat, cfg.fuel.text, '#fff');
    if (cfg.mdrExtra) annotText(g, x, y, cfg.mdrExtra.lon, cfg.mdrExtra.lat, cfg.mdrExtra.text, '#e0f2fe');
  }

  function mdrMean(grid) {
    if (!grid) return null;
    const lonSpan = grid.lon1 - grid.lon0;
    const latSpan = Math.abs(grid.lat0 - grid.lat1);
    const north = grid.lat0;
    let sum = 0, n = 0;
    for (let r = 0; r < grid.ny; r++) {
      for (let c = 0; c < grid.nx; c++) {
        const lon = grid.lon0 + (c + 0.5) / grid.nx * lonSpan;
        const lat = north - (r + 0.5) / grid.ny * latSpan;
        if (lon < MDR.lon0 || lon > MDR.lon1 || lat < MDR.lat0 || lat > MDR.lat1) continue;
        const v = grid.values[r * grid.nx + c];
        if (v != null && Number.isFinite(v)) { sum += v; n++; }
      }
    }
    return n > 0 ? sum / n : null;
  }

  function updateSeasonNote() {
    const el = document.getElementById('sst-season-note');
    if (!el || !META?.sst_seasons) return;
    const h = META.sst_seasons.hurricane;
    const o = META.sst_seasons.offseason;
    const mh = mdrMean(GRIDS.hurricane);
    const mo = mdrMean(GRIDS.offseason);
    if (mh == null || mo == null) { el.textContent = ''; return; }
    const delta = Math.abs(mh - mo);
    const hMonth = (h.day || '').slice(5, 7) === '09' ? 'Sep' : 'peak season';
    const oMonth = (o.day || '').slice(5, 7) === '02' ? 'Feb' : 'off-season';
    el.innerHTML = `In the main development region, peak season (${hMonth}) is about <strong>${delta.toFixed(1)} °C warmer</strong> than mid-winter (${oMonth}) — that extra heat is the fuel.`;
  }

  function drawLegend() {
    const el = document.getElementById('sst-legend');
    if (!el || !colorDomain) return;
    el.innerHTML = '';
    const { vmin, vmax } = colorDomain;
    const steps = 40;
    const grad = d3.range(steps).map(i => color(vmin + (i / (steps - 1)) * (vmax - vmin)));
    const bar = document.createElement('div');
    bar.className = 'legend-bar';
    bar.style.background = `linear-gradient(to right, ${grad.join(',')})`;
    const lo = document.createElement('span'); lo.className = 'legend-tick'; lo.textContent = `${vmin.toFixed(0)} °C`;
    const hi = document.createElement('span'); hi.className = 'legend-tick'; hi.textContent = `${vmax.toFixed(0)} °C`;
    const lab = document.createElement('span'); lab.textContent = 'Cooler'; lab.style.color = '#6b8090';
    const lab2 = document.createElement('span'); lab2.textContent = 'Warmer'; lab2.style.color = '#6b8090';
    const shared = document.createElement('span'); shared.textContent = '(shared scale)'; shared.style.color = '#6b8090'; shared.style.fontSize = '10.5px';
    el.append(lab, lo, bar, hi, lab2, shared);
  }

  function showFallback(msg) {
    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;
    const orig = document.getElementById('sst-map');
    if (orig) orig.hidden = true;
    const fb = document.getElementById('sst-map-fallback');
    if (fb) { fb.hidden = false; fb.innerHTML = `<strong>Map unavailable</strong><span>${msg}</span>`; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();