// The viewer's pure parts against numbers written by the pipeline's Python, so the two sides cannot drift apart.
// Fixtures come from forecast/drift.py and forecast/orbits.py; corrections-sample.bin is made from shifted copies of active-sample.csv.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { loadCorrections, correctionAt, lastMisses, applyCorrection } = require('../correct.js');
const { parseCsv, loadCatalog, alignsWith, searchCatalog, elementRecord } = require('../catalog.js');
const { loadOrbits } = require('../orbits.js');
const { MAP_TOP, ZOOM_MIN, mapPlace, mapCell, mapPoint, mapAt, gridIndex, fieldAt, seenFrom, chooseField, trackSegments, wrapYaw, percentGlyph, zoomForOrbit } = require('../mapmath.js');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, name));
const bytes = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const catalog = loadCatalog(read('active-sample.csv').toString());
// In this context, because the bundle checks instanceof Date.
const sgp4 = vm.runInThisContext(`(() => { ${read('../vendor/sgp4.js')}; return satellite; })()`);

function tinyTable() {
  const n = 2, buffer = new ArrayBuffer(28 + n * (4 + 24 + 4)), view = new DataView(buffer);
  new Uint8Array(buffer).set(Buffer.from('2026-11-20'));
  view.setUint32(12, n, true); view.setUint32(16, 4, true);
  [1, 3, 7, 15].forEach((h, i) => view.setUint16(20 + 2 * i, h, true));
  new Int32Array(buffer, 28, n).set([100, 200]);
  const grid = new Int16Array(buffer, 28 + 8, n * 12);
  for (let i = 0; i < 4; i++) grid.set([10 * (i + 1), 20 * (i + 1), -30 * (i + 1)], (4 + i) * 3);
  new Uint16Array(buffer, 28 + 8 + 48, 4).set([65535, 65535, 12, 9]);
  return loadCorrections(buffer);
}

test('reads the file the pipeline writes', () => {
  const want = JSON.parse(read('corrections-sample.json')), table = loadCorrections(bytes(read('corrections-sample.bin')));
  assert.equal(table.date, want.date);
  assert.equal(table.n, want.count);
  assert.deepStrictEqual(table.horizons, [1, 3, 7, 15]);
  for (const [h, km] of Object.entries(want.km)) {
    const got = correctionAt(table, want.norad, +h);
    km.forEach((x, axis) => assert.ok(Math.abs(got[axis] - x) <= .0501, `${h}d axis ${axis}: ${got[axis]} vs ${x}`));
  }
});

test('refuses a cut correction file', () => {
  const data = bytes(read('corrections-sample.bin'));
  assert.throws(() => loadCorrections(data.slice(0, data.byteLength - 4)), /size/);
  assert.throws(() => loadCorrections(new ArrayBuffer(10)), /size/);
});

test('a file with no objects has no answers', () => {
  const buffer = new ArrayBuffer(28), view = new DataView(buffer);
  view.setUint32(16, 4, true);
  [1, 3, 7, 15].forEach((h, i) => view.setUint16(20 + 2 * i, h, true));
  assert.equal(correctionAt(loadCorrections(buffer), 100, 3), null);
});

test('interpolates between horizons in dt squared and stays inside them', () => {
  const table = tinyTable();
  assert.deepStrictEqual(correctionAt(table, 200, 1), [1, 2, -3]);
  assert.deepStrictEqual(correctionAt(table, 200, 15), [4, 8, -12]);
  // k = (4 - 1) / (9 - 1) = .375 between 1 and 2 times the first row.
  const mid = correctionAt(table, 200, 2);
  [1.375, 2.75, -4.125].forEach((x, i) => assert.ok(Math.abs(mid[i] - x) < 1e-9));
  assert.equal(correctionAt(table, 200, .99), null);
  assert.equal(correctionAt(table, 200, 15.01), null);
  assert.equal(correctionAt(table, 999, 3), null);
});

test('reads whether the last forecast was checked', () => {
  const table = tinyTable();
  assert.equal(lastMisses(table, 100), null);
  assert.deepStrictEqual(lastMisses(table, 200), [1.2, .9]);
  assert.equal(lastMisses(table, 999), null);
});

test('a correction lands where the Python side measured the truth', () => {
  for (const { r, v, c, true: truth } of JSON.parse(read('curvilinear-vectors.json'))) {
    const got = applyCorrection(r, v, c);
    assert.ok(Math.hypot(got[0] - truth[0], got[1] - truth[1], got[2] - truth[2]) < .001, JSON.stringify({ got, truth }));
  }
});

test('the browser SGP4 matches the one the pipeline scores with', () => {
  for (const { norad, ms, r, v } of JSON.parse(read('sgp4-vectors.json'))) {
    const pv = sgp4.propagate(sgp4.json2satrec(elementRecord(catalog, catalog.index.get(norad))), new Date(ms));
    const { x, y, z } = pv.position, far = Math.hypot(x - r[0], y - r[1], z - r[2]);
    assert.ok(far < .001, `${norad} is ${far} km off`);
    assert.ok(Math.hypot(pv.velocity.x - v[0], pv.velocity.y - v[1], pv.velocity.z - v[2]) < 1e-5);
  }
});

