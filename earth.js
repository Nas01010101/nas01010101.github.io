// The planet at true scale, each object at its true height, and SGP4 against the network for one object.
'use strict';
const $ = id => document.getElementById(id);
const cv = $('sky'), ctx = cv.getContext('2d'), orbitCv = $('orbit'), orbitCtx = orbitCv.getContext('2d', { alpha: true }), stage = $('stage');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ZOOM_MIN = .2, ZOOM_MAX = 20000, ZOOM_PICK = 6, SLICES = 15, DAY_MS = 864e5, SUN_MS = 30000, READ_MS = 1000;
const NET_INK = '#36d07f', SGP4_INK = '#e6e6e6';
const view = { yaw: HERE_LON, pitch: 25 * RAD, zoom: 1, follow: false };
const params = new URLSearchParams(location.search), opened = now();

let W = 0, H = 0, dpr = 0, cols, rows, cwD, chD, cw, ch, atlas, g, c, pg, pc, stars = [];
let orb = null, pos = null, spots = null, slice = 0, meta = null, catalog = null, catalogLoad = null, table = null, netLoad = null;
let offsetDays = 0, timeTouched = false, source = 'meteo', modelShown = false, picked = null, shownPlace = null;
let dirty = true, last = 0, cost = 0, sunAt = 0, readAt = 0;

