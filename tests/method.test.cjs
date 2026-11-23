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
  // The home page reaches the planet page through its pale blue dot link only.
  assert.ok(read('index.html').includes('href="earth.html"') && !read('index.html').includes('what am i seeing here'));
  assert.match(read('flow.html'), /http-equiv="refresh" content="0; url=earth\.html#method"/);
});

test('the drawing sits at the end of the method, with its file and a description', () => {
  const earth = read('earth.html');
  assert.ok(earth.indexOf('id="drawing"') > earth.indexOf('id="method-network"'));
  assert.match(earth, /<img src="earth-drawing.png" width="300" height="299" loading="lazy" alt="Hand drawing/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'earth-drawing.png')));
});

test('the method is two sentences, a pipeline drawing that fits a phone, the scores and a link to the README', () => {
  const earth = read('earth.html'), method = earth.slice(earth.indexOf('<article id="method"'), earth.indexOf('</article>'));
  const pipes = [...method.matchAll(/<pre class="pipe"[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1]);
  assert.strictEqual(pipes.length, 2, 'one drawing for the weather, one for the satellites');
  // 38 columns is what a 390px phone shows at the page's font size.
  for (const line of pipes.join('\n').split('\n')) assert.ok([...line.replace(/&[a-z]+;/g, 'x')].length <= 38, line);
  for (const word of ['U-Net', 'residual', 'SGP4', 'Open-Meteo', 'CelesTrak']) assert.ok(pipes.join().includes(word), word);
  const prose = [...method.matchAll(/<p>([^<]*(?:<(?!\/p>)[^<]*)*)<\/p>/g)].map(m => m[1].replace(/<[^>]*>/g, '')).join(' ');
  assert.ok((prose.match(/\. /g) || []).length + 1 <= 2, prose);
  assert.match(method, /href="https:\/\/github\.com\/Nas01010101\/ascii-earth-forecast#[a-z-]+"/);
});
