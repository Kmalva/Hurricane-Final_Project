/* ════════════════════════════════════════════════════════════════════
   Make a Hurricane — drag-map educational game
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MAP_W = 900;
  const MAP_H = 520;
  const PAD = 40;
  const MOISTURE_COLS = 24;
  const MOISTURE_ROWS = 14;

  let config = null;
  let zones = [];
  let fallbackZone = null;
  let landGeo = null;
  let projection = null;
  let geoPath = null;
  let mainViewMode = 'explore';
  let stormX = 520;
  let stormY = 365;
  let svg, mapG, stormG, layers = {};
  let thumbs = { sst: null, moisture: null };
  let sstGrid = null;
  let colorDomain = null;
  let popupVisible = false;
  let rafPending = false;
  const color = d3.scaleSequential(d3.interpolateTurbo);
  const moistColor = d3.scaleLinear()
    .domain([20, 70])
    .range(['#e0f2fe', '#0d9488'])
    .clamp(true);

  function impactCategory(score) {
    if (score <= 30) return { id: 'low', label: 'Low' };
    if (score <= 55) return { id: 'moderate', label: 'Moderate' };
    if (score <= 75) return { id: 'high', label: 'High' };
    return { id: 'extreme', label: 'Extreme' };
  }

  function growthLabel(score) {
    if (score <= 30) return 'Weakening / low support';
    if (score <= 55) return 'Mixed conditions';
    if (score <= 75) return 'Strengthening possible';
    return 'Strong growth environment';
  }

  function computeScores(z) {
    const lowShearSupport = 100 - z.windShear;
    const lowPreparednessRisk = 100 - z.preparedness;
    const stormGrowthScore =
      0.4 * z.sst + 0.3 * z.moisture + 0.3 * lowShearSupport;
    const communityImpactPotential =
      0.6 * stormGrowthScore + 0.25 * z.exposure + 0.15 * lowPreparednessRisk;
    return {
      lowShearSupport,
      stormGrowthScore,
      communityImpactPotential,
      growthLabel: growthLabel(stormGrowthScore),
      impactCat: impactCategory(communityImpactPotential),
    };
  }

  function mainReason(z, scores) {
    if (z.sst > 75 && z.windShear > 60) {
      return 'Warm water fuel is high, but wind shear may disrupt organization.';
    }
    if (z.sst > 75 && z.moisture > 75 && z.windShear < 35) {
      return 'Warm ocean fuel, moisture, and low wind shear may align to support strengthening.';
    }
    if (z.windShear > 70) {
      return 'Strong wind shear can tilt and weaken storm structure even when other ingredients are present.';
    }
    if (z.sst < 40) {
      return 'Cooler sea surface temperatures provide less heat energy for storm growth.';
    }
    if (z.exposure > 75 && z.preparedness < 45) {
      return 'High coastal exposure and lower preparedness can raise community impact potential.';
    }
    if (z.exposure > 70 && z.preparedness > 70) {
      return 'Preparedness may reduce harm even when coastal exposure is elevated.';
    }
    return z.explanation || 'Ingredient alignment shapes the educational readout — not a real forecast.';
  }

  function findNearestZone(x, y) {
    let best = null;
    let bestD = Infinity;
    zones.forEach(z => {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    });
    if (best && bestD <= best.radius * 1.35) return best;
    return fallbackZone || best || zones[0];
  }

  function sampleMoistureAt(x, y) {
    const sources = zones.length ? zones : (fallbackZone ? [fallbackZone] : []);
    if (!sources.length) return 50;
    let num = 0;
    let den = 0;
    const power = 2;
    sources.forEach(z => {
      const d2 = (x - z.x) ** 2 + (y - z.y) ** 2 + 2500;
      const w = 1 / Math.pow(d2, power / 2);
      num += w * z.moisture;
      den += w;
    });
    return den > 0 ? num / den : 50;
  }

  function spiralPath(tightness, stretch, rotDeg) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const angle = t * Math.PI * 3.2 + (rotDeg * Math.PI) / 180;
      const r = (14 + t * (42 * tightness)) * (1 + stretch * t * 0.35);
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r * (1 - stretch * 0.32)]);
    }
    return d3.line().curve(d3.curveCatmullRom.alpha(0.6))(pts);
  }

  function createProjection() {
    return d3.geoMercator()
      .center([-50, 22])
      .scale(560)
      .translate([MAP_W / 2, 285]);
  }

  function syncZonePositions() {
    if (!projection) return;
    zones.forEach(z => {
      if (z.lon == null || z.lat == null) return;
      const p = projection([z.lon, z.lat]);
      if (p) {
        z.x = p[0];
        z.y = p[1];
      }
    });
  }

  function buildOcean(g) {
    return g.append('rect')
      .attr('class', 'game-ocean')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', MAP_W)
      .attr('height', MAP_H)
      .attr('fill', '#5b9fd4')
      .lower();
  }

  function buildLandLayer(g, opts) {
    const opacity = opts.opacity != null ? opts.opacity : 1;
    const stroke = opts.stroke !== false;
    const landG = g.append('g').attr('class', 'game-land-layer').attr('opacity', opacity);
    if (!landGeo || !geoPath) {
      return landG;
    }
    landG.selectAll('path')
      .data(landGeo.features)
      .join('path')
      .attr('class', 'game-land')
      .attr('d', geoPath)
      .attr('fill', '#d1d5db')
      .attr('stroke', stroke ? '#6b7280' : 'none')
      .attr('stroke-width', stroke ? 0.6 : 0);
    return landG;
  }

  function appendDefs(svgSel, uid) {
    const defs = svgSel.append('defs');
    const gradId = `game-sst-fallback-${uid}`;
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0').attr('y1', '0').attr('x2', '1').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#1e3a5f');
    grad.append('stop').attr('offset', '50%').attr('stop-color', '#ea580c');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#0c4a6e');
    return { defs, gradId };
  }

  function renderSstLayer(g, gradId, initialOpacity) {
    const layer = g.append('g').attr('class', 'layer-sst game-layer').attr('opacity', initialOpacity);
    if (!sstGrid) {
      layer.append('rect').attr('width', MAP_W).attr('height', MAP_H)
        .attr('fill', `url(#${gradId})`);
      return layer;
    }
    const cellW = (MAP_W - PAD * 2) / sstGrid.nx;
    const cellH = (MAP_H - PAD * 2) / sstGrid.ny;
    for (let r = 0; r < sstGrid.ny; r++) {
      for (let c = 0; c < sstGrid.nx; c++) {
        const v = sstGrid.values[r * sstGrid.nx + c];
        if (v == null || !Number.isFinite(v)) continue;
        const x = PAD + c * cellW;
        const y = PAD + r * cellH;
        layer.append('rect')
          .attr('x', x).attr('y', y)
          .attr('width', cellW + 0.5).attr('height', cellH + 0.5)
          .attr('fill', color(v))
          .attr('opacity', 0.78);
      }
    }
    return layer;
  }

  function renderMoistureField(g, initialOpacity) {
    const layer = g.append('g').attr('class', 'layer-moisture game-layer').attr('opacity', initialOpacity);
    const cellW = (MAP_W - PAD * 2) / MOISTURE_COLS;
    const cellH = (MAP_H - PAD * 2) / MOISTURE_ROWS;
    for (let r = 0; r < MOISTURE_ROWS; r++) {
      for (let c = 0; c < MOISTURE_COLS; c++) {
        const cx = PAD + (c + 0.5) * cellW;
        const cy = PAD + (r + 0.5) * cellH;
        const v = sampleMoistureAt(cx, cy);
        layer.append('rect')
          .attr('x', PAD + c * cellW)
          .attr('y', PAD + r * cellH)
          .attr('width', cellW + 0.5)
          .attr('height', cellH + 0.5)
          .attr('fill', moistColor(v))
          .attr('opacity', 0.82);
      }
    }
    return layer;
  }

  function appendStormDot(g) {
    return g.append('circle')
      .attr('class', 'storm-dot')
      .attr('r', 6)
      .attr('fill', '#111')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);
  }

  function renderZoneRings(g) {
    const rings = g.append('g').attr('class', 'game-zones');
    zones.forEach(z => {
      rings.append('circle')
        .attr('class', 'game-zone-ring')
        .attr('data-zone', z.id)
        .attr('cx', z.x).attr('cy', z.y).attr('r', z.radius)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.55)')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8,6')
        .attr('opacity', 0.45)
        .style('cursor', 'pointer')
        .on('click', () => snapToZone(z));
    });
    return rings;
  }

  function buildStorm(g) {
    const storm = g.append('g').attr('class', 'game-storm').attr('cursor', 'grab');
    storm.append('circle').attr('r', 22).attr('fill', 'rgba(220,38,38,0.25)').attr('class', 'storm-hit');
    const bands = [];
    for (let i = 0; i < 4; i++) {
      bands.push(
        storm.append('path')
          .attr('fill', 'none')
          .attr('stroke', 'rgba(255,255,255,0.85)')
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round')
      );
    }
    storm.append('circle').attr('r', 8).attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.9)').attr('stroke-width', 1.5).attr('class', 'storm-eye');
    const rain = storm.append('g').attr('class', 'storm-rain').attr('opacity', 0);
    for (let i = 0; i < 8; i++) {
      rain.append('line').attr('stroke', 'rgba(191,224,242,0.55)').attr('stroke-width', 1);
    }
    layers.stormBands = bands;
    layers.stormRain = rain;
    layers.stormEye = storm.select('.storm-eye');
    return storm;
  }

  function syncThumbDots() {
    ['sst', 'moisture'].forEach(key => {
      const t = thumbs[key];
      if (t && t.dot) {
        t.dot.attr('cx', stormX).attr('cy', stormY);
      }
    });
  }

  function mapAriaLabel(zone, scores) {
    const modeText = mainViewMode === 'explore'
      ? 'Exploration map'
      : mainViewMode === 'sst'
        ? 'Sea surface temperature view'
        : 'Moisture view';
    return `${modeText} at ${zone.label}: ${scores.growthLabel}, community impact ${scores.impactCat.label}`;
  }

  function updateStormVisual(zone, scores) {
    if (!stormG || !layers.stormBands) return;
    const t = d3.transition().duration(400).ease(d3.easeCubicOut);
    const g = scores.stormGrowthScore;
    const stretch = zone.windShear / 100;
    const tight = scores.lowShearSupport / 100;
    const scale = 0.65 + (g / 100) * 0.55;
    const rot = stretch * 22;

    layers.stormBands.forEach((band, i) => {
      band.transition(t)
        .attr('d', spiralPath(0.5 + tight * 0.55, stretch * 0.9, rot + i * 20))
        .attr('opacity', g <= 30 ? 0.25 + tight * 0.2 : 0.4 + tight * 0.55)
        .attr('stroke-width', g <= 30 ? 1 : 1.5 + (1 - stretch) * 1.2);
    });
    layers.stormEye.transition(t)
      .attr('opacity', zone.windShear < 50 ? 0.4 + tight * 0.5 : 0.12)
      .attr('r', 5 + tight * 7);

    const rainOp = zone.sst > 60 && zone.moisture > 60 ? (zone.moisture - 50) / 80 : 0;
    layers.stormRain.transition(t).attr('opacity', rainOp);
    layers.stormRain.selectAll('line').each(function (_, i) {
      const ang = (i / 8) * Math.PI * 2;
      const r0 = 18;
      d3.select(this).transition(t)
        .attr('x1', Math.cos(ang) * r0).attr('y1', Math.sin(ang) * r0)
        .attr('x2', Math.cos(ang) * (r0 + 14)).attr('y2', Math.sin(ang) * (r0 + 14) + 8);
    });

    stormG.transition(t)
      .attr('transform', `translate(${stormX},${stormY}) scale(${scale}) rotate(${rot})`);
  }

  function updatePanel(zone, scores) {
    const el = id => document.getElementById(id);
    if (el('game-location-type')) el('game-location-type').textContent = zone.locationType || zone.label;
    if (el('game-storm-response')) el('game-storm-response').textContent = zone.stormResponse || '—';
    if (el('game-growth-label')) el('game-growth-label').textContent = scores.growthLabel;
    if (el('game-growth-num')) el('game-growth-num').textContent = Math.round(scores.stormGrowthScore);
    if (el('game-impact-num')) el('game-impact-num').textContent = Math.round(scores.communityImpactPotential);
    if (el('game-main-reason')) el('game-main-reason').textContent = mainReason(zone, scores);
    if (el('game-explanation')) el('game-explanation').textContent = zone.explanation || '';

    const badge = el('game-impact-badge');
    if (badge) {
      badge.textContent = scores.impactCat.label;
      badge.className = 'risk-badge risk-badge--' + scores.impactCat.id;
    }

    ['sst', 'moisture', 'shear'].forEach(key => {
      const bar = el('game-bar-' + key);
      if (bar) {
        const val = key === 'shear' ? zone.windShear : zone[key];
        bar.style.width = val + '%';
      }
    });
    const expBar = el('game-bar-exposure');
    if (expBar) expBar.style.width = zone.exposure + '%';
    const prepBar = el('game-bar-prep');
    if (prepBar) prepBar.style.width = zone.preparedness + '%';

    const stage = el('game-map');
    if (stage) stage.setAttribute('aria-label', mapAriaLabel(zone, scores));
  }

  function showPopup(zone) {
    const pop = document.getElementById('game-popup');
    if (!pop || !zone.popupTitle) return;
    document.getElementById('game-popup-title').textContent = zone.popupTitle;
    document.getElementById('game-popup-body').textContent = zone.popupBody || zone.explanation || '';
    pop.hidden = false;
    popupVisible = true;
    const wrap = document.getElementById('game-map-wrap');
    if (wrap) {
      const svgRect = document.getElementById('game-map').getBoundingClientRect();
      const scaleX = svgRect.width / MAP_W;
      const scaleY = svgRect.height / MAP_H;
      pop.style.left = `${(stormX * scaleX) + 12}px`;
      pop.style.top = `${(stormY * scaleY) - 8}px`;
    }
  }

  function hidePopup() {
    const pop = document.getElementById('game-popup');
    if (pop) pop.hidden = true;
    popupVisible = false;
  }

  function snapToZone(z) {
    stormX = z.x;
    stormY = z.y;
    refreshAtPosition();
    if (z.popupTitle) showPopup(z);
  }

  function refreshAtPosition() {
    const zone = findNearestZone(stormX, stormY);
    const scores = computeScores(zone);
    if (stormG) {
      const g = scores.stormGrowthScore;
      const scale = 0.65 + (g / 100) * 0.55;
      const rot = (zone.windShear / 100) * 22;
      stormG.attr('transform', `translate(${stormX},${stormY}) scale(${scale}) rotate(${rot})`);
    }
    updateStormVisual(zone, scores);
    updatePanel(zone, scores);
    syncThumbDots();
    document.querySelectorAll('.game-zone-ring').forEach(ring => {
      const id = ring.getAttribute('data-zone');
      const on = zone.id === id;
      ring.classList.toggle('game-zone-ring--near', on);
      ring.setAttribute('opacity', on ? '0.85' : '0.45');
    });
  }

  function scheduleRefresh() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      refreshAtPosition();
    });
  }

  function enableDrag(storm) {
    const drag = d3.drag()
      .subject(() => ({ x: stormX, y: stormY }))
      .on('start', function () {
        d3.select(this).attr('cursor', 'grabbing').raise();
        hidePopup();
      })
      .on('drag', function (event) {
        stormX = Math.max(PAD, Math.min(MAP_W - PAD, event.x));
        stormY = Math.max(PAD, Math.min(MAP_H - PAD, event.y));
        if (stormG) stormG.attr('transform', `translate(${stormX},${stormY})`);
        syncThumbDots();
        scheduleRefresh();
      })
      .on('end', function () {
        d3.select(this).attr('cursor', 'grab');
        const zone = findNearestZone(stormX, stormY);
        const dist = Math.hypot(stormX - zone.x, stormY - zone.y);
        if (dist <= zone.radius * 1.25) {
          stormX = zone.x;
          stormY = zone.y;
          if (stormG) stormG.attr('transform', `translate(${stormX},${stormY})`);
          if (zone.popupTitle) showPopup(zone);
        }
        refreshAtPosition();
      });
    storm.call(drag);
  }

  function setMainView(mode) {
    mainViewMode = mode;
    const t = d3.transition().duration(280);
    const mainSstOp = mode === 'sst' ? 0.72 : 0;
    const mainMoistOp = mode === 'moisture' ? 0.78 : 0;
    const landOp = mode === 'explore' ? 1 : 0.4;

    if (layers.layerSst) layers.layerSst.transition(t).attr('opacity', mainSstOp);
    if (layers.layerMoisture) layers.layerMoisture.transition(t).attr('opacity', mainMoistOp);
    if (layers.landG) layers.landG.transition(t).attr('opacity', landOp);

    const back = document.getElementById('game-map-back');
    if (back) back.hidden = mode === 'explore';

    document.querySelectorAll('.game-thumb').forEach(btn => {
      const layer = btn.dataset.layer;
      const active = mode === layer;
      btn.classList.toggle('game-thumb--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const zone = findNearestZone(stormX, stormY);
    const scores = computeScores(zone);
    const stage = document.getElementById('game-map');
    if (stage) stage.setAttribute('aria-label', mapAriaLabel(zone, scores));
  }

  function buildVerticalLegend(containerId, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    const top = document.createElement('span');
    top.className = 'game-thumb-legend-label';
    top.textContent = opts.topLabel;
    const topVal = document.createElement('span');
    topVal.className = 'game-thumb-legend-value';
    topVal.textContent = opts.topValue;
    const bar = document.createElement('div');
    bar.className = 'game-thumb-legend-bar';
    bar.style.background = opts.gradient;
    const botVal = document.createElement('span');
    botVal.className = 'game-thumb-legend-value';
    botVal.textContent = opts.bottomValue;
    const bot = document.createElement('span');
    bot.className = 'game-thumb-legend-label';
    bot.textContent = opts.bottomLabel;
    el.append(top, topVal, bar, botVal, bot);
  }

  function drawThumbLegends() {
    const vmin = colorDomain ? colorDomain.vmin : 20;
    const vmax = colorDomain ? colorDomain.vmax : 30;
    const sstSteps = 24;
    const sstGrad = d3.range(sstSteps)
      .map(i => color(vmin + (i / (sstSteps - 1)) * (vmax - vmin)))
      .join(', ');
    buildVerticalLegend('game-thumb-legend-sst', {
      topLabel: 'Warm',
      topValue: `${vmax.toFixed(0)}°C`,
      bottomLabel: 'Cool',
      bottomValue: `${vmin.toFixed(0)}°C`,
      gradient: `linear-gradient(to bottom, ${sstGrad})`,
    });
    const moistSteps = 24;
    const moistGrad = d3.range(moistSteps)
      .map(i => moistColor(20 + (i / (moistSteps - 1)) * 50))
      .join(', ');
    buildVerticalLegend('game-thumb-legend-moisture', {
      topLabel: 'Moist',
      topValue: '70%',
      bottomLabel: 'Dry',
      bottomValue: '20%',
      gradient: `linear-gradient(to bottom, ${moistGrad})`,
    });
  }

  function initThumbMap(layerKey, svgId, uid) {
    const el = document.getElementById(svgId);
    if (!el) return null;
    const svgSel = d3.select(el);
    svgSel.selectAll('*').remove();
    svgSel.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
    const { gradId } = appendDefs(svgSel, uid);
    const g = svgSel.append('g').attr('class', 'game-thumb-inner-g');
    buildOcean(g);
    buildLandLayer(g, { opacity: 0.85, stroke: true });
    let layerSel;
    if (layerKey === 'sst') {
      layerSel = renderSstLayer(g, gradId, 0.88);
    } else {
      layerSel = renderMoistureField(g, 0.88);
    }
    const dot = appendStormDot(g);
    dot.attr('cx', stormX).attr('cy', stormY);
    return { svg: svgSel, dot, layer: layerSel };
  }

  function initThumbMaps() {
    thumbs.sst = initThumbMap('sst', 'game-thumb-sst', 'thumb-sst');
    thumbs.moisture = initThumbMap('moisture', 'game-thumb-moisture', 'thumb-moist');
    drawThumbLegends();
  }

  function setupThumbInteraction() {
    document.querySelectorAll('.game-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.dataset.layer;
        if (mainViewMode === layer) {
          setMainView('explore');
        } else {
          setMainView(layer);
        }
      });
    });
    const back = document.getElementById('game-map-back');
    if (back) back.addEventListener('click', () => setMainView('explore'));
  }

  function setupPopupClose() {
    const close = document.getElementById('game-popup-close');
    if (close) close.addEventListener('click', hidePopup);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (popupVisible) {
        hidePopup();
        return;
      }
      if (mainViewMode !== 'explore') setMainView('explore');
    });
  }

  function setupKeyboard() {
    const map = document.getElementById('game-map');
    if (!map) return;
    map.addEventListener('keydown', e => {
      const step = 12;
      if (e.key === 'ArrowLeft') { stormX -= step; e.preventDefault(); }
      if (e.key === 'ArrowRight') { stormX += step; e.preventDefault(); }
      if (e.key === 'ArrowUp') { stormY -= step; e.preventDefault(); }
      if (e.key === 'ArrowDown') { stormY += step; e.preventDefault(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        stormX = Math.max(PAD, Math.min(MAP_W - PAD, stormX));
        stormY = Math.max(PAD, Math.min(MAP_H - PAD, stormY));
        refreshAtPosition();
      }
    });
  }

  async function loadSstGrid() {
    try {
      const meta = await d3.json('data/goes_metadata.json');
      const path = meta.sst_seasons?.hurricane?.grid || meta.artifacts?.sst_grid_hurricane || meta.artifacts?.sst_grid;
      if (!path) return;
      sstGrid = await d3.json(path);
      const domain = meta.sst_seasons?.color_domain;
      if (domain) {
        colorDomain = domain;
        color.domain([domain.vmin, domain.vmax]);
      } else {
        color.domain([sstGrid.vmin, sstGrid.vmax]);
      }
    } catch (e) {
      sstGrid = null;
    }
  }

  function initMainMap() {
    const el = document.getElementById('game-map');
    if (!el) return;

    svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);

    const { gradId } = appendDefs(svg, 'main');
    mapG = svg.append('g').attr('class', 'game-map-inner');
    buildOcean(mapG);
    layers.landG = buildLandLayer(mapG, { opacity: 1, stroke: true });
    layers.layerSst = renderSstLayer(mapG, gradId, 0);
    layers.layerMoisture = renderMoistureField(mapG, 0);
    renderZoneRings(mapG);
    stormG = buildStorm(mapG);
    enableDrag(stormG);

    const start = zones.find(z => z.id === 'caribbean_heat') || zones[0];
    if (start) {
      stormX = start.x;
      stormY = start.y;
    }
    refreshAtPosition();
    setMainView('explore');
  }

  function showError(msg) {
    const map = document.getElementById('game-map');
    if (map) {
      d3.select(map).selectAll('*').remove();
      d3.select(map)
        .append('foreignObject')
        .attr('width', MAP_W)
        .attr('height', MAP_H)
        .append('xhtml:div')
        .attr('class', 'game-error')
        .text(msg);
      return;
    }
    const wrap = document.getElementById('game-map-wrap');
    if (wrap) wrap.innerHTML = `<p class="game-error">${msg}</p>`;
  }

  async function init() {
    if (!document.getElementById('game-map')) return;
    try {
      config = await d3.json('data/hurricane_zones.json');
      zones = config.zones || [];
      fallbackZone = config.fallbackZone || null;
      landGeo = await d3.json('data/game_atlantic_land.geojson');
      projection = createProjection();
      geoPath = d3.geoPath(projection);
      syncZonePositions();
      await loadSstGrid();
      initMainMap();
      initThumbMaps();
      setupThumbInteraction();
      setupPopupClose();
      setupKeyboard();
    } catch (e) {
      console.error('Hurricane game init failed:', e);
      const hint = e && e.message ? e.message : 'unknown error';
      showError(
        'Interactive map could not load. If you are viewing a local copy, serve the site from the project folder (e.g. python3 -m http.server). Details: ' + hint
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
