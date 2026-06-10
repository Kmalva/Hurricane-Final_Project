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
      fuel: { lon: -72, lat: 13, text: 'Most of the basin below ~26.5 °C — limited fuel', anchor: 'middle' },
      mdrExtra: { lon: -58, lat: 21, text: 'Storms are rare Dec–May even here' },
    },
  };

  const SEASON_LABELS = {
    hurricane: 'Hurricane season (Sep)',
    offseason: 'Non-hurricane season (Feb)',
  };

  const QUALITY_LABELS = {
    goes: 'GOES (clear sky)',
    interpolated: 'interpolated from nearby GOES',
    ersst: 'ERSST monthly (cloud gap fill)',
  };

  const CACHE_BUST = 'v=15';
  const IDW_POWER = 2;
  const IDW_MAX_DEG = 5;

  let META = null;
  let GRIDS = {};
  let DISPLAY = {};
  let colorDomain = null;
  let landFeatures = null;

  function bustUrl(path) {
    if (!path) return path;
    return path + (path.includes('?') ? '&' : '?') + CACHE_BUST;
  }

  function gridIndex(GRID, r, c) {
    return r * GRID.nx + c;
  }

  function cellLonLat(GRID, r, c) {
    const lonSpan = GRID.lon1 - GRID.lon0;
    const latSpan = Math.abs(GRID.lat0 - GRID.lat1);
    return {
      lon: GRID.lon0 + (c + 0.5) / GRID.nx * lonSpan,
      lat: GRID.lat0 - (r + 0.5) / GRID.ny * latSpan,
    };
  }

  function isLandCell(GRID, idx) {
    return GRID.quality?.[idx] === 'land';
  }

  function collectSamples(GRID) {
    const samples = [];
    for (let r = 0; r < GRID.ny; r++) {
      for (let c = 0; c < GRID.nx; c++) {
        const idx = gridIndex(GRID, r, c);
        if (isLandCell(GRID, idx)) continue;
        const v = GRID.values[idx];
        if (v == null || !Number.isFinite(v)) continue;
        const { lon, lat } = cellLonLat(GRID, r, c);
        samples.push({ lon, lat, v, q: GRID.quality?.[idx] ?? 'goes' });
      }
    }
    return samples;
  }

  function idwAt(lon, lat, samples) {
    if (!samples.length) return null;
    let num = 0, den = 0, nearest = null, nearD = Infinity;
    for (const s of samples) {
      const d = Math.hypot(s.lon - lon, s.lat - lat);
      if (d < nearD) { nearD = d; nearest = s; }
      if (d < 0.02) return { v: s.v, q: s.q, dist: d };
      if (d > IDW_MAX_DEG) continue;
      const w = 1 / Math.pow(d, IDW_POWER);
      num += w * s.v;
      den += w;
    }
    if (den > 0) return { v: num / den, q: 'interpolated', dist: 0 };
    if (nearest && nearD <= IDW_MAX_DEG * 1.5) return { v: nearest.v, q: nearest.q, dist: nearD };
    return null;
  }

  function buildDisplayGrid(GRID) {
    const samples = collectSamples(GRID);
    const n = GRID.nx * GRID.ny;
    const values = new Float32Array(n);
    values.fill(NaN);
    const quality = new Array(n);
    const land = new Uint8Array(n);

    for (let r = 0; r < GRID.ny; r++) {
      for (let c = 0; c < GRID.nx; c++) {
        const idx = gridIndex(GRID, r, c);
        if (isLandCell(GRID, idx)) {
          land[idx] = 1;
          quality[idx] = 'land';
          continue;
        }
        const raw = GRID.values[idx];
        if (raw != null && Number.isFinite(raw)) {
          values[idx] = raw;
          quality[idx] = GRID.quality?.[idx] ?? 'goes';
        }
      }
    }

    for (let r = 0; r < GRID.ny; r++) {
      for (let c = 0; c < GRID.nx; c++) {
        const idx = gridIndex(GRID, r, c);
        if (land[idx] || Number.isFinite(values[idx])) continue;
        const { lon, lat } = cellLonLat(GRID, r, c);
        const est = idwAt(lon, lat, samples);
        if (est) {
          values[idx] = est.v;
          quality[idx] = est.q;
        }
      }
    }

    return { values, quality, land, samples };
  }

  function sampleDisplay(DISPLAY_GRID, GRID, lon, lat) {
    const lonSpan = GRID.lon1 - GRID.lon0;
    const latSpan = Math.abs(GRID.lat0 - GRID.lat1);
    const fx = (lon - GRID.lon0) / lonSpan * GRID.nx - 0.5;
    const fy = (GRID.lat0 - lat) / latSpan * GRID.ny - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const c1 = c0 + 1;
    const r1 = r0 + 1;
    const tx = fx - c0;
    const ty = fy - r0;

    function at(r, c) {
      if (r < 0 || r >= GRID.ny || c < 0 || c >= GRID.nx) return null;
      const idx = gridIndex(GRID, r, c);
      if (DISPLAY_GRID.land[idx]) return null;
      const v = DISPLAY_GRID.values[idx];
      return Number.isFinite(v) ? { v, q: DISPLAY_GRID.quality[idx] } : null;
    }

    const p00 = at(r0, c0), p10 = at(r0, c1), p01 = at(r1, c0), p11 = at(r1, c1);
    const pts = [p00, p10, p01, p11].filter(Boolean);
    if (!pts.length) return idwAt(lon, lat, DISPLAY_GRID.samples);

    let num = 0, den = 0;
    if (p00) { const w = (1 - tx) * (1 - ty); num += p00.v * w; den += w; }
    if (p10) { const w = tx * (1 - ty); num += p10.v * w; den += w; }
    if (p01) { const w = (1 - tx) * ty; num += p01.v * w; den += w; }
    if (p11) { const w = tx * ty; num += p11.v * w; den += w; }
    const v = den ? num / den : pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const q = pts.some(p => p.q === 'goes') ? 'goes'
      : pts.some(p => p.q === 'ersst') ? 'ersst' : 'interpolated';
    return { v, q };
  }

  function renderHeatmapCanvas(DISPLAY_GRID, GRID, plotW, plotH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(plotW * dpr));
    const h = Math.max(1, Math.round(plotH * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const lonSpan = ATL_LON1 - ATL_LON0;
    const latSpan = ATL_LAT0 - ATL_LAT1;

    const gridLonSpan = GRID.lon1 - GRID.lon0;
    const gridLatSpan = Math.abs(GRID.lat0 - GRID.lat1);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const lon = ATL_LON0 + (px / w) * lonSpan;
        const lat = ATL_LAT0 - (py / h) * latSpan;
        const i = (py * w + px) * 4;
        const gc = Math.min(GRID.nx - 1, Math.max(0, Math.floor((lon - GRID.lon0) / gridLonSpan * GRID.nx)));
        const gr = Math.min(GRID.ny - 1, Math.max(0, Math.floor((GRID.lat0 - lat) / gridLatSpan * GRID.ny)));
        if (DISPLAY_GRID.land[gr * GRID.nx + gc]) {
          img.data[i + 3] = 0;
          continue;
        }
        const hit = sampleDisplay(DISPLAY_GRID, GRID, lon, lat);
        if (!hit || hit.v == null) {
          img.data[i + 3] = 0;
          continue;
        }
        const rgb = d3.color(color(hit.v));
        img.data[i] = rgb.r;
        img.data[i + 1] = rgb.g;
        img.data[i + 2] = rgb.b;
        img.data[i + 3] = hit.q === 'ersst' ? 235 : hit.q === 'interpolated' ? 245 : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function updateMapSubtitle() {
    const sub = document.getElementById('sst-map-sub');
    if (!sub || !META?.sst_seasons) return;
    const h = META.sst_seasons.hurricane;
    const o = META.sst_seasons.offseason;
    sub.textContent = `Sep 2022 vs Feb 2022 · multi-day GOES composite · shared scale ${colorDomain.vmin.toFixed(0)}–${colorDomain.vmax.toFixed(0)} °C`;
    if (h?.day && o?.day) {
      sub.textContent = `Multi-day clear-sky composite (${h.day.slice(0, 7)} vs ${o.day.slice(0, 7)}) · shared scale ${colorDomain.vmin.toFixed(0)}–${colorDomain.vmax.toFixed(0)} °C`;
    }
  }

  async function init() {
    try {
      const world = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
      landFeatures = topojson.feature(world, world.objects.countries);
    } catch (e) { /* not fatal */ }

    try {
      META = await d3.json(bustUrl('data/goes_metadata.json'));
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
      GRIDS.hurricane = await d3.json(bustUrl(seasons.hurricane.grid));
    } catch (e) {
      return showFallback('Hurricane-season SST grid unavailable.');
    }

    if (seasons.offseason?.grid) {
      try { GRIDS.offseason = await d3.json(bustUrl(seasons.offseason.grid)); } catch (e) { /* skip */ }
    }

    DISPLAY.hurricane = buildDisplayGrid(GRIDS.hurricane);
    if (GRIDS.offseason) DISPLAY.offseason = buildDisplayGrid(GRIDS.offseason);

    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;

    updateMapSubtitle();
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
      svgEl.style.overflow = 'hidden';

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
    const DISP = DISPLAY[seasonId];
    if (!GRID || !DISP) return;

    const wrap = document.getElementById('sst-map-wrap');
    const M = { top: 10, right: 16, bottom: 34, left: 44 };

    // Use panel width (half of wrap since side by side)
    const panelEl = svgEl.parentElement;
    const fullW = Math.max(panelEl ? panelEl.clientWidth : wrap.clientWidth / 2, 200);

    const lonSpan = ATL_LON1 - ATL_LON0;
    const latSpan = ATL_LAT0 - ATL_LAT1;
    const plotW = fullW - M.left - M.right;
    const plotH = plotW * (latSpan / lonSpan) * 1.2;
    const fullH = plotH + M.top + M.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${fullW} ${fullH}`).style('height', fullH + 'px');

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Scales locked to full Atlantic viewport
    const x = d3.scaleLinear().domain([ATL_LON0, ATL_LON1]).range([0, plotW]);
    const y = d3.scaleLinear().domain([ATL_LAT1, ATL_LAT0]).range([plotH, 0]);

  // Ocean background
    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', '#e8f2f7');

    const heatCanvas = renderHeatmapCanvas(DISP, GRID, plotW, plotH);
    const dataUrl = heatCanvas.toDataURL('image/png');
    g.append('image')
      .attr('href', dataUrl)
      .attr('x', 0).attr('y', 0)
      .attr('width', plotW)
      .attr('height', plotH)
      .attr('preserveAspectRatio', 'none');

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
        const hit = sampleDisplay(DISP, GRID, lon, lat);
        tip.style.opacity = '1';
        tip.style.left = (e.clientX + 16) + 'px';
        tip.style.top = (e.clientY - 10) + 'px';
        let body;
        if (!hit || hit.v == null) {
          body = `<div style="color:#6b8090">Land</div>`;
        } else {
          const src = QUALITY_LABELS[hit.q] || 'interpolated';
          body = `<div style="display:flex;gap:10px;align-items:center"><span style="color:#6b8090">Sea surface · ${src}</span><span style="margin-left:auto;font-weight:600">${hit.v.toFixed(1)} °C</span></div>`;
        }
        tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:#0c1f2a">${fmtLat(lat)}, ${fmtLon(lon)}</div>` + body;
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
    d3.json(bustUrl(path)).then(grid => {
      GRIDS.hurricane = grid;
      DISPLAY.hurricane = buildDisplayGrid(grid);
      color.domain([grid.vmin, grid.vmax]);
      colorDomain = { vmin: grid.vmin, vmax: grid.vmax };
      updateMapSubtitle();
      buildStackedLayout();
      window.addEventListener('resize', buildStackedLayout);
    }).catch(() => showFallback('Satellite SST map unavailable.'));
  }

  function annotText(g, x, y, lon, lat, text, fill, anchor) {
    g.append('text')
      .attr('x', x(lon)).attr('y', y(lat))
      .attr('text-anchor', anchor || 'start')
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
    if (cfg.fuel) annotText(g, x, y, cfg.fuel.lon, cfg.fuel.lat, cfg.fuel.text, '#fff', cfg.fuel.anchor);
    if (cfg.mdrExtra) annotText(g, x, y, cfg.mdrExtra.lon, cfg.mdrExtra.lat, cfg.mdrExtra.text, '#e0f2fe', cfg.mdrExtra.anchor);
  }

  function mdrMean(seasonId) {
    const grid = GRIDS[seasonId];
    const disp = DISPLAY[seasonId];
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
        const idx = r * grid.nx + c;
        const v = disp?.values[idx] ?? grid.values[idx];
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
    const mh = mdrMean('hurricane');
    const mo = mdrMean('offseason');
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