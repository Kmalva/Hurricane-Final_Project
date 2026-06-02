/* ════════════════════════════════════════════════════════════════════
   Viz 2 — GOES Atlantic SST heatmap with hurricane vs off-season toggle
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const fmtLon = d => (d < 0 ? `${Math.abs(Math.round(d))}°W` : `${Math.round(d)}°E`);
  const fmtLat = d => `${Math.round(d)}°N`;
  const color = d3.scaleSequential(d3.interpolateTurbo);

  const MDR = { lon0: -60, lon1: -20, lat0: 10, lat1: 20 };

  const ANNOTATIONS = {
    hurricane: {
      fuel: { lon: -89, lat: 24.5, text: 'Warm enough (≈26.5 °C+) to fuel storms' },
      mdrExtra: null,
    },
    offseason: {
      fuel: { lon: -42, lat: 15, text: 'Most of the basin below ~26.5 °C — limited hurricane fuel' },
      mdrExtra: { lon: -58, lat: 21, text: 'Storms are rare Dec–May even here' },
    },
  };

  let META = null;
  let GRIDS = {};
  let activeSeason = 'hurricane';
  let colorDomain = null;

  async function init() {
    try {
      META = await d3.json('data/goes_metadata.json');
    } catch (e) {
      return showFallback('Satellite SST map unavailable.');
    }

    const seasons = META.sst_seasons;
    if (!seasons || !seasons.hurricane) {
      return legacySingleGrid();
    }

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

    const offBtn = document.querySelector('.season-btn[data-season="offseason"]');
    if (seasons.offseason && seasons.offseason.grid) {
      try {
        GRIDS.offseason = await d3.json(seasons.offseason.grid);
      } catch (e) {
        if (offBtn) {
          offBtn.disabled = true;
          offBtn.title = 'Off-season grid not available';
        }
      }
    } else if (offBtn) {
      offBtn.disabled = true;
    }

    setupToggles();
    setSeason('hurricane');
    window.addEventListener('resize', () => draw(activeSeason));
  }

  function legacySingleGrid() {
    const sub = document.getElementById('sst-map-sub');
    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;
    if (META.sst && META.sst.day) {
      sub.textContent = `GOES-16 ABI · clear-sky composite, ${META.sst.day} · °C`;
    }
    const path = META.artifacts && META.artifacts.sst_grid;
    if (!path) return showFallback('Satellite SST map unavailable.');
    d3.json(path).then(grid => {
      GRIDS.hurricane = grid;
      color.domain([grid.vmin, grid.vmax]);
      colorDomain = { vmin: grid.vmin, vmax: grid.vmax };
      activeSeason = 'hurricane';
      draw('hurricane');
      window.addEventListener('resize', () => draw('hurricane'));
    }).catch(() => showFallback('Satellite SST map unavailable.'));
  }

  function setupToggles() {
    document.querySelectorAll('.season-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const id = btn.dataset.season;
        if (!GRIDS[id]) return;
        setSeason(id);
      });
    });
  }

  function setSeason(id) {
    activeSeason = id;
    document.querySelectorAll('.season-btn').forEach(btn => {
      const on = btn.dataset.season === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const s = META.sst_seasons[id];
    const sub = document.getElementById('sst-map-sub');
    if (s && sub) {
      sub.textContent = `GOES-16 ABI · clear-sky composite, ${s.day} · °C`;
    }
    const svg = document.getElementById('sst-map');
    if (svg) {
      const label = s ? s.label : 'Sea surface temperature';
      svg.setAttribute('aria-label', `Map of Atlantic sea surface temperature from GOES — ${label}`);
    }
    updateSeasonNote();
    draw(id);
  }

  function mdrMean(grid) {
    if (!grid) return null;
    const lonSpan = grid.lon1 - grid.lon0;
    const latNorth = grid.lat0;
    const latSpan = Math.abs(grid.lat0 - grid.lat1);
    let sum = 0;
    let n = 0;
    for (let r = 0; r < grid.ny; r++) {
      for (let c = 0; c < grid.nx; c++) {
        const lon = grid.lon0 + (c + 0.5) / grid.nx * lonSpan;
        const lat = latNorth - (r + 0.5) / grid.ny * latSpan;
        if (lon < MDR.lon0 || lon > MDR.lon1 || lat < MDR.lat0 || lat > MDR.lat1) continue;
        const v = grid.values[r * grid.nx + c];
        if (v != null && Number.isFinite(v)) {
          sum += v;
          n++;
        }
      }
    }
    return n > 0 ? sum / n : null;
  }

  function updateSeasonNote() {
    const el = document.getElementById('sst-season-note');
    if (!el || !META.sst_seasons) return;
    const h = META.sst_seasons.hurricane;
    const o = META.sst_seasons.offseason;
    const mh = mdrMean(GRIDS.hurricane);
    const mo = mdrMean(GRIDS.offseason);
    if (mh == null || mo == null) {
      el.textContent = '';
      return;
    }
    const delta = mh - mo;
    const hMonth = (h.day || '').slice(5, 7) === '09' ? 'Sep' : 'peak season';
    const oMonth = (o.day || '').slice(5, 7) === '02' ? 'Feb' : 'off-season';
    if (activeSeason === 'hurricane') {
      el.innerHTML = `In the main development region, this composite is about <strong>${delta.toFixed(1)} °C warmer</strong> than mid-winter (${oMonth} vs ${hMonth}). Toggle to see the cooler off-season basin.`;
    } else {
      el.innerHTML = `In the main development region, mid-winter (${oMonth}) is about <strong>${delta.toFixed(1)} °C cooler</strong> than peak season (${hMonth}) — less energy available to fuel hurricanes.`;
    }
  }

  function draw(seasonId) {
    const GRID = GRIDS[seasonId];
    if (!GRID) return;

    document.getElementById('sst-map').removeAttribute('hidden');
    const fb = document.getElementById('sst-map-fallback');
    if (fb) fb.hidden = true;

    const svg = d3.select('#sst-map');
    svg.selectAll('*').remove();

    const wrap = document.getElementById('sst-map-wrap');
    const M = { top: 14, right: 16, bottom: 34, left: 44 };
    const fullW = Math.max(wrap.clientWidth, 320);
    const lonSpan = GRID.lon1 - GRID.lon0;
    const latSpan = Math.abs(GRID.lat0 - GRID.lat1);
    const plotW = fullW - M.left - M.right;
    const plotH = plotW * (latSpan / lonSpan);
    const fullH = plotH + M.top + M.bottom;

    svg.attr('viewBox', `0 0 ${fullW} ${fullH}`).style('height', fullH + 'px');
    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const north = GRID.lat0;
    const south = GRID.lat1;
    const x = d3.scaleLinear().domain([GRID.lon0, GRID.lon1]).range([0, plotW]);
    const y = d3.scaleLinear().domain([south, north]).range([plotH, 0]);

    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', '#dde6ec');

    const cw = plotW / GRID.nx;
    const ch = plotH / GRID.ny;
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

    g.append('rect').attr('width', plotW).attr('height', plotH).attr('fill', 'transparent')
      .on('mousemove', function (e) {
        const [mx, my] = d3.pointer(e);
        const c = Math.floor(mx / cw);
        const r = Math.floor(my / ch);
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

    g.append('g').attr('transform', `translate(0,${plotH})`)
      .call(d3.axisBottom(x).ticks(7).tickFormat(fmtLon))
      .call(ax => {
        ax.select('.domain').attr('stroke', '#b9cad4');
        ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11);
        ax.selectAll('.tick line').attr('stroke', '#cdd9e0');
      });
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmtLat))
      .call(ax => {
        ax.select('.domain').attr('stroke', '#b9cad4');
        ax.selectAll('text').attr('fill', '#52707f').attr('font-family', 'Inter, Arial').attr('font-size', 11);
        ax.selectAll('.tick line').attr('stroke', '#cdd9e0');
      });

    drawAnnotations(g, x, y, seasonId);
    drawLegend();
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

  function drawLegend() {
    const el = document.getElementById('sst-legend');
    if (!el || !colorDomain) return;
    el.innerHTML = '';
    const vmin = colorDomain.vmin;
    const vmax = colorDomain.vmax;
    const steps = 40;
    const grad = d3.range(steps).map(i => color(vmin + (i / (steps - 1)) * (vmax - vmin)));
    const bar = document.createElement('div');
    bar.className = 'legend-bar';
    bar.style.background = `linear-gradient(to right, ${grad.join(',')})`;
    const lo = document.createElement('span');
    lo.className = 'legend-tick';
    lo.textContent = `${vmin.toFixed(0)} °C`;
    const hi = document.createElement('span');
    hi.className = 'legend-tick';
    hi.textContent = `${vmax.toFixed(0)} °C`;
    const lab = document.createElement('span');
    lab.textContent = 'Cooler';
    lab.style.color = '#6b8090';
    const lab2 = document.createElement('span');
    lab2.textContent = 'Warmer';
    lab2.style.color = '#6b8090';
    const shared = document.createElement('span');
    shared.textContent = '(shared scale)';
    shared.style.color = '#6b8090';
    shared.style.fontSize = '10.5px';
    el.append(lab, lo, bar, hi, lab2, shared);
  }

  function showImageFallback(src) {
    document.getElementById('sst-map').setAttribute('hidden', '');
    const fb = document.getElementById('sst-map-fallback');
    fb.hidden = false;
    fb.innerHTML = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'GOES sea surface temperature map';
    img.style.width = '100%';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    fb.style.minHeight = 'auto';
    fb.style.border = 'none';
    fb.style.background = 'none';
    fb.style.padding = '0';
    fb.appendChild(img);
  }

  function showFallback(msg) {
    const toggles = document.getElementById('sst-season-toggles');
    if (toggles) toggles.hidden = true;
    document.getElementById('sst-map').setAttribute('hidden', '');
    const fb = document.getElementById('sst-map-fallback');
    fb.hidden = false;
    fb.innerHTML = `<strong>Map unavailable</strong><span>${msg}</span>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
