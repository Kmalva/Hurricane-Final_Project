/* ════════════════════════════════════════════════════════════════════
   Make a Hurricane — drag-map educational game (era-aware, free drag)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MAP_W = 900;
  const MAP_H = 520;
  const PAD = 20;

  // Score offsets per era (0–100 game scale).
  // Real °C deltas: 1980 ≈ −1.2°C, 2080 SSP5-8.5 ≈ +2.3°C vs. today.
  const ERA_OFFSETS = {
    '1980': { sst: -7, moisture: -4 },
    'now':  { sst:  0, moisture:  0 },
    '2080': { sst: 13, moisture:  7 },
  };

  let currentEra = 'now';
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
  let cachedDefs = {};

  const color = d3.scaleSequential(t => d3.interpolateYlOrRd(0.12 + t * 0.74));
  const moistColor = d3.scaleLinear()
    .domain([20, 45, 70])
    .range(['#f3e6fb', '#c061c9', '#6a1b9a'])
    .clamp(true);

  // ── SCORING ──────────────────────────────────────────────────────────

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
    return 'Ingredient alignment shapes the educational readout — not a real forecast.';
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

  // IDW interpolation of all numeric ingredients at arbitrary pixel position.
  function interpolateAllAt(x, y) {
    const sources = zones.length ? zones : (fallbackZone ? [fallbackZone] : []);
    if (!sources.length) return Object.assign({}, fallbackZone || {});
    const fields = ['sst', 'moisture', 'windShear', 'exposure', 'preparedness'];
    const sums = {};
    fields.forEach(f => { sums[f] = 0; });
    let den = 0;
    sources.forEach(z => {
      const d2 = (x - z.x) ** 2 + (y - z.y) ** 2 + 2500;
      const w = 1 / d2;
      fields.forEach(f => { sums[f] += w * (z[f] || 0); });
      den += w;
    });
    const result = {};
    fields.forEach(f => { result[f] = den > 0 ? Math.round(sums[f] / den) : 50; });
    const nearest = findNearestZone(x, y);
    result.id = 'pos_' + Math.round(x) + '_' + Math.round(y);
    result.label = nearest.label;
    result.locationType = nearest.locationType;
    result.stormResponse = nearest.stormResponse;
    result.explanation = nearest.explanation;
    return result;
  }

  // Apply era SST/moisture score offset, clamped to [0,100].
  function applyEraOffset(zone) {
    const off = ERA_OFFSETS[currentEra] || ERA_OFFSETS['now'];
    return Object.assign({}, zone, {
      sst:      Math.max(0, Math.min(100, zone.sst      + off.sst)),
      moisture: Math.max(0, Math.min(100, zone.moisture + off.moisture)),
    });
  }

  // ── MOISTURE FIELD ───────────────────────────────────────────────────

  function sampleMoistureAt(x, y) {
    const sources = zones.length ? zones : (fallbackZone ? [fallbackZone] : []);
    if (!sources.length) return 50;
    const off = ERA_OFFSETS[currentEra] || ERA_OFFSETS['now'];
    let num = 0, den = 0;
    sources.forEach(z => {
      const d2 = (x - z.x) ** 2 + (y - z.y) ** 2 + 2500;
      const w = 1 / d2;
      num += w * Math.max(0, Math.min(100, z.moisture + off.moisture));
      den += w;
    });
    return den > 0 ? num / den : 50;
  }

  // ── SPIRAL PATH ──────────────────────────────────────────────────────

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

  // ── MAP SETUP ────────────────────────────────────────────────────────

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
      if (p) { z.x = p[0]; z.y = p[1]; }
    });
  }

  function buildOcean(g) {
    return g.append('rect')
      .attr('class', 'game-ocean')
      .attr('x', 0).attr('y', 0)
      .attr('width', MAP_W).attr('height', MAP_H)
      .attr('fill', '#4a9fd4')
      .lower();
  }

  function buildLandLayer(g, opts) {
    const opacity = opts.opacity != null ? opts.opacity : 1;
    const stroke = opts.stroke !== false;
    const landG = g.append('g').attr('class', 'game-land-layer').attr('opacity', opacity);
    if (!landGeo || !geoPath) return landG;
    landG.selectAll('path')
      .data(landGeo.features)
      .join('path')
      .attr('class', 'game-land')
      .attr('d', geoPath)
      .attr('fill', '#74c365')
      .attr('stroke', stroke ? '#2d6a3f' : 'none')
      .attr('stroke-width', stroke ? 0.8 : 0);
    return landG;
  }

  function appendDefs(svgSel, uid) {
    const defs = svgSel.append('defs');
    const gradId = `game-sst-fallback-${uid}`;
    const grad = defs.append('linearGradient').attr('id', gradId)
      .attr('x1', '0').attr('y1', '0').attr('x2', '1').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#fee391');
    grad.append('stop').attr('offset', '50%').attr('stop-color', '#fe9929');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#cc4c02');
    const clipId = appendOceanClip(defs, uid);
    cachedDefs[uid] = { defs, gradId, clipId };
    return { defs, gradId, clipId };
  }

  function appendOceanClip(defs, uid) {
    if (!landGeo || !geoPath) return null;
    const clipId = `game-ocean-clip-${uid}`;
    const clip = defs.append('clipPath')
      .attr('id', clipId)
      .attr('clipPathUnits', 'userSpaceOnUse');
    const landD = geoPath(landGeo);
    if (!landD) return null;
    const d = `M0,0 H${MAP_W} V${MAP_H} H0 Z ${landD}`;
    clip.append('path').attr('d', d)
      .attr('fill-rule', 'evenodd').attr('clip-rule', 'evenodd');
    return clipId;
  }

  function mapLonLatBounds() {
    if (!projection || !projection.invert) {
      return { lonMin: -100, lonMax: 22, latMin: -8, latMax: 55 };
    }
    const tl = projection.invert([0, 0]);
    const br = projection.invert([MAP_W, MAP_H]);
    return { lonMin: tl[0], lonMax: br[0], latMin: br[1], latMax: tl[1] };
  }

  // ── SST GRID ─────────────────────────────────────────────────────────

  function filledSstValues() {
    if (!sstGrid) return null;
    if (sstGrid._filled) return sstGrid._filled;
    const { nx, ny, values } = sstGrid;
    const v = values.map(x => (x != null && Number.isFinite(x)) ? x : null);
    let guard = 0;
    while (guard < 250) {
      guard++;
      const next = v.slice();
      let filledThis = 0;
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          const i = r * nx + c;
          if (v[i] != null) continue;
          let sum = 0, n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || rr >= ny || cc < 0 || cc >= nx) continue;
              const val = v[rr * nx + cc];
              if (val != null) { sum += val; n++; }
            }
          }
          if (n > 0) { next[i] = sum / n; filledThis++; }
        }
      }
      for (let i = 0; i < v.length; i++) v[i] = next[i];
      if (filledThis === 0) break;
    }
    const fallback = sstGrid.vmin != null ? sstGrid.vmin : 26;
    for (let i = 0; i < v.length; i++) if (v[i] == null) v[i] = fallback;
    sstGrid._filled = v;
    return v;
  }

  function sampleFilledSst(filled, lon, lat) {
    const { nx, ny, lon0, lon1, lat0, lat1 } = sstGrid;
    let c = Math.round((lon - lon0) / (lon1 - lon0) * (nx - 1));
    let r = Math.round((lat - lat0) / (lat1 - lat0) * (ny - 1));
    c = c < 0 ? 0 : (c > nx - 1 ? nx - 1 : c);
    r = r < 0 ? 0 : (r > ny - 1 ? ny - 1 : r);
    return filled[r * nx + c];
  }

  // ── LAYER RENDERERS ──────────────────────────────────────────────────

  function renderSstLayer(g, gradId, clipId, initialOpacity) {
    const layer = g.append('g')
      .attr('class', 'layer-sst game-layer')
      .attr('opacity', initialOpacity);
    if (clipId) layer.attr('clip-path', `url(#${clipId})`);
    if (!sstGrid || !projection || !clipId) {
      if (clipId) {
        layer.append('rect').attr('width', MAP_W).attr('height', MAP_H)
          .attr('fill', `url(#${gradId})`);
      }
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

  // ── STORM VISUAL ─────────────────────────────────────────────────────

  function appendStormDot(g) {
    return g.append('circle')
      .attr('class', 'storm-dot')
      .attr('r', 11)
      .attr('fill', '#111')
      .attr('stroke', '#fff')
      .attr('stroke-width', 3);
  }

  function renderZoneRings(g) {
    const rings = g.append('g').attr('class', 'game-zones');
    zones.forEach(z => {
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

  // ── SNAP TO ZONE ─────────────────────────────────────────────────────

  function snapToZone(z) {
    stormX = z.x;
    stormY = z.y;
    refreshAtPosition();
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
    syncThumbDots();

    document.querySelectorAll('.game-zone').forEach(group => {
      const id = group.getAttribute('data-zone');
      const zd = zones.find(z => z.id === id);
      const near = zd ? Math.hypot(stormX - zd.x, stormY - zd.y) < (zd.radius * 1.2) : false;
      const ring = group.querySelector('.game-zone-ring');
      if (!ring) return;
      ring.classList.toggle('game-zone-ring--near', near);
      ring.setAttribute('opacity', near ? '0.85' : '0.45');
    });
  }

  // ── ERA ──────────────────────────────────────────────────────────────

  // CSS filter on the SST layer gives a warm/cool visual shift without re-rendering.
  function applyEraVisualFilter() {
    const filters = {
      '1980': 'saturate(0.72) hue-rotate(20deg) brightness(0.94)',
      'now':  '',
      '2080': 'saturate(1.4) hue-rotate(-14deg) brightness(1.06)',
    };
    const f = filters[currentEra] || '';
    if (layers.layerSst) layers.layerSst.style('filter', f || null);
    if (thumbs.sst && thumbs.sst.layer) thumbs.sst.layer.style('filter', f || null);
  }

  function setEra(era) {
  if (!ERA_OFFSETS[era]) return;
  currentEra = era;

  // Swap to real SST grid for this era
  if (ERA_SST_CACHE[era]) {
    sstGrid = ERA_SST_CACHE[era];
    sstGrid._filled = null; // clear fill cache so it recomputes
  }

  // Re-render SST layer with new grid
  const def = cachedDefs['main'];
  if (layers.layerSst && def) {
    const opacity = mainViewMode === 'sst' ? 0.85 : 0;
    layers.layerSst.remove();
    layers.layerSst = renderSstLayer(mapG, def.gradId, def.clipId, opacity);
    if (layers.landG) layers.landG.raise();
    if (layers.zoneRings) layers.zoneRings.raise();
    if (stormG) stormG.raise();
    if (layers.dragOverlay) layers.dragOverlay.raise();
  }

  // Re-render moisture field
  if (layers.layerMoisture && def) {
    const opacity = mainViewMode === 'moisture' ? 0.85 : 0;
    layers.layerMoisture.remove();
    layers.layerMoisture = renderMoistureField(mapG, def.clipId, opacity);
    if (layers.landG) layers.landG.raise();
    if (layers.zoneRings) layers.zoneRings.raise();
    if (stormG) stormG.raise();
    if (layers.dragOverlay) layers.dragOverlay.raise();
  }

  // Re-render SST thumbnail with new grid
  if (thumbs.sst) {
    thumbs.sst = initThumbMap('sst', 'game-thumb-sst', 'thumb-sst');
    applyEraVisualFilter(); // no-op now but keeps the call in place
  }
     
  if (thumbs.moisture) {
  thumbs.moisture = initThumbMap('moisture', 'game-thumb-moisture', 'thumb-moist');
}

  refreshAtPosition();
}

// No CSS filter — real grid data handles era differences
function applyEraVisualFilter() {
  if (layers.layerSst) layers.layerSst.style('filter', null);
  if (thumbs.sst && thumbs.sst.layer) thumbs.sst.layer.style('filter', null);
}

  function setupEraToggles() {
    document.querySelectorAll('.era-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const era = btn.dataset.era;
        setEra(era);
        document.querySelectorAll('.era-btn').forEach(b => {
          const active = b.dataset.era === era;
          b.classList.toggle('era-btn--active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      });
    });
  }

  // ── VIEW TOGGLE ──────────────────────────────────────────────────────

  function setMainView(mode) {
    mainViewMode = mode;
    const t = d3.transition().duration(280);
    if (layers.layerSst) layers.layerSst.transition(t).attr('opacity', mode === 'sst' ? 0.85 : 0);
    if (layers.layerMoisture) layers.layerMoisture.transition(t).attr('opacity', mode === 'moisture' ? 0.85 : 0);
    if (layers.landG) layers.landG.attr('opacity', 1);

    const back = document.getElementById('game-map-back');
    if (back) back.hidden = mode === 'explore';

    document.querySelectorAll('.game-thumb').forEach(btn => {
      const layer = btn.dataset.layer;
      const active = mode === layer;
      btn.classList.toggle('game-thumb--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // ── LEGEND ───────────────────────────────────────────────────────────

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
    const sstGrad = d3.range(24)
      .map(i => color(vmin + (i / 23) * (vmax - vmin))).join(', ');
    buildHorizontalLegend('game-thumb-legend-sst', {
      lowLabel: 'Cool', lowValue: `${vmin.toFixed(0)}°C`,
      highLabel: 'Warm', highValue: `${vmax.toFixed(0)}°C`,
      gradient: `linear-gradient(to right, ${sstGrad})`,
    });
    const moistGrad = d3.range(24)
      .map(i => moistColor(20 + (i / 23) * 50)).join(', ');
    buildHorizontalLegend('game-thumb-legend-moisture', {
      lowLabel: 'Dry', lowValue: '20%',
      highLabel: 'Moist', highValue: '70%',
      gradient: `linear-gradient(to right, ${moistGrad})`,
    });
  }

  // ── THUMB MAPS ───────────────────────────────────────────────────────

  function initThumbMap(layerKey, svgId, uid) {
    const el = document.getElementById(svgId);
    if (!el) return null;
    const svgSel = d3.select(el);
    svgSel.selectAll('*').remove();
    svgSel.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
    const { gradId, clipId } = appendDefs(svgSel, uid);
    const g = svgSel.append('g').attr('class', 'game-thumb-inner-g');
    buildOcean(g);
    const layerSel = layerKey === 'sst'
      ? renderSstLayer(g, gradId, clipId, 0.9)
      : renderMoistureField(g, clipId, 0.9);
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
        const layer = btn.dataset.layer;
        if (mainViewMode === layer) setMainView('explore');
        else setMainView(layer);
      });
    });
    const back = document.getElementById('game-map-back');
    if (back) back.addEventListener('click', () => setMainView('explore'));
  }

  // ── DRAG ─────────────────────────────────────────────────────────────

  function setupDrag() {
    // Transparent overlay on top captures all pointer/touch events for drag.
    const overlay = mapG.append('rect')
      .attr('class', 'game-drag-overlay')
      .attr('width', MAP_W)
      .attr('height', MAP_H)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair');

    layers.dragOverlay = overlay;

    const drag = d3.drag()
      .on('start', function (event) {
        overlay.style('cursor', 'grabbing');
        stormX = Math.max(PAD, Math.min(MAP_W - PAD, event.x));
        stormY = Math.max(PAD, Math.min(MAP_H - PAD, event.y));
        refreshAtPosition();
      })
      .on('drag', function (event) {
        stormX = Math.max(PAD, Math.min(MAP_W - PAD, event.x));
        stormY = Math.max(PAD, Math.min(MAP_H - PAD, event.y));
        refreshAtPosition();
      })
      .on('end', function () {
        overlay.style('cursor', 'crosshair');
      });

    overlay.call(drag);
  }

  // ── KEYBOARD ESCAPE (layer view reset) ───────────────────────────────

  function setupModalClose() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mainViewMode !== 'explore') setMainView('explore');
    });
  }

  // ── SST DATA ─────────────────────────────────────────────────────────

  // async function loadSstGrid() {
  //   try {
  //     const meta = await d3.json('data/goes_metadata.json');
  //     const path = meta.sst_seasons?.hurricane?.grid
  //       || meta.artifacts?.sst_grid_hurricane
  //       || meta.artifacts?.sst_grid;
  //     if (!path) return;
  //     sstGrid = await d3.json(path);
  //     const domain = meta.sst_seasons?.color_domain;
  //     if (domain) {
  //       colorDomain = domain;
  //       color.domain([domain.vmin, domain.vmax]);
  //     } else {
  //       color.domain([sstGrid.vmin, sstGrid.vmax]);
  //     }
  //   } catch (e) { sstGrid = null; }
  // }


  // ── ERA SST GRID PATHS ───────────────────────────────────────────────
const ERA_SST_PATHS = {
  '1980': 'data/sst_grid_1980.json',
  'now':  'data/sst_grid_now.json',
  '2080': 'data/sst_grid_2080.json',
};
const ERA_SST_CACHE = {};

// ── SST DATA ─────────────────────────────────────────────────────────
async function loadSstGrid() {
  try {
    const meta = await d3.json('data/goes_metadata.json');
    const domain = meta.sst_seasons?.color_domain;
    if (domain) {
      colorDomain = domain;
      color.domain([domain.vmin, domain.vmax]);
    }
    // Load all three era grids upfront
    for (const [era, path] of Object.entries(ERA_SST_PATHS)) {
      try {
        ERA_SST_CACHE[era] = await d3.json(path);
      } catch (e) {
        console.warn(`SST grid for ${era} not found:`, path);
      }
    }
    // Set current grid to 'now'
    sstGrid = ERA_SST_CACHE['now'] || null;
    if (sstGrid && !colorDomain) {
      color.domain([sstGrid.vmin, sstGrid.vmax]);
    }
  } catch (e) {
    sstGrid = null;
  }
}

  // ── MAIN MAP INIT ────────────────────────────────────────────────────

  function initMainMap() {
    const el = document.getElementById('game-map');
    if (!el) return;

    svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);

    const { gradId, clipId } = appendDefs(svg, 'main');
    mapG = svg.append('g').attr('class', 'game-map-inner');
    buildOcean(mapG);
    layers.layerSst = renderSstLayer(mapG, gradId, clipId, 0);
    layers.layerMoisture = renderMoistureField(mapG, clipId, 0);
    layers.landG = buildLandLayer(mapG, { opacity: 1, stroke: true });
    layers.zoneRings = renderZoneRings(mapG);
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
      initMainMap();
      initThumbMaps();
      setupThumbInteraction();
      setupModalClose();
      setupEraToggles();
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
