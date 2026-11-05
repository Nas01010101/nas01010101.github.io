// The viewer's pure parts against numbers written by the pipeline's Python, so the two sides cannot drift apart.
// Fixtures come from forecast/drift.py and forecast/orbits.py; corrections-sample.bin is made from shifted copies of active-sample.csv.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { loadCorrections, correctionAt, lastMisses, applyCorrection } = require('../correct.js');
const { parseCsv, loadCatalog, alignsWith, searchCatalog, elementRecord } = require('../catalog.js');
const { loadOrbits } = require('../orbits.js');
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
