// The planet at true scale, each object at its true height. earthmap.js prints the forecast under it.
'use strict';
const $ = id => document.getElementById(id);
const cv = $('sky'), ctx = cv.getContext('2d'), orbitCv = $('orbit'), orbitCtx = orbitCv.getContext('2d', { alpha: true }), stage = $('stage');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ZOOM_MAX = 20000, SLICES = 15, SUN_MS = 30000;
const view = { yaw: HERE_LON, pitch: 25 * RAD, zoom: 1 };
const opened = now();

let W = 0, H = 0, dpr = 0, cols, rows, cwD, chD, cw, ch, atlas, g, c, pg, pc, stars = [];
let orb = null, pos = null, slice = 0, meta = null;
let dirty = true, last = 0, cost = 0, sunAt = 0;

const clock = () => (still ? opened : now());
const radius = () => Math.min(W, H) * .44 * view.zoom;
const scale = () => Math.min(devicePixelRatio || 1, 2);
const gmst = ms => (280.46061837 + 360.98564736629 * (ms / 864e5 + 2440587.5 - 2451545)) * RAD;
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const monoFont = size => `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;

// Earth-fixed vector, any unit, to the camera's frame: x right, y up, z toward the viewer.
function turn(x, y, z) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const ez = x * cy + y * sy;
  return [y * cy - x * sy, z * cp - ez * sp, z * sp + ez * cp];
}
const direction = (lat, lon) => turn(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));

function fit() {
  const w = stage.clientWidth, h = stage.clientHeight, ratio = scale();
  if (!w || !h || (w === W && h === H && ratio === dpr)) return;
  W = w; H = h; dpr = ratio;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize), fs = (W < 700 ? 8 : 12 * Math.max(1, rem / 14)) * dpr, font = monoFont(fs);
  ctx.font = font;
  cwD = Math.ceil(ctx.measureText('M').width); chD = Math.ceil(fs * 1.2); cw = cwD / dpr; ch = chD / dpr;
  cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
  cv.width = orbitCv.width = Math.round(W * dpr); cv.height = orbitCv.height = Math.round(H * dpr);
  atlas = makeAtlas(font, cwD, chD);
  const n = cols * rows;
  g = new Int16Array(n); c = new Uint8Array(n); pg = new Int16Array(n).fill(-1); pc = new Uint8Array(n);
  // Spread over the whole sky so that turning the camera turns them too; the visible half keeps the home page's density.
  const sky = Math.hypot(W, H) / 2, count = Math.round(2 * Math.PI * sky * sky / (W < 700 ? 6600 : 23040));
  stars = Array.from({ length: count }, (_, i) => {
    const z = 2 * hash(i, 1, 9) - 1, around = hash(i, 2, 8) * TAU, rim = Math.sqrt(1 - z * z);
    return { x: rim * Math.cos(around), y: rim * Math.sin(around), z, b: hash(i, 7, 1) };
  });
  dirty = true;
}

function put(col, row, glyph, ink) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  const i = row * cols + col;
  g[i] = glyph; c[i] = ink;
}

function drawStars() {
  const sky = Math.hypot(W, H) / 2;
  for (const s of stars) {
    const [x, y, z] = turn(s.x, s.y, s.z);
    if (z < 0) continue;
    const col = Math.floor((W / 2 + sky * x) / cw), row = Math.floor((H / 2 - sky * y) / ch);
    put(col, row, s.b > .8 ? PLUS : DOT, Math.min(3, Math.floor((.3 + .7 * s.b) * 4)));
  }
}

function drawPlanet(T) {
  g.fill(-1);
  drawStars();
  const R = radius(), rx = R / cw, ry = R / ch, cx = W / 2 / cw, cy = H / 2 / ch, cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const sun = subsolar(T), [Sx, Sy, Sz] = direction(sun.dec, sun.lon);
  for (let row = 0; row < rows; row++) {
    const ny = -(row + .5 - cy) / ry;
    for (let col = 0; col < cols; col++) {
      const dx = (col + .5 - cx) / rx, r2 = dx * dx + ny * ny, i = row * cols + col;
      if (r2 >= 1) {
        const r = Math.sqrt(r2), glow = (dx * Sx + ny * Sy) / r;
        if (r < RIM && glow > .1) { g[i] = r < 1.04 ? 1 : DOT; c[i] = OCEAN + (glow > .6 ? 3 : 2); }
        continue;
      }
      const z = Math.sqrt(1 - r2), ey = ny * cp + z * sp, ez = z * cp - ny * sp;
      const shade = smooth(-.12, .62, dx * Sx + ny * Sy + z * Sz) * (.62 + .38 * z);
      const cell = surface(Math.asin(Math.max(-1, Math.min(1, ey))), Math.atan2(dx, ez) + view.yaw, shade);
      g[i] = cell >> 8;
      if (cell >= 0) c[i] = cell & 255;
    }
  }
  const [hx, hy, hz] = direction(HERE_LAT, HERE_LON);
  if (hz > 0) put(Math.floor(cx + hx * rx), Math.floor(cy - hy * ry), PLUS, HERE);
  for (let i = 0; i < g.length; i++) {
    if (g[i] === pg[i] && c[i] === pc[i]) continue;
    const col = i % cols, row = (i - col) / cols, px = col * cwD, py = row * chD;
    ctx.clearRect(px, py, cwD, chD);
    if (g[i] >= 0) ctx.drawImage(atlas, g[i] * cwD, c[i] * chD, cwD, chD, px, py, cwD, chD);
    pg[i] = g[i]; pc[i] = c[i];
  }
}

function drawDots(T) {
  orbitCtx.clearRect(0, 0, orbitCv.width, orbitCv.height);
  if (!orb) return;
  const spin = gmst(T) + view.yaw, cs = Math.cos(spin), sn = Math.sin(spin), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), R = radius();
  const size = Math.max(1, dpr * (W < 700 ? .5 : .75));
  orbitCtx.fillStyle = W < 700 ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.6)';
  orbitCtx.beginPath();
  for (let i = 0; i < orb.n; i++) {
    const a = pos[i * 3], b = pos[i * 3 + 1], e = pos[i * 3 + 2], ez = a * cs + b * sn, qx = b * cs - a * sn;
    const sy = e * cp - ez * sp, sz = e * sp + ez * cp, flat = qx * qx + sy * sy, x = W / 2 + R * qx, y = H / 2 - R * sy;
    if ((sz < 0 && flat < 1) || a * a + b * b + e * e <= 1 || x < 0 || x > W || y < 0 || y > H) continue;
    orbitCtx.rect(x * dpr, y * dpr, size, size);
  }
  orbitCtx.fill();
}

function drawScale() {
  // Close in, the planet is a wall of glyphs behind the dots, so it recedes as the zoom grows.
  cv.style.opacity = Math.max(.3, 1 - .9 * Math.max(0, Math.log10(view.zoom / 2))).toFixed(2);
  const shown = view.zoom > 2;
  $('scale').hidden = !shown;
  if (!shown) return;
  const pxPerKm = radius() / RE, wanted = 100 / pxPerKm, unit = 10 ** Math.floor(Math.log10(wanted));
  const km = [1, 2, 5, 10].map(x => x * unit).find(x => x * pxPerKm >= 60) || unit;
  $('bar').style.width = `${(km * pxPerKm).toFixed(1)}px`;
  $('scale-text').textContent = `${km >= 1 ? km.toLocaleString('en-US') : km.toPrecision(1)} km`;
}

function tick() {
  const T = clock(), before = cover;
  refreshField();
  applyClouds(T);
  if (cover !== before) dirty = true;
  stepAim();
  if (orb && !still) {
    orbitsAt(orb, T, pos, Math.floor(slice * orb.n / SLICES), Math.floor((slice + 1) * orb.n / SLICES));
    slice = (slice + 1) % SLICES;
  }
  const nowMs = performance.now();
  if (dirty || (!still && nowMs - sunAt > SUN_MS)) { drawPlanet(T); drawScale(); sunAt = nowMs; }
  if (dirty || !still) drawDots(T);
  drawMap();
  dirty = false;
}

function loop(t) {
  if (t - last > Math.max(66, cost * 3)) {
    const a = performance.now();
    last = t;
    tick();
    cost += (performance.now() - a - cost) * .1;
  }
  requestAnimationFrame(loop);
}

// Pointer: one finger or mouse turns, two pinch.
const pointers = new Map();
let pinch = 0;

function nudge(dx, dy) {
  const R = radius();
  view.yaw -= dx / R / Math.max(Math.cos(view.pitch), .2);
  view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch + dy / R));
  dirty = true;
}

function zoomAt(factor, x, y) {
  const before = radius();
  view.zoom = clampZoom(view.zoom * factor);
  const after = radius();
  // Keeps the ground under the cursor in place.
  const gain = 1 / before - 1 / after, px = x - W / 2, py = y - H / 2;
  view.yaw += px * gain / Math.max(Math.cos(view.pitch), .2);
  view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch - py * gain));
  dirty = true;
}

// The stage is one row of the page, so pointers are measured from its own corner.
const onStage = (x, y) => { const box = stage.getBoundingClientRect(); return [x - box.left, y - box.top]; };

stage.addEventListener('pointerdown', e => {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  stage.classList.add('moving');
  aim = null;
  $('hint').hidden = true;
});
stage.addEventListener('pointermove', e => {
  const point = pointers.get(e.pointerId);
  if (!point) return;
  const dx = e.clientX - point.x, dy = e.clientY - point.y;
  point.x = e.clientX; point.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt(apart / pinch, ...onStage((a.x + b.x) / 2, (a.y + b.y) / 2));
    pinch = apart;
    return;
  }
  nudge(dx, dy);
});
function release(e) {
  pointers.delete(e.pointerId);
  if (!pointers.size) stage.classList.remove('moving');
  pinch = 0;
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), ...onStage(e.clientX, e.clientY)); }, { passive: false });
stage.addEventListener('keydown', e => {
  const step = radius() * .08, moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) { aim = null; nudge(...moves[e.key]); e.preventDefault(); } else if (e.key === '+' || e.key === '=') zoomAt(1.25, W / 2, H / 2);
  else if (e.key === '-' || e.key === '_') zoomAt(.8, W / 2, H / 2);
});
