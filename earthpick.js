// One object: its orbit, its ground track, and where SGP4 and the network put it. The page starts at the end of this file.
'use strict';
const TRACK_POINTS = 160, TRACK_MS = 1000, RING_ZOOM_MAX = 50, TIME_MAX = 7, TIME_STEP = .05;
let netTrouble = '';

// Where SGP4 and the network put the picked object at T, in km in SGP4's frame.
function placePicked(T) {
  const date = new Date(T), state = satellite.propagate(picked.satrec, date);
  if (!state || !state.position) return null;
  const { x, y, z } = state.position, v = state.velocity, r = [x, y, z], velocity = [v.x, v.y, v.z], dt = (T - picked.epoch) / DAY_MS;
  const fix = table ? correctionAt(table, picked.norad, dt) : null;
  return { turnAt: satellite.gstime(date), sgp4: r, v: velocity, net: fix && applyCorrection(r, velocity, fix), dt };
}

// Why the network has no answer, or null when it has one.
function netSilence(norad, dt) {
  if (!table) return netTrouble;
  if (!table.n) return 'network: starts once two days of elements are stored';
  if (!table.index.has(norad)) return 'network: no stored history for this object';
  if (dt < table.horizons[0]) return 'network: pick a time at least a day past the elements';
  if (dt > table.horizons[table.horizons.length - 1]) return `network: stops ${table.horizons[table.horizons.length - 1]} days past the elements`;
  return null;
}

// Rotates a position in SGP4's frame into the Earth's.
const earthFixed = ([x, y, z], angle) => [x * Math.cos(angle) + y * Math.sin(angle), -x * Math.sin(angle) + y * Math.cos(angle), z];

const groundPoint = (r, angle) => {
  const spot = satellite.eciToGeodetic({ x: r[0], y: r[1], z: r[2] }, angle);
  return { lat: spot.latitude, lon: wrapYaw(spot.longitude) };
};

// One period centred on T: positions for the ring, ground points for the map.
function refreshTrack(T) {
  if (!picked) { track = null; return; }
  if (track && track.row === picked.row && Math.abs(T - track.at) < TRACK_MS) return;
  const rec = picked.satrec;
  if (!(rec.no > 0)) { track = null; return; }
  const period = TAU / rec.no * 60000, ring = [], points = [];
  let rMax = 1;
  for (let i = 0; i < TRACK_POINTS; i++) {
    const date = new Date(T + (i / TRACK_POINTS - .5) * period), state = satellite.propagate(rec, date);
    if (!state || !state.position) continue;
    const { x, y, z } = state.position, r = [x, y, z];
    ring.push(r);
    points.push(groundPoint(r, satellite.gstime(date)));
    rMax = Math.max(rMax, Math.hypot(x, y, z) / RE);
  }
  track = { row: picked.row, at: T, ring, runs: trackSegments(points), rMax };
}

function followPicked(p) {
  const at = p.net ? p.sgp4.map((x, i) => (x + p.net[i]) / 2) : p.sgp4, [x, y, z] = earthFixed(at, p.turnAt);
  const size = Math.hypot(x, y, z);
  // Zoomed out, the camera leans out of the orbit's plane, so the ring reads as an ellipse and not a line.
  const lean = .5 * (1 - smooth(1, 3, view.zoom));
  let nx = 0, ny = 0, nz = 0;
  if (lean > 0) {
    const [a, b, d] = at, [u, v, w] = p.v;
    [nx, ny, nz] = earthFixed([b * w - d * v, d * u - a * w, a * v - b * u], p.turnAt);
    const pole = Math.hypot(nx, ny, nz) || 1;
    nx /= pole; ny /= pole; nz /= pole;
  }
  const cx = x / size + lean * nx, cy = y / size + lean * ny, cz = z / size + lean * nz;
  view.yaw = Math.atan2(cy, cx); view.pitch = Math.asin(cz / Math.hypot(cx, cy, cz));
  dirty = true;
}

function mark(r, angle, ink) {
  const [ex, ey, ez] = earthFixed(r, angle), [x, y, z] = turn(ex, ey, ez);
  const k = radius() / RE, flat = (x * x + y * y) / (RE * RE);
  return { x: W / 2 + k * x, y: H / 2 - k * y, hidden: z < 0 && flat < 1, ink };
}

