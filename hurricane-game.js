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
=======
  const PAD = 20;
>>>>>>> Stashed changes

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
  let challenges = [];
  let activeLayer = 'sst';
  let activeChallengeId = null;
  let stormX = 520;
  let stormY = 365;
  let svg, mapG, stormG, layers = {};
  let sstGrid = null;
  let colorDomain = null;
<<<<<<< Updated upstream
  let popupVisible = false;
  let rafPending = false;
  const color = d3.scaleSequential(d3.interpolateTurbo);
=======
  let cachedDefs = {};

  const color = d3.scaleSequential(t => d3.interpolateYlOrRd(0.12 + t * 0.74));
  const moistColor = d3.scaleLinear()
    .domain([20, 45, 70])
    .range(['#f3e6fb', '#c061c9', '#6a1b9a'])
    .clamp(true);
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
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
=======
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
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
=======
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
>>>>>>> Stashed changes
      return layer;
    }
    const lonSpan = sstGrid.lon1 - sstGrid.lon0;
    const latNorth = sstGrid.lat0;
    const latSpan = Math.abs(sstGrid.lat0 - sstGrid.lat1);
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
          .attr('opacity', 0.72);
      }
    }
    return layer;
  }

  function renderMoistureLayer(g) {
    const layer = g.append('g').attr('class', 'layer-moisture game-layer').attr('opacity', 0);
    const defs = svg.select('defs');
    if (defs.select('#game-moist-pattern').empty()) {
      const p = defs.append('pattern').attr('id', 'game-moist-pattern')
        .attr('width', 12).attr('height', 12).attr('patternUnits', 'userSpaceOnUse');
      p.append('circle').attr('cx', 3).attr('cy', 3).attr('r', 2).attr('fill', 'rgba(45,212,191,0.35)');
    }
    zones.forEach(z => {
      layer.append('circle')
        .attr('cx', z.x).attr('cy', z.y)
        .attr('r', z.radius * 1.1)
        .attr('fill', 'url(#game-moist-pattern)')
        .attr('opacity', 0.15 + (z.moisture / 100) * 0.55);
    });
    return layer;
  }

  function renderShearLayer(g) {
    const layer = g.append('g').attr('class', 'layer-shear game-layer').attr('opacity', 0);
    const arrow = (x1, y1, x2, y2, op) => {
      layer.append('line')
        .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2)
        .attr('stroke', '#a78bfa').attr('stroke-width', 1.8).attr('opacity', op)
        .attr('marker-end', 'url(#game-arrow)');
    };
    zones.forEach(z => {
      const n = 4 + Math.floor(z.windShear / 25);
      const op = 0.25 + (z.windShear / 100) * 0.65;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const dx = Math.cos(a) * z.radius * 0.6;
        const dy = Math.sin(a) * z.radius * 0.4;
        arrow(z.x - dx, z.y - dy, z.x + dx * 1.4, z.y + dy * 1.4, op);
      }
    });
    arrow(720, 180, 820, 200, 0.7);
    arrow(680, 120, 780, 100, 0.6);
    return layer;
  }

