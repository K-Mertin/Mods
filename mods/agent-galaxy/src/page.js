(() => {
  'use strict';

  const EXAMPLES = [
    { id: 'mine', project: 'auth-service', core: 'Fix the failing login test', rings: [
      { name: 'Plan',     items: ['reproduce the failure', 'read the stack trace', 'find the commit that changed it', 'patch token refresh', 'run the full suite'] },
      { name: 'Tools',    items: ['shell', 'file search', 'editor', 'test runner', 'git log', 'web search'] },
      { name: 'Memory',   items: ['repo uses pytest', 'tokens expire in 15 min', 'CI runs on every push', 'last auth fix was in March', 'staging has its own clock'] },
      { name: 'Thoughts', items: ['why only on CI?', 'clock skew?', 'is the mock stale?', 'check the timezone', 'compare with main', 'is it flaky?', 'ask before force-push', 'smaller diff first'] },
      { name: 'Context',  items: ['Run the tests before every commit', 'Never log a token', 'Keep diffs small', 'Never force-push to main', 'skill: test-runner', 'Tokens are refreshed by the gateway'] } ] },
    { id: 'ex-2', project: 'game', status: 'waiting', core: 'Add a boss fight to level 3', rings: [
      { name: 'Plan',     items: ['sketch the attack patterns', 'add a health bar', 'tune the hitboxes', 'playtest twice', 'record a clip'] },
      { name: 'Tools',    items: ['editor', 'sprite packer', 'shell', 'test runner'] },
      { name: 'Memory',   items: ['60 fps target', 'player has 3 lives', 'levels load from JSON', 'sound is still mono'] },
      { name: 'Thoughts', items: ['too hard?', 'telegraph the big hit', 'reuse the level 2 music?', 'phase two at half health', 'needs a checkpoint'] },
      { name: 'Context',  items: ['Hold 60 fps on a mid-range laptop', 'Levels are data, not code', 'Pixel art at 16 px per tile', 'skill: sprite-export', 'Level 2 boss was too easy'] } ] },
    { id: 'ex-3', project: 'docs-site', core: 'Rewrite the getting started guide', rings: [
      { name: 'Plan',     items: ['list what a newcomer needs', 'cut the install steps to five', 'add one working example', 'check every link'] },
      { name: 'Tools',    items: ['editor', 'link checker', 'web search', 'spell check'] },
      { name: 'Memory',   items: ['readers skip long intros', 'v2 renamed the config file', 'screenshots are from v1'] },
      { name: 'Thoughts', items: ['is this jargon?', 'show the output too', 'one idea per section', 'who is this for?'] },
      { name: 'Context',  items: ['Write for a first-time reader', 'Every example must run', 'Sentence case for headings', 'skill: docs', 'Say workspace, not project'] } ] }
  ];
  const PALETTE = ['#7fd4ff', '#5fe3c0', '#b9a2ff', '#ff8fb1', '#ffd27a', '#9bb8ff'];
  const TILTS = [[0.12, 0.06], [-0.48, 0.28], [0.62, -0.36], [-0.22, -0.62], [0.3, -0.14], [-0.75, 0.15]];
  const CORE_RGB = [255, 196, 107], ERR_RGB = [255, 92, 92];
  const STORE_KEY = 'agent-galaxy-content-v1';
  const F = 1100, TAU = Math.PI * 2;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Served by the local companion script: show real agents. Anywhere else: play the examples.
  const live = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  let W = 0, H = 0, DPR = 1, unit = 1;
  let yaw = 0.6, pitch = 0.42, zoom = 1;
  let speed = reduced ? 0.25 : 1, timeScale = 1, T = 0, clock = 0, last = performance.now();
  let stars = [];
  let cy = 1, sy = 0, cp = 1, sp = 0;

  // Every session is one galaxy. The drawing code below works on "the current galaxy":
  // use(g) loads its parts into these variables and save() writes them back.
  let galaxies = [], focus = null, view = 'single', follow = true;
  let G = null, core = '', rings = [], words = [], pulses = [], waves = [], coreKick = 0;
  let camT = [0, 0, 0], camD = F;
  let hover = null, hoverG = null, selected = null, idleShown = false, connected = false;
  const hiddenRings = new Set();

  function use(g) { G = g; core = g.core; rings = g.rings; words = g.words; pulses = g.pulses; waves = g.waves; coreKick = g.coreKick; }
  function save() { G.core = core; G.rings = rings; G.words = words; G.pulses = pulses; G.waves = waves; G.coreKick = coreKick; }

  function slotPos(slot) {
    if (!slot) return [0, 0, 0];
    const a = slot * 2.39996, r = 1900 * Math.sqrt(slot);
    return [Math.cos(a) * r, ((slot * 7) % 5 - 2) * 260, Math.sin(a) * r];
  }
  function addGalaxy(id) {
    const used = new Set(galaxies.map(g => g.slot)); let slot = 0; while (used.has(slot)) slot++;
    const tx = slot ? (((slot * 37) % 11) / 11 - 0.5) * 0.9 : 0, tz = slot ? (((slot * 53) % 13) / 13 - 0.5) * 0.8 : 0;
    const g = { id, slot, pos: slotPos(slot), ocx: Math.cos(tx), osx: Math.sin(tx), ocz: Math.cos(tz), osz: Math.sin(tz), rot: slot * 1.7,
      project: '', status: 'working', state: 'working', look: null, core: '', rings: [], words: [], pulses: [], waves: [], coreKick: 0, lastEvent: -99, demoTimer: 0.8 + slot * 0.7, mtime: 0,
      c: { x: 0, y: 0, s: 1 }, cz: 0, depth: F, lod: 1, detail: true, visible: true, hit: null };
    galaxies.push(g); return g;
  }

  /* ---------- content ---------- */
  function loadContent() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const c = JSON.parse(raw); if (c && c.core && Array.isArray(c.rings) && c.rings.length) return c; }
    } catch (e) {}
    return { core: EXAMPLES[0].core, rings: JSON.parse(JSON.stringify(EXAMPLES[0].rings)) };
  }
  function saveContent() { try { localStorage.setItem(STORE_KEY, JSON.stringify(content)); } catch (e) {} }
  const toState = (c, project) => ({ project, status: c.status, core: c.core, rings: c.rings.map(r => ({ name: r.name, items: r.items.map(t => ({ key: t, text: t })) })) });
  let content = null;

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

  // works on the current galaxy
  function syncRings(names) {
    if (names.length === rings.length && names.every((n, i) => rings[i].name === n)) return;
    const n = names.length, step = n > 1 ? Math.min(85, 260 / (n - 1)) : 0;
    rings = names.map((name, i) => {
      const [tx, tz] = TILTS[i % TILTS.length], color = PALETTE[i % PALETTE.length];
      return { name, color, rgb: hexRgb(color), radius: 150 + i * step, speed: 0.26 / (1 + i * 0.4),
        ctx: Math.cos(tx), stx: Math.sin(tx), ctz: Math.cos(tz), stz: Math.sin(tz),
        visible: !hiddenRings.has(name), heat: 0, sprite: glowSprite(hexRgb(color), 64, true), beacon: i * 1.9 + 0.6,
        rocks: Array.from({ length: 80 }, () => ({ a: Math.random() * TAU, k: 1 + (Math.random() + Math.random() - 1) * 0.075, w: 0.45 + Math.random() * 0.4, sz: 1 + Math.random() * 1.7, al: 0.3 + Math.random() * 0.7 })) };
    });
    if (selected && selected.g === G) { selected = null; showDetail(); }
    if (hover && hover.g === G) hover = null;
    words = []; pulses = []; waves = [];
  }

  // Bring one galaxy in line with a state: new items fly out of the core, missing ones drift away.
  function applyState(g, s, stagger) {
    use(g);
    core = s.core || '';
    if (s.project) g.project = s.project;
    if (s.mtime) g.mtime = s.mtime;
    if (s.status) g.status = s.status;
    syncRings(s.rings.map(r => r.name));
    const seen = new Set();
    s.rings.forEach((r, i) => {
      const n = r.items.length;
      r.items.forEach((it, j) => {
        const key = String(it.key != null ? it.key : it.text);
        const target = (j / Math.max(n, 1)) * TAU + i * 0.9;
        let w = words.find(x => x.ring === i && x.key === key && !x.dying);
        if (!w) {
          w = { g, key, ring: i, a0: target, ang: target, k: 0, glow: 0, birth: clock + (stagger ? 0.1 + i * 0.12 + j * 0.05 : 0), dying: 0, box: null, p: null, life: 0, flash: 0, h: [...key].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 9973, 7) };
          words.push(w);
        }
        w.text = it.text; w.detail = it.detail || it.text; w.target = target; seen.add(w);
        w.n = it.n != null ? Math.max(1, it.n) : 1 + w.h % 4;   // how often it was used: bigger planet, more moons
        w.idle = !!it.idle; w.error = !!it.error;   // error: this step failed or was declined   // context the agent has but has not opened yet
      });
    });
    for (const w of words) {
      if (seen.has(w) || w.dying) continue;
      w.dying = clock || 0.001; w.box = null;
      if (selected === w) selected = null;
      if (hover === w) hover = null;
    }
    pulses = pulses.filter(p => !p.word.dying);
    save();
    if (g === focus) { renderLegend(); showDetail(); updateButtons(); }
    menuDirty = true;
  }

  function firePulse(g, ringName, key, error) {
    use(g);
    const i = rings.findIndex(r => r.name === ringName);
    const w = words.find(x => x.ring === i && x.key === String(key) && !x.dying);
    if (w && rings[i].visible) {
      if (pulses.length > 12) pulses.shift();
      pulses.push({ word: w, t: 0, error: !!error }); coreKick = 1;
    }
    save();
    if (!w) return;
    g.lastEvent = clock;
    // follow the action: jump to a session that starts working while the one on screen is quiet
    if (follow && view === 'single' && focus && g !== focus && clock - focus.lastEvent > 12) setFocus(g, false);
    setStatus(g, w);
  }

  /* ---------- sprites ---------- */
  function glowSprite(rgb, size, hard) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), h = size / 2, gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, rgba(rgb, 1)); gr.addColorStop(hard ? 0.16 : 0.4, rgba(rgb, hard ? 0.42 : 0.28)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return c;
  }
  function raySprite(c1 = CORE_RGB, c2 = [255, 120, 70]) {
    const size = 512, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), h = size / 2;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 130; i++) {
      const a = Math.random() * TAU, len = h * (0.3 + Math.pow(Math.random(), 2) * 0.7), al = 0.08 + Math.random() * 0.3;
      const gr = g.createLinearGradient(h, h, h + Math.cos(a) * len, h + Math.sin(a) * len);
      gr.addColorStop(0, rgba(c1, al)); gr.addColorStop(1, rgba(c2, 0));
      g.strokeStyle = gr; g.lineWidth = 0.6 + Math.random() * 1.8;
      g.beginPath(); g.moveTo(h, h); g.lineTo(h + Math.cos(a) * len, h + Math.sin(a) * len); g.stroke();
    }
    return c;
  }
  const SPR = { white: glowSprite([255, 255, 255], 64, true), warm: glowSprite([255, 190, 120], 128, true), halo: glowSprite([255, 160, 90], 256, false),
    blue: glowSprite([150, 200, 255], 64, true), pink: glowSprite([255, 130, 190], 64, true), err: glowSprite(ERR_RGB, 64, true) };
  const NEB = [[70, 130, 255], [140, 100, 255], [255, 100, 170], [60, 210, 200], [255, 160, 90]].map(c => glowSprite(c, 256, false));
  const RAYS = raySprite();
  // The core shows the session's state: working (amber), your turn (blue) or quiet (dim).
  const LOOKS = {
    working: { rgb: CORE_RGB, text: '#fff4dc', dark: ['rgba(34,18,6,0.94)', 'rgba(24,12,8,0.82)', 'rgba(24,12,8,0)'], label: 'CORE', gain: 1, halo: SPR.halo, warm: SPR.warm, rays: RAYS },
    waiting: { rgb: [120, 225, 255], text: '#eafaff', dark: ['rgba(5,20,36,0.94)', 'rgba(5,14,28,0.84)', 'rgba(5,14,28,0)'], label: 'YOUR TURN', gain: 1,
      halo: glowSprite([70, 160, 255], 256, false), warm: glowSprite([140, 220, 255], 128, true), rays: raySprite([120, 225, 255], [60, 120, 255]) },
    quiet: { rgb: [196, 176, 150], text: '#efe6d8', dark: ['rgba(26,20,14,0.94)', 'rgba(18,14,10,0.84)', 'rgba(18,14,10,0)'], label: 'QUIET', gain: 0.5,
      halo: glowSprite([170, 140, 110], 256, false), warm: glowSprite([200, 180, 150], 128, true), rays: raySprite([196, 176, 150], [150, 120, 100]) }
  };
  function stateOf(g) {
    if (!live) return g.status || 'working';
    const idle = Date.now() - (g.mtime || Date.now());
    if (g.status === 'waiting') return idle > 2500 ? 'waiting' : 'working';   // a reply is often followed at once by a tool call
    return idle > 60000 ? 'quiet' : 'working';
  }

  let far = [], bulge = [], nebula = [], accr = [], shots = [], shotTimer = 3;

  function buildStars() {
    stars = []; far = []; nebula = []; accr = [];
    const R = 540, N = 2600;
    for (let i = 0; i < N; i++) {
      const r = 45 + Math.pow(Math.random(), 0.75) * R;
      const arm = (i % 3) * (TAU / 3);
      const a = arm + r * 0.0115 + (Math.random() - 0.5) * (0.95 - 0.55 * r / R) * 1.5;
      const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const warm = Math.max(0, 1 - r / 240), pink = Math.random() < 0.05, bright = Math.random() < 0.035;
      stars.push({
        r, a, y: g * (36 * (1 - r / (R + 60)) + 5), w: 0.9 / Math.sqrt(r / 60),
        size: Math.random() < 0.08 ? 1.8 : 1.05,
        col: pink ? [255, 140, 200] : [Math.round(140 + 115 * warm), Math.round(185 + 20 * warm), Math.round(255 - 135 * warm)],
        alpha: 0.25 + Math.random() * 0.6,
        spr: bright ? (pink ? SPR.pink : warm > 0.3 ? SPR.warm : Math.random() < 0.5 ? SPR.blue : SPR.white) : null,
        ph: Math.random() * TAU, f: 1 + Math.random() * 2.5
      });
    }
    // warm central bulge
    for (let i = 0; i < 420; i++) {
      const r = 20 + Math.abs((Math.random() + Math.random() + Math.random() - 1.5)) * 105;
      stars.push({ r, a: Math.random() * TAU, y: (Math.random() - 0.5) * 2 * Math.max(6, 62 - r * 0.45), w: 1.5 / Math.sqrt(r / 40),
        size: 1.05, col: [255, 205 + Math.round(Math.random() * 30), 150], alpha: 0.2 + Math.random() * 0.45, spr: null, ph: 0, f: 1 });
    }
    // fast hot particles hugging the core
    for (let i = 0; i < 70; i++) accr.push({ r: 112 + Math.random() * 30, a: Math.random() * TAU, y: (Math.random() - 0.5) * 5, w: 1.2 + Math.random() * 0.8, sz: 4 + Math.random() * 5 });
    // gas clouds along the arms
    for (let i = 0; i < 14; i++) {
      const r = 150 + Math.random() * 360;
      nebula.push({ r, a: (i % 3) * (TAU / 3) + r * 0.0115 + (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 30, w: 0.9 / Math.sqrt(r / 60),
        size: 200 + Math.random() * 240, i, alpha: 0.1 + Math.random() * 0.08 });
    }
    // distant sky
    for (let i = 0; i < 950; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * TAU, q = Math.sqrt(1 - u * u), tint = Math.random();
      far.push({ x: q * Math.cos(t) * 1000, y: u * 1000, z: q * Math.sin(t) * 1000, big: Math.random() < 0.04,
        sz: Math.random() < 0.2 ? 1.6 : 1, a: 0.25 + Math.random() * 0.6, ph: Math.random() * TAU, f: 0.6 + Math.random() * 2.4,
        col: tint < 0.15 ? [255, 210, 170] : tint < 0.4 ? [170, 200, 255] : [230, 238, 255] });
    }
  }

  /* ---------- 3D ---------- */
  function proj(x, y, z) {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const s = F / Math.max(60, z2 + camD) * unit;
    return { x: W / 2 + x1 * s, y: H / 2 + y2 * s, z: z2, s };
  }
  // a point in the current galaxy; z comes back relative to that galaxy's centre (negative = nearer than the core)
  function cam(x, y, z) {
    const y1 = y * G.ocx - z * G.osx, z1 = y * G.osx + z * G.ocx;
    const p = proj(x * G.ocz - y1 * G.osz + G.pos[0] - camT[0], x * G.osz + y1 * G.ocz + G.pos[1] - camT[1], z1 + G.pos[2] - camT[2]);
    p.z -= G.cz; return p;
  }
  function ringPoint(r, a, k) {
    const x = Math.cos(a) * r.radius * k, z = Math.sin(a) * r.radius * k;
    const y1 = -z * r.stx, z1 = z * r.ctx;
    return cam(x * r.ctz - y1 * r.stz, x * r.stz + y1 * r.ctz, z1);
  }
  const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);

  /* ---------- drawing ---------- */
  function drawBackdrop(dt) {
    ctx.globalCompositeOperation = 'lighter';
    const k = Math.max(W, H) / 1000 * 0.78 * (0.75 + 0.25 * zoom);
    for (const s of far) {
      const x1 = s.x * cy + s.z * sy, z1 = -s.x * sy + s.z * cy;
      const z2 = s.y * sp + z1 * cp;
      if (z2 < 0) continue;
      const X = W / 2 + x1 * k, Y = H / 2 + (s.y * cp - z1 * sp) * k;
      if (X < -6 || X > W + 6 || Y < -6 || Y > H + 6) continue;
      const tw = 0.62 + 0.38 * Math.sin(clock * s.f + s.ph);
      if (s.big) { const d = 5 + 9 * tw; ctx.globalAlpha = 0.85 * tw; ctx.drawImage(SPR.white, X - d / 2, Y - d / 2, d, d); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = rgba(s.col, s.a * tw); ctx.fillRect(X, Y, s.sz, s.sz); }
    }
    // the occasional shooting star
    if (!reduced) {
      shotTimer -= dt;
      if (shotTimer <= 0) {
        const a = Math.PI * (0.1 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? 0 : Math.PI);
        shots.push({ x: Math.random() * W, y: Math.random() * H * 0.6, vx: Math.cos(a) * 900, vy: Math.abs(Math.sin(a)) * 900, t: 0 });
        shotTimer = 3.5 + Math.random() * 6;
      }
    }
    for (const s of shots) {
      s.t += dt / 0.75; s.x += s.vx * dt; s.y += s.vy * dt;
      const al = Math.sin(Math.min(1, s.t) * Math.PI), tx = s.x - s.vx * 0.13, ty = s.y - s.vy * 0.13;
      const g = ctx.createLinearGradient(tx, ty, s.x, s.y);
      g.addColorStop(0, 'rgba(180,210,255,0)'); g.addColorStop(1, `rgba(235,244,255,${0.9 * al})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    shots = shots.filter(s => s.t < 1);
    ctx.globalCompositeOperation = 'source-over';
  }

  // faint polar grid in the galactic plane, like a navigation chart
  function drawGrid() {
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,170,255,0.075)';
    for (const R0 of [135, 270, 405, 540]) {
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) { const a = i / 72 * TAU, p = cam(Math.cos(a) * R0, 0, Math.sin(a) * R0); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,170,255,0.05)'; ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + T * 0.02, p1 = cam(Math.cos(a) * 135, 0, Math.sin(a) * 135), p2 = cam(Math.cos(a) * 560, 0, Math.sin(a) * 560);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  }

  function drawNebula(front) {
    ctx.globalCompositeOperation = 'lighter';
    for (const n of nebula) {
      const a = n.a + G.rot + T * n.w * 0.18, p = cam(Math.cos(a) * n.r, n.y, Math.sin(a) * n.r);
      if ((p.z < 0) !== front) continue;
      const d = n.size * p.s;
      ctx.globalAlpha = n.alpha * (front ? 0.8 : 1);
      ctx.drawImage(NEB[(n.i + G.slot) % NEB.length], p.x - d / 2, p.y - d * 0.3, d, d * 0.6);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawStars(front) {
    ctx.globalCompositeOperation = 'lighter';
    const stride = G.detail ? 1 : G.lod > 0.3 ? 2 : 3, boost = G.detail ? 1 : 1.6;
    for (let i = 0; i < stars.length; i += stride) {
      const s = stars[i], a = s.a + G.rot + T * s.w * 0.18;
      const p = cam(Math.cos(a) * s.r, s.y, Math.sin(a) * s.r);
      if ((p.z < 0) !== front) continue;
      const depth = Math.max(0.25, Math.min(1, 1 - p.z / 900)) * boost;
      if (s.spr) {
        const tw = 0.6 + 0.4 * Math.sin(clock * s.f + s.ph), d = (5 + 6 * tw) * p.s;
        ctx.globalAlpha = Math.min(1, depth * (0.55 + 0.45 * tw)); ctx.drawImage(s.spr, p.x - d / 2, p.y - d / 2, d, d); ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = rgba(s.col, s.alpha * depth);
        const d = Math.max(0.9, s.size * p.s * 1.25);
        ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    if (G.detail) for (const s of accr) {
      const a = s.a + T * s.w;
      for (let j = 0; j < 4; j++) {
        const p = cam(Math.cos(a - j * 0.05) * s.r, s.y, Math.sin(a - j * 0.05) * s.r);
        if ((p.z < 0) !== front) continue;
        const d = s.sz * p.s * (1 - j * 0.18);
        ctx.globalAlpha = 0.7 * (1 - j / 4); ctx.drawImage(SPR.warm, p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawRings(front) {
    const SEG = G.detail ? 120 : 48;
    for (const r of rings) {
      if (!r.visible) continue;
      ctx.beginPath();
      let prev = ringPoint(r, 0, 1);
      for (let i = 1; i <= SEG; i++) {
        const p = ringPoint(r, i / SEG * TAU, 1);
        if (((prev.z + p.z) / 2 < 0) === front) { ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); }
        prev = p;
      }
      const hot = 0.5 + 0.5 * Math.min(1, r.heat || 0);
      if (front && G.detail) { ctx.strokeStyle = rgba(r.rgb, 0.07 + 0.1 * (r.heat || 0)); ctx.lineWidth = 6; ctx.stroke(); }
      ctx.strokeStyle = rgba(r.rgb, (front ? 0.55 : 0.17) * (0.8 + 0.4 * hot));
      ctx.lineWidth = front ? 1.2 : 1;
      ctx.stroke();
      if (!G.detail) continue;
      // energy packets running against the orbit, each with a fading tail
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const a = -T * r.speed * 2.4 + k * Math.PI;
        for (let j = 0; j < 18; j++) {
          const p = ringPoint(r, a + j * 0.022, 1);
          if ((p.z < 0) !== front) continue;
          const f = 1 - j / 18;
          if (j === 0) { const d = 14 * p.s; ctx.globalAlpha = front ? 1 : 0.4; ctx.drawImage(r.sprite, p.x - d / 2, p.y - d / 2, d, d); ctx.globalAlpha = 1; }
          else { ctx.fillStyle = rgba(r.rgb, (front ? 0.8 : 0.25) * f * f); const d = 2.4 * p.s * (0.4 + 0.6 * f); ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d); }
        }
      }
      // asteroid belt drifting along the orbit
      for (const k of r.rocks) {
        const p = ringPoint(r, k.a + T * r.speed * k.w, k.k);
        if ((p.z < 0) !== front) continue;
        ctx.fillStyle = rgba(r.rgb, (front ? 0.6 : 0.2) * k.al);
        const d = Math.max(0.8, k.sz * p.s); ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      }
      ctx.globalCompositeOperation = 'source-over';
      // graduation ticks, like an instrument dial
      ctx.strokeStyle = rgba(r.rgb, front ? 0.45 : 0.14); ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 36; i++) {
        const a = i / 36 * TAU + T * r.speed * 0.3, p1 = ringPoint(r, a, 1);
        if ((p1.z < 0) !== front) continue;
        const p2 = ringPoint(r, a, i % 3 === 0 ? 1.04 : 1.02);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
      // a beacon that carries the ring's name around the orbit
      const bp = ringPoint(r, T * r.speed * 0.55 + r.beacon, 1);
      if ((bp.z < 0) === front) {
        const al = front ? 0.95 : 0.35, d = 5 * bp.s;
        ctx.save(); ctx.translate(bp.x, bp.y); ctx.rotate(clock * 0.8);
        ctx.strokeStyle = rgba(r.rgb, al); ctx.lineWidth = 1.2; ctx.strokeRect(-d, -d, 2 * d, 2 * d);
        ctx.rotate(Math.PI / 4); ctx.fillStyle = rgba(r.rgb, al * 0.8); ctx.fillRect(-d * 0.45, -d * 0.45, d * 0.9, d * 0.9); ctx.restore();
        ctx.font = `500 ${Math.max(8, 10 * Math.pow(bp.s, 0.6))}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = rgba(r.rgb, al);
        ctx.fillText(r.name.toUpperCase(), bp.x, bp.y - d - 10 * bp.s);
      }
    }
  }

  function drawWord(w) {
    const r = rings[w.ring], p = w.p;
    const bad = w.error || w.flash > 0.05, rgb = bad ? ERR_RGB : r.rgb, spr = bad ? SPR.err : r.sprite, col = bad ? '#ff5c5c' : r.color;
    const isHot = w === hover || w === selected;
    const depth = Math.max(0.28, Math.min(1, 0.72 - p.z / 620));
    const alpha = Math.min(1, depth + w.glow * 0.5 + (isHot ? 0.6 : 0)) * w.life * (w.idle && !isHot && w.glow < 0.05 ? 0.55 : 1);
    if (alpha <= 0.01) { w.box = null; return; }
    if (!G.detail) {   // far away: just a point of light
      const d = Math.max(3.5, (16 + w.glow * 40) * p.s);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
      ctx.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; w.box = null; return;
    }
    const size = Math.max(9, (isHot ? 17 : 14.5) * Math.pow(p.s, 0.6));

    if (isHot || w.glow > 0.02) {
      const c = cam(0, 0, 0);
      const g = ctx.createLinearGradient(c.x, c.y, p.x, p.y);
      g.addColorStop(0, rgba(CORE_RGB, 0.0));
      g.addColorStop(0.25, rgba(CORE_RGB, isHot ? 0.5 : 0.35 * w.glow));
      g.addColorStop(1, rgba(rgb, isHot ? 0.8 : 0.6 * w.glow));
      ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }

    // comet tail along the orbit
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 1; j <= 12; j++) {
      const q = ringPoint(r, w.ang - j * 0.028, w.k), f = 1 - j / 13;
      ctx.fillStyle = rgba(rgb, alpha * 0.55 * f * f);
      const d = 3.2 * q.s * f; ctx.fillRect(q.x - d / 2, q.y - d / 2, d, d);
    }
    // each item is a small planet lit by the core; it grows and gains moons the more it is used
    const nr = (3.4 + Math.min(5, (w.n - 1) * 0.85) + w.glow * 2 + (isHot ? 1.5 : 0)) * p.s;
    const gd = nr * 2 + (20 + w.glow * 46 + (isHot ? 22 : 0)) * p.s;
    ctx.globalAlpha = alpha * 0.9; ctx.drawImage(spr, p.x - gd / 2, p.y - gd / 2, gd, gd); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    let lx = G.c.x - p.x, ly = G.c.y - p.y; const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    const pg = ctx.createRadialGradient(p.x + lx * nr * 0.5, p.y + ly * nr * 0.5, nr * 0.08, p.x, p.y, nr);
    pg.addColorStop(0, 'rgba(255,255,255,1)'); pg.addColorStop(0.45, rgba(rgb, 1));
    pg.addColorStop(1, rgba([rgb[0] * 0.22 | 0, rgb[1] * 0.22 | 0, rgb[2] * 0.28 | 0], 1));
    ctx.globalAlpha = alpha; ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(p.x, p.y, nr, 0, TAU); ctx.fill();
    if (w.n >= 4) {   // heavily used: a ringed planet
      ctx.strokeStyle = rgba(rgb, 0.85); ctx.lineWidth = Math.max(1, 1.3 * p.s);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, nr * 2, nr * 0.55, -0.45, 0.25, Math.PI - 0.25); ctx.stroke();
    }
    const moons = Math.min(3, w.n - 1);
    for (let m = 0; m < moons; m++) {
      const ma = clock * (1.5 - m * 0.35) + m * 2.1 + w.h, mr = nr + (6 + m * 4.5) * p.s;
      ctx.fillStyle = m === 0 ? 'rgba(235,242,255,0.95)' : rgba(rgb, 0.9);
      ctx.beginPath(); ctx.arc(p.x + Math.cos(ma) * mr, p.y + Math.sin(ma) * mr * 0.42, Math.max(1, 1.5 * p.s), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (isHot || w.glow > 0.05) {
      ctx.strokeStyle = rgba(rgb, alpha * 0.8); ctx.lineWidth = 1;
      const spin = clock * 1.4 + w.ring, rr = nr + (moons ? 8 + moons * 4.5 : 5) * p.s;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, spin, spin + 2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, spin + Math.PI, spin + Math.PI + 2.2); ctx.stroke();
    }

    ctx.font = `${isHot ? 600 : 500} ${size}px "Chakra Petch", "Trebuchet MS", sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const tx = p.x + nr + (10 + Math.min(3, w.n - 1) * 4.5) * p.s, tw = ctx.measureText(w.text).width;
    if (isHot || w.glow > 0.3) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
    ctx.fillStyle = isHot || w.glow > 0.3 ? rgba([255, 255, 255], alpha) : rgba([219, 233, 255], alpha * 0.92);
    if (bad) ctx.fillStyle = rgba([255, 178, 178], alpha);
    ctx.fillText(w.text, tx, p.y);
    ctx.shadowBlur = 0;
    if (isHot) {
      ctx.strokeStyle = rgba(rgb, 0.8); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tx, p.y + size * 0.72); ctx.lineTo(tx + tw, p.y + size * 0.72); ctx.stroke();
    }
    w.box = w.life > 0.6 && !w.dying ? [p.x - nr - 6, p.y - size * 0.8, tx + tw + 4, p.y + size * 0.8] : null;
  }

  function wrap(text, maxW, maxLines) {
    const out = []; let line = '';
    for (const word of text.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/.{0,2}$/, '…'); }
    return out;
  }

  function drawCore() {
    const c = cam(0, 0, 0), s = c.s, K = G.look || LOOKS.working;
    const beat = 1 + Math.sin(clock * 1.7) * 0.045 + coreKick * 0.09;
    const R = 96 * s * beat;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.55 + coreKick * 0.25) * K.gain; ctx.drawImage(K.halo, c.x - R * 3.4, c.y - R * 3.4, R * 6.8, R * 6.8);
    // slow counter-rotating light rays
    for (const [w, k, al] of [[0.05, 3.3, 0.6], [-0.033, 2.5, 0.5]]) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(clock * w); ctx.globalAlpha = (al + coreKick * 0.3) * K.gain;
      ctx.drawImage(K.rays, -R * k, -R * k, R * 2 * k, R * 2 * k); ctx.restore();
    }
    // anamorphic lens streak
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, 0.03); ctx.globalAlpha = 0.75 + coreKick * 0.25;
    ctx.drawImage(K.warm, -R * 5.5, -R * 5.5, R * 11, R * 11); ctx.restore();
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(0.022, 1); ctx.globalAlpha = 0.3;
    ctx.drawImage(K.warm, -R * 2.6, -R * 2.6, R * 5.2, R * 5.2); ctx.restore();
    if (!G.detail) { ctx.globalAlpha = 0.9; ctx.drawImage(K.warm, c.x - R * 0.9, c.y - R * 0.9, R * 1.8, R * 1.8); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!G.detail) return;

    let g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
    g.addColorStop(0, K.dark[0]); g.addColorStop(0.78, K.dark[1]); g.addColorStop(1, K.dark[2]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(K.rgb, 0.5); ctx.lineWidth = 1.5 * s; ctx.shadowColor = rgba(K.rgb, 1); ctx.shadowBlur = 18 * s;
    ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.8, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0;

    const arcs = [[0.86, 0.5, 1.9, 2.4], [0.94, -0.33, 0.8, 1.2], [1.04, 0.2, 2.6, 1], [1.04, 0.2, 0.5, 1], [0.72, -0.8, 0.5, 1.4], [0.72, -0.8, 0.9, 1.4]];
    arcs.forEach(([k, w, len, lw], i) => {
      const a = clock * w + i * 2.1;
      ctx.strokeStyle = rgba(K.rgb, i === 0 ? 0.95 : 0.55); ctx.lineWidth = lw * s;
      ctx.beginPath(); ctx.arc(c.x, c.y, R * k, a, a + len); ctx.stroke();
    });
    ctx.save(); ctx.setLineDash([2 * s, 7 * s]); ctx.strokeStyle = rgba(K.rgb, 0.4); ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.arc(c.x, c.y, R * 1.32, -clock * 0.12, -clock * 0.12 + TAU); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = rgba(K.rgb, 0.5); ctx.lineWidth = 1;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU - clock * 0.08, r1 = R * 1.12, r2 = R * (i % 4 === 0 ? 1.2 : 1.155);
      ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1); ctx.lineTo(c.x + Math.cos(a) * r2, c.y + Math.sin(a) * r2); ctx.stroke();
    }

    const long = core.length > 48;
    const fs = Math.max(10, (long ? 13 : 17) * s);
    ctx.font = `600 ${fs}px "Chakra Petch", "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = wrap(core, R * 1.4, long ? 5 : 4);
    ctx.shadowColor = rgba(K.rgb, 0.9); ctx.shadowBlur = 14 * s;
    ctx.fillStyle = K.text;
    lines.forEach((ln, i) => ctx.fillText(ln, c.x, c.y + (i - (lines.length - 1) / 2) * fs * 1.25 + 4 * s));
    ctx.shadowBlur = 0;
    ctx.font = `500 ${Math.max(8, 9.5 * s)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillStyle = rgba(K.rgb, 0.75);
    ctx.fillText(K.label, c.x, c.y - R * 0.6);
  }

  function drawPulses() {
    const c = cam(0, 0, 0), q = Math.max(0.4, Math.min(1, G.lod));
    ctx.globalCompositeOperation = 'lighter';
    for (const pl of pulses) {
      const p = pl.word.p; if (!p) continue;
      const r = rings[pl.word.ring], t = ease(pl.t), rgb = pl.error ? ERR_RGB : r.rgb, spr = pl.error ? SPR.err : r.sprite;
      const x = c.x + (p.x - c.x) * t, y = c.y + (p.y - c.y) * t;
      const t0 = Math.max(0, t - 0.35), x0 = c.x + (p.x - c.x) * t0, y0 = c.y + (p.y - c.y) * t0;
      const g = ctx.createLinearGradient(x0, y0, x, y);
      g.addColorStop(0, rgba(rgb, 0)); g.addColorStop(1, rgba(rgb, 0.9));
      ctx.strokeStyle = g; ctx.lineWidth = 5 * q; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      ctx.lineWidth = 1.6; ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      ctx.drawImage(spr, x - 16 * q, y - 16 * q, 32 * q, 32 * q); ctx.drawImage(SPR.white, x - 7 * q, y - 7 * q, 14 * q, 14 * q);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // shockwave where a pulse lands
  function drawWaves(dt) {
    for (const wv of waves) {
      wv.t += dt / 0.9;
      const p = wv.word.p; if (!p) continue;
      const rgb = wv.error ? ERR_RGB : rings[wv.word.ring].rgb;
      for (const lag of [0, 0.25]) {
        const t = wv.t - lag; if (t <= 0 || t >= 1) continue;
        ctx.strokeStyle = rgba(rgb, 0.8 * (1 - t) * (1 - t)); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, (8 + ease(t) * 46) * p.s, 0, TAU); ctx.stroke();
      }
      const t = Math.min(1, wv.t);
      ctx.strokeStyle = rgba([255, 255, 255], 0.7 * (1 - t)); ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + wv.rot, r1 = (10 + ease(t) * 22) * p.s, r2 = r1 + 9 * p.s * (1 - t);
        ctx.moveTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1); ctx.lineTo(p.x + Math.cos(a) * r2, p.y + Math.sin(a) * r2);
      }
      ctx.stroke();
    }
    waves = waves.filter(wv => wv.t < 1.25 && !wv.word.dying);
  }

  // name plate under a galaxy that is too far away to read
  function drawTitle() {
    const c = G.c, hot = G === hoverG, y = c.y + Math.max(30, 310 * c.s) + 14;
    const st = G.state, dot = st === 'waiting' ? LOOKS.waiting.rgb : st === 'quiet' ? [150, 150, 150] : CORE_RGB;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px "Chakra Petch", "Trebuchet MS", sans-serif';
    const name = (G.project || 'session').toUpperCase(), tw = ctx.measureText(name).width;
    ctx.fillStyle = hot ? '#ffffff' : 'rgba(219,233,255,0.92)';
    ctx.fillText(name, c.x, y);
    ctx.fillStyle = rgba(dot, st === 'working' && clock - G.lastEvent < 4 ? 0.6 + 0.4 * Math.sin(clock * 8) : 0.9); ctx.beginPath(); ctx.arc(c.x - tw / 2 - 11, y, 3, 0, TAU); ctx.fill();
    ctx.font = '400 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = hot ? 'rgba(219,233,255,0.95)' : 'rgba(127,147,184,0.95)';
    ctx.fillText((st === 'waiting' ? 'your turn · ' : st === 'quiet' ? 'quiet · ' : '') + clip(core, 40), c.x, y + 17);
    if (hot && G.hit) {
      ctx.strokeStyle = rgba(CORE_RGB, 0.7); ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const a = clock * 0.5 + i * TAU / 4; ctx.beginPath(); ctx.arc(c.x, c.y, G.hit.r, a, a + 0.9); ctx.stroke(); }
    }
  }

  /* ---------- HUD ---------- */
  let lastNote = 0;
  function statusText(prefix, strong) {
    const el = $('status'); el.textContent = '';
    const dot = document.createElement('span'); dot.className = 'dot';
    el.append(dot, document.createTextNode(prefix));
    if (strong) { const b = document.createElement('b'); b.textContent = strong; el.append(b); }
    lastNote = clock; idleShown = false;
  }
  function setStatus(g, w) {
    if (view === 'single' && g !== focus) return;
    const where = view === 'all' && galaxies.length > 1 ? (g.project || 'session') + ' · ' : '';
    statusText(where + g.rings[w.ring].name.toLowerCase() + ' → ', w.text);
  }

  function showDetail() {
    const d = $('detail'), w = selected;
    if (!w) { d.hidden = true; return; }
    const r = w.g.rings[w.ring];
    d.style.setProperty('--c', r.color);
    $('detailRing').textContent = (galaxies.length > 1 ? (w.g.project || 'session') + ' · ' : '') + r.name;
    $('detailText').textContent = w.detail || w.text;
    d.hidden = false;
  }

  function renderLegend() {
    const legend = $('legend'); legend.textContent = '';
    if (!focus) return;
    focus.rings.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.style.setProperty('--c', r.color);
      b.setAttribute('aria-pressed', String(r.visible));
      const n = focus.words.filter(w => w.ring === i && !w.dying).length;
      b.append(document.createElement('i'), document.createTextNode(`${r.name} · ${n}`));
      b.addEventListener('click', () => {
        if (hiddenRings.has(r.name)) hiddenRings.delete(r.name); else hiddenRings.add(r.name);
        for (const g of galaxies) for (const x of g.rings) x.visible = !hiddenRings.has(x.name);
        if (selected && !selected.g.rings[selected.ring].visible) { selected = null; showDetail(); }
        b.setAttribute('aria-pressed', String(r.visible));
      });
      legend.append(b);
    });
  }

  /* ---------- sessions: menu, focus, views ---------- */
  const menu = $('sessMenu'), sessBtn = $('sessBtn'), allBtn = $('allBtn'), editor = $('editor'), editBtn = $('editBtn');
  let menuDirty = false, menuAt = 0;

  function age(g) {
    if (!live || !g.mtime) return '';
    const s = (Date.now() - g.mtime) / 1000;
    if (s < 3600) return `idle ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `idle ${Math.round(s / 3600)} h`;
    return `idle ${Math.round(s / 86400)} d`;
  }
  function renderMenu() {
    menu.textContent = '';
    const row = (title, sub, on, current, fn) => {
      const b = document.createElement('button'); b.type = 'button';
      if (current) b.setAttribute('aria-current', 'true');
      const t = document.createElement('b'); t.textContent = title;
      const s = document.createElement('small'); s.textContent = sub; if (on) s.className = on === 'turn' ? 'turn' : 'on';
      b.append(t, s); b.addEventListener('click', fn); menu.append(b);
    };
    if (live) row('Follow the action', follow ? 'On. The view jumps to whichever session starts working.' : 'Off. The view stays on the session you pick.', follow, false, () => { follow = !follow; renderMenu(); });
    if (galaxies.length > 1) row('All sessions', `Show all ${galaxies.length} galaxies at once`, false, view === 'all', () => { setView('all'); closeMenu(); });
    if (menu.children.length) menu.append(document.createElement('hr'));
    for (const g of galaxies.slice().sort((a, b) => (b.mtime - a.mtime) || (a.slot - b.slot))) {
      const st = stateOf(g), a = st === 'waiting' ? 'your turn' : st === 'working' ? 'working now' : age(g) || 'quiet';
      row(g.project || 'session', clip(g.core, 72) + ' · ' + a, st === 'waiting' ? 'turn' : st === 'working', g === focus && view === 'single', () => { setFocus(g, true); closeMenu(); });
    }
    menuDirty = false; menuAt = clock;
  }
  function closeMenu() { menu.hidden = true; sessBtn.setAttribute('aria-expanded', 'false'); }
  function closeEditor() { editor.hidden = true; editBtn.setAttribute('aria-expanded', 'false'); }

  function updateButtons() {
    const name = view === 'all' && galaxies.length > 1 ? `${galaxies.length} sessions` : focus ? (focus.project || 'session') : 'no session';
    sessBtn.textContent = (live ? 'live · ' : '') + name + ' ▾';
    allBtn.hidden = galaxies.length < 2;
    allBtn.setAttribute('aria-pressed', String(view === 'all'));
    $('hint').textContent = view === 'all' ? 'click a galaxy to fly in · drag to turn · scroll to zoom' : 'drag to turn · scroll to zoom · click a word';
  }
  function setFocus(g, chosen) {
    focus = g; view = 'single';
    if (chosen) follow = false;
    selected = null; hover = null; hoverG = null; showDetail();
    renderLegend(); updateButtons(); menuDirty = true;
    statusText('viewing ', g.project || 'session');
  }
  function setView(v) {
    if (v === 'all' && galaxies.length < 2) v = 'single';
    view = v; hover = null; hoverG = null;
    if (v === 'all') { selected = null; showDetail(); statusText(`all ${galaxies.length} sessions`); }
    else if (focus) statusText('viewing ', focus.project || 'session');
    updateButtons(); menuDirty = true;
  }

  sessBtn.addEventListener('click', () => {
    closeEditor(); menu.hidden = !menu.hidden; sessBtn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) renderMenu();
  });
  allBtn.addEventListener('click', () => { closeMenu(); setView(view === 'all' ? 'single' : 'all'); });
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) closeMenu(); else if (!editor.hidden) closeEditor(); else if (view === 'single') setView('all');
  });

  /* ---------- loop ---------- */
  function prepare(g) {
    const p = proj(g.pos[0] - camT[0], g.pos[1] - camT[1], g.pos[2] - camT[2]);
    g.cz = p.z; g.depth = p.z + camD; g.c = p;
    g.state = stateOf(g); g.look = LOOKS[g.state];
    g.lod = F / Math.max(60, g.depth);
    g.visible = g.depth > 700;
    g.detail = g.visible && g.lod > 0.6;
    g.hit = g.visible && (view === 'all' || g !== focus) ? { x: p.x, y: p.y, r: Math.max(26, 330 * p.s) } : null;
  }

  // advance the current galaxy by dt
  function step(dt) {
    for (const pl of pulses) {
      pl.t += dt / 0.8;
      if (pl.t >= 1) { pl.word.glow = 1; if (pl.error) pl.word.flash = 1; rings[pl.word.ring].heat = 1; waves.push({ word: pl.word, t: 0, rot: Math.random() * TAU, error: pl.error }); }
    }
    pulses = pulses.filter(pl => pl.t < 1);
    coreKick = Math.max(0, coreKick - dt * 1.6);
    for (const r of rings) r.heat = Math.max(0, r.heat - dt * 0.6);

    if (!live && speed > 0 && !pulses.length && G.state !== 'waiting') {   // example mode: attention wanders at random
      G.demoTimer -= dt;
      if (G.demoTimer <= 0) {
        const pool = words.filter(w => rings[w.ring].visible && !w.dying);
        if (pool.length) {
          const w = pool[Math.floor(Math.random() * pool.length)];
          pulses.push({ word: w, t: 0, error: Math.random() < 0.1 }); coreKick = 1; G.lastEvent = clock; setStatus(G, w);
        }
        G.demoTimer = (G === focus ? 1.7 : 3.2) + Math.random() * 1.8;
      }
    }

    for (const w of words) {
      const r = rings[w.ring];
      w.glow = Math.max(0, w.glow - dt * 0.55); w.flash = Math.max(0, w.flash - dt * 0.3);
      const d = ((w.target - w.a0 + Math.PI) % TAU + TAU) % TAU - Math.PI;
      w.a0 += d * Math.min(1, dt * 2.5);
      const fade = w.dying ? Math.max(0, 1 - (clock - w.dying) / 0.7) : 1;
      w.life = ease((clock - w.birth) / 1.1) * fade;
      w.ang = w.a0 + T * r.speed; w.k = ease((clock - w.birth) / 1.3) * (1 + (1 - fade) * 0.3);
      w.p = r.visible && G.visible ? ringPoint(r, w.ang, w.k) : null;
      if (!w.p) w.box = null;
    }
    words = words.filter(w => !w.dying || clock - w.dying < 0.7);
    if (!G.visible) waves = [];
  }

  function drawGalaxy(dt) {
    const sorted = words.filter(w => w.p).sort((a, b) => b.p.z - a.p.z);
    if (G.detail) drawGrid();
    drawNebula(false);
    drawStars(false);
    drawRings(false);
    for (const w of sorted) if (w.p.z >= 0) drawWord(w);
    drawCore();
    drawNebula(true);
    drawStars(true);
    drawRings(true);
    drawPulses();
    for (const w of sorted) if (w.p.z < 0) drawWord(w);
    drawWaves(dt);
    if (!G.detail || view === 'all') drawTitle();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    const target = (hover || dragging) ? 0.12 : 1;
    timeScale += (target - timeScale) * Math.min(1, dt * 5);
    T += dt * timeScale * speed;
    if (!dragging) yaw += dt * 0.045 * timeScale * speed;
    cy = Math.cos(yaw); sy = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
    unit = zoom * Math.min(W, H * 1.15) / 900;

    // the camera flies between one galaxy and a view of them all
    let tgt = focus ? focus.pos : [0, 0, 0], tD = F;
    if (view === 'all' && galaxies.length > 1) {
      tgt = [0, 0, 0];
      for (const g of galaxies) for (let i = 0; i < 3; i++) tgt[i] += g.pos[i] / galaxies.length;
      let maxR = 0;
      for (const g of galaxies) maxR = Math.max(maxR, Math.hypot(g.pos[0] - tgt[0], g.pos[1] - tgt[1], g.pos[2] - tgt[2]));
      tD = 2.4 * (maxR + 700);
    }
    const k = Math.min(1, dt * 2.6);
    for (let i = 0; i < 3; i++) camT[i] += (tgt[i] - camT[i]) * k;
    camD += (tD - camD) * k;

    for (const g of galaxies) prepare(g);
    for (const g of galaxies) { use(g); step(dt); save(); }

    if (focus && view === 'single' && idleShown !== focus.state && (focus.state !== 'working' ? clock - lastNote > 1.5 : live && connected && clock - lastNote > 6)) {
      const st = focus.state;
      statusText(st === 'waiting' ? 'your turn: the agent has finished and is waiting for you' : st === 'quiet' ? 'quiet: no activity for over a minute' : 'working');
      idleShown = st;
    }
    if (!menu.hidden && (menuDirty || clock - menuAt > 2)) renderMenu();

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(dt);
    for (const g of galaxies.filter(x => x.visible).sort((a, b) => b.cz - a.cz)) { use(g); drawGalaxy(dt); save(); }

    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  const pointers = new Map(); let pinchDist = 0;

  function hitWord(x, y) {
    let best = null;
    for (const g of galaxies) for (const w of g.words) {
      const b = w.box; if (!b || !w.p) continue;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && (!best || g.cz + w.p.z < best.g.cz + best.p.z)) best = w;
    }
    return best;
  }
  function hitGalaxy(x, y) {
    let best = null;
    for (const g of galaxies) {
      const h = g.hit; if (!h) continue;
      if (Math.hypot(x - h.x, y - h.y) <= h.r && (!best || g.depth < best.depth)) best = g;
    }
    return best;
  }
  function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('dragging');
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist) zoom = Math.max(0.45, Math.min(2.6, zoom * d / pinchDist));
      pinchDist = d; moved = 99; return;
    }
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      yaw += dx * 0.006; pitch = Math.max(-1.35, Math.min(1.35, pitch + dy * 0.005));
      lastX = e.clientX; lastY = e.clientY;
    } else {
      const [x, y] = local(e);
      hover = hitWord(x, y); hoverG = hover ? null : hitGalaxy(x, y);
      canvas.classList.toggle('pointing', !!(hover || hoverG));
    }
  });
  function release(e) {
    const wasClick = dragging && moved < 6 && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { dragging = false; canvas.classList.remove('dragging'); pinchDist = 0; }
    if (wasClick && e.type === 'pointerup') {
      const [x, y] = local(e), w = hitWord(x, y), g = w ? null : hitGalaxy(x, y);
      closeMenu();
      if (g) setFocus(g, true);
      else { selected = w === selected ? null : w; showDetail(); }
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!dragging) { hover = null; hoverG = null; canvas.classList.remove('pointing'); } });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = Math.max(0.45, Math.min(2.6, zoom * Math.exp(-e.deltaY * 0.0012)));
  }, { passive: false });

  $('speed').value = String(speed);
  $('speed').addEventListener('input', e => { speed = parseFloat(e.target.value); });

  /* ---------- editor (example mode only) ---------- */
  const mineName = () => content.core === EXAMPLES[0].core ? EXAMPLES[0].project : 'my agent';
  function fillEditor() {
    $('coreInput').value = content.core;
    $('ringsInput').value = content.rings.map(r => `${r.name}: ${r.items.join(', ')}`).join('\n');
  }
  function applyMine() {
    const mine = galaxies.find(g => g.id === 'mine'); if (!mine) return;
    applyState(mine, toState(content, mineName()), true); setFocus(mine, true);
  }
  editBtn.addEventListener('click', () => {
    closeMenu(); editor.hidden = !editor.hidden;
    editBtn.setAttribute('aria-expanded', String(!editor.hidden));
    if (!editor.hidden) { fillEditor(); $('coreInput').focus(); }
  });
  editor.addEventListener('submit', e => {
    e.preventDefault();
    const out = [];
    $('ringsInput').value.split('\n').forEach(line => {
      line = line.trim(); if (!line) return;
      const k = line.indexOf(':');
      const name = k > 0 ? line.slice(0, k).trim() : `Ring ${out.length + 1}`;
      const items = [...new Set((k > 0 ? line.slice(k + 1) : line).split(',').map(s => s.trim()).filter(Boolean))].slice(0, 14);
      if (items.length) out.push({ name: name.slice(0, 24), items });
    });
    if (!out.length) { $('ringsInput').focus(); return; }
    content = { core: $('coreInput').value.trim() || 'Untitled idea', rings: out.slice(0, 6) };
    saveContent(); applyMine();
  });
  $('resetBtn').addEventListener('click', () => {
    content = { core: EXAMPLES[0].core, rings: JSON.parse(JSON.stringify(EXAMPLES[0].rings)) }; saveContent(); fillEditor(); applyMine();
  });

  /* ---------- live feed ---------- */
  let wantAll = location.hash === '#all', build = '';
  const EMPTY_RINGS = ['Tools', 'Files', 'Actions', 'Thoughts', 'Context'].map(name => ({ name, items: [] }));
  function placeholder(text) {
    galaxies = []; selected = null; hover = null; hoverG = null; showDetail();
    const g = addGalaxy('__none');
    applyState(g, { project: 'no session', core: text, rings: EMPTY_RINGS }, false);
    focus = g; view = 'single'; renderLegend(); updateButtons();
  }
  function reconcile(list) {
    if (!list.length) { placeholder('Waiting for a Claude Code session'); statusText('no session found yet'); return; }
    const ids = new Set(list.map(s => s.id)), keptFocus = focus && ids.has(focus.id);
    galaxies = galaxies.filter(g => ids.has(g.id));
    if (selected && !ids.has(selected.g.id)) { selected = null; showDetail(); }
    hover = null; hoverG = null;
    const before = galaxies.length;
    for (const s of list) {
      let g = galaxies.find(x => x.id === s.id); const fresh = !g;
      if (fresh) g = addGalaxy(s.id);
      applyState(g, s, fresh);
    }
    if (!keptFocus) { focus = galaxies.slice().sort((a, b) => b.mtime - a.mtime)[0]; renderLegend(); }
    if (wantAll && galaxies.length > 1) { view = 'all'; wantAll = false; }
    if (view === 'all' && galaxies.length < 2) view = 'single';
    updateButtons(); menuDirty = true;
    if (galaxies.length !== before) statusText(galaxies.length > 1 ? `following ${galaxies.length} sessions` : 'following ', galaxies.length > 1 ? '' : focus.project);
  }
  function connect() {
    editBtn.hidden = true;
    placeholder('Connecting');
    statusText('connecting to the local feed');
    const es = new EventSource('/events');
    es.onopen = () => { connected = true; };
    es.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m) return;
      connected = true;
      // the script was restarted with a newer page: reload to pick it up
      if (m.build) { if (!build) build = m.build; else if (m.build !== build) { location.reload(); return; } }
      if (Array.isArray(m.full)) return reconcile(m.full);
      const g = m.id && galaxies.find(x => x.id === m.id);
      if (!g || !m.state) return;
      applyState(g, m.state, !!m.reset);
      (m.pulses || []).forEach(p => firePulse(g, p.ring, p.key, p.error));
    };
    es.onerror = () => { connected = false; statusText('lost the local feed, retrying'); };
  }

  /* ---------- start ---------- */
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);
  resize();
  buildStars();
  if (live) connect();
  else {
    content = loadContent();
    const mine = addGalaxy('mine');
    applyState(mine, toState(content, mineName()), true);
    for (const ex of EXAMPLES.slice(1)) applyState(addGalaxy(ex.id), toState(ex, ex.project), true);
    focus = mine; renderLegend();
    if (wantAll) view = 'all';
    updateButtons();
  }
  requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
})();