test('parses quoted names and missing line ends', () => {
  assert.deepStrictEqual(parseCsv('a,"b, ""c"""\r\n1,2'), [['a', 'b, "c"'], ['1', '2']]);
});

test('finds by number first, then by name', () => {
  const norad = catalog.norads[5];
  assert.equal(searchCatalog(catalog, String(norad))[0], 5);
  const name = catalog.names[7].slice(0, 5).toLowerCase();
  const hits = searchCatalog(catalog, name.toUpperCase());
  assert.ok(hits.length >= 1 && hits.every(i => catalog.lower[i].includes(name)));
  assert.deepStrictEqual(searchCatalog(catalog, '   '), []);
  assert.deepStrictEqual(searchCatalog(catalog, 'no such object here'), []);
  assert.equal(searchCatalog(catalog, 'a', 3).length, 3);
});

test('only a catalog in the same order as the dots aligns', () => {
  const rows = catalog.rows, col = name => catalog.head.indexOf(name);
  const buffer = new ArrayBuffer(8 + rows.length * 32), f = new Float32Array(buffer, 8);
  rows.forEach((r, i) => f.set([0, r[col('MEAN_MOTION')], r[col('ECCENTRICITY')], r[col('INCLINATION')], r[col('RA_OF_ASC_NODE')], r[col('ARG_OF_PERICENTER')], r[col('MEAN_ANOMALY')], r[col('MEAN_MOTION_DOT')]], i * 8));
  const orb = loadOrbits(buffer);
  assert.ok(alignsWith(catalog, orb));
  const swapped = loadCatalog(read('active-sample.csv').toString());
  [swapped.anomalies[0], swapped.anomalies[1]] = [swapped.anomalies[1], swapped.anomalies[0]];
  assert.ok(!alignsWith(swapped, orb));
  assert.ok(!alignsWith({ ...catalog, rows: rows.slice(1) }, orb));
});

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const DEG = Math.PI / 180;

test('a map cell and its place round trip inside the clipped band', () => {
  const cols = 90, rows = 16;
  for (const [col, row] of [[0, 0], [89, 15], [45, 8], [14, 3]]) {
    const { lat, lon } = mapPlace(col, row, cols, rows);
    assert.ok(Math.abs(lat) < MAP_TOP && Math.abs(lon) < Math.PI);
    assert.deepStrictEqual(mapCell(lat, lon, cols, rows), { col, row });
  }
  // Row 0 is the north edge, as on any map.
  assert.ok(mapPlace(0, 0, cols, rows).lat > 0 && mapPlace(0, 15, cols, rows).lat < 0);
  assert.equal(mapCell(70 * DEG, 0, cols, rows), null);
  assert.equal(mapCell(-70 * DEG, 0, cols, rows), null);
  // Longitudes wrap rather than fall off the sides.
  assert.deepStrictEqual(mapCell(0, 3 * Math.PI, cols, rows), mapCell(0, Math.PI, cols, rows));
});

test('the nearest grid cell is the one the pipeline reports for a place', () => {
  assert.deepStrictEqual(gridIndex(48.75 * DEG, -71.25 * DEG), { row: 18, col: 14, index: 18 * 48 + 14 });
  assert.deepStrictEqual(gridIndex(45.5 * DEG, -73.57 * DEG), { row: 18, col: 14, index: 18 * 48 + 14 });
  assert.equal(gridIndex(-90 * DEG, -180 * DEG).index, 0);
  assert.equal(gridIndex(90 * DEG, 179.99 * DEG).index, 24 * 48 - 1);
});

test('the field reads between cells the way the globe does, and wraps at the date line', () => {
  const grid = new Float32Array(24 * 48);
  const at = (row, col) => row * 48 + col;
  grid[at(12, 0)] = 100; grid[at(12, 47)] = 0;
  // The centre of cell (12, 0) holds its own value.
  close(fieldAt(grid, (12.5 * 7.5 - 90) * DEG, (.5 * 7.5 - 180) * DEG), 100, 1e-4);
  // Half way across the date line, between cells 47 and 0.
  close(fieldAt(grid, (12.5 * 7.5 - 90) * DEG, 180 * DEG), 50, 1e-4);
  close(fieldAt(grid, (12.5 * 7.5 - 90) * DEG, -180 * DEG), 50, 1e-4);
  // Past the last row's centre the value holds.
  grid[at(23, 5)] = 40;
  close(fieldAt(grid, 89.9 * DEG, (5.5 * 7.5 - 180) * DEG), 40, 1e-4);
});

