/* ════════════════════════════════════════════════════════════════════
   Follow the Fuel — scroll-driven country CO2 emissions racing leaderboard
   Pivots the story from one storm to the global emissions system behind a
   warming ocean, then hands back to the SSP futures.

   Data: data/emissions_country_year.json (built offline by
   scripts/process_emissions.py). Falls back to an inlined seed if the
   JSON cannot load, so the section never goes blank.
   Wrapped in an IIFE so globals don't leak into the other visualizations.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const section = document.getElementById('follow-the-fuel');
  if (!section || typeof d3 === 'undefined') return;

  // ── shared scroll/motion helpers (mirrors main.js) ──
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const smooth = p => p * p * (3 - 2 * p);
  const lerp = (a, b, t) => a + (b - a) * t;
  const motionOK = () => !reduceMotion.matches && window.innerWidth > 880;

  const ROWS = 10;

  // ── E: inlined seed fallback (decade checkpoints; used only if JSON load fails) ──
  const SEED = {
    meta: { yearMin: 1850, yearMax: 2023, source: 'Curated seed', sourceTier: 'E-inline',
            metrics: ['annual', 'cumulative'] },
    countries: [
      mkSeed('USA', 'United States', [20, 660, 2300, 4700, 5800, 4900], [300, 15000, 90000, 200000, 320000, 430000], [0.87, 8.68, 15.13, 20.7, 20.57, 14.63]),
      mkSeed('CHN', 'China', [0, 10, 80, 1490, 3500, 11900], [50, 1000, 8000, 40000, 95000, 280000], [0, 0.03, 0.15, 1.52, 2.77, 8.44]),
      mkSeed('GBR', 'United Kingdom', [120, 420, 590, 610, 550, 320], [6000, 22000, 45000, 60000, 70000, 78000], [4.44, 11.05, 11.8, 10.89, 9.32, 4.71]),
      mkSeed('DEU', 'Germany', [25, 300, 480, 1090, 900, 600], [1000, 12000, 35000, 70000, 85000, 95000], [0.74, 5.36, 6.96, 13.97, 10.98, 7.14]),
      mkSeed('RUS', 'Russia', [0, 50, 480, 2000, 1500, 1800], [100, 3000, 25000, 70000, 100000, 120000], [0, 0.38, 2.67, 8, 10.27, 12.5]),
      mkSeed('IND', 'India', [1, 8, 80, 300, 900, 3000], [20, 400, 3000, 12000, 28000, 60000], [0, 0.03, 0.22, 0.43, 0.85, 2.1]),
      mkSeed('JPN', 'Japan', [0, 30, 110, 920, 1200, 1000], [10, 600, 5000, 25000, 45000, 65000], [0, 0.68, 1.31, 7.86, 9.45, 8.06]),
      mkSeed('FRA', 'France', [20, 130, 210, 480, 400, 280], [800, 6000, 16000, 30000, 38000, 42000], [0.56, 3.17, 5, 8.89, 6.56, 4.12]),
      mkSeed('QAT', 'Qatar', [0, 0, 1, 30, 55, 130], [0, 0, 50, 1000, 4000, 12000], [0, 0, 0.4, 13.04, 30.5, 35.1]),
    ],
  };
  function mkSeed(iso, name, annual, cumulative, perCap) {
    const yrs = [1850, 1900, 1950, 1980, 2000, 2023];
    const pair = arr => yrs.map((y, i) => [y, arr[i]]);
    return { iso, name, series: { annual: pair(annual), cumulative: pair(cumulative), per_capita: pair(perCap) } };
  }

  // ── state ──
  let DATA = null;
  const byIso = new Map();
  let METRICS = ['cumulative', 'annual'];
  let metric = 'cumulative';
  let pinned = null;
  let CHECKPOINTS = [1850, 1900, 1950, 1980, 2000, 2023];

  const disp = new Map();      // iso -> { rank, value, op } eased display state
  let dispMax = 1;             // eased x-scale maximum
  let curYear = 1850;

  // ── elements ──
  const boardSvg = d3.select('#fuel-board');
  const yearEl = document.getElementById('fuel-year');
  const annotEl = document.getElementById('fuel-annotation');
  const timelineEl = document.getElementById('fuel-timeline');
  const raceEl = document.getElementById('fuel-race');
  const stageEl = document.getElementById('fuel-stage');

  // ─────────────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────────────
  function indexData() {
    byIso.clear();
    DATA.countries.forEach(c => byIso.set(c.iso, c));
    METRICS = ((DATA.meta && DATA.meta.metrics) || METRICS)
      .filter(m => m === 'annual' || m === 'cumulative');
    if (!METRICS.includes(metric)) metric = METRICS[0];
    const ymin = DATA.meta.yearMin, ymax = DATA.meta.yearMax;
    CHECKPOINTS = [1850, 1900, 1950, 1980, 2000, ymax].filter(y => y >= ymin && y <= ymax);
    if (CHECKPOINTS[CHECKPOINTS.length - 1] !== ymax) CHECKPOINTS.push(ymax);
    curYear = CHECKPOINTS[0];
  }

  function valueAt(c, m, year) {
    const s = c.series[m];
    if (!s || !s.length) return 0;
    if (year <= s[0][0]) return year < s[0][0] ? 0 : s[0][1];
    if (year >= s[s.length - 1][0]) return s[s.length - 1][1];
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid][0] <= year) lo = mid; else hi = mid; }
    const [y0, v0] = s[lo], [y1, v1] = s[hi];
    return lerp(v0, v1, (year - y0) / (y1 - y0));
  }

  function getTopN(year, m, n) {
    const arr = [];
    for (const c of DATA.countries) {
      const v = valueAt(c, m, year);
      if (v > 0) arr.push({ iso: c.iso, name: c.name, value: v });
    }
    arr.sort((a, b) => b.value - a.value);
    const top = arr.slice(0, n);
    top.forEach((d, i) => { d.rank = i; });
    return top;
  }

  function fmtValue(v, m) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' Gt';
    return Math.round(v) + ' Mt';
  }

  // ─────────────────────────────────────────────────────────────────────
  // YEAR MAPPING (equal scroll per era between checkpoints)
  // ─────────────────────────────────────────────────────────────────────
  function yearFromProgress(p) {
    const n = CHECKPOINTS.length;
    if (n < 2) return CHECKPOINTS[0] || 1850;
    const seg = clamp01(p) * (n - 1);
    const i = Math.min(n - 2, Math.floor(seg));
    return lerp(CHECKPOINTS[i], CHECKPOINTS[i + 1], seg - i);
  }

  // ─────────────────────────────────────────────────────────────────────
  // BOARD RENDER (manual easing -> buttery rank swaps without transition thrash)
  // ─────────────────────────────────────────────────────────────────────
  function geom() {
    const node = boardSvg.node();
    const w = node ? node.clientWidth || node.parentNode.clientWidth : 720;
    const rowH = 34, padTop = 6;
    const labelW = Math.min(190, w * 0.32);
    const valueW = 78;
    const barMax = Math.max(40, w - labelW - valueW - 18);
    const height = padTop * 2 + ROWS * rowH;
    boardSvg.attr('viewBox', `0 0 ${w} ${height}`).attr('height', height);
    return { w, rowH, padTop, labelW, valueW, barMax, height };
  }

  function computeTargets(year) {
    const rows = getTopN(year, metric, ROWS);
    const target = new Map();
    rows.forEach(d => target.set(d.iso, { rank: d.rank, value: d.value, op: 1 }));
    if (pinned && !target.has(pinned)) {
      const c = byIso.get(pinned);
      const v = c ? valueAt(c, metric, year) : 0;
      if (v > 0) target.set(pinned, { rank: ROWS - 0.15, value: v, op: 0.55 });
    }
    return { target, topVal: rows.length ? rows[0].value : 1 };
  }

  function easeState(target, topVal, snap) {
    const k = snap ? 1 : 0.18;
    dispMax = snap ? topVal : lerp(dispMax, topVal, 0.18);
    if (dispMax <= 0) dispMax = topVal || 1;
    // ensure entries exist
    target.forEach((t, iso) => {
      if (!disp.has(iso)) disp.set(iso, { rank: t.rank, value: t.value, op: 0 });
    });
    const dead = [];
    disp.forEach((d, iso) => {
      const t = target.get(iso) || { rank: d.rank + 1.2, value: d.value, op: 0 };
      d.rank = lerp(d.rank, t.rank, k);
      d.value = lerp(d.value, t.value, k);
      d.op = lerp(d.op, t.op, snap ? 1 : 0.22);
      if (!target.has(iso) && d.op < 0.02) dead.push(iso);
    });
    dead.forEach(iso => disp.delete(iso));
  }

  function drawBoard(g) {
    const rows = [];
    disp.forEach((d, iso) => {
      const c = byIso.get(iso);
      rows.push({ iso, name: c ? c.name : iso, rank: d.rank, value: d.value, op: d.op });
    });
    rows.sort((a, b) => a.rank - b.rank);

    const sel = boardSvg.selectAll('g.fuel-row').data(rows, d => d.iso);
    sel.exit().remove();

    const enter = sel.enter().append('g').attr('class', 'fuel-row')
      .attr('tabindex', 0).attr('role', 'button')
      .on('click', (e, d) => togglePin(d.iso))
      .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(d.iso); } });
    enter.append('rect').attr('class', 'fuel-bar').attr('x', g.labelW + 8).attr('height', 22).attr('rx', 5);
    enter.append('text').attr('class', 'fuel-rank').attr('x', 4).attr('y', 16);
    enter.append('text').attr('class', 'fuel-name').attr('x', 30).attr('y', 16);
    enter.append('text').attr('class', 'fuel-val').attr('y', 16);

    const all = enter.merge(sel);
    all.attr('transform', d => `translate(0, ${g.padTop + d.rank * g.rowH})`)
      .style('opacity', d => d.op)
      .classed('is-pinned', d => d.iso === pinned);
    all.select('rect.fuel-bar')
      .attr('width', d => Math.max(2, (d.value / dispMax) * g.barMax));
    all.select('text.fuel-rank').text((d) => Math.round(d.rank + 1));
    all.select('text.fuel-name').text(d => d.name).attr('x', 30);
    all.select('text.fuel-val')
      .attr('x', d => g.labelW + 14 + Math.max(2, (d.value / dispMax) * g.barMax))
      .text(d => fmtValue(d.value, metric));
  }

  function buildTimeline() {
    if (!timelineEl) return;
    timelineEl.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'fuel-tl-track';
    const fill = document.createElement('div');
    fill.className = 'fuel-tl-fill';
    fill.id = 'fuel-tl-fill';
    track.appendChild(fill);
    CHECKPOINTS.forEach((y, i) => {
      const tick = document.createElement('span');
      tick.className = 'fuel-tl-tick';
      tick.style.left = (i / (CHECKPOINTS.length - 1) * 100) + '%';
      tick.textContent = y;
      track.appendChild(tick);
    });
    timelineEl.appendChild(track);
  }

  function renderFrame(progress, snap) {
    const year = motionOK() ? yearFromProgress(progress) : (DATA.meta.yearMax);
    curYear = year;
    const g = geom();
    const { target, topVal } = computeTargets(year);
    easeState(target, topVal, snap);
    drawBoard(g);
    if (yearEl) yearEl.textContent = Math.round(year);
    const fill = document.getElementById('fuel-tl-fill');
    if (fill) fill.style.width = (clamp01(progress) * 100) + '%';
    section.style.setProperty('--fuel-heat', smooth(clamp01(progress)).toFixed(3));
  }

  // ─────────────────────────────────────────────────────────────────────
  // METRIC TOGGLE (+ shock annotation)
  // ─────────────────────────────────────────────────────────────────────
  const ANNOT = {
    cumulative: 'Cumulative emissions: who has contributed most over all of history.',
    annual: 'Annual emissions: who is adding the most right now.',
  };
  function setMetric(next) {
    if (next === metric || !METRICS.includes(next)) return;
    const shock = (metric === 'annual' && next === 'cumulative') || (metric === 'cumulative' && next === 'annual');
    metric = next;
    section.querySelectorAll('.fuel-metric-btn').forEach(b => {
      const on = b.dataset.metric === metric;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (annotEl) {
      annotEl.textContent = shock
        ? 'Annual shows today\u2019s pressure. Cumulative shows the history already stored in the atmosphere.'
        : ANNOT[metric];
      annotEl.classList.remove('is-flash');
      void annotEl.offsetWidth;
      annotEl.classList.add('is-flash');
    }
    // snap=false so the bars dramatically reorder via easing (the "shock")
    renderFrame(currentProgress(), false);
  }

  // ─────────────────────────────────────────────────────────────────────
  // PIN A COUNTRY — hurricane-linked readout (share of all CO2 -> ocean heat)
  // ─────────────────────────────────────────────────────────────────────
  const pinPanel = document.getElementById('fuel-pin-panel');
  const pinName = document.getElementById('fuel-pin-name');
  const pinShare = document.getElementById('fuel-pin-share');
  const pinGauge = document.getElementById('fuel-pin-gauge');
  const pinCum = document.getElementById('fuel-pin-cum');
  const pinNote = document.getElementById('fuel-pin-note');
  const pinClear = document.getElementById('fuel-pin-clear');

  // Total CO2 emitted by humanity (Mt) — used to express a country's share honestly.
  // Prefer the world total baked into meta; otherwise sum the tracked countries.
  let WORLD_CUM = 0;
  function worldCumulative() {
    if (DATA.meta && DATA.meta.world && DATA.meta.world.cumulative > 0) return DATA.meta.world.cumulative;
    let s = 0;
    DATA.countries.forEach(c => { s += valueAt(c, 'cumulative', DATA.meta.yearMax); });
    return s;
  }

  function togglePin(iso) {
    pinned = (pinned === iso) ? null : iso;
    if (pinned && pinPanel) {
      pinPanel.hidden = false;
      renderPinPanel();
    } else if (pinPanel) {
      pinPanel.hidden = true;
    }
    renderFrame(currentProgress(), false);
  }

  function renderPinPanel() {
    const c = byIso.get(pinned);
    if (!c) return;
    if (!WORLD_CUM) WORLD_CUM = worldCumulative();
    const cum = valueAt(c, 'cumulative', DATA.meta.yearMax);   // Mt CO2
    const share = WORLD_CUM > 0 ? (cum / WORLD_CUM) * 100 : 0;

    if (pinName) pinName.textContent = c.name;
    if (pinShare) pinShare.textContent = (share >= 1 ? share.toFixed(1) : share.toFixed(2)) + '%';
    if (pinGauge) requestAnimationFrame(() => { pinGauge.style.width = Math.min(100, share).toFixed(2) + '%'; });
    if (pinCum) {
      const gt = cum / 1000;
      pinCum.textContent = (gt >= 100 ? Math.round(gt) : gt.toFixed(1)) +
        ' Gt of CO\u2082 released since 1850 — heat the ocean is still absorbing.';
    }
    if (pinNote) {
      pinNote.textContent = share >= 10
        ? 'An outsized share of the heat now stored in the ocean traces back here, and a warmer ocean is exactly what fuels stronger hurricanes.'
        : share >= 2
          ? 'That CO\u2082 traps heat the ocean soaks up, nudging the Atlantic warmth that hurricanes feed on.'
          : 'Even a smaller share adds heat the ocean keeps, and it is that stored ocean heat that gives hurricanes their energy.';
    }
  }

  if (pinClear) pinClear.addEventListener('click', () => togglePin(pinned));

  // ─────────────────────────────────────────────────────────────────────
  // SCENE 1 — scroll-driven warm wipe (own progress, always animates)
  // ─────────────────────────────────────────────────────────────────────
  function setupZoomout() {
    const zo = document.getElementById('fuel-zoomout');
    if (!zo || !motionOK()) return;   // section is display:none on mobile/reduced
    let zraf = 0;
    function zprog() {
      const r = zo.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      if (travel <= 0) return r.top <= 0 ? 1 : 0;
      return clamp01(-r.top / travel);
    }
    function paint() {
      zraf = 0;
      const p = zprog();
      zo.style.setProperty('--z', p.toFixed(3));
      // line fades in early, holds, then dissolves as the wash hands off
      let lo = 1;
      if (p < 0.22) lo = p / 0.22;
      else if (p > 0.62) lo = clamp01(1 - (p - 0.62) / 0.3);
      zo.style.setProperty('--zline', lo.toFixed(3));
    }
    function sched() { if (!zraf) zraf = requestAnimationFrame(paint); }
    window.addEventListener('scroll', sched, { passive: true });
    window.addEventListener('resize', sched);
    paint();
  }

  // ─────────────────────────────────────────────────────────────────────
  // SCROLL DRIVER (tall race; sticky stage) — RAF + getBoundingClientRect
  // ─────────────────────────────────────────────────────────────────────
  function currentProgress() {
    if (!raceEl) return 0;
    const rect = raceEl.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    if (travel <= 0) return rect.top <= 0 ? 1 : 0;
    return clamp01(-rect.top / travel);
  }

  let raf = 0, settleFrames = 0;
  function loop() {
    raf = 0;
    const rect = raceEl ? raceEl.getBoundingClientRect() : null;
    const near = rect && rect.bottom > -200 && rect.top < window.innerHeight + 200;
    if (DATA && (near || settleFrames > 0)) {
      const p = currentProgress();
      renderFrame(p, false);
      settleFrames = near ? 30 : settleFrames - 1;
      schedule();
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(loop); }
  function kick() { settleFrames = 30; schedule(); }

  // ─────────────────────────────────────────────────────────────────────
  // SENTENCE REVEALS (.fuel-reveal-block) — mirrors intro-story timing
  // ─────────────────────────────────────────────────────────────────────
  function setupReveals() {
    const blocks = section.querySelectorAll('.fuel-reveal-block');
    if (!('IntersectionObserver' in window) || !motionOK()) {
      section.querySelectorAll('.fuel-beat').forEach(b => b.classList.add('is-visible'));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        const beats = entry.target.querySelectorAll('.fuel-beat');
        beats.forEach((b, i) => setTimeout(() => b.classList.add('is-visible'), 250 + i * 1100));
      });
    }, { threshold: 0.4 });
    blocks.forEach(b => obs.observe(b));
  }

  // ─────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────
  function setupToggle() {
    section.querySelectorAll('.fuel-metric-btn').forEach(b => {
      b.addEventListener('click', () => setMetric(b.dataset.metric));
    });
  }

  async function loadData() {
    try {
      DATA = await d3.json('data/emissions_country_year.json');
      if (!DATA || !DATA.countries || !DATA.countries.length) throw new Error('empty dataset');
    } catch (e) {
      console.warn('[fuel] JSON load failed; using inline seed', e);
      DATA = SEED;
    }
    indexData();
  }

  loadData().then(() => {
    buildTimeline();
    setupToggle();
    setupReveals();
    setupZoomout();
    // initial paint (snap so first frame is settled)
    renderFrame(currentProgress(), true);
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', () => { buildTimeline(); kick(); });
    kick();
  }).catch(err => console.warn('[fuel] init failed', err));

})();
