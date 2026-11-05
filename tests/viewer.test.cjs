// The viewer's pure parts: map geometry, the choice of weather field, the height bands and the isobars.
const test = require('node:test'), assert = require('node:assert');
const { MAP_TOP, ZOOM_MIN, BANDS, BANDS_DIM, placeMarks, mapPlace, mapCell, mapPoint, mapAt, gridIndex, fieldAt, seenFrom, chooseField, wrapYaw, percentGlyph, terrainBand, contours, pressureMarks, sourceWords } = require('../mapmath.js');

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

test('the camera can pull back far enough to hold a geostationary orbit', () => {
  assert.ok(ZOOM_MIN < 1 / 6.6);
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

test('height bands match the ground at known places', () => {
  const band = (lat, lon) => terrainBand(lat * DEG, lon * DEG);
  assert.equal(band(32, 88), 3, 'Tibet');
  assert.equal(band(-16, -68), 3, 'Andes');
  assert.equal(band(40, -106), 2, 'Rockies');
  assert.equal(band(23, 10), 1, 'Sahara');
  assert.equal(band(45.5, -73.6), 0, 'Montreal');
  assert.equal(BANDS.length, 5);
});

test('white cloud glyphs and black isobars both stay readable on every band', () => {
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
    return .2126 * r + .7152 * g + .0722 * b;
  };
  for (const hex of BANDS) {
    const l = luminance(hex);
    assert.ok((1.05) / (l + .05) >= 3, `${hex} against white`);
    assert.ok((l + .05) / .05 >= 3, `${hex} against black`);
  }
  BANDS.forEach((hex, i) => {
    const dim = luminance(BANDS_DIM[i]), grey = luminance('#969696');
    assert.ok((grey + .05) / (dim + .05) >= 3, `dim cloud on ${BANDS_DIM[i]}`);
    assert.ok((luminance(hex) + .05) / (dim + .05) >= 1.8, `${hex} must stand out from ${BANDS_DIM[i]}`);
  });
});

const ROWS = 24, COLS = 48;
// A pressure grid with one Gaussian dip or bump on a flat 1012 hPa background.
function blob(row, col, depth, wide = 3) {
  const grid = new Float32Array(ROWS * COLS);
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const di = Math.min(Math.abs(i - col), COLS - Math.abs(i - col)), dj = j - row;
      grid[j * COLS + i] = 1012 + depth * Math.exp(-(di * di + dj * dj) / (2 * wide * wide));
    }
  }
  return grid;
}

test('a flat field has no isobars and no highs or lows', () => {
  const grid = new Float32Array(ROWS * COLS).fill(1012.5);
  assert.equal(contours(grid, 8).length, 0);
  assert.deepStrictEqual(pressureMarks(grid), []);
});

test('a low gives closed rings round its centre', () => {
  // Centred on the map, so the outer ring stays clear of its clipped top and bottom edges.
  const runs = contours(blob(12, 20, -40), 8), { x, y } = mapPoint(((12.5 / ROWS) - .5) * Math.PI, ((20.5 / COLS) - .5) * 2 * Math.PI, 1, 1);
  assert.ok(runs.length > 0 && runs.length % 4 === 0);
  // Every crossing lies on the map, and every run's two ends are one lattice cell apart at most.
  for (let k = 0; k < runs.length; k += 4) {
    for (const value of runs.slice(k, k + 4)) assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(runs[k] - runs[k + 2]) < .02 && Math.abs(runs[k + 1] - runs[k + 3]) < .1);
  }
  // Closed: each end of a run is shared with exactly one other run.
  const ends = new Map();
  for (let k = 0; k < runs.length; k += 2) {
    const key = `${runs[k].toFixed(6)},${runs[k + 1].toFixed(6)}`;
    ends.set(key, (ends.get(key) || 0) + 1);
  }
  assert.ok([...ends.values()].every(count => count === 2), 'an open end');
  // The rings surround the centre on all four sides.
  const xs = [], ys = [];
  for (let k = 0; k < runs.length; k += 2) { xs.push(runs[k]); ys.push(runs[k + 1]); }
  assert.ok(Math.min(...xs) < x && Math.max(...xs) > x && Math.min(...ys) < y && Math.max(...ys) > y);
});

