// The moving network drawings in the method section, checked frame by frame without a browser.
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const { unetFrame, mlpFrame, html, COLS } = require('../netanim.js');
const text = grid => grid.map(row => row.map(([ch]) => ch).join('')).join('\n');

test('every frame fits the 38 columns a phone shows and names what it draws', () => {
  for (const [frame, words] of [[unetFrame, ['Open-Meteo', 'U-Net', 'today']], [mlpFrame, ['CelesTrak', 'residual', 'SGP4']]]) {
    for (let t = 0; t < 20; t += 0.37) {
      const grid = frame(t);
      for (const row of grid) assert.strictEqual(row.length, COLS);
      for (const w of words) assert.ok(text(grid).includes(w), `${w} at t=${t}`);
    }
  }
});

test('frames move with time and repeat for the same time', () => {
  for (const frame of [unetFrame, mlpFrame]) {
    assert.strictEqual(text(frame(3.1)), text(frame(3.1)));
    assert.notStrictEqual(text(frame(1)), text(frame(2.5)));
  }
});

test('the corrected dot sits nearer the truth than SGP4 alone at every day of the cycle', () => {
  for (let t = 0; t < 15; t += 1) {
    const row = text(mlpFrame(t)).split('\n').find(r => r.startsWith('day'));
    const x = row.indexOf('x') < 0 ? row.indexOf('●') : row.indexOf('x');
    const net = row.indexOf('●'), sgp4 = row.indexOf('○');
    assert.ok(net >= 0 && Math.abs(net - x) <= Math.abs((sgp4 < 0 ? net : sgp4) - x), row);
  }
});

test('html wraps runs of one class in a span and leaves plain text bare', () => {
  assert.strictEqual(html([[['a', 'm'], ['b', 'm'], ['c', ''], ['d', 'net']]]), '<span class="m">ab</span>c<span class="net">d</span>');
});

test('the page loads the drawings, labels them for screen readers and keeps the satellite anchor', () => {
  const earth = fs.readFileSync(path.join(__dirname, '..', 'earth.html'), 'utf8');
  assert.match(earth, /<pre class="pipe" data-net="unet" role="img" aria-label="[^"]+"/);
  assert.match(earth, /<pre class="pipe" id="method-orbits" data-net="mlp" role="img" aria-label="[^"]+"/);
  assert.ok(earth.includes('<script src="netanim.js"></script>'));
});

const realData = days => {
  const flat = v => new Float64Array(24 * 48).fill(v);
  const ground = require('../netanim.js').groundGrids((lat, lon) => lon > 0, () => 1); // east half land, all band 1
  return { days: days || [{ date: '2026-11-01', cloud: flat(0) }, { date: '2026-11-02', cloud: flat(100) }], today: { date: '2026-11-22', cloud: flat(55) }, ground };
};

test('with real data the input map steps through the days and the output map shows the forecast over land and sea', () => {
  const data = realData(), a = unetFrame(0, data), b = unetFrame(0.31, data);
  assert.ok(text(a).startsWith('Open-Meteo 11-01') && text(b).startsWith('Open-Meteo 11-02'));
  for (const row of a) assert.strictEqual(row.length, COLS);
  assert.strictEqual(a[1][0][0], '·', 'clear day draws the clear glyph');
  assert.strictEqual(b[1][0][0], '@', 'overcast day draws the full glyph');
  assert.strictEqual(a[1][26][0], '+', '55% forecast in the output map');
  assert.match(a[1][0][1], /^g0/, 'west half is sea'); assert.match(a[1][11][1], /^g2/, 'east half is land band 1');
  assert.ok(text(a).includes('sea low high'));
});

test('pool averages the grid north row first', () => {
  const { pool } = require('../netanim.js'), g = new Float64Array(24 * 48);
  for (let x = 0; x < 48; x++) g[23 * 48 + x] = 60; // north row
  const p = pool(g, 6, 12);
  assert.strictEqual(p[0], 15); assert.strictEqual(p[12 * 5], 0);
});

test('readHistory reads the last 30 days and their dates from a numpy npz', async () => {
  const { readHistory } = require('../netanim.js'), buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'history-small.npz'));
  const days = await readHistory(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.strictEqual(days.length, 30);
  assert.strictEqual(days[0].date, '2026-11-06'); assert.strictEqual(days[29].date, '2026-11-35');
  assert.strictEqual(days[0].cloud[0], 10); assert.strictEqual(days[29].cloud[23 * 48], 100);
  await assert.rejects(readHistory(new ArrayBuffer(40)));
});

test('the map has a hidden play button that the weather file reveals and the map script wires up', () => {
  const earth = fs.readFileSync(path.join(__dirname, '..', 'earth.html'), 'utf8'), map = fs.readFileSync(path.join(__dirname, '..', 'earthmap.js'), 'utf8');
  assert.match(earth, /<button id="play" type="button" aria-pressed="false" hidden>play 48 h<\/button> <span id="play-at"><\/span>/);
  assert.ok(map.includes("$('play').hidden = false") && map.includes("$('play').addEventListener('click'"));
});
