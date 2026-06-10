/* ════════════════════════════════════════════════════════════════════
   Viz 3 — CENTERPIECE: "Ingredients of a storm" explorer (Hurricane Ian)
   Skills: d3-scrollytelling + frontend-polish. Built on real GOES layers.
   Artifact-flexible: only shows layers that exist in goes_metadata.json, so
   a partial pipeline still yields a polished, annotated satellite section.
   Interactions (each reveals something a static image cannot):
     • layer toggles / blend to stack storm + warm water + moisture
     • hover -> side panel reads local sea surface temperature
     • annotations for the eye and landfall point
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // layer registry — ordered ocean→storm→atmosphere (narrative build-up)
  const LAYER_DEFS = [
    { id: 'storm_sst_layer', key: 'storm_sst_layer', name: 'Sea surface temp',
      accent: '#ef4444', accentDim: 'rgba(239,68,68,0.15)',
      z: 1, op: 0.78, defaultOn: false, label: 'The fuel',
      shortDesc: 'Warm water is the energy source. Rapid evaporation loads the atmosphere with heat and moisture, which powers the storm like a heat engine.',
      desc: 'Sea surface temperature - is the energy source that makes a hurricane possible. Warm water (29–31°C in this case) evaporates rapidly, loading the atmosphere above with heat and moisture. As long as the storm sits over warm water, it draws energy upward like a heat engine. When the SST drops, from cooler water ahead or churning up cold water from beneath, the engine begins to starve. ' },
    { id: 'storm_visible', key: 'storm_visible', name: 'Visible Light',
      accent: '#e2e8f0', accentDim: 'rgba(226,232,240,0.12)',
      z: 2, op: 1.0, defaultOn: true, label: 'The storm',
      shortDesc: 'Sunlight reflecting off cloud tops reveals the storm\'s structure: spiral rainbands winding inward and the eyewall surrounding the calm eye.',
      desc: 'Visible light - is sunlight bouncing off the tops of clouds, which clearly shows the storm\'s shape. You can trace the spiral rainbands winding inward, and the eye wall surrounding the calm eye at the center. This specifically shows structure, not intensity.' },
    { id: 'storm_ir', key: 'storm_ir', name: 'Infrared',
      accent: '#fb923c', accentDim: 'rgba(251,146,60,0.15)',
      z: 3, op: 1.0, defaultOn: false, label: 'Intensity',
      shortDesc: 'Cloud-top temperatures reveal intensity. The coldest, brightest ring around the eye marks the eyewall, where updrafts and winds are strongest.',
      desc: 'Infrared - measures heat radiating from cloud tops. Colder cloud tops which are higher in the atmosphere appear brighter. The ring of coldest, brightest cloud ringing the eye marks the eye wall, which is the most violent part of the storm, as updrafts are strongest and winds are highest. Meteorologists can use this band to estimate hurricane intensity even when aircraft reconnaissance (flights that measure conditions inside the storms) isn\'t available.' },
    { id: 'water_vapor', key: 'water_vapor', name: 'Water vapor',
      accent: '#38bdf8', accentDim: 'rgba(56,189,248,0.15)',
      z: 4, op: 0.82, defaultOn: false, label: 'Moisture',
      shortDesc: 'Moisture in the mid and upper atmosphere spiraling into the storm feeds the thunderstorm activity that drives intensification.',
      desc: 'Water vapor imagery shows moisture in the mid and upper atmosphere. Darker areas are dry; brighter areas trace moist air spiraling into the storm. Moisture is critical for hurricanes. It feeds the thunderstorm activity that drives intensification and sustains the storm\'s structure. This is atmospheric moisture, not measured rainfall. ' },
  ];



  let META = null, SST = null, BOX = null, active = new Set();


function setContextPanel(layer) {
  const body = document.getElementById('context-panel-body');
  if (!body) return;
  body.innerHTML =
    `<span class="context-layer-name" style="color:${layer.accent}">${layer.name}</span>` +
    `<span class="context-layer-role" style="color:${layer.accent}">${layer.label}</span>` +
    `<span class="context-layer-desc">${layer.desc}</span>`;
}

function setContextPanelDefault() {
  const body = document.getElementById('context-panel-body');
  if (!body) return;
  body.innerHTML =
    `<div class="context-default"><p>Select a layer to learn how each ingredient contributes to a hurricane's power.</p></div>`;
}

function setContextPanelAll(layers) {
  const body = document.getElementById('context-panel-body');
  if (!body) return;
  const items = layers.map(l =>
    `<div class="context-all-item" style="border-color:${l.accent}">` +
      `<span class="context-layer-name" style="color:${l.accent};font-size:0.88rem;margin-bottom:0.2rem">${l.name}</span>` +
      `<span class="context-layer-role" style="color:${l.accent}">${l.label}</span>` +
      `<span class="context-layer-desc" style="font-size:0.78rem;line-height:1.5">${l.shortDesc}</span>` +
    `</div>`
  ).join('');
  body.innerHTML = `<div class="context-all-grid">${items}</div>`;
}

  async function init() {
    try { META = await d3.json('data/goes_metadata.json'); }
    catch (e) { return fallback('Satellite explorer unavailable.'); }

    const art = META.artifacts || {};
    const layers = LAYER_DEFS.filter(l => art[l.key]);
    if (!layers.length) return fallback('No satellite layers were exported.');

    // storm meta -> panel + stage aspect
    const s = META.storm || {};
    document.getElementById('panel-storm').textContent = `${s.name || 'Storm'} · ${s.year_label || ''}`.trim();
    document.getElementById('panel-storm-sub').textContent =
      [s.date_utc, s.category_at_view].filter(Boolean).join(' · ');
    document.getElementById('explorer-source').textContent =
      `Source: NOAA GOES-16 (${(META.products && META.products.imagery) || 'ABI'}) · ${s.date_utc || ''}. See methods.`;

    BOX = (META.storm_image && META.storm_image.box) || (META.boxes && META.boxes.storm);
    const stage = document.getElementById('explorer-stage');
    if (META.storm_image && META.storm_image.w && META.storm_image.h) {
      stage.style.aspectRatio = `${META.storm_image.w} / ${META.storm_image.h}`;
    }

    // optional SST grid for hover read-outs
    if (art.storm_sst_grid) {
      try { SST = await d3.json(art.storm_sst_grid); } catch (e) { SST = null; }
    }

    buildStage(stage, layers, art);
    buildToggles(layers);
    buildAnnotations(stage);
    addAnnotationsToGrid();

    layers.filter(l => l.defaultOn).forEach(l => active.add(l.id));
    syncLayers(layers);
    setReadoutDefault();

    const defaultLayer = layers.find(l => l.defaultOn);
    if (defaultLayer) setContextPanel(defaultLayer);
  }

  function buildStage(stage, layers, art) {
    // Stack layer: full-stage images for single-layer mode
    layers.forEach(l => {
      const img = document.createElement('img');
      img.className = 'layer-img';
      img.src = art[l.key];
      img.alt = `${l.name} satellite layer`;
      img.style.zIndex = String(l.z);
      img.style.opacity = '0';
      img.dataset.layer = l.id;
      img.dataset.op = String(l.op);
      stage.appendChild(img);
    });

    // Grid layer: 2x2 container for all-mode
    const grid = document.createElement('div');
    grid.className = 'stage-grid';
    grid.id = 'stage-grid';
    grid.style.display = 'none';
    layers.forEach(l => {
      const cell = document.createElement('div');
      cell.className = 'stage-cell';
      const cellImg = document.createElement('img');
      cellImg.src = art[l.key];
      cellImg.alt = l.name;
      cellImg.className = 'stage-cell-img';
      const label = document.createElement('span');
      label.className = 'stage-cell-label';
      label.textContent = l.name;
      label.style.color = l.accent;
      cell.appendChild(cellImg);
      cell.appendChild(label);
      grid.appendChild(cell);
    });
    stage.appendChild(grid);

    // hover capture (top-most, single-layer mode only)
    const cap = document.createElement('div');
    cap.className = 'hover-capture';
    cap.style.zIndex = '50';
    stage.appendChild(cap);
    cap.addEventListener('mousemove', onHover);
    cap.addEventListener('mouseleave', setReadoutDefault);
  }

  let allMode = false;

  function buildToggles(layers) {
    const host = document.getElementById('layer-toggles');
    host.innerHTML = '';

    // Individual layer buttons — radio style, one active at a time
    layers.forEach(l => {
      const btn = document.createElement('button');
      btn.className = 'layer-btn';
      btn.dataset.layer = l.id;
      btn.style.setProperty('--lb-accent', l.accent);
      btn.style.setProperty('--lb-accent-dim', l.accentDim);
      btn.innerHTML =
        `<span class="lb-text">` +
          `<span class="lb-name">${l.name}</span>` +
          `<span class="lb-sublabel">${l.label}</span>` +
        `</span>` +
        `<span class="lb-pill">Off</span>`;
      btn.addEventListener('click', () => {
        allMode = false;
        active.clear();
        active.add(l.id);
        syncLayers(layers);
        setReadout(l);
        setContextPanel(l);
      });
      host.appendChild(btn);
    });

    // Divider
    const div = document.createElement('div');
    div.className = 'lb-divider';
    host.appendChild(div);

    // All layers button (2x2 grid icon)
    const allBtn = document.createElement('button');
    allBtn.className = 'layer-btn layer-btn--all';
    allBtn.id = 'layer-btn-all';
    allBtn.innerHTML =
      `<span class="lb-all-grid" aria-hidden="true">` +
        `<span style="background:#ef4444"></span>` +
        `<span style="background:#e2e8f0"></span>` +
        `<span style="background:#fb923c"></span>` +
        `<span style="background:#38bdf8"></span>` +
      `</span>` +
      `<span class="lb-text">` +
        `<span class="lb-name">All layers</span>` +
        `<span class="lb-sublabel">Combined view</span>` +
      `</span>` +
      `<span class="lb-pill" id="lb-all-pill">Off</span>`;
      
      allBtn.addEventListener('click', () => {
        allMode = !allMode;
        if (allMode) {
          layers.forEach(l => active.add(l.id));
          setContextPanelAll(layers);
        } else {
          active.clear();
          const def = layers.find(l => l.defaultOn) || layers[0];
          if (def) { active.add(def.id); setContextPanel(def); }
        }
  syncLayers(layers);
  document.getElementById('readout-body').innerHTML = allMode
    ? 'All four satellite layers are stacked. Hover the scene to read sea surface temperature beneath the storm.'
    : 'Hover the satellite scene to read the sea surface temperature, and toggle layers to stack the ingredients: <strong>warm water</strong>, <strong>storm</strong>, and <strong>moisture</strong>.';
});
    host.appendChild(allBtn);
  }

  function syncLayers(layers) {
    const stage = document.getElementById('explorer-stage');
    const grid = document.getElementById('stage-grid');
    const cap = stage.querySelector('.hover-capture');
    const annot = document.getElementById('annot-svg');

    if (allMode) {
      // Show 2x2 grid, hide stacked images and overlays
      layers.forEach(l => {
        const img = stage.querySelector(`img[data-layer="${l.id}"]`);
        if (img) img.style.opacity = '0';
      });
      if (grid) grid.style.display = 'grid';
      if (cap) cap.style.display = 'none';
      if (annot) annot.style.display = 'none';
    } else {
      // Show stacked single-layer mode
      if (grid) grid.style.display = 'none';
      if (cap) cap.style.display = '';
      if (annot) annot.style.display = '';
      layers.forEach(l => {
        const img = stage.querySelector(`img[data-layer="${l.id}"]`);
        if (img) img.style.opacity = active.has(l.id) ? img.dataset.op : '0';
      });
      if (annot) {
        annot.querySelector('#annot-warm').style.opacity = active.has('storm_sst_layer') ? 1 : 0;
        annot.querySelector('#annot-moist').style.opacity = active.has('water_vapor') ? 1 : 0;
      }
    }

    // Sync individual button states
    layers.forEach(l => {
      const btn = document.querySelector(`.layer-btn[data-layer="${l.id}"]`);
      if (btn) {
        const singleActive = active.has(l.id) && !allMode;
        btn.classList.toggle('active', singleActive);
        btn.querySelector('.lb-pill').textContent = singleActive ? 'On' : 'Off';
      }
    });

    // all-layers button
    const allBtn = document.getElementById('layer-btn-all');
    const allPill = document.getElementById('lb-all-pill');
    if (allBtn) allBtn.classList.toggle('active', allMode);
    if (allPill) allPill.textContent = allMode ? 'On' : 'Off';
  }

  // normalized helpers (image spans the storm BOX exactly; north = top)
  function lonOf(nx) { return BOX.lon0 + nx * (BOX.lon1 - BOX.lon0); }
  function latOf(ny) { return BOX.lat1 - ny * (BOX.lat1 - BOX.lat0); } // lat1 = north
  function nxOf(lon) { return (lon - BOX.lon0) / (BOX.lon1 - BOX.lon0); }
  function nyOf(lat) { return (BOX.lat1 - lat) / (BOX.lat1 - BOX.lat0); }

  function sampleSST(nx, ny) {
    if (!SST) return null;
    const c = Math.min(SST.nx - 1, Math.max(0, Math.floor(nx * SST.nx)));
    const r = Math.min(SST.ny - 1, Math.max(0, Math.floor(ny * SST.ny)));
    return SST.values[r * SST.nx + c];
  }

  function onHover(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const lon = lonOf(nx), lat = latOf(ny);
    const v = sampleSST(nx, ny);
    const body = document.getElementById('readout-body');
    const moist = active.has('water_vapor');
    let html = `<span class="readout-hint">${fmtLat(lat)}, ${fmtLon(lon)}</span>`;
    if (v == null) {
      html += `<span class="readout-val">Land / cloud</span>` +
        `<span class="readout-hint">No clear-sky sea surface reading here.</span>`;
    } else {
      const hot = v >= 28.5;
      html += `<span class="readout-val">${v.toFixed(1)} °C</span>` +
        `<span class="readout-hint">${hot ? 'Warm enough to fuel a major hurricane.' : 'Sea surface temperature in the storm’s region.'}` +
        `${moist ? ' Moist air is wrapping in above it.' : ''}</span>`;
    }
    body.innerHTML = html;
  }

  function setReadout(layer) {
    document.getElementById('readout-body').innerHTML =
      `<span class="readout-hint" style="text-transform:uppercase;letter-spacing:.1em;color:${layer.accent}">${layer.name}</span>` +
      `<div style="margin-top:.4rem">${layer.desc}</div>`;
  }

  function setReadoutDefault() {
    document.getElementById('readout-body').innerHTML =
      'Hover the satellite scene to read the sea surface temperature, and toggle layers to stack the ingredients: <strong>warm water</strong>, <strong>storm</strong>, and <strong>moisture</strong>.';
  }

  let VW = 811, VH = 567;
  function buildAnnotations(stage) {
    const NS = 'http://www.w3.org/2000/svg';
    VW = (META.storm_image && META.storm_image.w) || 811;
    VH = (META.storm_image && META.storm_image.h) || 567;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'annot-svg');
    svg.setAttribute('class', 'annot-layer');
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);   // image pixel space => no glyph distortion
    svg.style.zIndex = '40';
    stage.appendChild(svg);

    const s = META.storm || {};
    const lf = s.landfall || { lon: -82.3, lat: 26.7, name: 'SW Florida' };
    const eye = { lon: lf.lon+.05, lat: lf.lat+.1 };
    const ex = nxOf(eye.lon) * VW, ey = nyOf(eye.lat) * VH;
    const lx = nxOf(lf.lon) * VW, ly = nyOf(lf.lat) * VH;

    // eye: ring + label to the LEFT (anchor end) to avoid the landfall label
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', ex); ring.setAttribute('cy', ey); ring.setAttribute('r', 24);
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#fff'); ring.setAttribute('stroke-width', 2.2);
    svg.appendChild(ring);
    textNode(svg, NS, ex - 22, ey + 5, 'Eye / eyewall', '#fff', 'end');

    // landfall: pin + label ABOVE-right
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', 6);
    dot.setAttribute('fill', '#1af64e'); dot.setAttribute('stroke', '#000'); dot.setAttribute('stroke-width', 1.2);
    svg.appendChild(dot);
    textNode(svg, NS, lx + 12, ly - 12, `Landfall · ${(lf.name || 'coast')}`, '#1af64e', 'start');

    // adaptive callouts (shown when their layer is active)
    const warm = textNode(svg, NS, 18, VH - 40, 'Warm Gulf water — the fuel', '#fff', 'start');
    warm.setAttribute('id', 'annot-warm'); warm.style.opacity = 0;
    const moist = textNode(svg, NS, 18, VH - 16, 'Moisture spiralling into the storm', '#e0f2fe', 'start');
    moist.setAttribute('id', 'annot-moist'); moist.style.opacity = 0;
  }

  function addAnnotationsToGrid() {
    const annot = document.getElementById('annot-svg');
    const grid = document.getElementById('stage-grid');
    if (!annot || !grid) return;
    // Clone the annotation SVG (without the adaptive warm/moist callouts) into each cell
    grid.querySelectorAll('.stage-cell').forEach(cell => {
      const clone = annot.cloneNode(true);
      clone.removeAttribute('id');
      // Hide the adaptive callouts in grid cells — they're layer-specific
      const warm = clone.querySelector('#annot-warm');
      const moist = clone.querySelector('#annot-moist');
      if (warm) warm.remove();
      if (moist) moist.remove();
      clone.style.zIndex = '5';
      cell.appendChild(clone);
    });
  }

  function textNode(svg, NS, x, y, text, color, anchor) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('fill', color); t.setAttribute('font-family', 'Inter, Arial');
    t.setAttribute('font-size', '15'); t.setAttribute('font-weight', '600');
    t.setAttribute('text-anchor', anchor || 'start');
    t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', 'rgba(0,0,0,0.6)');
    t.setAttribute('stroke-width', '3'); t.setAttribute('stroke-linejoin', 'round');
    t.textContent = text; svg.appendChild(t); return t;
  }

  const fmtLon = d => (d < 0 ? `${Math.abs(d).toFixed(1)}°W` : `${d.toFixed(1)}°E`);
  const fmtLat = d => `${d.toFixed(1)}°N`;

  function fallback(msg) {
    const fb = document.getElementById('explorer-fallback');
    if (fb) { fb.hidden = false; fb.innerHTML = `<strong>Explorer unavailable</strong><span>${msg}</span>`; }
    const panel = document.getElementById('explorer-panel');
    if (panel) panel.style.display = 'none';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();