const clock = () => (still ? opened : now()) + offsetDays * DAY_MS;
const radius = () => Math.min(W, H) * .36 * view.zoom;
const scale = () => Math.min(devicePixelRatio || 1, 2);
const gmst = ms => satellite.gstime(new Date(ms));
const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const say = text => { $('say').firstChild.textContent = text; };

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
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize), fs = (W < 700 ? 8 : 12 * Math.max(1, rem / 14)) * dpr;
  const font = `${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
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
    if (s.b > .95) {
      put(col, row, PLUS, 4);
      for (const k of [-2, -1, 1, 2]) put(col + k, row, DASH, Math.abs(k) === 1 ? 3 : 1);
      put(col, row - 1, PIPE, 2); put(col, row + 1, PIPE, 2);
    } else put(col, row, s.b > .8 ? PLUS : DOT, Math.min(3, Math.floor((.3 + .7 * s.b) * 4)));
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

// Every dot's place on screen in CSS pixels, NaN when behind the planet, inside it or off screen.
function projectDots(T) {
  const spin = gmst(T) + view.yaw, cs = Math.cos(spin), sn = Math.sin(spin), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch), R = radius();
  for (let i = 0; i < orb.n; i++) {
    const a = pos[i * 3], b = pos[i * 3 + 1], e = pos[i * 3 + 2], ez = a * cs + b * sn, qx = b * cs - a * sn;
    const sy = e * cp - ez * sp, sz = e * sp + ez * cp, flat = qx * qx + sy * sy, x = W / 2 + R * qx, y = H / 2 - R * sy;
    const hidden = (sz < 0 && flat < 1) || a * a + b * b + e * e <= 1 || x < 0 || x > W || y < 0 || y > H;
    spots[i * 2] = hidden ? NaN : x; spots[i * 2 + 1] = y;
  }
}

function drawDots(T) {
  orbitCtx.clearRect(0, 0, orbitCv.width, orbitCv.height);
  if (!orb) return;
  projectDots(T);
  const size = Math.max(1, dpr * (W < 700 ? .5 : .75)), skip = picked ? picked.row : -1;
  orbitCtx.fillStyle = W < 700 ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.6)';
  orbitCtx.beginPath();
  for (let i = 0; i < orb.n; i++) {
    const x = spots[i * 2];
    if (x === x && i !== skip) orbitCtx.rect(x * dpr, spots[i * 2 + 1] * dpr, size, size);
  }
  orbitCtx.fill();
}

// Where SGP4 and the network put the picked object at T, in km in SGP4's frame.
function placePicked(T) {
  const date = new Date(T), state = satellite.propagate(picked.satrec, date);
  if (!state || !state.position) return null;
  const { x, y, z } = state.position, v = state.velocity, r = [x, y, z], dt = (T - picked.epoch) / DAY_MS;
  const fix = table ? correctionAt(table, picked.norad, dt) : null;
  return { turnAt: satellite.gstime(date), sgp4: r, net: fix && applyCorrection(r, [v.x, v.y, v.z], fix), dt };
}

// Why the network has no answer, or null when it has one.
function netSilence(norad, dt) {
  if (!table || !table.n) return 'network: starts once two days of elements are stored';
  if (!table.index.has(norad)) return 'network: no stored history for this object';
  if (dt < table.horizons[0]) return 'network: pick a time at least a day past the elements';
  if (dt > table.horizons[table.horizons.length - 1]) return `network: stops ${table.horizons[table.horizons.length - 1]} days past the elements`;
  return null;
}

// Rotates a position in SGP4's frame into the Earth's.
const earthFixed = ([x, y, z], angle) => [x * Math.cos(angle) + y * Math.sin(angle), -x * Math.sin(angle) + y * Math.cos(angle), z];

function followPicked(p) {
  const at = p.net ? p.sgp4.map((x, i) => (x + p.net[i]) / 2) : p.sgp4, [x, y, z] = earthFixed(at, p.turnAt);
  view.yaw = Math.atan2(y, x); view.pitch = Math.asin(z / Math.hypot(x, y, z));
  dirty = true;
}

function mark(r, angle, ink) {
  const [ex, ey, ez] = earthFixed(r, angle), [x, y, z] = turn(ex, ey, ez);
  const k = radius() / RE, flat = (x * x + y * y) / (RE * RE);
  return { x: W / 2 + k * x, y: H / 2 - k * y, hidden: z < 0 && flat < 1, ink };
}

function caption(text, x, y, ink, alignRight) {
  const size = (W < 700 ? 11 : 12) * dpr;
  orbitCtx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
  orbitCtx.textBaseline = 'middle';
  const width = orbitCtx.measureText(text).width, px = (alignRight ? x - 8 : x + 8) * dpr - (alignRight ? width : 0), py = y * dpr;
  orbitCtx.fillStyle = '#000';
  orbitCtx.fillRect(px - 2 * dpr, py - size * .7, width + 4 * dpr, size * 1.4);
  orbitCtx.fillStyle = ink;
  orbitCtx.fillText(text, px, py);
}

function drawMarks(p) {
  const white = mark(p.sgp4, p.turnAt, SGP4_INK), green = p.net && mark(p.net, p.turnAt, NET_INK);
  if (green && !white.hidden && !green.hidden) {
    const apart = Math.hypot(white.x - green.x, white.y - green.y);
    if (apart > 2) {
      orbitCtx.strokeStyle = '#8c8c8c'; orbitCtx.lineWidth = dpr;
      orbitCtx.beginPath(); orbitCtx.moveTo(white.x * dpr, white.y * dpr); orbitCtx.lineTo(green.x * dpr, green.y * dpr); orbitCtx.stroke();
    }
    if (apart > 40) {
      const km = Math.hypot(...p.sgp4.map((x, i) => x - p.net[i]));
      caption(`${km.toFixed(1)} km`, (white.x + green.x) / 2, (white.y + green.y) / 2, SGP4_INK, false);
    }
  }
  const pair = [[white, 'sgp4'], [green, 'network']];
  // The two labels sit on opposite sides, so they stay readable while the points overlap.
  const sgp4OnRight = green && white.x > green.x;
  for (const [m, text] of pair) {
    if (!m || m.hidden) continue;
    orbitCtx.fillStyle = '#000';
    orbitCtx.fillRect((m.x - 5) * dpr, (m.y - 5) * dpr, 10 * dpr, 10 * dpr);
    orbitCtx.fillStyle = m.ink;
    orbitCtx.fillRect((m.x - 3) * dpr, (m.y - 3) * dpr, 6 * dpr, 6 * dpr);
    caption(text, m.x, m.y, m.ink, (text === 'sgp4') !== (sgp4OnRight || !green));
  }
}

function drawScale() {
  // Close in, the planet is a wall of glyphs behind the two points, so it recedes as the zoom grows.
  cv.style.opacity = Math.max(.3, 1 - .9 * Math.max(0, Math.log10(view.zoom / 2))).toFixed(2);
  const pxPerKm = radius() / RE, wanted = 100 / pxPerKm, unit = 10 ** Math.floor(Math.log10(wanted));
  const km = [1, 2, 5, 10].map(x => x * unit).find(x => x * pxPerKm >= 60) || unit;
  $('bar').style.width = `${(km * pxPerKm).toFixed(1)}px`;
  $('scale-text').textContent = `${km >= 1 ? km.toLocaleString('en-US') : km.toPrecision(1)} km`;
}

const latLon = (deg, plus, minus) => `${Math.abs(deg).toFixed(2).padStart(5)}${deg < 0 ? minus : plus}`;
function placeText(r, angle) {
  const spot = satellite.eciToGeodetic({ x: r[0], y: r[1], z: r[2] }, angle);
  const lat = spot.latitude / RAD, lon = ((spot.longitude / RAD + 540) % 360) - 180;
  return `${latLon(lat, 'N', 'S')} ${latLon(lon, 'E', 'W').padStart(7)} ${spot.height.toFixed(1)} km`;
}

function updateRead(T, p) {
  $('r-name').textContent = `${picked.label}  #${picked.norad}`;
  const dt = (T - picked.epoch) / DAY_MS;
  $('r-at').textContent = `${new Date(T).toISOString().slice(0, 16).replace('T', ' ')} UTC, ${dt.toFixed(1)} days past its elements`;
  $('r-sgp4').textContent = p ? `sgp4     ${placeText(p.sgp4, p.turnAt)}` : 'SGP4 cannot place this object at this time';
  const silence = netSilence(picked.norad, dt), net = $('r-net');
  net.className = p && p.net ? 't net' : 't m';
  net.textContent = p && p.net ? `network  ${placeText(p.net, p.turnAt)}` : silence || 'network: no answer at this time';
  $('r-gap-row').hidden = !(p && p.net);
  if (p && p.net) $('r-gap').textContent = `network moves it ${Math.hypot(...p.sgp4.map((x, i) => x - p.net[i])).toFixed(1)} km`;
  const misses = table && lastMisses(table, picked.norad);
  $('r-miss-row').hidden = !misses;
  if (misses) $('r-miss').textContent = `last 1-day miss: sgp4 ${misses[0].toFixed(1)} km, network ${misses[1].toFixed(1)} km`;
  $('r-zoom').textContent = p && p.net ? 'zoom to both' : 'zoom to it';
}

