// The day's forecast on a flat map: height bands in colour, cloud as white glyphs, isobars and highs and lows from the pressure grid. The part of the Earth the camera sees stays bright.
'use strict';
const mapEl = $('map'), mapCv = $('map-glyphs'), mapCtx = mapCv.getContext('2d'), linesCv = $('map-lines'), linesCtx = linesCv.getContext('2d');
const INK_DIM = 2, INK_LIT = 4, DRAG_PX = 4, MARK_PX = 90;
// A band value for cells outside the Earth's outline: nothing is drawn there, so the page's black shows through.
const MAP_OFF = 255;
// A phone's map is too short for every line, so it draws half of them.
const isobarStep = () => (mapW < 500 ? 16 : 8);

let mapW = 0, mapH = 0, mapDpr = 0, mCols = 0, mRows = 0, mCw = 0, mCh = 0, mAtlas = null, mapKey = '';
let mLat, mLon, mBand, mLand, mGlyph, mLit, mShown;
// What colours the map: the day's temperature when the field has one and the visitor has not asked for terrain.
let wantTemp = true, layer = 'terrain';
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
  for (let i = 0; i < mGlyph.length; i++) mGlyph[i] = field.grid && mBand[i] !== MAP_OFF ? percentGlyph(fieldAt(field.grid, mLat[i], mLon[i], field.rows, field.cols)) : -1;
  mapKey = '';
}

// Each cell's colour index: sea and four heights for terrain, or seven temperature bands in a sea and a land tone.
function fillBands() {
  if (!mCols) return;
  for (let i = 0; i < mBand.length; i++) {
    if (mBand[i] === MAP_OFF) continue;
    mBand[i] = layer === 'temp' ? tempBand(fieldAt(field.temp, mLat[i], mLon[i], field.rows, field.cols)) * 2 + mLand[i] : mLand[i] ? 1 + terrainBand(mLat[i], mLon[i]) : 0;
  }
  mShown.fill(-1);
  mapKey = '';
}

// Picks the layer the field allows, then repaints the map's colours and its legend.
function applyLayer() {
  layer = wantTemp && field.temp ? 'temp' : 'terrain';
  $('layer-temp').hidden = !field.temp;
  $('layer-temp').setAttribute('aria-pressed', layer === 'temp');
  $('layer-terrain').setAttribute('aria-pressed', layer === 'terrain');
  fillBands();
  buildLegend();
}

function fitMap() {
  const w = mapEl.clientWidth, h = mapEl.clientHeight, ratio = scale();
  if (!w || !h || (w === mapW && h === mapH && ratio === mapDpr)) return;
  mapW = w; mapH = h; mapDpr = ratio;
  const fs = Math.max(5, Math.min(w / 120 / .6, 8)) * ratio, font = monoFont(fs);
  mapCv.width = linesCv.width = Math.round(w * ratio); mapCv.height = linesCv.height = Math.round(h * ratio);
  mapCtx.font = font;
  mCw = Math.ceil(mapCtx.measureText('M').width); mCh = Math.ceil(fs * 1.2);
  mCols = Math.floor(mapCv.width / mCw); mRows = Math.floor(mapCv.height / mCh);
  mAtlas = makeAtlas(font, mCw, mCh);
  const n = mCols * mRows;
  mLat = new Float32Array(n); mLon = new Float32Array(n); mBand = new Uint8Array(n); mLand = new Uint8Array(n); mGlyph = new Int8Array(n); mLit = new Uint8Array(n); mShown = new Int32Array(n).fill(-1);
  for (let row = 0, i = 0; row < mRows; row++) {
    for (let col = 0; col < mCols; col++, i++) {
      const place = mapPlace(col, row, mCols, mRows);
      if (!place) { mBand[i] = MAP_OFF; continue; }
      const { lat, lon } = place;
      mLat[i] = lat; mLon[i] = lon; mLand[i] = isLand(lat, lon) ? 1 : 0;
    }
  }
  fillBands();
  fillGlyphs();
  mapSource();
  dirty = true;
}

