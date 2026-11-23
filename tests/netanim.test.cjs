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
