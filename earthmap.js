// The day's forecast on a flat map: height bands in colour, cloud as white glyphs, isobars and highs and lows from the pressure grid. The part of the Earth the camera sees stays bright.
'use strict';
const mapEl = $('map'), mapCv = $('map-glyphs'), mapCtx = mapCv.getContext('2d'), linesCv = $('map-lines'), linesCtx = linesCv.getContext('2d');
const INK_DIM = 2, INK_LIT = 4, DRAG_PX = 4, MARK_PX = 90;
// A phone's map is too short for every line, so it draws half of them.
const isobarStep = () => (mapW < 500 ? 16 : 8);

let mapW = 0, mapH = 0, mapDpr = 0, mCols = 0, mRows = 0, mCw = 0, mCh = 0, mAtlas = null, mapKey = '';
let mLat, mLon, mBand, mGlyph, mLit, mShown;
let field = { kind: 'none', key: 'none', date: null, grid: null, temp: null, pressure: null, nets: [], rows: GRID_ROWS, cols: GRID_COLS };
let settled = false, tapped = null, hovered = null, aim = null, mapPress = null, cloudsOwn = false, linesKey = '';

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const todayOf = data => (data && data.weather && data.weather.today) || null;
const frameAt = ms => {
  if (!weather) return -1;
  const f = Math.round((ms - weather.start) / weather.step);
  return f >= 0 && f < weather.frames ? f : -1;
};
const hereCell = () => mapCell(HERE_LAT, HERE_LON, mCols, mRows);

function fillGlyphs() {
  if (!mCols) return;
  for (let i = 0; i < mGlyph.length; i++) mGlyph[i] = field.grid ? percentGlyph(fieldAt(field.grid, mLat[i], mLon[i], field.rows, field.cols)) : -1;
  mapKey = '';
}

function fitMap() {
  const w = mapEl.clientWidth, h = mapEl.clientHeight, ratio = scale();
  if (!w || !h || (w === mapW && h === mapH && ratio === mapDpr)) return;
  mapW = w; mapH = h; mapDpr = ratio;
  const fs = Math.max(6, Math.min(w / 90 / .6, 10)) * ratio, font = monoFont(fs);
  mapCv.width = linesCv.width = Math.round(w * ratio); mapCv.height = linesCv.height = Math.round(h * ratio);
  mapCtx.font = font;
  mCw = Math.ceil(mapCtx.measureText('M').width); mCh = Math.ceil(fs * 1.2);
  mCols = Math.floor(mapCv.width / mCw); mRows = Math.floor(mapCv.height / mCh);
  mAtlas = makeAtlas(font, mCw, mCh);
  const n = mCols * mRows;
  mLat = new Float32Array(n); mLon = new Float32Array(n); mBand = new Uint8Array(n); mGlyph = new Int8Array(n); mLit = new Uint8Array(n); mShown = new Int32Array(n).fill(-1);
  for (let row = 0, i = 0; row < mRows; row++) {
    for (let col = 0; col < mCols; col++, i++) {
      const { lat, lon } = mapPlace(col, row, mCols, mRows);
      mLat[i] = lat; mLon[i] = lon; mBand[i] = isLand(lat, lon) ? 1 + terrainBand(lat, lon) : 0;
    }
  }
  fillGlyphs();
  mapSource();
  dirty = true;
}