function applyClouds(T) {
  if (source === 'meteo') {
    modelShown = false;
    showFrame(T);
    const ok = weather && frameShown >= 0;
    $('cloud-note').firstChild.textContent = weather && !ok ? 'clear: the forecast does not reach this time' : '';
    return;
  }
  const today = meta.weather.today, match = new Date(T).toISOString().slice(0, 10) === today.date;
  if (match && !modelShown) { coverFrom(Uint8Array.from(today.cloud), null, 24, 48); modelShown = true; }
  if (!match) { cover = rain = null; modelShown = false; }
  frameShown = -1;
  $('cloud-note').firstChild.textContent = match ? `my model's daily mean for ${today.date}, no rain` : `clear: my model has only ${today.date}`;
}

function tick() {
  const T = clock();
  const before = cover;
  applyClouds(T);
  if (cover !== before) dirty = true;
  if (orb && !still) {
    orbitsAt(orb, T, pos, Math.floor(slice * orb.n / SLICES), Math.floor((slice + 1) * orb.n / SLICES));
    slice = (slice + 1) % SLICES;
  }
  const p = picked && placePicked(T);
  if (p && view.follow) followPicked(p);
  const nowMs = performance.now();
  if (dirty || (!still && nowMs - sunAt > SUN_MS)) { drawPlanet(T); drawScale(); sunAt = nowMs; }
  if (dirty || !still) {
    drawDots(T);
    if (p) drawMarks(p);
  }
  if (picked && (dirty || nowMs - readAt > READ_MS)) { updateRead(T, p); readAt = nowMs; }
  shownPlace = p;
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

function setTime(days) {
  offsetDays = days;
  for (const b of $('times').children) b.setAttribute('aria-pressed', String(+b.dataset.days === days));
  if (orb) orbitsAt(orb, clock(), pos);
  dirty = true;
}

function setSource(next) {
  source = next; frameShown = -1; modelShown = false;
  for (const b of $('sources').children) b.setAttribute('aria-pressed', String(b.dataset.source === next));
  dirty = true;
}

// The element file is gzip and raw.githubusercontent.com sends it as bytes, but a cache or proxy could already have opened it.
async function gunzip(buffer) {
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new TextDecoder().decode(buffer);
  return new Response(new Response(buffer).body.pipeThrough(new DecompressionStream('gzip'))).text();
}

function ensureCatalog() {
  if (!catalogLoad) {
    say('loading names');
    catalogLoad = ready.then(async () => {
      if (!meta || !meta.satellites) throw new Error('no forecast.json');
      const loaded = loadCatalog(await gunzip(await download(`${FORECAST}elements/${meta.satellites.as_of}.csv.gz`)));
      if (!orb || !alignsWith(loaded, orb)) throw new Error('names and dots differ');
      catalog = loaded;
      say('');
    }).catch(() => { catalog = null; say('names did not load, so satellites cannot be picked right now'); });
  }
  return catalogLoad;
}

// A correction file from another day belongs to other element sets, so it is left out.
function ensureNet() {
  if (!netLoad) {
    netLoad = download(`${FORECAST}corrections.bin`).then(buffer => {
      const loaded = loadCorrections(buffer);
      table = meta && meta.satellites && loaded.date === meta.satellites.as_of ? loaded : null;
    }).catch(() => { table = null; });
  }
  return netLoad;
}

async function pick(row) {
  await Promise.all([ensureCatalog(), ready.then(ensureNet)]);
  if (!catalog) return;
  picked = { row, norad: catalog.norads[row], label: catalog.names[row], epoch: catalog.epochs[row], satrec: satellite.json2satrec(elementRecord(catalog, row)) };
  const url = new URL(location.href);
  url.searchParams.set('sat', picked.norad);
  history.replaceState(null, '', url);
  $('hits').replaceChildren();
  $('find').value = '';
  say('');
  $('read').hidden = false;
  // The network has no point under a day past the elements, so the first pick lands on its first answer.
  if (!timeTouched && offsetDays === 0 && table && table.index.has(picked.norad) && (clock() - picked.epoch) / DAY_MS < table.horizons[0]) setTime(1);
  view.follow = true;
  view.zoom = Math.max(view.zoom, ZOOM_PICK);
  dirty = true;
}

function clearPick() {
  picked = null; shownPlace = null; view.follow = false;
  $('read').hidden = true;
  const url = new URL(location.href);
  url.searchParams.delete('sat');
  history.replaceState(null, '', url);
  dirty = true;
}

// Far enough in that the two points stand about 40% of the short screen side apart.
function zoomToPicked() {
  if (!picked || !shownPlace) return;
  view.follow = true;
  followPicked(shownPlace);
  if (shownPlace.net) {
    const a = turn(...earthFixed(shownPlace.sgp4, shownPlace.turnAt)), b = turn(...earthFixed(shownPlace.net, shownPlace.turnAt));
    view.zoom = clampZoom(1.11 * RE / Math.max(.01, Math.hypot(a[0] - b[0], a[1] - b[1])));
  } else view.zoom = Math.max(view.zoom, ZOOM_PICK);
}

function showHits(query) {
  const list = $('hits');
  list.replaceChildren();
  if (!catalog) return;
  const found = searchCatalog(catalog, query);
  say(query.trim() && !found.length ? 'no match' : '');
  for (const row of found) {
    const item = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${catalog.names[row]} #${catalog.norads[row]}`;
    b.addEventListener('click', () => pick(row));
    item.append(b);
    list.append(item);
  }
}

// Pointer: one finger or mouse turns, two pinch, a press that does not travel picks.
const pointers = new Map();
let pressX = 0, pressY = 0, travelled = 0, pinch = 0;

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
  if (!view.follow) {
    // Keeps the ground under the cursor in place.
    const gain = 1 / before - 1 / after, px = x - W / 2, py = y - H / 2;
    view.yaw += px * gain / Math.max(Math.cos(view.pitch), .2);
    view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch - py * gain));
  }
  dirty = true;
}