function drawMap() {
  if (!mCols) return;
  const key = `${view.yaw.toFixed(3)},${view.pitch.toFixed(3)},${view.zoom.toFixed(3)},${W},${H},${field.key},${layer},${tapped ? `${tapped.lat},${tapped.lon}` : ''},${mCols}`;
  if (key === mapKey) return;
  mapKey = key;
  const R = radius();
  let any = false;
  for (let i = 0; i < mLit.length; i++) { mLit[i] = mBand[i] !== MAP_OFF && seenFrom(mLat[i], mLon[i], view, R, W, H) ? 1 : 0; any = any || mLit[i] === 1; }
  // Zoomed in far enough, the view is smaller than a cell, and the window must not vanish.
  if (!any) {
    const at = mapCell(view.pitch, wrapYaw(view.yaw), mCols, mRows), cell = at.row * mCols + at.col;
    if (mBand[cell] !== MAP_OFF) mLit[cell] = 1;
  }
  // Cell index to ink for every cross: the cities, then the tapped place unless a city holds that cell.
  const crosses = new Map(MARKS.map(m => { const at = mapCell(m.lat, m.lon, mCols, mRows); return [at.row * mCols + at.col, m.ink]; }));
  const tap = tapped && mapCell(tapped.lat, tapped.lon, mCols, mRows);
  if (tap && !crosses.has(tap.row * mCols + tap.col)) crosses.set(tap.row * mCols + tap.col, INK_LIT);
  for (let i = 0; i < mGlyph.length; i++) {
    if (mBand[i] === MAP_OFF) continue;
    let glyph = mGlyph[i], ink = mLit[i] ? INK_LIT : INK_DIM, mark = 0;
    // A black tile and blank neighbours keep a one-cell mark readable inside a field of heavy glyphs.
    if (crosses.has(i)) { glyph = PLUS; ink = crosses.get(i); mark = 1; } else if (crosses.has(i - 1) || crosses.has(i + 1)) glyph = -1;
    const state = ((glyph + 1) * 64 + ink * 2 + mLit[i]) * 2 + mark;
    if (state === mShown[i]) continue;
    mShown[i] = state;
    const col = i % mCols, row = (i - col) / mCols, px = Math.round(col * mapCv.width / mCols), py = Math.round(row * mapCv.height / mRows);
    mapCtx.fillStyle = mark ? '#000' : (layer === 'temp' ? (mLit[i] ? TEMP_TONES : TEMP_TONES_DIM) : (mLit[i] ? BANDS : BANDS_DIM))[mBand[i]];
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
  const clearOfCities = MARKS.map(m => { const at = mapPoint(m.lat, m.lon, w, h); return { x: at.x - tileH, y: at.y - tileH, w: 2 * tileH, h: 2 * tileH }; });
  const marks = pressureMarks(field.pressure, field.rows, field.cols);
  for (const box of placeMarks(marks, w, h, mark => linesCtx.measureText(labelOf(mark)).width + size * .5, tileH, clearOfCities, Math.floor(mapW / MARK_PX))) {
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
  const words = modelWords(field.kind, field.nets, !!field.temp, !!field.pressure, settled, meta && meta.weather ? scoreFacts(meta.weather.losses) : null), net = $('map-net');
  net.hidden = !words.net;
  net.textContent = words.net;
  $('map-from').textContent = words.from;
  $('model-more').replaceChildren(...words.lines.map(text => infoLine(text)));
  $('legend-pressure').hidden = !field.pressure;
  $('legend-step').textContent = `pressure lines every ${isobarStep()} hPa`;
  renderToday();
  const label = field.kind === 'network' ? `Forecast map for ${field.date}, by our networks: ${sourceWords(field.nets, !!field.temp, !!field.pressure)}.` : field.kind === 'meteo' ? `Cloud forecast map from Open-Meteo for ${new Date(field.at).toISOString().slice(0, 16).replace('T', ' ')} UTC.` : words.from;
  mapEl.setAttribute('aria-label', `${label} ${$('map-text').textContent}`);
}

function infoLine(...parts) {
  const line = document.createElement('p');
  line.append(...parts);
  return line;
}

// Points the globe and the map at a place named in the text.
function flyTo(place) {
  aim = { yaw: place.lon, pitch: place.lat };
  tapped = place;
  mapReadout();
  dirty = true;
  mapEl.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
}

function placeButton(place) {
  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = placeWords(place.lat, place.lon);
  go.setAttribute('aria-label', `Show ${placeWords(place.lat, place.lon)} on the map`);
  go.addEventListener('click', () => flyTo(place));
  return go;
}

function renderToday() {
  const box = $('today-lines');
  if (!field.grid) {
    box.replaceChildren(infoLine(settled ? 'no forecast reached this page' : 'loading forecast'));
    return;
  }
  const facts = dayFacts(field.grid, field.temp, field.pressure, field.rows, field.cols);
  const when = field.kind === 'network' ? field.date : new Date(field.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const lines = [infoLine(when), infoLine(`world cloud ${Math.round(facts.cloud)}%`)];
  const fact = (name, value, place) => infoLine(`${name} ${value} `, placeButton(place));
  if (facts.hot) lines.push(fact('warmest', `${Math.round(facts.hot.value)}°C`, facts.hot), fact('coldest', `${Math.round(facts.cold.value)}°C`, facts.cold));
  if (facts.low) lines.push(fact('lowest pressure', `${Math.round(facts.low.value)}\u00a0hPa`, facts.low));
  if (facts.hot) lines.push(infoLine('daily means, cells about 800 km wide'));
  box.replaceChildren(...lines);
}

function buildLegend() {
  const list = $('legend'), swatch = (color, cls = 'sw') => { const box = document.createElement('i'); box.className = cls; box.style.background = color; return box; };
  const item = (...parts) => { const li = document.createElement('li'); li.append(...parts); list.append(li); return li; };
  list.replaceChildren();
  if (layer === 'temp') {
    ['under', ...TEMP_EDGES.slice(1).map(() => 'to'), 'over'].forEach((word, i) => item(swatch(TEMP_BANDS[i]), `${word} ${TEMP_EDGES[Math.min(i, TEMP_EDGES.length - 1)]}${i ? '' : '°C'}`.replace('-', '\u2212')));
    item(swatch(TEMP_TONES[6]), swatch(TEMP_TONES[7]), 'darker: sea');
  } else ['sea', 'under 300 m', 'to 1,000 m', 'to 2,500 m', 'higher'].forEach((name, i) => item(swatch(BANDS[i]), name));
  const ramp = document.createElement('span');
  ramp.className = 'ramp';
  ramp.style.background = layer === 'temp' ? TEMP_TONES[6] : BANDS[0];
  ramp.textContent = RAMP;
  item('cloud 0 ', ramp, ' 100%');
  const step = document.createElement('span');
  step.id = 'legend-step';
  item(swatch(layer === 'temp' ? TEMP_BANDS[3] : BANDS[1], 'sw line'), step, ', H high, L low').id = 'legend-pressure';
  item(swatch(layer === 'temp' ? TEMP_TONES_DIM[7] : BANDS_DIM[1]), swatch(layer === 'temp' ? TEMP_TONES[7] : BANDS[1]), 'bright: what the globe shows');
}

// The globe's own key, above the map: what the dots, colours and marks on the planet are.
function globeKey() {
  const list = $('globe-legend'), inked = (text, color) => { const span = document.createElement('span'); span.style.color = color; span.textContent = text; return span; };
  const swatch = color => { const box = document.createElement('i'); box.className = 'sw'; box.style.background = color; return box; };
  const item = (...parts) => { const li = document.createElement('li'); li.append(...parts); list.append(li); };
  list.replaceChildren();
  if (showDots && orb) item(inked('\u00b7 ', '#fff'), `satellite ${lead ? `in ${lead}\u00a0h` : 'now'}`);
  item(swatch(INKS[LAND + 2]), swatch(INKS[OCEAN + 2]), 'land, sea');
  item(swatch(INKS[CLOUD_LAND + 2]), swatch(INKS[CLOUD_SEA + 2]), 'paler: cloud');
  // Only Open-Meteo's frames carry rain.
  if (field.kind === 'meteo') item(inked('| ', INKS[OCEAN + 3]), 'rain');
  for (const { name, ink } of MARKS) item(inked('+ ', INKS[ink]), name);
  item('dark side: night');
}

// What the satellite lines say follows the forecast's lead time.
function fleetNote() {
  if (!orb) return;
  const count = `${orb.n.toLocaleString('en-US')} objects ${lead ? leadWords(lead, clock()) : 'now'}, CelesTrak`;
  if ($('count').textContent === count) return;
  $('count').textContent = count;
  $('fleet-each').textContent = dotWords(lead);
  $('fleet-miss').hidden = !lead;
  globeKey();
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
  applyLayer();
  globeKey();
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

function onOutline(e) {
  const box = mapEl.getBoundingClientRect();
  return mapOn(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
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
  if (!mapPress) { if (e.pointerType === 'mouse') showAt(onOutline(e) ? place : null); return; }
  if (!mapPress.dragging && Math.hypot(e.clientX - mapPress.x, e.clientY - mapPress.y) >= DRAG_PX) mapPress.dragging = true;
  if (mapPress.dragging) {
    aim = null; view.yaw = place.lon; view.pitch = place.lat; dirty = true;
    showAt(place);
  }
});
mapEl.addEventListener('pointerup', e => {
  if (mapPress && !mapPress.dragging && onOutline(e)) {
    const place = placeOnMap(e), cell = mapCell(place.lat, place.lon, mCols, mRows), here = hereCell();
    aim = { yaw: place.lon, pitch: place.lat };
    tapped = cell.col === here.col && cell.row === here.row ? null : place;
    mapReadout();
  }
  mapPress = null;
  if (e.pointerType !== 'mouse') hovered = null;
  mapReadout();
});
mapEl.addEventListener('pointercancel', () => { mapPress = null; hovered = null; mapReadout(); });
mapEl.addEventListener('pointerleave', () => { if (!mapPress) { hovered = null; mapReadout(); } });

const pickLayer = temp => () => { wantTemp = temp; applyLayer(); mapSource(); dirty = true; };
$('layer-temp').addEventListener('click', pickLayer(true));
$('layer-terrain').addEventListener('click', pickLayer(false));

// Where the page scrolls, a vertical swipe on the map has to scroll it instead of turning the globe.
function mapTouch() { mapEl.style.touchAction = document.documentElement.scrollHeight > innerHeight ? 'pan-y' : 'none'; }

const dots = download(`${FORECAST}sats.bin`).catch(() => download('sats.bin')).then(buffer => {
  orb = loadOrbits(buffer);
  pos = new Float32Array(orb.n * 3);
  orbitsAt(orb, shownAt(), pos);
  $('lead').hidden = !showDots;
  fleetNote();
  const fleet = fleetFacts(orb, RE);
  $('fleet-count').textContent = `${fleet.n.toLocaleString('en-US')} active satellites, from CelesTrak`;
  $('fleet-where').textContent = `${Math.round(fleet.lowShare * 100)}% in low orbit, one lap about ${Math.round(fleet.lapMin)}\u00a0minutes`;
  $('fleet-more').hidden = false;
  dirty = true;
}).catch(() => {
  $('count').textContent = $('fleet-count').textContent = 'satellites did not load';
  // Nothing to take away, unless the visitor already did.
  if (showDots) $('sats').hidden = true;
});
const info = fetch(`${FORECAST}forecast.json`).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(data => { meta = data; dirty = true; renderMethod(data); }).catch(() => { meta = null; renderMethod(null); });
const planetLoad = download(`${FORECAST}planet.bin`).then(buffer => { loadWeather(buffer); dirty = true; }).catch(() => {});
// Until both have answered the map says it is loading; after that, an empty map means nothing reached the page.
Promise.allSettled([info, planetLoad]).then(() => { settled = true; mapReadout(); mapSource(); });
new ResizeObserver(() => { fit(); fitMap(); mapTouch(); }).observe(document.documentElement);
new ResizeObserver(fit).observe(stage);
new ResizeObserver(fitMap).observe(mapEl);
addEventListener('resize', fit);
applyLayer(); globeKey(); fit(); fitMap(); mapReadout(); mapSource(); mapTouch(); requestAnimationFrame(loop);
