// Compares orbits.js with SGP4 one day past the fixture's download.
// Run: npm i --no-save satellite.js@7.1.0 && node --test tests/
// SATS_CSV=<path> measures a full download instead of the sample.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { json2satrec, propagate } = require('satellite.js');
const { loadOrbits, orbitsAt, RE } = require('../orbits.js');

const AT = Date.parse('2026-11-04T17:00Z');
const parse = text => {
  const [head, ...lines] = text.trim().split('\n').map(l => l.split(','));
  return lines.map(l => Object.fromEntries(head.map((k, i) => [k, l[i]])));
};
function pack(rows) {
  const ms = r => Date.parse(r.EPOCH + 'Z'), base = Math.max(...rows.map(ms));
  const buf = new ArrayBuffer(8 + rows.length * 32);
  new DataView(buf).setFloat64(0, base, true);
  const f = new Float32Array(buf, 8);
  rows.forEach((r, i) => f.set([(ms(r) - base) / 1000, r.MEAN_MOTION, r.ECCENTRICITY, r.INCLINATION, r.RA_OF_ASC_NODE, r.ARG_OF_PERICENTER, r.MEAN_ANOMALY, r.MEAN_MOTION_DOT], i * 8));
  return buf;
}
function errors(rows, AT = Date.parse('2026-11-04T17:00Z')) {
  const o = loadOrbits(pack(rows)), out = new Float32Array(o.n * 3);
  orbitsAt(o, AT, out);
  const low = [], high = [];
  rows.forEach((r, i) => {
    const sat = json2satrec(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /NAME|ID$|EPOCH|TYPE$/.test(k) && k !== 'NORAD_CAT_ID' ? v : +v])));
    const pv = propagate(sat, new Date(AT));
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return; // SGP4 itself gave up, e.g. decayed.
    const km = Math.hypot(out[i * 3] * RE - pv.position.x, out[i * 3 + 1] * RE - pv.position.y, out[i * 3 + 2] * RE - pv.position.z);
    (+r.MEAN_MOTION > 6 ? low : high).push(km);
  });
  const q = (a, p) => a.sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
  return { low: { n: low.length, p50: q(low, .5), p95: q(low, .95), max: q(low, 1) }, high: { n: high.length, p50: q(high, .5), p95: q(high, .95), max: q(high, 1) } };
}

test('stays within a drawn cell of SGP4', () => {
  const file = process.env.SATS_CSV || path.join(__dirname, 'active-sample.csv');
  const e = errors(parse(fs.readFileSync(file, 'utf8')));
  console.log(JSON.stringify(e));
  // One 8.4px cell on a 274px Earth is about 196 km.
  assert.ok(e.low.p50 < 196, `low orbit median ${e.low.p50} km`);
  assert.ok(e.low.p95 < 196, `low orbit p95 ${e.low.p95} km`);
  assert.ok(e.high.p95 < 196, `high orbit p95 ${e.high.p95} km`);
});

// The page forecasts up to a day ahead from elements up to a day old, and tells the visitor 20 km.
test('a forecast two days past the elements stays within 20 km of SGP4 for 95%', () => {
  const rows = parse(fs.readFileSync(path.join(__dirname, 'active-sample.csv'), 'utf8')), base = Math.max(...rows.map(r => Date.parse(r.EPOCH + 'Z')));
  for (const hours of [1, 6, 24, 48]) {
    const e = errors(rows, base + hours * 36e5), all = Math.max(e.low.p95, e.high.p50);
    assert.ok(e.low.p95 < 20, `+${hours} h low orbit p95 ${e.low.p95} km`);
    assert.ok(all < 30, `+${hours} h high orbit median ${e.high.p50} km`);
  }
});

test('reads the packed layout', () => {
  const o = loadOrbits(pack(parse(fs.readFileSync(path.join(__dirname, 'active-sample.csv'), 'utf8'))));
  assert.ok(o.n > 100);
  assert.ok(o.a.every(a => a > 1 && a < 40), 'semi-major axis in Earth radii');
});

test('a slice writes only its own satellites, with the values of a full pass', () => {
  const buffer = fs.readFileSync(path.join(__dirname, '..', 'sats.bin')), o = loadOrbits(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
  const full = new Float32Array(o.n * 3), part = new Float32Array(o.n * 3), to = Math.floor(o.n / 15), ms = o.base + 36e5;
  orbitsAt(o, ms, full);
  orbitsAt(o, ms, part, 0, to);
  assert.deepStrictEqual(part.subarray(0, to * 3), full.subarray(0, to * 3));
  assert.ok(part.subarray(to * 3).every(v => v === 0));
});