<<<<<<< Updated upstream
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
=======
  // ── STORM VISUAL ─────────────────────────────────────────────────────

  function appendStormDot(g) {
    return g.append('circle')
      .attr('class', 'storm-dot')
      .attr('r', 11)
      .attr('fill', '#111')
      .attr('stroke', '#fff')
      .attr('stroke-width', 3);
>>>>>>> Stashed changes
  }

  function renderZoneRings(g) {
    const rings = g.append('g').attr('class', 'game-zones');
    zones.forEach(z => {
<<<<<<< Updated upstream
      rings.append('circle')
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
    if (stage) {
      stage.setAttribute('aria-label',
        `Educational simulation at ${zone.label}: ${scores.growthLabel}, community impact ${scores.impactCat.label}`);
    }

    updateChallengeFeedback(zone, scores);
  }

<<<<<<< Updated upstream
  function updateChallengeFeedback(zone, scores) {
    const fb = document.getElementById('game-challenge-feedback');
    if (!fb || !activeChallengeId) {
      if (fb) fb.textContent = '';
      return;
    }
    const ch = challenges.find(c => c.id === activeChallengeId);
    if (!ch) return;
    if (challengeMatches(zone, scores, ch)) {
      fb.className = 'game-feedback game-feedback--success';
      fb.textContent = zone.challengeSuccess || 'Good find — this region matches the challenge.';
    } else {
      fb.className = 'game-feedback game-feedback--hint';
      fb.textContent = ch.failHint || 'Try another region. One helpful ingredient, but another factor may limit growth.';
    }
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
      const rect = wrap.getBoundingClientRect();
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

=======
>>>>>>> Stashed changes
  function snapToZone(z) {
    stormX = z.x;
    stormY = z.y;
    refreshAtPosition();
<<<<<<< Updated upstream
    if (z.popupTitle) showPopup(z);
=======
>>>>>>> Stashed changes
  }

  // ── REFRESH ──────────────────────────────────────────────────────────

  function refreshAtPosition() {
    const rawZone = interpolateAllAt(stormX, stormY);
    const zone = applyEraOffset(rawZone);
    const scores = computeScores(zone);

    if (stormG) {
      stormG.attr('transform', `translate(${stormX},${stormY})`);
    }
    updateStormVisual(zone, scores);
    updatePanel(zone, scores);
<<<<<<< Updated upstream
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
        stormG.attr('transform', `translate(${stormX},${stormY})`);
        scheduleRefresh();
      })
      .on('end', function () {
        d3.select(this).attr('cursor', 'grab');
        const zone = findNearestZone(stormX, stormY);
        const dist = Math.hypot(stormX - zone.x, stormY - zone.y);
        if (dist <= zone.radius * 1.25) {
          stormX = zone.x;
          stormY = zone.y;
          stormG.attr('transform', `translate(${stormX},${stormY})`);
          if (zone.popupTitle) showPopup(zone);
        }
        refreshAtPosition();
      });
    storm.call(drag);
  }

  function setLayer(id) {
    activeLayer = id;
    document.querySelectorAll('.game-layer-btn').forEach(btn => {
      const on = btn.dataset.layer === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const layerOp = {
      sst: { sst: 0.55, moisture: 0, shear: 0, exposure: 0 },
      moisture: { sst: 0, moisture: 0.65, shear: 0, exposure: 0 },
      shear: { sst: 0, moisture: 0, shear: 0.75, exposure: 0 },
      exposure: { sst: 0, moisture: 0, shear: 0, exposure: 0.8 },
      all: { sst: 0.4, moisture: 0.3, shear: 0.2, exposure: 0.1 },
    };
    const op = layerOp[id] || layerOp.sst;

    Object.keys(layers).forEach(key => {
      if (!key.startsWith('layer')) return;
      const sel = layers[key];
      if (!sel) return;
      const name = key.replace('layer', '').toLowerCase();
      const o = op[name] != null ? op[name] : 0;
      sel.transition().duration(280).attr('opacity', o);
    });

    const leg = document.getElementById('game-legend');
    if (leg) {
      const texts = {
        sst: 'Warm colors ≈ warmer sea surface (GOES snapshot, Sep 2022).',
        moisture: 'Teal = schematic moist air — not measured rainfall.',
        shear: 'Purple arrows = stronger wind shear aloft (schematic).',
        exposure: 'Lights = illustrative coastal exposure.',
        all: 'Combined schematic layers (educational only).',
      };
      leg.textContent = texts[id] || '';
    }
  }

  function setupLayerToggles() {
    document.querySelectorAll('.game-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => setLayer(btn.dataset.layer));
    });
    setLayer('sst');
  }

  function setupChallenges() {
    const list = document.getElementById('game-challenges');
    if (!list) return;
    list.innerHTML = challenges.map(ch =>
      `<button type="button" class="game-challenge-btn" data-challenge="${ch.id}">${ch.prompt}</button>`
    ).join('');
    list.querySelectorAll('.game-challenge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeChallengeId = btn.dataset.challenge;
        list.querySelectorAll('.game-challenge-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.challenge === activeChallengeId);
        });
        refreshAtPosition();
=======
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
    applyEraVisualFilter();

    // Re-render moisture field since era offset changes the distribution.
    const def = cachedDefs['main'];
    if (layers.layerMoisture && def) {
      const opacity = mainViewMode === 'moisture' ? 0.85 : 0;
      layers.layerMoisture.remove();
      layers.layerMoisture = renderMoistureField(mapG, def.clipId, opacity);
      // Restore z-order
      if (layers.landG) layers.landG.raise();
      if (layers.zoneRings) layers.zoneRings.raise();
      if (stormG) stormG.raise();
      if (layers.dragOverlay) layers.dragOverlay.raise();
    }

    refreshAtPosition();
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
>>>>>>> Stashed changes
      });
    });
  }

<<<<<<< Updated upstream
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
=======
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

  // ── MODAL CLOSE ──────────────────────────────────────────────────────

  function setupModalClose() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mainViewMode !== 'explore') setMainView('explore');
>>>>>>> Stashed changes
    });
  }

  // ── SST DATA ─────────────────────────────────────────────────────────

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

<<<<<<< Updated upstream
  function initMap() {
=======
  // ── MAIN MAP INIT ────────────────────────────────────────────────────

  function initMainMap() {
>>>>>>> Stashed changes
    const el = document.getElementById('game-map');
    if (!el) return;

    svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`);

    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'game-sst-fallback').attr('x1', '0').attr('y1', '0').attr('x2', '1').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#1e3a5f');
    grad.append('stop').attr('offset', '50%').attr('stop-color', '#ea580c');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#0c4a6e');
    defs.append('marker').attr('id', 'game-arrow').attr('viewBox', '0 -4 8 8').attr('refX', 6)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4 L8,0 L0,4').attr('fill', '#a78bfa');

    mapG = svg.append('g').attr('class', 'game-map-inner');
<<<<<<< Updated upstream
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
    enableDrag(stormG);

    const start = zones.find(z => z.id === 'caribbean_heat') || zones[0];
    if (start) { stormX = start.x; stormY = start.y; }

    setupDrag();

    refreshAtPosition();
    setLayer(activeLayer);
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
      challenges = config.challenges || [];
      await loadSstGrid();
<<<<<<< Updated upstream
      initMap();
      setupLayerToggles();
      setupChallenges();
      setupPopupClose();
      setupKeyboard();
=======
      initMainMap();
      initThumbMaps();
      setupThumbInteraction();
      setupModalClose();
      setupEraToggles();
>>>>>>> Stashed changes
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
