// The forecast next to Montréal and the open-source table, checked from index.html without a browser.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf("fetch(FORECAST + 'forecast.json')"), tail = '.finally(() => { build(); paint(); });';
const block = html.slice(start, html.indexOf(tail, start) + tail.length);
assert(start > 0 && block.endsWith(tail), 'forecast block not found');

const NOW = Date.parse('2026-11-04T12:00Z');
const report = () => ({
  weather: { today: { date: '2026-11-04', cloud_mean: 62.1, temp_mean: 15.2, places: [{ place: 'near Singapore', cloud: 74.2, temp: 27.3 }, { place: 'near Montreal', cloud: 70.1, temp: 3.4 }] } },
});

async function meteo(response) {
  const nodes = {};
  let builds = 0;
  await vm.runInNewContext(block, {
    FORECAST: '', now: () => NOW, build: () => { builds++; }, paint() {},
    document: { getElementById: id => (nodes[id] ||= { textContent: '' }) }, fetch: () => response, Promise, Date, Error,
  });
  assert.strictEqual(builds, 1, 'layout must be rebuilt once the block settles');
  return nodes.meteo ? nodes.meteo.textContent : '';
}
const ok = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

(async () => {
  const text = await meteo(ok(report()));
  assert.strictEqual(text, ', forecast 3.4°C, 70.1% cloud');
  assert(!/62\.1|15\.2|27\.3/.test(text), 'Montréal only');

  const noPlaces = report();
  delete noPlaces.weather.today.places;
  assert.strictEqual(await meteo(ok(noPlaces)), '', 'no places: clock only');
  const noCell = report();
  noCell.weather.today.places.pop();
  assert.strictEqual(await meteo(ok(noCell)), '', 'no Montréal cell: clock only');

  const yesterday = report();
  yesterday.weather.today.date = '2026-11-03';
  assert.notStrictEqual(await meteo(ok(yesterday)), '', "yesterday's run still shows");
  const old = report();
  old.weather.today.date = '2026-11-01';
  assert.strictEqual(await meteo(ok(old)), '', 'an old run adds nothing');

  assert.strictEqual(await meteo(Promise.resolve({ ok: false, status: 404 })), '');
  assert.strictEqual(await meteo(Promise.reject(new Error('offline'))), '');
  assert.strictEqual(await meteo(ok({})), '', 'a malformed report adds nothing');

  // The note is the one Montréal line; the other two lines and the block above the planet are gone.
  for (const id of ['id="today"', 'id="fleet"', 'id="weather"', 'id="count"']) assert(!html.includes(id), id);

  // Each row's merged count matches its data-prs, and the rows add up to the headline.
  const rows = [...html.matchAll(/<tr data-prs="(\d+)">(.*?)<\/tr>/g)].map(([, prs, row]) => [+prs, ...[...row.matchAll(/class="num"><span class="t">(\d+)</g)].map(m => +m[1])]);
  const [, total, merged, issues, reviews] = html.match(/<p data-prs="(\d+)"><span class="t">(\d+) merged, (\d+) issues, (\d+) reviews/).map(Number);
  assert.strictEqual(total, merged);
  assert.strictEqual(rows.length, 7);
  rows.forEach(([prs, m]) => assert.strictEqual(prs, m));
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  assert.deepStrictEqual([sum(1), sum(2), sum(3)], [merged, issues, reviews]);
  console.log('ok');
})().catch(err => { console.error(err); process.exit(1); });