function dotAt(x, y, reach) {
  if (!orb) return -1;
  let best = -1, bestSq = reach * reach;
  for (let i = 0; i < orb.n; i++) {
    const dx = spots[i * 2] - x, dy = spots[i * 2 + 1] - y, sq = dx * dx + dy * dy;
    if (sq < bestSq) { bestSq = sq; best = i; }
  }
  return best;
}

stage.addEventListener('pointerdown', e => {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { pressX = e.clientX; pressY = e.clientY; travelled = 0; }
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); travelled = 99; }
  stage.classList.add('moving');
});
stage.addEventListener('pointermove', e => {
  const point = pointers.get(e.pointerId);
  if (!point) return;
  const dx = e.clientX - point.x, dy = e.clientY - point.y;
  point.x = e.clientX; point.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt(apart / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = apart;
    return;
  }
  travelled = Math.max(travelled, Math.hypot(e.clientX - pressX, e.clientY - pressY));
  if (travelled >= 5) { view.follow = false; nudge(dx, dy); }
});
function release(e) {
  const had = pointers.delete(e.pointerId);
  if (!pointers.size) stage.classList.remove('moving');
  pinch = 0;
  if (e.type !== 'pointerup' || !had || pointers.size || travelled >= 5) return;
  const row = dotAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 20 : 8);
  if (row >= 0) pick(row);
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
stage.addEventListener('keydown', e => {
  const step = radius() * .08, moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) { view.follow = false; nudge(...moves[e.key]); e.preventDefault(); } else if (e.key === '+' || e.key === '=') zoomAt(1.25, W / 2, H / 2);
  else if (e.key === '-' || e.key === '_') zoomAt(.8, W / 2, H / 2);
  else if (e.key === 'Escape') clearPick();
});

