const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const { dailyMisses, bar, satRows } = require('../method.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('daily misses keep network days only and square-root each one', () => {
  const d = dailyMisses([
    { date: '2026-11-01', net: false, cloud: { model: 400, repeat: 900 } },
    { date: '2026-11-02', net: true, cloud: { model: 400, repeat: 900 }, temp: { model: 1, repeat: 4 }, pressure: { model: 9, repeat: 25 } },
    { date: '2026-11-03', net: true, cloud: { model: 225, repeat: null } },
  ]);
  assert.deepStrictEqual(d.cloud, [{ date: '2026-11-02', model: 20, repeat: 30 }]);
  assert.deepStrictEqual(d.temp, [{ date: '2026-11-02', model: 1, repeat: 2 }]);
  assert.deepStrictEqual(dailyMisses(null), { cloud: [], temp: [], pressure: [] });
});

test('bars start at zero, so half the miss draws half the bar', () => {
  assert.strictEqual(bar(10, 10).length, 20);
  assert.strictEqual(bar(5, 10).length, 10);
  assert.strictEqual(bar(0, 10).length, 1);
});

test('satellite rows come from the latest day, shortest horizon first', () => {
  const s = satRows([
    { date: '2026-11-11', days: { 1: { n: 1, corrected: 1, sgp4_km: 9, model_km: 8 } } },
    { date: '2026-11-12', days: { 7: { n: 30, corrected: 0, sgp4_km: 224.47, model_km: 224.47 }, 1: { n: 10, corrected: 9, sgp4_km: 6.63, model_km: 3.54 } } },
  ]);
  assert.strictEqual(s.date, '2026-11-12');
  assert.deepStrictEqual(s.rows.map(r => r.days), [1, 7]);
  assert.strictEqual(s.rows[1].corrected, 0);
  assert.deepStrictEqual(satRows([]), { date: '', rows: [] });
});

test('the method lives on the planet page and old links reach it', () => {
  const earth = read('earth.html');
  for (const id of ['method', 'method-weather', 'method-sats', 'method-orbits']) assert.ok(earth.includes(`id="${id}"`), id);
  assert.ok(earth.indexOf('method.js') < earth.indexOf('earthmap.js'), 'method.js loads before the script that calls it');
  assert.ok(!earth.includes('href="flow.html'), 'no link back to the old page');
  assert.ok(read('index.html').includes('href="earth.html#method"'));
  assert.match(read('flow.html'), /http-equiv="refresh" content="0; url=earth\.html#method"/);
});