test('the lit window holds what the camera shows and moves with zoom and turn', () => {
  const view = { yaw: 0, pitch: 0 }, W = 400, H = 400;
  assert.ok(seenFrom(0, 0, view, 150, W, H));
  assert.ok(seenFrom(0, 80 * DEG, view, 150, W, H));
  assert.ok(!seenFrom(0, 100 * DEG, view, 150, W, H), 'behind the planet');
  // Zoomed in, the middle stays and the limb leaves the screen.
  assert.ok(seenFrom(0, 0, view, 2000, W, H));
  assert.ok(!seenFrom(0, 45 * DEG, view, 2000, W, H));
  // A turned camera sees the other side.
  assert.ok(seenFrom(0, 100 * DEG, { yaw: 90 * DEG, pitch: 0 }, 150, W, H));
  // Pitching up brings the north into view.
  assert.ok(seenFrom(60 * DEG, 0, { yaw: 0, pitch: 60 * DEG }, 2000, W, H));
  assert.ok(!seenFrom(-60 * DEG, 0, { yaw: 0, pitch: 60 * DEG }, 2000, W, H));
});

test('one weather field: the network for its own day, otherwise the forecast frame, otherwise none', () => {
  const today = { net: true, date: '2026-11-05', cloud: new Array(1152).fill(1) };
  assert.equal(chooseField(today, '2026-11-05', true), 'network');
  assert.equal(chooseField(today, '2026-11-05', false), 'network');
  assert.equal(chooseField(today, '2026-11-06', true), 'meteo', 'the network is a day behind before the daily job');
  assert.equal(chooseField({ ...today, net: false }, '2026-11-05', true), 'meteo');
  assert.equal(chooseField({ ...today, cloud: [1, 2] }, '2026-11-05', true), 'meteo');
  assert.equal(chooseField({ date: '2026-11-05' }, '2026-11-05', true), 'meteo');
  assert.equal(chooseField(null, '2026-11-05', true), 'meteo');
  assert.equal(chooseField(null, '2026-11-05', false), 'none');
  assert.equal(chooseField({ ...today, net: false }, '2026-11-05', false), 'none');
});

test('a ground track breaks at the date line and where it leaves the map', () => {
  const at = (lat, lon) => ({ lat: lat * DEG, lon: lon * DEG });
  const across = trackSegments([at(0, 170), at(1, 179), at(2, -179), at(3, -170)]);
  assert.deepStrictEqual(across.map(s => s.length), [2, 2]);
  const off = trackSegments([at(50, 0), at(60, 10), at(70, 20), at(75, 30), at(60, 40), at(50, 50)]);
  assert.deepStrictEqual(off.map(s => s.length), [2, 2]);
  assert.deepStrictEqual(trackSegments([]), []);
  // A lone point has no line to draw.
  assert.deepStrictEqual(trackSegments([at(0, 0)]), []);
});

test('the map turns the camera the short way round', () => {
  close(wrapYaw(0), 0);
  close(wrapYaw(3 * Math.PI / 2), -Math.PI / 2);
  close(wrapYaw(-3 * Math.PI / 2), Math.PI / 2);
  close(wrapYaw(5 * Math.PI), Math.PI);
});

test('each glyph stands for its share of the ramp and clear sky has none', () => {
  assert.equal(percentGlyph(0), -1);
  assert.equal(percentGlyph(4.9), -1);
  assert.equal(percentGlyph(5), 0);
  assert.equal(percentGlyph(50), 4);
  assert.equal(percentGlyph(99.9), 8);
  assert.equal(percentGlyph(100), 8);
});

test('picking a high orbit pulls the camera back far enough to hold it', () => {
  assert.equal(zoomForOrbit(.9, 1.1), 1, 'a low orbit stays at the whole planet');
  close(zoomForOrbit(6.6, 1), 1 / 6.6);
  // Never closer than the view already is when that already shows it.
  close(zoomForOrbit(2, .3), .3);
  assert.equal(zoomForOrbit(1000, 1), ZOOM_MIN, 'held at the zoom limit');
  assert.ok(ZOOM_MIN < 1 / 6.6, 'a geostationary ring fits');
});

test('a pixel of the map gives back the place drawn there, and stays on the map', () => {
  const lat = 45.5 * DEG, lon = -73.57 * DEG, { x, y } = mapPoint(lat, lon, 900, 330), back = mapAt(x, y, 900, 330);
  assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9);
  assert.deepEqual(mapAt(-50, -50, 900, 330), { lat: MAP_TOP, lon: -Math.PI });
  assert.deepEqual(mapAt(950, 400, 900, 330), { lat: -MAP_TOP, lon: Math.PI });
});

test('a place sits on the map where its cell is', () => {
  const { col, row } = mapCell(45.5 * DEG, -73.57 * DEG, 90, 16), { x, y } = mapPoint(45.5 * DEG, -73.57 * DEG, 900, 160);
  assert.equal(Math.floor(x / 10), col);
  assert.equal(Math.floor(y / 10), row);
});
