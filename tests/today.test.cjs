// The three cities under the planet and the open-source table, checked from index.html and cities.js without a browser.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CITIES, cellOf, nextSun, forecastFor, cityLines } = require('../cities.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf("fetch(FORECAST + 'forecast.json')"), tail = '.finally(() => { status(); build(); paint(); });';
const block = html.slice(start, html.indexOf(tail, start) + tail.length);
assert(start > 0 && block.endsWith(tail), 'forecast block not found');

// The sun from planet.js, the same one the page uses.
const sky = { location: { search: '' }, URLSearchParams };
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'planet.js'), 'utf8').split('const smooth')[0]}; this.subsolar = subsolar;`, sky);
const { subsolar } = sky;

// Every city under the planet has a cross on it, each in an ink of its own.
const inked = { location: { search: '' }, URLSearchParams, atob };
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'planet.js'), 'utf8').split('const STREAKS')[0]}; this.MARKS = MARKS; this.INKS = INKS;`, inked);
assert.strictEqual(inked.MARKS.length, CITIES.length);
CITIES.forEach((city, k) => {
  const mark = inked.MARKS[k];
  assert(Math.abs(mark.lat - city.lat * Math.PI / 180) < 1e-9 && Math.abs(mark.lon - city.lon * Math.PI / 180) < 1e-9, `${city.name}: mark not on the city`);
  assert.strictEqual(inked.INKS.indexOf(inked.INKS[mark.ink]), mark.ink, `${city.name}: ink shared with the planet`);
});
assert.strictEqual(new Set(inked.MARKS.map(m => inked.INKS[m.ink])).size, CITIES.length, 'two cities share an ink');

const NOW = Date.parse('2026-11-04T12:00Z');
const CELLS = 24 * 48;
const grid = (fill, at) => { const g = new Array(CELLS).fill(fill); for (const [i, v] of at) g[i] = v; return g; };
const [mtl, kyoto, casa] = CITIES.map(c => cellOf(c.lat, c.lon));
const report = () => ({
  weather: { today: { date: '2026-11-04', places: [{ place: 'near Singapore', cloud: 74.2, temp: 27.3 }, { place: 'near Montreal', cloud: 70.1, temp: 3.4 }] } },
});

// What the fetch block keeps: the day's forecast, or nothing.
async function kept(response) {
  const ctx = { FORECAST: '', now: () => NOW, forecast: null, calls: [], fetch: () => response, Promise, Date, Error };
  ctx.status = () => ctx.calls.push('status'); ctx.build = () => ctx.calls.push('build'); ctx.paint = () => {};
  await vm.runInNewContext(block, ctx);
  assert.deepStrictEqual(ctx.calls, ['status', 'build'], 'the lines are redrawn, then the layout, once the block settles');
  return ctx.forecast;
}
const ok = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