$('times').addEventListener('click', e => {
  if (e.target.dataset.days === undefined) return;
  timeTouched = true;
  setTime(+e.target.dataset.days);
});
$('sources').addEventListener('click', e => { if (e.target.dataset.source && !e.target.disabled) setSource(e.target.dataset.source); });
$('find').addEventListener('focus', ensureCatalog);
$('find').addEventListener('input', e => { const q = e.target.value; ensureCatalog().then(() => { if ($('find').value === q) showHits(q); }); });
$('find').addEventListener('keydown', e => {
  if (e.key === 'Enter' && catalog) { const first = searchCatalog(catalog, e.target.value, 1)[0]; if (first !== undefined) pick(first); else say('no match'); }
  if (e.key === 'Escape') { e.target.value = ''; $('hits').replaceChildren(); say(''); }
});
$('r-clear').addEventListener('click', clearPick);
$('r-zoom').addEventListener('click', zoomToPicked);

const dots = download(`${FORECAST}sats.bin`).catch(() => download('sats.bin')).then(buffer => {
  orb = loadOrbits(buffer);
  pos = new Float32Array(orb.n * 3); spots = new Float32Array(orb.n * 2).fill(NaN);
  orbitsAt(orb, clock(), pos);
  $('count').textContent = `${orb.n.toLocaleString('en-US')} objects, CelesTrak`;
  dirty = true;
}).catch(() => { $('count').textContent = 'satellites did not load'; });

const info = fetch(`${FORECAST}forecast.json`).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(data => {
  meta = data;
  const today = data.weather && data.weather.today, model = document.querySelector('[data-source=model]');
  if (today && today.net && Array.isArray(today.cloud) && today.cloud.length === 24 * 48) model.disabled = false;
  else model.textContent = 'my model: after the next daily run';
}).catch(() => { meta = null; });

const ready = Promise.all([dots, info]);

download(`${FORECAST}planet.bin`).then(buffer => { loadWeather(buffer); dirty = true; }).catch(() => {});

// A shared link opens on its object.
const asked = params.get('sat');
if (asked) {
  ensureCatalog().then(async () => {
    if (!catalog) return;
    const row = catalog.index.get(+asked);
    if (row === undefined) say(`no satellite with number ${asked}`);
    else await pick(row);
  });
}

new ResizeObserver(fit).observe(stage);
addEventListener('resize', fit);
fit();
requestAnimationFrame(loop);
