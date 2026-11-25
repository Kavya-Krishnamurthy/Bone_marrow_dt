// Illustrated, animated cross-section of bone marrow drawn on a canvas.
// Cell counts on screen follow the model's populations for the selected day:
// stem cells by the bone, growing cells in the marrow, finished cells in the blood vessel,
// and fat cells that fill in as the marrow empties.

const SW = 1000; // virtual scene width
const SH = 620; // virtual scene height
const VESSEL_TOP = 440;
const VESSEL_BOT = 540;

export const CELL_INFO = {
  hsc: { name: 'Stem cells', text: 'The “seeds” of blood. Each one can make every kind of blood cell and copy itself. They sit close to the bone.' },
  prog_neutrophil: { name: 'Young white cells', text: 'Growing cells that become infection-fighting neutrophils in about 5 days.' },
  prog_rbc: { name: 'Young red cells', text: 'Growing cells that become oxygen-carrying red blood cells in about a week.' },
  prog_platelet: { name: 'Megakaryocytes', text: 'Giant cells that break off tiny fragments called platelets, which help blood clot.' },
  prog_lymphocyte: { name: 'Young immune cells', text: 'Growing cells that become lymphocytes, the immune system’s defenders.' },
  rbc: { name: 'Red blood cells', text: 'Carry oxygen around the body. They live about 4 months, so their number falls slowly.' },
  neutrophil: { name: 'White blood cells', text: 'Neutrophils: first responders against infection. They last under a day in the blood, so they vanish fast when the marrow stops making them.' },
  platelet: { name: 'Platelets', text: 'Tiny cell fragments that plug leaks and stop bleeding. They last about a week.' },
  lymphocyte: { name: 'Lymphocytes', text: 'Immune cells that are unusually sensitive to radiation. Many die within a day or two.' },
  fat: { name: 'Fat cells', text: 'Fill the space left when blood-making cells are lost. More fat means emptier marrow.' },
  bone: { name: 'Spongy bone', text: 'Marrow lives inside the honeycomb of thin bone struts found in the hips, spine, ribs and long bones.' },
  vessel: { name: 'Blood vessel', text: 'Finished cells squeeze through the thin wall and are carried to the rest of the body.' },
};

// Number of drawn cells at 100% of normal.
const MAX = {
  hsc: 9,
  prog_neutrophil: 15,
  prog_rbc: 14,
  prog_platelet: 4,
  prog_lymphocyte: 8,
  rbc: 44,
  neutrophil: 12,
  platelet: 30,
  lymphocyte: 10,
};
const ZONE = {
  hsc: 'niche', prog_neutrophil: 'marrow', prog_rbc: 'marrow', prog_platelet: 'mega', prog_lymphocyte: 'marrow',
  rbc: 'vessel', neutrophil: 'vessel', platelet: 'vessel', lymphocyte: 'vessel',
};
const RADIUS = {
  hsc: 13, prog_neutrophil: 9, prog_rbc: 8.5, prog_platelet: 19, prog_lymphocyte: 8,
  rbc: 7.5, neutrophil: 8, platelet: 2.8, lymphocyte: 6.5,
};

function boneTopY(x) {
  return 58 + 12 * Math.sin(x / 83) + 7 * Math.sin(x / 31 + 1.3) + 5 * Math.sin(x / 17 + 0.4);
}
function boneBotY(x) {
  return 578 + 9 * Math.sin(x / 71 + 2) + 6 * Math.sin(x / 27);
}
// Trabecular struts hanging from the top bone into the marrow.
const STRUTS = [
  { x: 210, len: 70, w: 22 },
  { x: 520, len: 52, w: 18 },
  { x: 790, len: 82, w: 24 },
];

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

