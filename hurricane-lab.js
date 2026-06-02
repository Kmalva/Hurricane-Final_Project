/* ════════════════════════════════════════════════════════════════════
   Hurricane Ingredients Lab — educational simulation (no GOES required)
   Skills: d3-chart-patterns, frontend-polish, data-cleaning (transparent formulas)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const KEYS = ['oceanTemp', 'moisture', 'windShear', 'coastalExposure', 'preparedness'];

  const PRESETS = {
    calm: { oceanTemp: 25, moisture: 20, windShear: 70, coastalExposure: 30, preparedness: 70 },
    warmOcean: { oceanTemp: 85, moisture: 50, windShear: 40, coastalExposure: 35, preparedness: 50 },
    highEnv: { oceanTemp: 90, moisture: 85, windShear: 15, coastalExposure: 40, preparedness: 45 },
    highExposure: { oceanTemp: 75, moisture: 70, windShear: 25, coastalExposure: 90, preparedness: 20 },
    prepared: { oceanTemp: 70, moisture: 65, windShear: 30, coastalExposure: 75, preparedness: 85 },
  };

  let state = { oceanTemp: 50, moisture: 50, windShear: 50, coastalExposure: 40, preparedness: 55 };
  let activePreset = null;
  let svg, layers;

  function category(score) {
    if (score <= 30) return { id: 'low', label: 'Low' };
    if (score <= 55) return { id: 'moderate', label: 'Moderate' };
    if (score <= 75) return { id: 'high', label: 'High' };
    return { id: 'extreme', label: 'Extreme' };
  }

  function computeScores(s) {
    const lowShearSupport = 100 - s.windShear;
    const lowPreparednessRisk = 100 - s.preparedness;
    const stormFormationEnvironment =
      0.35 * s.oceanTemp + 0.30 * s.moisture + 0.35 * lowShearSupport;
    const communityImpactPotential =
      0.50 * stormFormationEnvironment +
      0.30 * s.coastalExposure +
      0.20 * lowPreparednessRisk;
    return {
      lowShearSupport,
      stormFormationEnvironment,
      communityImpactPotential,
      envCat: category(stormFormationEnvironment),
      impactCat: category(communityImpactPotential),
    };
  }

  function explainRisk(s, scores) {
    if (s.oceanTemp > 75 && s.moisture > 75) {
      return 'Warm ocean fuel + high moisture may support a stronger storm environment.';
    }
    if (s.windShear < 30 && scores.stormFormationEnvironment >= 56) {
      return 'Low wind shear + favorable environment may support storm organization.';
    }
    if (s.coastalExposure > 75 && s.preparedness < 40) {
      return 'High exposure + low preparedness can increase community impact potential.';
    }
    if (s.preparedness > 70 && s.coastalExposure > 55) {
      return 'Preparedness may reduce harm even when exposure is elevated.';
    }
    if (scores.stormFormationEnvironment > 55 && scores.communityImpactPotential > 55) {
      return 'Multiple ingredients may align to raise storm environment and community impact potential.';
    }
    if (scores.stormFormationEnvironment <= 35 && scores.communityImpactPotential <= 35) {
      return 'Current settings suggest a calmer storm environment and lower community impact potential.';
    }
    return 'Adjust ingredients to see how alignment can change risk — no single factor tells the whole story.';
  }

  function getAnnotations(s) {
    const out = [];
    if (s.oceanTemp > 75) out.push('Warm ocean fuel is high.');
    if (s.moisture > 75) out.push('Moisture supports heavier rainfall potential.');
    if (s.windShear < 30) out.push('Low wind shear supports storm organization.');
    if (s.coastalExposure > 75 && s.preparedness < 40) {
      out.push('High exposure and low preparedness increase community impact.');
    }
    return out;
  }

  function initScene() {
    const el = document.getElementById('lab-stage');
    if (!el) return;
    svg = d3.select(el);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'lab-sky').attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#0a2433');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#061620');

    const g = svg.append('g');
    layers = {
      root: g,
      sky: g.append('rect').attr('width', 400).attr('height', 300).attr('fill', 'url(#lab-sky)'),
      ocean: g.append('rect').attr('y', 165).attr('width', 400).attr('height', 135).attr('fill', '#0c4a6e'),
      goesBg: g.append('image').attr('x', 0).attr('y', 0).attr('width', 400).attr('height', 300).attr('opacity', 0).attr('preserveAspectRatio', 'xMidYMid slice'),
      coastGlow: g.append('rect').attr('x', 0).attr('y', 248).attr('width', 400).attr('height', 52).attr('fill', '#1e293b').attr('opacity', 0.5),
      buildings: g.append('g').attr('class', 'buildings'),
      rain: g.append('g').attr('class', 'rain').attr('opacity', 0),
      clouds: g.append('g').attr('class', 'clouds'),
      storm: g.append('g').attr('class', 'storm').attr('transform', 'translate(200,145)'),
      prep: g.append('g').attr('class', 'prep').attr('opacity', 0),
      eye: null,
    };

    buildStormSpiral(layers.storm);
    buildBuildings(layers.buildings);
    buildPrepIcons(layers.prep);
    buildCloudBands(layers.clouds);
    buildRainLines(layers.rain);

    tryGoesBackground();
  }

  function buildStormSpiral(stormG) {
    const bands = [];
    for (let i = 0; i < 5; i++) {
      const path = stormG.append('path')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.75)')
        .attr('stroke-width', 2.2)
        .attr('stroke-linecap', 'round');
      bands.push(path);
    }
    layers.eye = stormG.append('circle')
      .attr('r', 12)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.9)')
      .attr('stroke-width', 2);
    layers.bands = bands;
  }

  function spiralPath(tightness, stretch, rotDeg) {
    const pts = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 3.2 + (rotDeg * Math.PI) / 180;
      const r = (18 + t * (55 * tightness)) * (1 + stretch * t * 0.4);
      pts.push([Math.cos(angle) * r, Math.sin(angle) * r * (1 - stretch * 0.35)]);
    }
    return d3.line().curve(d3.curveCatmullRom.alpha(0.6))(pts);
  }

  function buildCloudBands(cloudG) {
    layers.cloudPaths = [];
    for (let i = 0; i < 4; i++) {
      const p = cloudG.append('path')
        .attr('fill', 'rgba(255,255,255,0.12)')
        .attr('stroke', 'rgba(255,255,255,0.25)')
        .attr('stroke-width', 1);
      layers.cloudPaths.push(p);
    }
  }

  function buildRainLines(rainG) {
    layers.rainLines = [];
    for (let i = 0; i < 12; i++) {
      layers.rainLines.push(
        rainG.append('line')
          .attr('stroke', 'rgba(191,224,242,0.5)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2,3')
      );
    }
  }

  function buildBuildings(buildG) {
    layers.buildingRects = [];
    const slots = [
      [20, 252, 14, 28], [38, 258, 10, 22], [52, 250, 16, 36], [72, 255, 12, 25],
      [300, 252, 14, 30], [318, 258, 11, 20], [332, 248, 18, 40], [355, 254, 13, 26],
      [120, 262, 8, 18], [200, 260, 10, 20], [280, 263, 9, 16],
    ];
    slots.forEach(([x, y, w, h], i) => {
      const r = buildG.append('rect')
        .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
        .attr('fill', '#fef08a').attr('opacity', 0);
      layers.buildingRects.push(r);
    });
  }

  function buildPrepIcons(prepG) {
    prepG.append('path')
      .attr('d', 'M30,255 L50,235 L70,255 Z')
      .attr('fill', 'none').attr('stroke', '#7fd2f4').attr('stroke-width', 1.5)
      .attr('class', 'prep-evac');
    prepG.append('circle').attr('cx', 340).attr('cy', 242).attr('r', 10)
      .attr('fill', 'none').attr('stroke', '#7fd2f4').attr('stroke-width', 1.5)
      .attr('class', 'prep-shield');
    prepG.append('text').attr('x', 200).attr('y', 28).attr('text-anchor', 'middle')
      .attr('fill', '#7fd2f4').attr('font-size', 10).attr('font-family', 'Inter, Arial')
      .text('⚠ Prepared');
  }

  function updateScene(s, scores) {
    if (!layers || !svg) return;
    const t = d3.transition().duration(400).ease(d3.easeCubicOut);

    const oceanColor = d3.interpolateRgb('#0c4a6e', '#ea580c')(s.oceanTemp / 100);
    layers.ocean.transition(t).attr('fill', oceanColor);

    const tight = scores.lowShearSupport / 100;
    const stretch = s.windShear / 100;
    const rot = stretch * 35;
    layers.bands.forEach((band, i) => {
      band.transition(t)
        .attr('d', spiralPath(0.65 + tight * 0.5, stretch * 0.85, rot + i * 18))
        .attr('opacity', 0.35 + tight * 0.55)
        .attr('stroke-width', 1.2 + (1 - stretch) * 1.8);
    });
    layers.eye.transition(t)
      .attr('opacity', s.windShear < 45 ? 0.5 + tight * 0.5 : 0.15)
      .attr('r', 8 + tight * 10);

    const moistOp = 0.15 + (s.moisture / 100) * 0.55;
    layers.cloudPaths.forEach((p, i) => {
      const cx = 80 + i * 70;
      const cy = 60 + i * 12;
      p.transition(t)
        .attr('d', `M${cx},${cy} Q${cx + 40},${cy - 20} ${cx + 90},${cy + 10} T${cx + 50},${cy + 35}`)
        .attr('opacity', moistOp);
    });
    layers.rain.transition(t).attr('opacity', s.moisture > 60 ? (s.moisture - 60) / 80 : 0);
    layers.rainLines.forEach((line, i) => {
      const x = 100 + (i % 6) * 45;
      const y = 40 + Math.floor(i / 6) * 50;
      line.transition(t)
        .attr('x1', x).attr('y1', y)
        .attr('x2', x - 8).attr('y2', y + 25 + s.moisture * 0.15);
    });

    const exp = s.coastalExposure / 100;
    layers.coastGlow.transition(t).attr('opacity', 0.3 + exp * 0.5);
    layers.buildingRects.forEach((r, i) => {
      const show = i < Math.round(3 + exp * 8);
      r.transition(t)
        .attr('opacity', show ? 0.35 + exp * 0.55 : 0)
        .attr('fill', exp > 0.6 ? '#fde047' : '#cbd5e1');
    });

    layers.prep.transition(t).attr('opacity', s.preparedness > 45 ? (s.preparedness - 45) / 110 : 0);

    layers.storm.transition(t).attr('transform',
      `translate(200,${145 - s.oceanTemp * 0.08}) rotate(${stretch * 12})`);
  }

  function tryGoesBackground() {
    if (!layers) return;
    fetch('data/goes_metadata.json')
      .then(r => r.ok ? r.json() : null)
      .then(meta => {
        const url = meta && meta.artifacts && meta.artifacts.storm_visible;
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          layers.goesBg.attr('href', url).transition().duration(800).attr('opacity', 0.1);
        };
        img.onerror = () => {};
        img.src = url;
      })
      .catch(() => {});
  }

  function updatePanel(scores) {
    const envN = Math.round(scores.stormFormationEnvironment);
    const impN = Math.round(scores.communityImpactPotential);
    document.getElementById('lab-env-num').textContent = envN;
    document.getElementById('lab-impact-num').textContent = impN;
    setBadge('lab-env-badge', scores.envCat);
    setBadge('lab-impact-badge', scores.impactCat);
    document.getElementById('lab-main-risk').textContent = explainRisk(state, scores);
    const stage = document.getElementById('lab-stage');
    if (stage) {
      stage.setAttribute('aria-label',
        `Educational simulation: storm environment ${scores.envCat.label}, community impact ${scores.impactCat.label}`);
    }
  }

  function setBadge(id, cat) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = cat.label;
    el.className = 'risk-badge risk-badge--' + cat.id;
  }

  function updateAnnotationsList(s) {
    const ul = document.getElementById('lab-annotations');
    if (!ul) return;
    const items = getAnnotations(s);
    ul.innerHTML = items.map(t => `<li>${t}</li>`).join('');
  }

  function syncSlidersFromState() {
    KEYS.forEach(key => {
      const input = document.getElementById('lab-' + key);
      if (input) input.value = state[key];
    });
  }

  function readStateFromSliders() {
    KEYS.forEach(key => {
      const input = document.getElementById('lab-' + key);
      if (input) state[key] = +input.value;
    });
  }

  function updateAll() {
    const scores = computeScores(state);
    updatePanel(scores);
    updateScene(state, scores);
    updateAnnotationsList(state);
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    state = { ...p };
    activePreset = name;
    syncSlidersFromState();
    document.querySelectorAll('.lab-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === name);
    });
    updateAll();
  }

  function setupSliders() {
    KEYS.forEach(key => {
      const input = document.getElementById('lab-' + key);
      if (!input) return;
      input.addEventListener('input', () => {
        activePreset = null;
        document.querySelectorAll('.lab-preset-btn').forEach(b => b.classList.remove('active'));
        readStateFromSliders();
        updateAll();
      });
    });
  }

  function setupPresets() {
    document.querySelectorAll('.lab-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });
  }

  function setupInfoButtons() {
    document.querySelectorAll('.lab-info').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = 'tip-' + btn.dataset.tip;
        const tip = document.getElementById(id);
        if (!tip) return;
        const open = tip.hidden;
        document.querySelectorAll('.lab-tip').forEach(t => { t.hidden = true; });
        document.querySelectorAll('.lab-info').forEach(b => b.setAttribute('aria-expanded', 'false'));
        if (open) {
          tip.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  function init() {
    if (!document.getElementById('lab-stage')) return;
    initScene();
    setupSliders();
    setupPresets();
    setupInfoButtons();
    updateAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