(async () => {
  assert.strictEqual((await kept(ok(report()))).date, '2026-11-04');
  const yesterday = report();
  yesterday.weather.today.date = '2026-11-03';
  assert(await kept(ok(yesterday)), "yesterday's run still shows");
  const old = report();
  old.weather.today.date = '2026-11-01';
  assert.strictEqual(await kept(ok(old)), null, 'an old run adds nothing');
  assert.strictEqual(await kept(Promise.resolve({ ok: false, status: 404 })), null);
  assert.strictEqual(await kept(Promise.reject(new Error('offline'))), null);
  assert.strictEqual(await kept(ok({})), null, 'a malformed report adds nothing');

  // The cells are the ones the pipeline picks: Montréal 45-52.5N 75-67.5W, Kyoto 30-37.5N 135-142.5E, Casablanca 30-37.5N 15-7.5W.
  assert.deepStrictEqual([mtl, kyoto, casa], [18 * 48 + 14, 16 * 48 + 42, 16 * 48 + 22]);

  // With grids, each city reads its own cell; pressure is Montréal's only.
  const today = { date: '2026-11-04', places: report().weather.today.places, cloud: grid(50, [[mtl, 77], [kyoto, 65], [casa, 12]]), temp: grid(0, [[mtl, 9], [kyoto, 14], [casa, -3]]), pressure: grid(1000, [[mtl, 1007.8]]) };
  const full = cityLines(NOW, today, subsolar);
  assert.deepStrictEqual(full.rows.map(r => r.slice(0, 11).trim()), ['Montréal', 'Kyoto', 'Casablanca']);
  assert.deepStrictEqual(full.rows.map(r => r.slice(22).trim().split(/ +/)), [['9', '77%'], ['14', '65%'], ['-3', '12%']]);
  assert.match(full.detail, /^Montréal: sun(rise|set) \d\d:\d\d, 1008\u00a0hPa$/);
  assert.strictEqual(full.source, "our model, today's mean, 800\u00a0km cell");
  // Once the UTC date has moved past the forecast's day, the line names that day instead of calling it today.
  const late = cityLines(NOW + 864e5, today, subsolar).source;
  assert.strictEqual(late, 'our model, nov 4 mean, 800\u00a0km cell');
  assert(late.length + 2 <= 39, late);
  // Columns line up under the heading at every row.
  for (const r of full.rows) assert.strictEqual(r.length, full.head.length, r);
  assert.strictEqual(full.head.indexOf('°C') + 2, full.rows[0].indexOf('9') + 1);
  // Every line fits the 39-column measure with its two-column lead.
  for (const l of [full.head, ...full.rows, full.detail, full.source]) assert(l.length + 2 <= 39, l);

  // Clock and day or night per city, in its own zone: noon UTC is 07:00 in Montréal, 21:00 in Kyoto, 12:00 in Casablanca.
  assert.deepStrictEqual(full.rows.map(r => r.slice(11, 22).trim()), ['07:00 day', '21:00 night', '12:00 day']);
  // Before sunrise in Montréal the next event is the sunrise, about 06:30 local in early November.
  const dawn = nextSun(CITIES[0], Date.parse('2026-11-04T10:00Z'), subsolar);
  assert.strictEqual(dawn.word, 'sunrise');
  assert(Math.abs(dawn.at - Date.parse('2026-11-04T11:32Z')) < 15 * 6e4, new Date(dawn.at).toISOString());

  // The older format kept only Montréal's cell: the others show a dash, pressure is left out.
  const places = cityLines(NOW, report().weather.today, subsolar);
  assert.deepStrictEqual(places.rows.map(r => r.slice(22).trim().split(/ +/)), [['3', '70%'], ['-', '-'], ['-', '-']]);
  assert(!/hPa/.test(places.detail));
  assert(!/74|27/.test(places.rows.join()), 'no Singapore values');
  // A grid of the wrong size is not read.
  assert.deepStrictEqual(forecastFor({ cloud: [1, 2], temp: [3] }), [null, null, null]);
  // No forecast: clocks and the sun only, no heading, no dashes.
  const none = cityLines(NOW, null, subsolar);
  assert.deepStrictEqual([none.head, none.source], ['', '']);
  assert(none.rows.every(r => !r.includes('-') && r === r.trimEnd()));
  assert.match(none.detail, /^Montréal: sun(rise|set) \d\d:\d\d$/);

  // The note is the city block; the older lines and the block above the planet are gone.
  for (const id of ['id="today"', 'id="fleet"', 'id="weather"', 'id="count"', 'id="meteo"', 'id="status"']) assert(!html.includes(id), id);

  // Merged PRs only: one headline total, one row per organisation listing its repos, rows add up to the total.
  const rows = [...html.matchAll(/<tr data-prs="(\d+)">(.*?)<\/tr>/g)].map(([, prs, row]) => [+prs, ...[...row.matchAll(/class="num"><span class="t">(\d+)</g)].map(m => +m[1])]);
  const [, total, merged] = html.match(/<p class="split" data-prs="(\d+)"><span class="t">(\d+) merged PRs, \d+ repos<\/span>/).map(Number);
  assert.strictEqual(total, merged);
  assert(!/\d+ (opened|issues|reviews|open-source contributions)/.test(html), 'only merged PRs are counted');
  assert(html.includes('<span class="t m">alphafold3, '), 'repos are listed after the organisation');
  rows.forEach(r => assert.strictEqual(r.length, 2, 'one count column'));
  rows.forEach(([prs, m]) => assert.strictEqual(prs, m));
  assert.strictEqual(rows.reduce((a, r) => a + r[1], 0), merged);
  const picks = [...html.match(/<div id="prs"[\s\S]*?<\/div>/)[0].matchAll(/href="https:\/\/github.com\/([^/]+)\/[^"]+\/pull\/\d+"/g)].map(m => m[1]);
  assert.deepStrictEqual(picks, ['google-deepmind', 'google-deepmind', 'NVIDIA']);
  console.log('ok');
})().catch(err => { console.error(err); process.exit(1); });

require('node:test')('the pull request page holds each picked PR with an escaped diff, and the home page links to it', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const home = read('index.html'), page = read('prs.html');
  assert(home.includes('href="prs.html"'));
  for (const url of home.match(/<div id="prs"[\s\S]*?<\/div>/)[0].match(/https:\/\/github\.com\/[^"]+\/pull\/\d+/g)) assert(page.includes(`href="${url}"`), url);
  assert.strictEqual((page.match(/<section id=/g) || []).length, 5);
  assert.strictEqual((page.match(/<pre>/g) || []).length, 5);
  // Diff text is escaped: C++ templates and Lean arrows appear as entities or literal text, never as tags.
  assert(page.includes('&lt;class _Sender&gt;'));
  for (const [, body] of page.matchAll(/<pre>([\s\S]*?)<\/pre>/g)) assert(!/<(?!\/?span[ >])/.test(body), 'no raw tags inside diffs');
});