function drawMap() {
  if (!mCols) return;
  const key = `${view.yaw.toFixed(3)},${view.pitch.toFixed(3)},${view.zoom.toFixed(3)},${W},${H},${field.key},${tapped ? `${tapped.lat},${tapped.lon}` : ''},${mCols}`;
  if (key === mapKey) return;
  mapKey = key;
  const R = radius();
  let any = false;
  for (let i = 0; i < mLit.length; i++) { mLit[i] = seenFrom(mLat[i], mLon[i], view, R, W, H) ? 1 : 0; any = any || mLit[i] === 1; }
  // Zoomed in far enough, the view is smaller than a cell, and the window must not vanish.
  if (!any) {
    const at = mapCell(Math.max(-MAP_TOP * .999, Math.min(MAP_TOP * .999, view.pitch)), wrapYaw(view.yaw), mCols, mRows);
    if (at) mLit[at.row * mCols + at.col] = 1;
  }
  const here = hereCell(), hereAt = here ? here.row * mCols + here.col : -1, tap = tapped && mapCell(tapped.lat, tapped.lon, mCols, mRows), tapAt = tap ? tap.row * mCols + tap.col : -1;
  for (let i = 0; i < mGlyph.length; i++) {
    let glyph = mGlyph[i], ink = mLit[i] ? INK_LIT : INK_DIM, mark = 0;
    // A black tile and blank neighbours keep a one-cell mark readable inside a field of heavy glyphs.
    if (i === hereAt) { glyph = PLUS; ink = HERE; mark = 1; } else if (i === tapAt) { glyph = PLUS; ink = INK_LIT; mark = 1; } else if (Math.abs(i - hereAt) === 1 || Math.abs(i - tapAt) === 1) glyph = -1;
    const state = ((glyph + 1) * 64 + ink * 2 + mLit[i]) * 2 + mark;
    if (state === mShown[i]) continue;
    mShown[i] = state;
    const col = i % mCols, row = (i - col) / mCols, px = Math.round(col * mapCv.width / mCols), py = Math.round(row * mapCv.height / mRows);
    mapCtx.fillStyle = mark ? '#000' : (mLit[i] ? BANDS : BANDS_DIM)[mBand[i]];
    mapCtx.fillRect(px, py, Math.round((col + 1) * mapCv.width / mCols) - px, Math.round((row + 1) * mapCv.height / mRows) - py);
    if (glyph >= 0) mapCtx.drawImage(mAtlas, glyph * mCw, ink * mCh, mCw, mCh, px, py, mCw, mCh);
  }
  drawIsobars();
}

// Redrawn only when the field or the map's size changes: the lines stay still while the window moves under them.
function drawIsobars() {
  const key = `${field.key},${linesCv.width},${linesCv.height}`;
  if (key === linesKey) return;
  linesKey = key;
  const w = linesCv.width, h = linesCv.height;
  linesCtx.clearRect(0, 0, w, h);
  if (!field.pressure) return;
  const runs = contours(field.pressure, isobarStep(), field.rows, field.cols);
  linesCtx.strokeStyle = '#000';
  linesCtx.lineWidth = 1.25 * mapDpr;
  linesCtx.beginPath();
  for (let k = 0; k < runs.length; k += 4) {
    linesCtx.moveTo(runs[k] * w, runs[k + 1] * h);
    linesCtx.lineTo(runs[k + 2] * w, runs[k + 3] * h);
  }
  linesCtx.stroke();
  const size = Math.round(Math.max(10, Math.min(w / mapDpr / 60, 14)) * mapDpr);
  linesCtx.font = monoFont(size);
  linesCtx.textBaseline = 'middle';
  const labelOf = mark => `${mark.kind}${Math.round(mark.value)}`, tileH = size * 1.4;
  const here = mapPoint(HERE_LAT, HERE_LON, w, h), clearOfHere = { x: here.x - tileH, y: here.y - tileH, w: 2 * tileH, h: 2 * tileH };
  const marks = pressureMarks(field.pressure, field.rows, field.cols);
  for (const box of placeMarks(marks, w, h, mark => linesCtx.measureText(labelOf(mark)).width + size * .5, tileH, clearOfHere, Math.floor(mapW / MARK_PX))) {
    linesCtx.fillStyle = '#000';
    linesCtx.fillRect(box.x, box.y, box.w, box.h);
    linesCtx.fillStyle = '#f2f2f2';
    linesCtx.fillText(labelOf(box.mark), box.x + size * .25, box.y + tileH / 2);
  }
}

const degrees = (deg, plus, minus) => `${Math.abs(deg).toFixed(1)}${deg < 0 ? minus : plus}`;