function caption(text, x, y, ink, alignRight) {
  const size = (W < 700 ? 11 : 12) * dpr;
  orbitCtx.font = monoFont(size);
  orbitCtx.textBaseline = 'middle';
  const width = orbitCtx.measureText(text).width, px = (alignRight ? x - 8 : x + 8) * dpr - (alignRight ? width : 0), py = y * dpr;
  orbitCtx.fillStyle = '#000';
  orbitCtx.fillRect(px - 2 * dpr, py - size * .7, width + 4 * dpr, size * 1.4);
  orbitCtx.fillStyle = ink;
  orbitCtx.fillText(text, px, py);
}

function drawRing(p) {
  // Past this zoom the ring runs off screen by thousands of pixels and its chords stray across the view.
  if (!track || track.ring.length < 2 || view.zoom > RING_ZOOM_MAX) return;
  orbitCtx.strokeStyle = RING_INK; orbitCtx.lineWidth = dpr;
  orbitCtx.beginPath();
  let pen = false;
  for (const r of [...track.ring, track.ring[0]]) {
    const m = mark(r, p.turnAt);
    if (m.hidden) { pen = false; continue; }
    if (pen) orbitCtx.lineTo(m.x * dpr, m.y * dpr); else orbitCtx.moveTo(m.x * dpr, m.y * dpr);
    pen = true;
  }
  orbitCtx.stroke();
}

function drawMarks(p) {
  const white = mark(p.sgp4, p.turnAt, SGP4_INK), green = p.net && mark(p.net, p.turnAt, NET_INK);
  if (green && !white.hidden && !green.hidden) {
    const apart = Math.hypot(white.x - green.x, white.y - green.y);
    if (apart > 2) {
      orbitCtx.strokeStyle = RING_INK; orbitCtx.lineWidth = dpr;
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

const latLon = (deg, plus, minus) => `${Math.abs(deg).toFixed(2).padStart(5)}${deg < 0 ? minus : plus}`;
function placeText(r, angle) {
  const spot = satellite.eciToGeodetic({ x: r[0], y: r[1], z: r[2] }, angle);
  const lat = spot.latitude / RAD, lon = ((spot.longitude / RAD + 540) % 360) - 180;
  return `${latLon(lat, 'N', 'S')} ${latLon(lon, 'E', 'W').padStart(7)} ${spot.height.toFixed(1)} km`;
}

function updateRead(T, p) {
  $('r-name').textContent = `${picked.label}  #${picked.norad}`;
  const dt = (T - picked.epoch) / DAY_MS;
  $('r-at').textContent = `${new Date(T).toISOString().slice(0, 16).replace('T', ' ')} UTC, ${dt.toFixed(1)} d past elements`;
  $('r-sgp4').textContent = p ? `sgp4     ${placeText(p.sgp4, p.turnAt)}` : 'SGP4 cannot place this object at this time';
  const silence = netSilence(picked.norad, dt), net = $('r-net');
  net.className = p && p.net ? 'net' : 'm';
  net.textContent = p && p.net ? `network  ${placeText(p.net, p.turnAt)}` : silence || 'network: no answer at this time';
  $('r-gap-row').hidden = !(p && p.net);
  if (p && p.net) $('r-gap').textContent = `gap      ${Math.hypot(...p.sgp4.map((x, i) => x - p.net[i])).toFixed(1)} km`;
  const misses = table && lastMisses(table, picked.norad);
  $('r-miss-row').hidden = !misses;
  if (misses) $('r-miss').textContent = `1-day miss  sgp4 ${misses[0].toFixed(1)}, network ${misses[1].toFixed(1)} km`;
  $('r-zoom').textContent = view.zoom > 2 ? 'whole orbit' : p && p.net ? 'zoom to both' : 'zoom to it';
}

function setTime(days) {
  offsetDays = days;
  const when = $('when'), text = days ? `+${days.toFixed(1)} d` : 'now';
  when.value = days;
  when.setAttribute('aria-valuetext', days ? `${days.toFixed(1)} days ahead` : 'now');
  $('r-plus').textContent = text;
  moved = true;
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
    }).catch(() => { catalog = null; say(orb ? 'names did not load, so none can be picked right now' : 'satellites did not load, so none can be picked right now'); });
  }
  return catalogLoad;
}

