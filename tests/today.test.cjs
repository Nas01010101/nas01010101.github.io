// The forecast block above the planet and the open-source table, checked from index.html without a browser.
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
  weather: {
    days: Array(7).fill({}),
    week: { cloud: { model: 17.26, persistence: 19.69 }, temp: { model: 0.91, persistence: 0.97 } },
    today: { date: '2026-11-04', cloud_mean: 62.1, temp_mean: 15.2, places: [{ place: 'near Singapore', cloud: 74.2, temp: 27.3 }, { place: 'near Montreal', cloud: 70.1, temp: 3.4 }] },
  },
  satellites: { horizons: [] },
});

async function load(response) {
  const nodes = {};
  const node = id => (nodes[id] ||= { id, textContent: '', hidden: false, style: { visibility: id === 'today' ? 'hidden' : '' } });
  let builds = 0;
  await vm.runInNewContext(block, {
    FORECAST: '', now: () => NOW, today: node('today'), build: () => { builds++; }, paint() {},
    document: { getElementById: node }, fetch: () => response, Promise, Date, Error,
  });
  assert.strictEqual(builds, 1, 'layout must be rebuilt once the block settles');
  return nodes;
}
const ok = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

(async () => {
  let n = await load(ok(report()));
  assert.strictEqual(n.today.hidden, false);
  assert.strictEqual(n.today.style.visibility, '');
  assert.strictEqual(n['today-head'].textContent, 'model forecast for 2026-11-04');
  assert.strictEqual(n['today-global'].textContent, 'global 62.1% cloud, 15.2°C');
  assert.strictEqual(n['today-here'].textContent, 'near Montreal 70.1% cloud, 3.4°C');
  assert.strictEqual(n['today-week'].textContent, '7 day error vs persistence');
  assert.strictEqual(n['today-cloud'].textContent, 'cloud 17.3 vs 19.7 points');
  assert.strictEqual(n['today-temp'].textContent, 'temp 0.9 vs 1.0°C');
  assert(!n['today-sats'], 'no horizons yet: the satellite line keeps its hidden attribute');

  const noPlaces = report();
  delete noPlaces.weather.today.places;
  n = await load(ok(noPlaces));
  assert.strictEqual(n.today.hidden, false);
  assert.strictEqual(n['today-place'].hidden, true);

  const withSats = report();
  withSats.satellites.horizons = [{ days: 1, low: { median_km: 2.4 } }];
  n = await load(ok(withSats));
  assert.strictEqual(n['today-sats'].hidden, false);
  assert.strictEqual(n['today-sats'].textContent, 'satellites 2.4 km off, 1 day old elements');

  const yesterday = report();
  yesterday.weather.today.date = '2026-11-03';
  assert.strictEqual((await load(ok(yesterday))).today.hidden, false, "yesterday's run still shows");
  const old = report();
  old.weather.today.date = '2026-11-01';
  assert.strictEqual((await load(ok(old))).today.hidden, true, 'an old run is hidden');

  assert.strictEqual((await load(Promise.resolve({ ok: false, status: 404 }))).today.hidden, true);
  assert.strictEqual((await load(Promise.reject(new Error('offline')))).today.hidden, true);
  assert.strictEqual((await load(ok({}))).today.hidden, true, 'a malformed report is hidden');

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