function mapReadout() {
  const at = hovered || tapped, today = todayOf(meta);
  let mark = true, text;
  if (at) {
    mark = false;
    text = `${degrees(at.lat / RAD, 'N', 'S')} ${degrees(at.lon / RAD, 'E', 'W')}`;
    if (field.grid) {
      const { index } = gridIndex(at.lat, at.lon, field.rows, field.cols);
      text += `  cloud ${Math.round(field.grid[index])}%`;
      if (field.temp) text += `  ${field.temp[index]}°C`;
      if (field.pressure) text += `  ${Math.round(field.pressure[index])} hPa`;
    }
  } else if (field.kind === 'network') {
    const place = (today.places || []).find(p => /montr/i.test(p.place));
    text = place ? `Montréal  cloud ${Math.round(place.cloud)}%  ${Math.round(place.temp)}°C` : 'Montréal';
  } else if (field.kind === 'meteo') {
    text = `Montréal  cloud ${Math.round(field.grid[gridIndex(HERE_LAT, HERE_LON, field.rows, field.cols).index])}%`;
  } else text = 'Montréal';
  $('map-mark').hidden = !mark;
  $('map-text').textContent = text;
}

function mapSource() {
  $('map-net').hidden = field.kind !== 'network';
  let from = settled ? 'no forecast reached this page' : 'loading forecast', label = from, day = null;
  if (field.kind === 'network') {
    from = `${sourceWords(field.nets, !!field.temp, !!field.pressure)}, `;
    // A narrow column would otherwise break the date at its hyphens.
    day = document.createElement('span');
    day.style.whiteSpace = 'nowrap';
    day.textContent = field.date;
    label = `Forecast map for ${field.date} from the network.`;
  } else if (field.kind === 'meteo') {
    from = `open-meteo forecast, ${new Date(field.at).toISOString().slice(11, 16)} UTC`;
    label = `Cloud forecast map from Open-Meteo for ${new Date(field.at).toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
  }
  $('map-from').replaceChildren(from, ...(day ? [day] : []));
  $('legend').textContent = `0 .:-=+*#%@ 100${field.pressure ? `  lines ${isobarStep()} hPa` : ''}`;
  mapEl.setAttribute('aria-label', `${label} ${$('map-text').textContent}`);
}

function refreshField() {
  const real = still ? opened : now(), today = todayOf(meta), frame = frameAt(real), kind = chooseField(today, isoDay(real), frame >= 0);
  const key = kind === 'network' ? `n${today.date}` : kind === 'meteo' ? `m${frame}` : 'none';
  if (key === field.key) return;
  field = { kind, key, date: null, grid: null, temp: null, pressure: null, nets: [], rows: GRID_ROWS, cols: GRID_COLS };
  if (kind === 'network') {
    field.date = today.date;
    field.grid = today.cloud;
    field.temp = Array.isArray(today.temp) && today.temp.length === today.cloud.length ? today.temp : null;
    // A file with no list predates the temperature and pressure networks, and only its cloud came from a network.
    field.nets = Array.isArray(today.networks) ? today.networks : ['cloud'];
    field.pressure = field.nets.includes('pressure') && Array.isArray(today.pressure) && today.pressure.length === today.cloud.length ? today.pressure : null;
  } else if (kind === 'meteo') {
    const cells = weather.rows * weather.columns;
    field.grid = weather.data.subarray(frame * cells, (frame + 1) * cells);
    field.rows = weather.rows; field.cols = weather.columns;
    field.at = weather.start + frame * weather.step;
  }
  cloudsOwn = false;
  fillGlyphs();
  mapReadout();
  mapSource();
  dirty = true;
}

// The globe shows the map's own day; past it, Open-Meteo's frames while they last, and the note says so.
function applyClouds(T) {
  const note = $('cloud-note');
  let text = '';
  if (field.kind === 'network' && isoDay(T) === field.date) {
    if (!cloudsOwn) { coverFrom(Uint8Array.from(field.grid), null, field.rows, field.cols); cloudsOwn = true; frameShown = -1; }
  } else {
    cloudsOwn = false;
    showFrame(T);
    if (!weather || frameShown < 0) { if (cover || rain) { cover = rain = null; } } else if (field.kind === 'network') text = `open-meteo clouds past ${field.date}`;
  }
  if (note.textContent !== text) { note.textContent = text; note.hidden = !text; }
}

function stepAim() {
  if (!aim) return;
  const yaw = wrapYaw(aim.yaw - view.yaw), pitch = aim.pitch - view.pitch;
  if (still || Math.abs(yaw) + Math.abs(pitch) < .002) { view.yaw = aim.yaw; view.pitch = aim.pitch; aim = null; } else { view.yaw += yaw * .3; view.pitch += pitch * .3; }
  dirty = true;
}

function placeOnMap(e) {
  const box = mapEl.getBoundingClientRect();
  return mapAt(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
}

function showAt(place) { hovered = place; mapReadout(); }

mapEl.addEventListener('pointerdown', e => {
  if (e.button) return;
  mapEl.setPointerCapture(e.pointerId);
  mapPress = { x: e.clientX, y: e.clientY, dragging: false };
  $('hint').hidden = true;
});
mapEl.addEventListener('pointermove', e => {
  const place = placeOnMap(e);
  if (!mapPress) { if (e.pointerType === 'mouse') showAt(place); return; }
  if (!mapPress.dragging && Math.hypot(e.clientX - mapPress.x, e.clientY - mapPress.y) >= DRAG_PX) mapPress.dragging = true;
  if (mapPress.dragging) {
    aim = null; view.yaw = place.lon; view.pitch = place.lat; dirty = true;
    showAt(place);
  }
});
mapEl.addEventListener('pointerup', e => {
  if (mapPress && !mapPress.dragging) {
    const place = placeOnMap(e), cell = mapCell(place.lat, place.lon, mCols, mRows), here = hereCell();
    aim = { yaw: place.lon, pitch: place.lat };
    tapped = cell && here && cell.col === here.col && cell.row === here.row ? null : place;
    mapReadout();
  }
  mapPress = null;
  if (e.pointerType !== 'mouse') hovered = null;
  mapReadout();
});
mapEl.addEventListener('pointercancel', () => { mapPress = null; hovered = null; mapReadout(); });
mapEl.addEventListener('pointerleave', () => { if (!mapPress) { hovered = null; mapReadout(); } });

// Where the page scrolls, a vertical swipe on the map has to scroll it instead of turning the globe.
function mapTouch() { mapEl.style.touchAction = document.documentElement.scrollHeight > innerHeight ? 'pan-y' : 'none'; }

const dots = download(`${FORECAST}sats.bin`).catch(() => download('sats.bin')).then(buffer => {
  orb = loadOrbits(buffer);
  pos = new Float32Array(orb.n * 3);
  orbitsAt(orb, clock(), pos);
  $('count').textContent = `${orb.n.toLocaleString('en-US')} objects, CelesTrak`;
  dirty = true;
}).catch(() => { $('count').textContent = 'satellites did not load'; });
const info = fetch(`${FORECAST}forecast.json`).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(data => { meta = data; dirty = true; }).catch(() => { meta = null; });
const planetLoad = download(`${FORECAST}planet.bin`).then(buffer => { loadWeather(buffer); dirty = true; }).catch(() => {});
// Until both have answered the map says it is loading; after that, an empty map means nothing reached the page.
Promise.allSettled([info, planetLoad]).then(() => { settled = true; mapReadout(); mapSource(); });
new ResizeObserver(() => { fit(); fitMap(); mapTouch(); }).observe(document.documentElement);
new ResizeObserver(fit).observe(stage);
new ResizeObserver(fitMap).observe(mapEl);
addEventListener('resize', fit);
fit(); fitMap(); mapReadout(); mapTouch(); requestAnimationFrame(loop);