// A correction file from another day belongs to other element sets, so it is left out.
function ensureNet() {
  if (!netLoad) {
    netLoad = download(`${FORECAST}corrections.bin`).then(buffer => {
      const loaded = loadCorrections(buffer);
      table = meta && meta.satellites && loaded.date === meta.satellites.as_of ? loaded : null;
      if (!table) netTrouble = 'network: no corrections for these elements yet';
    }).catch(why => {
      table = null;
      netTrouble = why === 404 ? 'network: no corrections published yet' : 'network: corrections did not load';
    });
  }
  return netLoad;
}

async function pick(row) {
  await Promise.all([ensureCatalog(), ready.then(ensureNet)]);
  if (!catalog) return;
  picked = { row, norad: catalog.norads[row], label: catalog.names[row], epoch: catalog.epochs[row], satrec: satellite.json2satrec(elementRecord(catalog, row)) };
  track = null;
  const url = new URL(location.href);
  url.searchParams.set('sat', picked.norad);
  history.replaceState(null, '', url);
  $('hits').replaceChildren();
  $('find').value = '';
  say('');
  $('read').hidden = false;
  $('hint').hidden = true;
  // The network has no point under a day past the elements, so the first pick lands on its first answer.
  const dt = (clock() - picked.epoch) / DAY_MS;
  if (!timeTouched && table && table.index.has(picked.norad) && dt < table.horizons[0]) setTime(Math.min(TIME_MAX, offsetDays + Math.ceil((table.horizons[0] - dt) / TIME_STEP + 1e-9) * TIME_STEP));
  refreshTrack(clock());
  aim = null;
  view.follow = true;
  view.zoom = zoomForOrbit(track ? track.rMax : 1, view.zoom);
  dirty = true;
}

function clearPick() {
  if (!picked) return;
  picked = null; shownPlace = null; track = null; view.follow = false; timeTouched = false;
  $('read').hidden = true;
  setTime(0);
  const url = new URL(location.href);
  url.searchParams.delete('sat');
  history.replaceState(null, '', url);
  dirty = true;
}

// Far enough in that the two points stand about 40% of the short screen side apart; pressed again, back out to the orbit.
function zoomToPicked() {
  if (!picked || !shownPlace) return;
  view.follow = true;
  if (view.zoom > 2) view.zoom = zoomForOrbit(track ? track.rMax : 1, 1);
  else if (shownPlace.net) {
    const a = turn(...earthFixed(shownPlace.sgp4, shownPlace.turnAt)), b = turn(...earthFixed(shownPlace.net, shownPlace.turnAt));
    view.zoom = clampZoom(.91 * RE / Math.max(.01, Math.hypot(a[0] - b[0], a[1] - b[1])));
  } else view.zoom = ZOOM_CLOSE;
  dirty = true;
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

$('when').addEventListener('input', e => { timeTouched = true; setTime(+e.target.value); });
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
}).catch(() => { $('count').textContent = 'satellites did not load'; $('hint').textContent = 'drag to turn'; });

const info = fetch(`${FORECAST}forecast.json`).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(data => { meta = data; dirty = true; }).catch(() => { meta = null; });
const planetLoad = download(`${FORECAST}planet.bin`).then(buffer => { loadWeather(buffer); dirty = true; }).catch(() => {});
const ready = Promise.all([dots, info]);

// Until both have answered the map says it is loading; after that, an empty map means nothing reached the page.
Promise.allSettled([info, planetLoad]).then(() => { settled = true; mapReadout(); mapSource(); });

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

new ResizeObserver(() => { fit(); fitMap(); mapTouch(); }).observe(document.documentElement);
new ResizeObserver(fit).observe(stage);
new ResizeObserver(fitMap).observe(mapEl);
addEventListener('resize', fit);
fit();
fitMap();
mapReadout();
mapTouch();
requestAnimationFrame(loop);
