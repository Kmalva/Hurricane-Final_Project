/* ════════════════════════════════════════════════════════════════════
   Make a Hurricane — drag-map educational game (era-aware, free drag)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MAP_W = 900;
  const MAP_H = 520;
<<<<<<< Updated upstream
  const PAD = 40;
  const LAYERS = ['sst', 'moisture', 'shear', 'exposure', 'all'];

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

  // ── ZONE / INTERPOLATION ──────────────────────────────────────────────

  function findNearestZone(x, y) {
    let best = null, bestD = Infinity;
    zones.forEach(z => {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d < bestD) { bestD = d; best = z; }
    });
    if (best && bestD <= best.radius * 1.35) return best;
    return fallbackZone || best || zones[0];
  }

  function challengeMatches(zone, scores, ch) {
    const m = ch.match;
    if (!m) return false;
    if (m.minStormGrowth != null && scores.stormGrowthScore < m.minStormGrowth) return false;
    if (m.minImpact != null && scores.communityImpactPotential < m.minImpact) return false;
    if (m.minSst != null && zone.sst < m.minSst) return false;
    if (m.minWindShear != null && zone.windShear < m.minWindShear) return false;
    if (m.minExposure != null && zone.exposure < m.minExposure) return false;
    if (m.minPreparedness != null && zone.preparedness < m.minPreparedness) return false;
    return true;
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

  function buildCoast(g) {
    g.append('path')
      .attr('class', 'game-coast')
      .attr('fill', '#0f3d52')
      .attr('stroke', '#7fd2f4')
      .attr('stroke-width', 1.2)
      .attr('opacity', 0.85)
      .attr('d', [
        'M 120,280 L 95,310 L 110,340 L 140,360 L 180,355 L 220,330 L 260,310 L 300,295',
        'L 340,300 L 380,320 L 420,350 L 480,380 L 540,390 L 600,370 L 650,320',
        'L 700,260 L 750,220 L 780,200 L 820,210 L 850,240 L 860,280 L 840,320',
        'L 800,350 L 720,380 L 620,400 L 500,410 L 380,400 L 280,380 L 200,360 Z',
        'M 200,360 L 180,320 L 160,290 L 140,270 Z',
      ].join(' '));
    g.append('rect')
      .attr('x', 0).attr('y', 0).attr('width', MAP_W).attr('height', MAP_H)
      .attr('fill', '#0c4a6e')
      .lower();
  }

  function renderSstLayer(g) {
    const layer = g.append('g').attr('class', 'layer-sst game-layer').attr('opacity', 0);
    if (!sstGrid) {
      layer.append('rect').attr('width', MAP_W).attr('height', MAP_H)
        .attr('fill', 'url(#game-sst-fallback)');
      return layer;
    }
    const filled = filledSstValues();
    const { lonMin, lonMax, latMin, latMax } = mapLonLatBounds();
    const NX = 100, NY = 58;
    const fills = new Map();
    for (let r = 0; r < NY; r++) {
      const latT = latMax - (r / NY) * (latMax - latMin);
      const latB = latMax - ((r + 1) / NY) * (latMax - latMin);
      const latC = (latT + latB) / 2;
      for (let c = 0; c < NX; c++) {
        const lonL = lonMin + (c / NX) * (lonMax - lonMin);
        const lonR = lonMin + ((c + 1) / NX) * (lonMax - lonMin);
        const lonC = (lonL + lonR) / 2;
        const val = sampleFilledSst(filled, lonC, latC);
        const tl = projection([lonL, latT]);
        const tr = projection([lonR, latT]);
        const br = projection([lonR, latB]);
        const bl = projection([lonL, latB]);
        if (!tl || !tr || !br || !bl) continue;
        const fill = color(val);
        const seg = `M${tl[0]},${tl[1]}L${tr[0]},${tr[1]}L${br[0]},${br[1]}L${bl[0]},${bl[1]}Z`;
        fills.set(fill, (fills.get(fill) || '') + seg);
      }
    }
    fills.forEach((segs, fill) => {
      layer.append('path').attr('d', segs).attr('fill', fill).attr('opacity', 0.85);
    });
    return layer;
  }

  function renderMoistureField(g, clipId, initialOpacity) {
    const layer = g.append('g')
      .attr('class', 'layer-moisture game-layer')
      .attr('opacity', initialOpacity);
    if (clipId) layer.attr('clip-path', `url(#${clipId})`);
    if (!projection || !clipId) return layer;
    const { lonMin, lonMax, latMin, latMax } = mapLonLatBounds();
    const COLS = 40, ROWS = 24;
    const fills = new Map();
    for (let r = 0; r < ROWS; r++) {
      const latT = latMax - (r / ROWS) * (latMax - latMin);
      const latB = latMax - ((r + 1) / ROWS) * (latMax - latMin);
      const latC = (latT + latB) / 2;
      for (let c = 0; c < COLS; c++) {
        const lonL = lonMin + (c / COLS) * (lonMax - lonMin);
        const lonR = lonMin + ((c + 1) / COLS) * (lonMax - lonMin);
        const lonC = (lonL + lonR) / 2;
        const center = projection([lonC, latC]);
        if (!center) continue;
        const v = sampleMoistureAt(center[0], center[1]);
        const tl = projection([lonL, latT]);
        const tr = projection([lonR, latT]);
        const br = projection([lonR, latB]);
        const bl = projection([lonL, latB]);
        if (!tl || !tr || !br || !bl) continue;
        const fill = moistColor(v);
        const seg = `M${tl[0]},${tl[1]}L${tr[0]},${tr[1]}L${br[0]},${br[1]}L${bl[0]},${bl[1]}Z`;
        fills.set(fill, (fills.get(fill) || '') + seg);
      }
    }
    fills.forEach((segs, fill) => {
      layer.append('path').attr('d', segs).attr('fill', fill).attr('opacity', 0.8);
    });
    return layer;
  }

  function renderExposureLayer(g) {
    const layer = g.append('g').attr('class', 'layer-exposure game-layer').attr('opacity', 0);
    const slots = [
      [265, 292], [295, 288], [310, 305], [240, 318], [200, 328],
      [350, 310], [380, 325],
    ];
    slots.forEach(([x, y], i) => {
      layer.append('rect')
        .attr('x', x).attr('y', y).attr('width', 8 + (i % 3) * 2).attr('height', 14 + (i % 2) * 6)
        .attr('fill', '#fde047').attr('opacity', 0.55);
    });
    layer.append('text').attr('x', 280).attr('y', 278)
      .attr('fill', '#fef08a').attr('font-size', 10).attr('font-family', 'Inter, Arial')
      .text('Coastal exposure');
    return layer;
  }

  function renderZoneRings(g) {
    const rings = g.append('g').attr('class', 'game-zones');
    zones.forEach(z => {
<<<<<<< Updated upstream
      const ring = rings.append('g')
        .attr('class', 'game-zone')
        .attr('data-zone', z.id)
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', `Explore ${z.label}`)
        .style('cursor', 'pointer')
        .on('click', () => snapToZone(z))
        .on('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            snapToZone(z);
          }
        });
      ring.append('circle')
        .attr('class', 'game-zone-hit')
        .attr('cx', z.x).attr('cy', z.y).attr('r', z.radius + 12)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all');
      ring.append('circle')
=======
      const ring = rings.append('g')
        .attr('class', 'game-zone')
        .attr('data-zone', z.id)
        .attr('role', 'button')
        .attr('tabindex', 0)
        .attr('aria-label', `Snap to ${z.label}`)
        .style('cursor', 'pointer')
        .on('click', (event) => { event.stopPropagation(); snapToZone(z); })
        .on('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            snapToZone(z);
          }
        });
      ring.append('circle')
        .attr('class', 'game-zone-hit')
        .attr('cx', z.x).attr('cy', z.y).attr('r', z.radius + 12)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all');
      ring.append('circle')
>>>>>>> Stashed changes
        .attr('class', 'game-zone-ring')
        .attr('cx', z.x).attr('cy', z.y).attr('r', z.radius)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.55)')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '8,6')
        .attr('opacity', 0.45)
        .attr('pointer-events', 'none');
    });
    return rings;
  }

  function buildStorm(g) {
    const storm = g.append('g').attr('class', 'game-storm');
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

<<<<<<< Updated upstream
=======
  // ── THUMBNAIL SYNC ───────────────────────────────────────────────────

  function syncThumbDots() {
    ['sst', 'moisture'].forEach(key => {
      const t = thumbs[key];
      if (t && t.dot) t.dot.attr('cx', stormX).attr('cy', stormY);
    });
  }

  // ── PANEL UPDATE ─────────────────────────────────────────────────────

  function mapAriaLabel(zone, scores) {
    const modeText = mainViewMode === 'explore' ? 'Exploration map'
      : mainViewMode === 'sst' ? 'Sea surface temperature view' : 'Moisture view';
    return `${modeText} at ${zone.label}: ${scores.growthLabel}, community impact ${scores.impactCat.label}`;
  }

>>>>>>> Stashed changes
  function updateStormVisual(zone, scores) {
    if (!stormG || !layers.stormBands) return;
    const t = d3.transition().duration(200).ease(d3.easeCubicOut);
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
    if (el('game-bar-exposure')) el('game-bar-exposure').style.width = zone.exposure + '%';
    if (el('game-bar-prep')) el('game-bar-prep').style.width = zone.preparedness + '%';

    // Era label badge
    const eraTag = el('game-era-label');
    if (eraTag) {
      const names = { '1980': '1980', 'now': 'Today', '2080': '2080 · SSP5-8.5' };
      const tagClasses = { '1980': 'era-label-tag--1980', 'now': 'era-label-tag--now', '2080': 'era-label-tag--2080' };
      eraTag.textContent = names[currentEra] || currentEra;
      eraTag.className = 'era-label-tag ' + (tagClasses[currentEra] || '');
    }

    const stage = el('game-map');
    if (stage) stage.setAttribute('aria-label', mapAriaLabel(zone, scores));
  }

  function updateChallengeFeedback(zone, scores) {
    const fb = document.getElementById('game-challenge-feedback');
    if (!fb || !activeChallengeId) {
      if (fb) fb.textContent = '';
      return;
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    modalOpen = true;
    const close = document.getElementById('game-modal-close');
    if (close) close.focus();
  }

  function closeModal() {
    const modal = document.getElementById('game-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    modalOpen = false;
  }

=======
>>>>>>> Stashed changes
  function snapToZone(z) {
    stormX = z.x;
    stormY = z.y;
    refreshAtPosition();
    if (z.popupTitle) showPopup(z);
  }

  // ── REFRESH ──────────────────────────────────────────────────────────

  function refreshAtPosition() {
    const rawZone = interpolateAllAt(stormX, stormY);
    const zone = applyEraOffset(rawZone);
    const scores = computeScores(zone);

    if (stormG) {
      const g = scores.stormGrowthScore;
      const scale = 0.65 + (g / 100) * 0.55;
      const rot = (zone.windShear / 100) * 22;
      stormG.attr('transform', `translate(${stormX},${stormY}) scale(${scale}) rotate(${rot})`);
    }
    updateStormVisual(zone, scores);
    updatePanel(zone, scores);
    document.querySelectorAll('.game-zone-ring').forEach(ring => {
      const id = ring.getAttribute('data-zone');
      const on = zone.id === id;
      const ring = group.querySelector('.game-zone-ring');
      if (!ring) return;
      ring.classList.toggle('game-zone-ring--near', on);
      ring.setAttribute('opacity', on ? '0.85' : '0.45');
    });
  }

  function setMainView(mode) {
    mainViewMode = mode;
    const t = d3.transition().duration(280);
    const mainSstOp = mode === 'sst' ? 0.85 : 0;
    const mainMoistOp = mode === 'moisture' ? 0.85 : 0;

    if (layers.layerSst) layers.layerSst.transition(t).attr('opacity', mainSstOp);
    if (layers.layerMoisture) layers.layerMoisture.transition(t).attr('opacity', mainMoistOp);
    if (layers.landG) layers.landG.attr('opacity', 1);

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

  function buildHorizontalLegend(containerId, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    const lo = document.createElement('span');
    lo.className = 'game-thumb-legend-end';
    lo.textContent = `${opts.lowLabel} · ${opts.lowValue}`;
    const bar = document.createElement('div');
    bar.className = 'game-thumb-legend-bar';
    bar.style.background = opts.gradient;
    const hi = document.createElement('span');
    hi.className = 'game-thumb-legend-end';
    hi.textContent = `${opts.highValue} · ${opts.highLabel}`;
    el.append(lo, bar, hi);
  }

  function drawThumbLegends() {
    const vmin = colorDomain ? colorDomain.vmin : 20;
    const vmax = colorDomain ? colorDomain.vmax : 30;
    const sstSteps = 24;
    const sstGrad = d3.range(sstSteps)
      .map(i => color(vmin + (i / (sstSteps - 1)) * (vmax - vmin)))
      .join(', ');
    buildHorizontalLegend('game-thumb-legend-sst', {
      lowLabel: 'Cool',
      lowValue: `${vmin.toFixed(0)}°C`,
      highLabel: 'Warm',
      highValue: `${vmax.toFixed(0)}°C`,
      gradient: `linear-gradient(to right, ${sstGrad})`,
    });
    const moistSteps = 24;
    const moistGrad = d3.range(moistSteps)
      .map(i => moistColor(20 + (i / (moistSteps - 1)) * 50))
      .join(', ');
    buildHorizontalLegend('game-thumb-legend-moisture', {
      lowLabel: 'Dry',
      lowValue: '20%',
      highLabel: 'Moist',
      highValue: '70%',
      gradient: `linear-gradient(to right, ${moistGrad})`,
    });
  }

  function initThumbMap(layerKey, svgId, uid) {
    const el = document.getElementById(svgId);
    if (!el) return null;
    const svgSel = d3.select(el);
    svgSel.selectAll('*').remove();
    svgSel.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
    const { gradId, clipId } = appendDefs(svgSel, uid);
    const g = svgSel.append('g').attr('class', 'game-thumb-inner-g');
    buildOcean(g);
    let layerSel;
    if (layerKey === 'sst') {
      layerSel = renderSstLayer(g, gradId, clipId, 0.9);
    } else {
      layerSel = renderMoistureField(g, clipId, 0.9);
    }
    buildLandLayer(g, { opacity: 1, stroke: true });
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
        activeChallengeId = btn.dataset.challenge;
        list.querySelectorAll('.game-challenge-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.challenge === activeChallengeId);
        });
        refreshAtPosition();
      });
    });
    const back = document.getElementById('game-map-back');
    if (back) back.addEventListener('click', () => setMainView('explore'));
  }

  function setupPopupClose() {
    const close = document.getElementById('game-popup-close');
    if (close) close.addEventListener('click', hidePopup);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hidePopup();
    });
  }

  function setupKeyboard() {
    const map = document.getElementById('game-map');
    if (!map) return;
    map.setAttribute('tabindex', '0');
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
      const path = meta.sst_seasons?.hurricane?.grid
        || meta.artifacts?.sst_grid_hurricane
        || meta.artifacts?.sst_grid;
      if (!path) return;
      sstGrid = await d3.json(path);
      const domain = meta.sst_seasons?.color_domain;
      if (domain) {
        colorDomain = domain;
        color.domain([domain.vmin, domain.vmax]);
      } else {
        color.domain([sstGrid.vmin, sstGrid.vmax]);
      }
    } catch (e) { sstGrid = null; }
  }

  function initMap() {
    const el = document.getElementById('game-map');
    if (!el) return;

    svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);

    const { gradId, clipId } = appendDefs(svg, 'main');
    mapG = svg.append('g').attr('class', 'game-map-inner');
    buildCoast(mapG);
    layers.layerSst = renderSstLayer(mapG);
    layers.layerMoisture = renderMoistureLayer(mapG);
    layers.layerShear = renderShearLayer(mapG);
    layers.layerExposure = renderExposureLayer(mapG);
    renderZoneRings(mapG);
=======
    buildOcean(mapG);
    layers.layerSst = renderSstLayer(mapG, gradId, clipId, 0);
    layers.layerMoisture = renderMoistureField(mapG, clipId, 0);
    layers.landG = buildLandLayer(mapG, { opacity: 1, stroke: true });
    layers.zoneRings = renderZoneRings(mapG);
>>>>>>> Stashed changes
    stormG = buildStorm(mapG);

    const start = zones.find(z => z.id === 'caribbean_heat') || zones[0];
    if (start) { stormX = start.x; stormY = start.y; }

    setupDrag();

    refreshAtPosition();
    setMainView('explore');
  }

  // ── ERROR ────────────────────────────────────────────────────────────

  function showError(msg) {
    const map = document.getElementById('game-map');
    if (map) {
      d3.select(map).selectAll('*').remove();
      d3.select(map)
        .append('foreignObject').attr('width', MAP_W).attr('height', MAP_H)
        .append('xhtml:div').attr('class', 'game-error').text(msg);
      return;
    }
    const wrap = document.getElementById('game-map-wrap');
    if (wrap) wrap.innerHTML = `<p class="game-error">${msg}</p>`;
  }

  // ── INIT ─────────────────────────────────────────────────────────────

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
      initMap();
      setupLayerToggles();
      setupChallenges();
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