// ---------- Cell drawing (shared with legend icons) ----------
export function drawCell(ctx, type, x, y, r, opts = {}) {
  const { alpha = 1, hit = 0, seed = 0, phase = 0 } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  const grey = hit > 0;
  switch (type) {
    case 'hsc': {
      const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.1);
      g.addColorStop(0, grey ? 'rgba(160,160,160,0.25)' : 'rgba(168,120,245,0.45)');
      g.addColorStop(1, 'rgba(168,120,245,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * (2 + 0.15 * Math.sin(phase * 2)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grey ? '#b9b4bd' : '#b591ee';
      ctx.strokeStyle = grey ? '#8d8891' : '#7046b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = grey ? '#6f6a73' : '#4b2490';
      ctx.beginPath();
      ctx.ellipse(r * 0.08, -r * 0.05, r * 0.55, r * 0.5, seed, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.4, -r * 0.45, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'prog_neutrophil':
    case 'prog_lymphocyte':
    case 'prog_rbc': {
      const c = {
        prog_neutrophil: ['#dcc3ef', '#9d74c9', '#5e3596'],
        prog_lymphocyte: ['#bcd3f4', '#7d9fd6', '#2d4c95'],
        prog_rbc: ['#f2a7ac', '#cf6b73', '#5d1d39'],
      }[type];
      ctx.fillStyle = grey ? '#c4c0c6' : c[0];
      ctx.strokeStyle = grey ? '#98939b' : c[1];
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = grey ? '#77727a' : c[2];
      ctx.beginPath();
      const nr = type === 'prog_rbc' ? 0.45 : 0.6;
      ctx.arc(r * 0.1, 0, r * nr, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'prog_platelet': {
      // Megakaryocyte: large, ruffled, multilobed nucleus.
      ctx.fillStyle = grey ? '#cbc6cd' : '#e6c9ef';
      ctx.strokeStyle = grey ? '#9a959c' : '#a56fbe';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = r * (1 + 0.07 * Math.sin(a * 5 + seed * 3));
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = grey ? '#7a757d' : '#7a3c93';
      for (const [dx, dy, s] of [[-0.25, -0.15, 0.32], [0.22, -0.2, 0.3], [0.05, 0.25, 0.33], [-0.3, 0.25, 0.22]]) {
        ctx.beginPath();
        ctx.arc(dx * r, dy * r, s * r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'rbc': {
      ctx.rotate(seed * 6);
      ctx.fillStyle = grey ? '#b7a9aa' : '#d3333f';
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grey ? '#9d8f90' : '#a8202d';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.45, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-r * 0.1, -r * 0.1, r * 0.75, Math.PI * 1.1, Math.PI * 1.6);
      ctx.stroke();
      break;
    }
    case 'neutrophil': {
      ctx.fillStyle = grey ? '#d4d0d6' : '#f1e6f4';
      ctx.strokeStyle = grey ? '#a29ea4' : '#b48fc8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = grey ? '#7d7980' : '#6c3f98';
      ctx.rotate(seed * 4);
      for (const [dx, dy] of [[-0.38, 0.05], [0.02, -0.3], [0.4, 0.08]]) {
        ctx.beginPath();
        ctx.arc(dx * r, dy * r, r * 0.27, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'platelet': {
      ctx.rotate(seed * 5);
      ctx.fillStyle = grey ? '#a9a4ab' : '#9466c2';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lymphocyte': {
      ctx.fillStyle = grey ? '#cfcfd3' : '#d6e5fa';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grey ? '#77777e' : '#27468f';
      ctx.beginPath();
      ctx.arc(r * 0.08, 0, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fat': {
      ctx.fillStyle = '#fff7e3';
      ctx.strokeStyle = '#e3cf9f';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.9, seed, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.25, r * 0.15, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  if (hit > 0) {
    // Damage crack
    ctx.globalAlpha = alpha * Math.min(1, hit);
    ctx.strokeStyle = '#3d3a40';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.3);
    ctx.lineTo(-r * 0.1, r * 0.05);
    ctx.lineTo(r * 0.15, -r * 0.2);
    ctx.lineTo(r * 0.6, r * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws a single legend icon into a small canvas element. */
export function drawIcon(canvas, type) {
  const size = 36;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const r = { hsc: 10, prog_platelet: 13, platelet: 4, fat: 14 }[type] || 10;
  if (type === 'platelet') {
    drawCell(ctx, 'platelet', 11, 14, r, { seed: 0.2 });
    drawCell(ctx, 'platelet', 24, 20, r, { seed: 1.1 });
    drawCell(ctx, 'platelet', 15, 26, r, { seed: 2.4 });
  } else {
    drawCell(ctx, type, size / 2, size / 2, r, { seed: 0.4 });
  }
}

export function createScene(canvas, labelLayer, { onHover } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let scale = 1;
  let dpr = 1;
  let parts = [];
  let fats = [];
  let beams = [];
  let streaks = [];
  let flash = 0;
  let targets = { ...MAX };
  let fatTarget = 4;
  let chronic = false;
  let playing = false;
  let time = 0;
  let last = performance.now();
  let highlight = null;
  let labelsOn = true;
  let streakTimer = 0;
  const spawnClock = {};

  // Static textures
  const osteocytes = Array.from({ length: 26 }, () => {
    const top = Math.random() < 0.65;
    const x = rnd(10, SW - 10);
    const y = top ? rnd(10, boneTopY(x) - 10) : rnd(boneBotY(x) + 8, SH - 6);
    return { x, y, a: rnd(0, Math.PI) };
  });
  const endo = [];
  for (let x = 10; x < SW; x += 46) endo.push(x + rnd(-6, 6));

  // ---------- Labels ----------
  const LABELS = [
    { key: 'bone', x: 640, y: 12, tx: 700, ty: 40, title: 'Bone', desc: 'Marrow lives inside it' },
    { key: 'hsc', x: 40, y: 150, title: 'Stem cells', desc: 'The seeds of all blood' },
    { key: 'marrow', x: 380, y: 245, title: 'Young blood cells', desc: 'Growing and dividing' },
    { key: 'fat', x: 690, y: 300, title: 'Fat cells', desc: 'Fill empty space' },
    { key: 'vessel', x: 40, y: 452, tx: 150, ty: 490, title: 'Blood vessel', desc: 'Carries finished cells → body' },
  ];
  const labelEls = {};
  labelLayer.replaceChildren();
  for (const L of LABELS) {
    const el = document.createElement('div');
    el.className = 'scene-label';
    el.style.left = (L.x / SW) * 100 + '%';
    el.style.top = (L.y / SH) * 100 + '%';
    const t = document.createElement('strong');
    t.textContent = L.title;
    const d = document.createElement('span');
    d.textContent = L.desc;
    const v = document.createElement('em');
    el.append(t, d, v);
    labelLayer.append(el);
    labelEls[L.key] = { el, v, L };
  }

  function resize() {
    const cw = canvas.clientWidth || 800;
    scale = cw / SW;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(SH * scale * dpr);
    canvas.style.height = SH * scale + 'px';
    labelLayer.classList.toggle('compact', cw < 620);
    if (reduced || !playing) render();
  }

  function zoneSpot(zone) {
    if (zone === 'niche') {
      const x = rnd(30, SW - 30);
      return { x, y: boneTopY(x) + rnd(20, 48) };
    }
    if (zone === 'marrow') return { x: rnd(30, SW - 30), y: rnd(150, 390) };
    if (zone === 'mega') return { x: rnd(60, SW - 60), y: rnd(395, 415) };
    return { x: rnd(-20, SW + 20), y: rnd(VESSEL_TOP + 14, VESSEL_BOT - 14) };
  }

  function spawn(type, initial) {
    const zone = ZONE[type];
    let p = zoneSpot(zone);
    if (type === 'platelet' && !initial) {
      const megas = parts.filter((q) => q.type === 'prog_platelet' && !q.dying);
      if (megas.length) {
        const m = megas[Math.floor(Math.random() * megas.length)];
        p = { x: m.x + rnd(-10, 10), y: VESSEL_TOP + 12 };
      }
    } else if (zone === 'vessel' && !initial) {
      p = { x: rnd(0, SW), y: VESSEL_TOP + 10 + rnd(0, 4) };
    }
    parts.push({
      type, x: p.x, y: p.y, vx: 0, vy: 0, r: RADIUS[type] * rnd(0.9, 1.1),
      born: initial ? -10 : time, dying: null, hit: 0, seed: Math.random() * 6,
      phase: Math.random() * 6, lane: rnd(VESSEL_TOP + 14, VESSEL_BOT - 14), speed: rnd(0.8, 1.2),
    });
  }

  function placeFat(initial) {
    for (let tries = 0; tries < 40; tries++) {
      const r = rnd(22, 38);
      const x = rnd(40, SW - 40);
      const y = rnd(160 + r * 0.5, 395 - r * 0.6);
      if (fats.every((f) => f.dying != null || Math.hypot(f.x - x, f.y - y) > f.r + r + 4)) {
        fats.push({ x, y, r, seed: Math.random(), born: initial ? -10 : time, dying: null });
        return;
      }
    }
  }

  function reconcile(initial = false) {
    for (const type of Object.keys(MAX)) {
      const alive = parts.filter((p) => p.type === type && p.dying == null);
      const want = targets[type];
      if (alive.length < want) {
        const n = initial ? want - alive.length : 1;
        const gap = initial ? 0 : 0.05;
        if (initial || time - (spawnClock[type] || 0) > gap) {
          for (let i = 0; i < n; i++) spawn(type, initial);
          spawnClock[type] = time;
        }
      } else if (alive.length > want) {
        const excess = alive.length - want;
        alive.sort((a, b) => b.hit - a.hit || Math.random() - 0.5);
        const n = initial ? excess : Math.max(1, Math.ceil(excess * 0.25));
        for (let i = 0; i < n; i++) alive[i].dying = time;
      }
    }
    const fAlive = fats.filter((f) => f.dying == null);
    if (fAlive.length < fatTarget) placeFat(initial);
    else if (fAlive.length > fatTarget) fAlive[fAlive.length - 1].dying = time;
    if (initial) {
      while (fats.filter((f) => f.dying == null).length < fatTarget) {
        const before = fats.length;
        placeFat(true);
        if (fats.length === before) break;
      }
    }
  }

  function step(dt) {
    time += dt;
    const k = reduced ? 0 : 1;
    for (const p of parts) {
      p.phase += dt;
      const zone = ZONE[p.type];
      if (zone === 'vessel') {
        p.x += 55 * p.speed * dt * k;
        p.y += (p.lane - p.y) * Math.min(1, dt * 1.5) * k + Math.sin(p.phase * 2 + p.seed) * 0.15 * k;
        if (p.x > SW + 25) p.x = -25;
      } else if (zone !== 'mega') {
        p.vx += rnd(-1, 1) * 30 * dt;
        p.vy += rnd(-1, 1) * 30 * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.x += p.vx * dt * k;
        p.y += p.vy * dt * k;
        if (zone === 'niche') {
          const top = boneTopY(p.x) + 16;
          p.y = Math.min(Math.max(p.y, top), top + 40);
        } else {
          p.y = Math.min(Math.max(p.y, 150), 392);
        }
        p.x = Math.min(Math.max(p.x, 20), SW - 20);
      }
      if (p.hit > 0) p.hit = Math.max(0, p.hit - dt * 0.25);
    }
    parts = parts.filter((p) => p.dying == null || time - p.dying < 0.9);
    fats = fats.filter((f) => f.dying == null || time - f.dying < 1.2);
    beams = beams.filter((b) => time - b.t < 1.4);
    streaks = streaks.filter((s) => time - s.t < 0.9);
    flash = Math.max(0, flash - dt * 1.6);
    if (chronic && playing && !reduced) {
      streakTimer -= dt;
      if (streakTimer <= 0) {
        streakTimer = rnd(0.25, 0.7);
        const x0 = rnd(-50, SW + 50);
        streaks.push({ t: time, x0, y0: -10, x1: x0 + rnd(-300, 300), y1: SH + 10 });
        const victims = parts.filter((p) => p.dying == null && Math.random() < 0.04);
        for (const v of victims) v.hit = 1;
      }
    }
    reconcile(false);
  }

  // ---------- Drawing ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 60, 0, VESSEL_TOP);
    g.addColorStop(0, '#f8dcd5');
    g.addColorStop(1, '#f2c5bf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SW, SH);
    // faint stroma fibres
    ctx.strokeStyle = 'rgba(200,120,120,0.13)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const y = 160 + i * 18;
      ctx.moveTo(0, y);
      for (let x = 0; x <= SW; x += 50) ctx.lineTo(x, y + 8 * Math.sin(x / 90 + i));
      ctx.stroke();
    }
  }

  function drawBone() {
    const fillBone = (pathFn) => {
      const g = ctx.createLinearGradient(0, 0, 0, SH);
      g.addColorStop(0, '#efe5cf');
      g.addColorStop(1, '#e6d9bb');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#cdb98f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      pathFn();
      ctx.fill();
      ctx.stroke();
    };
    fillBone(() => {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, boneTopY(0));
      for (let x = 0; x <= SW; x += 8) {
        let y = boneTopY(x);
        for (const s of STRUTS) {
          const d = Math.abs(x - s.x);
          if (d < s.w * 1.6) y += s.len * Math.cos((d / (s.w * 1.6)) * (Math.PI / 2)) ** 2;
        }
        ctx.lineTo(x, y);
      }
      ctx.lineTo(SW, 0);
      ctx.closePath();
    });
    fillBone(() => {
      ctx.moveTo(0, SH);
      for (let x = 0; x <= SW; x += 8) ctx.lineTo(x, boneBotY(x));
      ctx.lineTo(SW, SH);
      ctx.closePath();
    });
    // lamellae
    ctx.strokeStyle = 'rgba(190,168,120,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      for (let x = 0; x <= SW; x += 10) ctx.lineTo(x, boneTopY(x) - i * 11);
      ctx.stroke();
      ctx.beginPath();
      for (let x = 0; x <= SW; x += 10) ctx.lineTo(x, boneBotY(x) + i * 9);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(140,115,70,0.45)';
    for (const o of osteocytes) {
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, 4, 1.8, o.a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawVessel() {
    const g = ctx.createLinearGradient(0, VESSEL_TOP, 0, VESSEL_BOT);
    g.addColorStop(0, '#f0b3b0');
    g.addColorStop(0.5, '#f6c7c3');
    g.addColorStop(1, '#eeaaa7');
    ctx.fillStyle = g;
    ctx.fillRect(0, VESSEL_TOP, SW, VESSEL_BOT - VESSEL_TOP);
    ctx.fillStyle = '#d9787e';
    for (const [y0, dir] of [[VESSEL_TOP, -1], [VESSEL_BOT, 1]]) {
      for (const x of endo) {
        ctx.beginPath();
        ctx.ellipse(x, y0 + dir * 2, 20, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // flow chevrons
    ctx.strokeStyle = 'rgba(160,50,60,0.18)';
    ctx.lineWidth = 3;
    const off = (time * 40) % 120;
    for (let x = -120 + off; x < SW + 40; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, VESSEL_TOP + 38);
      ctx.lineTo(x + 14, (VESSEL_TOP + VESSEL_BOT) / 2);
      ctx.lineTo(x, VESSEL_BOT - 38);
      ctx.stroke();
    }
  }

  function lifeAlpha(p) {
    const grow = Math.min(1, (time - p.born) / 0.6);
    const die = p.dying != null ? Math.max(0, 1 - (time - p.dying) / 0.9) : 1;
    return { a: Math.min(grow, die), s: (0.4 + 0.6 * grow) * (p.dying != null ? 0.6 + 0.4 * die : 1) };
  }

  function render() {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawBackground();
    for (const f of fats) {
      const { a, s } = lifeAlpha(f);
      drawCell(ctx, 'fat', f.x, f.y, f.r * s, { alpha: a * (highlight && highlight !== 'fat' ? 0.35 : 1), seed: f.seed });
    }
    drawVessel();
    const order = ['prog_platelet', 'prog_rbc', 'prog_neutrophil', 'prog_lymphocyte', 'hsc', 'rbc', 'lymphocyte', 'neutrophil', 'platelet'];
    for (const type of order) {
      for (const p of parts) {
        if (p.type !== type) continue;
        const { a, s } = lifeAlpha(p);
        const dim = highlight && !matchesHighlight(p.type) ? 0.25 : 1;
        drawCell(ctx, p.type, p.x, p.y, p.r * s, { alpha: a * dim, hit: p.hit, seed: p.seed, phase: p.phase });
      }
    }
    drawBone();
    // radiation
    for (const b of beams) {
      const life = 1 - (time - b.t) / 1.4;
      ctx.save();
      ctx.globalAlpha = Math.max(0, life);
      ctx.strokeStyle = '#d6f53c';
      ctx.shadowColor = '#e8ff6a';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3;
      ctx.beginPath();
      b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }
    for (const st of streaks) {
      const life = 1 - (time - st.t) / 0.9;
      ctx.save();
      ctx.globalAlpha = Math.max(0, life) * 0.8;
      ctx.strokeStyle = '#c8f04a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(st.x0, st.y0);
      ctx.lineTo(st.x1, st.y1);
      ctx.stroke();
      ctx.restore();
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(226,250,120,${flash * 0.35})`;
      ctx.fillRect(0, 0, SW, SH);
    }
    if (labelsOn) drawLeaders();
  }

  function matchesHighlight(type) {
    if (!highlight) return true;
    if (highlight === 'marrow') return type.startsWith('prog_');
    return type === highlight;
  }

  function nearest(type, fx, fy) {
    let best = null;
    let bd = Infinity;
    for (const p of parts) {
      if (p.dying != null) continue;
      if (type === 'marrow' ? !p.type.startsWith('prog_') || p.type === 'prog_platelet' : p.type !== type) continue;
      const d = Math.hypot(p.x - fx, p.y - fy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function drawLeaders() {
    ctx.save();
    ctx.strokeStyle = 'rgba(40,25,45,0.65)';
    ctx.fillStyle = 'rgba(40,25,45,0.85)';
    ctx.lineWidth = 1.2;
    for (const { L } of Object.values(labelEls)) {
      let tx = L.tx;
      let ty = L.ty;
      if (L.key === 'hsc' || L.key === 'marrow' || L.key === 'fat') {
        const anchorY = L.y + 10;
        let p = null;
        if (L.key === 'fat') {
          let bd = Infinity;
          for (const f of fats) {
            if (f.dying != null) continue;
            const d = Math.hypot(f.x - L.x, f.y - anchorY);
            if (d < bd) { bd = d; p = f; }
          }
        } else p = nearest(L.key, L.x + 60, anchorY);
        if (!p) continue;
        tx = p.x;
        ty = p.y;
      }
      if (tx == null) continue;
      const sx = L.x + 6;
      const sy = L.y + 6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    render();
    requestAnimationFrame(loop);
  }

  // Hover
  function toScene(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * SW, y: ((ev.clientY - r.top) / r.height) * SH };
  }
  canvas.addEventListener('pointermove', (ev) => {
    const { x, y } = toScene(ev);
    let hitType = null;
    let bd = Infinity;
    for (const p of parts) {
      if (p.dying != null) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r + 10 && d < bd) { bd = d; hitType = p.type; }
    }
    if (!hitType) {
      for (const f of fats) if (f.dying == null && Math.hypot(f.x - x, f.y - y) < f.r) hitType = 'fat';
    }
    if (!hitType) {
      if (y < boneTopY(x) || y > boneBotY(x)) hitType = 'bone';
      else if (y > VESSEL_TOP && y < VESSEL_BOT) hitType = 'vessel';
    }
    onHover?.(hitType, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerleave', () => onHover?.(null));

  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();
  reconcile(true);
  render();
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });

  return {
    /** levels: { hsc, prog_*, rbc, neutrophil, platelet, lymphocyte } as fractions of normal. */
    setLevels(levels, { instant = false } = {}) {
      for (const type of Object.keys(MAX)) {
        const rel = Math.max(0, levels[type] ?? 1);
        let n = rel * MAX[type];
        n = n > 0.02 && n < 1 ? 1 : Math.round(n);
        targets[type] = Math.min(n, Math.round(MAX[type] * 1.6));
      }
      const cell = (levels.prog_neutrophil + levels.prog_rbc + levels.prog_platelet + levels.prog_lymphocyte) / 4;
      fatTarget = Math.round(3 + 9 * Math.max(0, 1 - Math.min(1, cell)));
      if (instant) reconcile(true);
    },
    zap(strength = 1) {
      const s = Math.max(0.15, Math.min(1, strength));
      flash = 0.6 + 0.4 * s;
      const n = Math.round(4 + 6 * s);
      for (let i = 0; i < n; i++) {
        const x0 = rnd(-100, SW);
        const pts = [];
        let x = x0;
        for (let y = -10; y <= SH + 20; y += 40) {
          pts.push([x, y]);
          x += rnd(10, 40) * (i % 2 ? 1 : -1) + 12;
        }
        beams.push({ t: time, pts });
      }
      for (const p of parts) {
        if (p.dying != null) continue;
        const sensitive = p.type === 'hsc' || p.type.startsWith('prog_') || p.type === 'lymphocyte';
        if (sensitive && Math.random() < 0.25 + 0.7 * s) p.hit = 1.5;
      }
    },
    setChronic(on) { chronic = on; },
    setPlaying(on) { playing = on; },
    setHighlight(type) { highlight = type; if (reduced) render(); },
    setLabels(on) {
      labelsOn = on;
      labelLayer.hidden = !on;
      if (reduced) render();
    },
    setLabelValues(vals) {
      for (const [k, v] of Object.entries(vals)) if (labelEls[k]) labelEls[k].v.textContent = v;
    },
  };
}