test('isobars wrap across the date line without a line across the map', () => {
  const runs = contours(blob(12, 0, -40), 8);
  assert.ok(runs.length > 0);
  let wraps = 0;
  for (let k = 0; k < runs.length; k += 4) if (Math.abs(runs[k] - runs[k + 2]) > .5) wraps++;
  // A segment in the seam cell runs to its east edge; none of them cross the whole map at drawing scale.
  assert.equal(wraps, 0);
});

test('a low and a high are marked where they are, with their values', () => {
  const [low] = pressureMarks(blob(14, 20, -30));
  assert.equal(low.kind, 'L');
  close(low.lat, (14.5 / ROWS - .5) * Math.PI);
  close(low.lon, (20.5 / COLS - .5) * 2 * Math.PI);
  close(low.value, 982, 1);
  const [high] = pressureMarks(blob(8, 40, 25));
  assert.equal(high.kind, 'H');
  close(high.value, 1037, 1);
});

test('a weak wobble is not a high or low, and two marks never sit on top of each other', () => {
  assert.deepStrictEqual(pressureMarks(blob(14, 20, -2)), []);
  const twin = blob(14, 20, -30), other = blob(14, 23, -20);
  const both = twin.map((v, i) => v + other[i] - 1012);
  assert.equal(pressureMarks(both).filter(m => m.kind === 'L').length, 1);
});

const meets = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

test('a label near the map edge stays whole inside it', () => {
  const marks = [{ lat: MAP_TOP * .99, lon: 3.13 }, { lat: -MAP_TOP * .99, lon: -3.13 }];
  const placed = placeMarks(marks, 400, 150, () => 50, 20, null, 9);
  assert.equal(placed.length, 2);
  for (const box of placed) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 400 && box.y + box.h <= 150);
});

test('a label moves off the avoided box or is dropped, and labels never overlap', () => {
  const at = mapPoint(.5, -1.2, 400, 150), avoid = { x: at.x - 10, y: at.y - 10, w: 20, h: 20 };
  const [moved] = placeMarks([{ lat: .5, lon: -1.2 }], 400, 150, () => 40, 14, avoid, 9);
  assert.ok(moved && !meets(moved, avoid));
  const pile = Array.from({ length: 12 }, () => ({ lat: .5, lon: -1.2 })), placed = placeMarks(pile, 400, 150, () => 40, 14, avoid, 99);
  assert.ok(placed.length < 12);
  placed.forEach((a, i) => { assert.ok(!meets(a, avoid)); placed.slice(i + 1).forEach(b => assert.ok(!meets(a, b))); });
});

test('the limit keeps the strongest marks, the first ones given', () => {
  const marks = [{ lat: 0, lon: -2 }, { lat: 0, lon: 0 }, { lat: 0, lon: 2 }];
  assert.deepStrictEqual(placeMarks(marks, 400, 150, () => 40, 14, null, 2).map(p => p.mark), marks.slice(0, 2));
  assert.deepStrictEqual(placeMarks(marks, 400, 150, () => 40, 14, null, 0), []);
});

test('the caption names only what a network made', () => {
  assert.equal(sourceWords(['cloud'], true, false), 'cloud, ridge temperature');
  assert.equal(sourceWords(['cloud', 'pressure'], true, true), 'cloud, pressure, ridge temperature');
  assert.equal(sourceWords(['cloud', 'temp', 'pressure'], true, true), 'cloud, temperature, pressure');
  assert.equal(sourceWords(['cloud', 'temp', 'pressure'], false, false), 'cloud');
});
