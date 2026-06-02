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

  // layer registry — bottom→top z-order; only used if the artifact exists
  const LAYER_DEFS = [
    { id: 'storm_visible', key: 'storm_visible', name: 'Visible', dot: '#e5e7eb', z: 1, op: 1.0, defaultOn: true,
      desc: 'Visible light — sunlight reflected off the cloud tops. You can pick out the eye and the spiral rain bands.' },
    { id: 'storm_ir', key: 'storm_ir', name: 'Infrared', dot: '#fb923c', z: 2, op: 1.0, defaultOn: false,
      desc: 'Infrared — color shows cloud-top temperature. The coldest, highest tops (brightest) ring the eye, where the storm is most intense.' },
    { id: 'storm_sst_layer', key: 'storm_sst_layer', name: 'Sea surface temp', dot: '#ef4444', z: 3, op: 0.78, defaultOn: false,
      desc: 'Sea surface temperature — the warm Gulf water beneath the storm (≈29–31 °C) that supplied its energy. This is the fuel.' },
    { id: 'water_vapor', key: 'water_vapor', name: 'Water vapor', dot: '#38bdf8', z: 4, op: 0.82, defaultOn: false,
      desc: 'Water vapor — atmospheric moisture in the mid- and upper-atmosphere. Deeper blues trace the moist air spiralling into the storm. (Moisture, not measured rainfall.)' },
  ];

  let META = null, SST = null, BOX = null, active = new Set();

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

    layers.filter(l => l.defaultOn).forEach(l => active.add(l.id));
    syncLayers(layers);
    setReadoutDefault();
  }

  function buildStage(stage, layers, art) {
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

    // hover capture (top-most)
    const cap = document.createElement('div');
    cap.className = 'hover-capture';
    cap.style.zIndex = '50';
    stage.appendChild(cap);
    cap.addEventListener('mousemove', onHover);
    cap.addEventListener('mouseleave', setReadoutDefault);
  }

  function buildToggles(layers) {
    const host = document.getElementById('layer-toggles');
    host.innerHTML = '';
    layers.forEach(l => {
      const btn = document.createElement('button');
      btn.className = 'layer-btn';
      btn.dataset.layer = l.id;
      btn.innerHTML = `<span class="dot" style="background:${l.dot}"></span>` +
        `<span class="layer-name">${l.name}</span>` +
        `<span class="layer-state">Off</span>`;
      btn.addEventListener('click', () => {
        if (active.has(l.id)) active.delete(l.id); else active.add(l.id);
        syncLayers(layers);
        setReadout(l);
      });
      host.appendChild(btn);
    });
  }

  function syncLayers(layers) {
    const stage = document.getElementById('explorer-stage');
    layers.forEach(l => {
      const img = stage.querySelector(`img[data-layer="${l.id}"]`);
      if (img) img.style.opacity = active.has(l.id) ? img.dataset.op : '0';
      const btn = document.querySelector(`.layer-btn[data-layer="${l.id}"]`);
      if (btn) {
        btn.classList.toggle('active', active.has(l.id));
        btn.querySelector('.layer-state').textContent = active.has(l.id) ? 'On' : 'Off';
      }
    });
    // annotations adapt to what's visible
    const annot = document.getElementById('annot-svg');
    if (annot) {
      annot.querySelector('#annot-warm').style.opacity = active.has('storm_sst_layer') ? 1 : 0;
      annot.querySelector('#annot-moist').style.opacity = active.has('water_vapor') ? 1 : 0;
    }
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
      `<span class="readout-hint" style="text-transform:uppercase;letter-spacing:.1em;color:#7fd2f4">${layer.name}${active.has(layer.id) ? '' : ' · off'}</span>` +
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
    const eye = { lon: lf.lon - 0.9, lat: lf.lat - 0.4 };
    const ex = nxOf(eye.lon) * VW, ey = nyOf(eye.lat) * VH;
    const lx = nxOf(lf.lon) * VW, ly = nyOf(lf.lat) * VH;

    // eye: ring + label to the LEFT (anchor end) to avoid the landfall label
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', ex); ring.setAttribute('cy', ey); ring.setAttribute('r', 16);
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#fff'); ring.setAttribute('stroke-width', 2.2);
    svg.appendChild(ring);
    textNode(svg, NS, ex - 22, ey + 5, 'Eye / eyewall', '#fff', 'end');

    // landfall: pin + label ABOVE-right
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', 6);
    dot.setAttribute('fill', '#fde047'); dot.setAttribute('stroke', '#000'); dot.setAttribute('stroke-width', 1.2);
    svg.appendChild(dot);
    textNode(svg, NS, lx + 12, ly - 12, `Landfall · ${(lf.name || 'coast')}`, '#fde047', 'start');

    // adaptive callouts (shown when their layer is active)
    const warm = textNode(svg, NS, 18, VH - 40, 'Warm Gulf water — the fuel', '#fff', 'start');
    warm.setAttribute('id', 'annot-warm'); warm.style.opacity = 0;
    const moist = textNode(svg, NS, 18, VH - 16, 'Moisture spiralling into the storm', '#e0f2fe', 'start');
    moist.setAttribute('id', 'annot-moist'); moist.style.opacity = 0;
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
