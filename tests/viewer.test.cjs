// The viewer's pure parts: map geometry, the choice of weather field, the height bands and the isobars.
const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const { MAP_RATIO, ZOOM_MIN, BANDS, BANDS_DIM, placeMarks, mapPlace, mapCell, mapPoint, mapOn, mapAt, gridIndex, fieldAt, seenFrom, chooseField, wrapYaw, percentGlyph, TEMP_EDGES, TEMP_BANDS, TEMP_TONES, TEMP_TONES_DIM, tempBand, terrainBand, contours, pressureMarks, sourceWords } = require('../mapmath.js');
const { dayFacts, placeWords, scoreFacts, modelWords, fleetFacts } = require('../earthinfo.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const DEG = Math.PI / 180;

test('a map cell and its place round trip, and corners lie off the outline', () => {
  const cols = 90, rows = 44;
  for (const [col, row] of [[45, 0], [45, 43], [45, 22], [14, 10], [75, 30], [1, 22], [88, 22]]) {
    const place = mapPlace(col, row, cols, rows);
    assert.ok(place, `${col},${row} is on the map`);
    assert.ok(Math.abs(place.lat) < Math.PI / 2 && Math.abs(place.lon) <= Math.PI);
    assert.deepStrictEqual(mapCell(place.lat, place.lon, cols, rows), { col, row });
  }
  for (const [col, row] of [[0, 0], [89, 0], [0, 43], [89, 43]]) assert.equal(mapPlace(col, row, cols, rows), null);
  // Row 0 is the north edge, as on any map.
  assert.ok(mapPlace(45, 0, cols, rows).lat > 0 && mapPlace(45, 43, cols, rows).lat < 0);
  // Longitudes wrap rather than fall off the sides.
  assert.deepStrictEqual(mapCell(0, 3 * Math.PI, cols, rows), mapCell(0, Math.PI, cols, rows));
});

test('the whole Earth is on the map, and places keep their true share of its area', () => {
  // Monte Carlo over the map: the share of the outline's cells in a latitude band equals that band's share of a sphere.
  const cols = 800, rows = Math.round(cols / MAP_RATIO);
  let on = 0, tropics = 0, polar = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const place = mapPlace(col, row, cols, rows);
      if (!place) continue;
      on++;
      if (Math.abs(place.lat) < 30 * DEG) tropics++;
      if (Math.abs(place.lat) > 60 * DEG) polar++;
    }
  }
  close(tropics / on, .5, .002);
  close(polar / on, 1 - Math.sin(60 * DEG), .002);
  // The poles reach the top and bottom edges.
  close(mapPoint(Math.PI / 2, 0, 1, 1).y, 0, 1e-9);
  close(mapPoint(-Math.PI / 2, 0, 1, 1).y, 1, 1e-9);
  // Equator's ends reach the sides.
  close(mapPoint(0, -Math.PI, 1, 1).x, 0, 1e-9);
  assert.ok(mapOn(.5, .5, 1, 1) && !mapOn(.01, .01, 1, 1));
});

test('the page gives the map the projection\'s own shape', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'earth.html'), 'utf8'), [, ratio] = page.match(/--ratio:([\d.]+)/);
  close(Number(ratio), MAP_RATIO, 1e-3);
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
  const corner = mapAt(-50, -50, 900, 330), other = mapAt(950, 400, 900, 330);
  close(corner.lat, Math.PI / 2, 1e-6); close(corner.lon, -Math.PI);
  close(other.lat, -Math.PI / 2, 1e-6); close(other.lon, Math.PI);
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
  const marks = [{ lat: 1.15, lon: 3.13 }, { lat: -1.15, lon: -3.13 }];
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

test('labels keep off every box in a list of avoided boxes', () => {
  const box = (lat, lon) => { const at = mapPoint(lat, lon, 400, 150); return { x: at.x - 10, y: at.y - 10, w: 20, h: 20 }; };
  const avoid = [box(.5, -1.2), box(.6, 2.4)];
  const placed = placeMarks([{ lat: .5, lon: -1.2 }, { lat: .6, lon: 2.4 }], 400, 150, () => 40, 14, avoid, 9);
  assert.strictEqual(placed.length, 2);
  placed.forEach(p => avoid.forEach(a => assert.ok(!meets(p, a))));
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

test('the day\'s facts weigh cells by area and find the extremes', () => {
  const rows = 24, cols = 48, grid = new Array(rows * cols).fill(0), temp = new Array(rows * cols).fill(10), pressure = new Array(rows * cols).fill(1010);
  // Cloud only at the top row, which covers little of the sphere.
  for (let col = 0; col < cols; col++) grid[(rows - 1) * cols + col] = 100;
  temp[12 * cols + 7] = 35; temp[3] = -40; pressure[20 * cols + 40] = 960;
  const facts = dayFacts(grid, temp, pressure, rows, cols);
  assert.ok(facts.cloud < 1, `${facts.cloud}`);
  assert.equal(facts.hot.value, 35);
  close(facts.hot.lat, (12.5 / rows - .5) * Math.PI);
  close(facts.hot.lon, (7.5 / cols - .5) * 2 * Math.PI);
  assert.equal(facts.cold.value, -40);
  assert.equal(facts.low.value, 960);
  const bare = dayFacts(grid, null, null, rows, cols);
  assert.equal(bare.hot, null); assert.equal(bare.low, null);
  assert.equal(dayFacts(null, null, null, rows, cols).cloud, null);
});

test('a place reads as degrees with its hemisphere', () => {
  assert.equal(placeWords(11 * DEG, 8 * DEG), '11N 8E');
  assert.equal(placeWords(-45.4 * DEG, -73.6 * DEG), '45S 74W');
});

test('the model line says who made the map on screen', () => {
  const all = modelWords('network', ['cloud', 'temp', 'pressure'], true, true, true);
  assert.equal(all.net, 'our neural networks');
  assert.ok(all.lines.some(line => line.includes('cloud 19\u00a0points, temperature 0.9°C, pressure 2.6\u00a0hPa')));
  assert.ok(!all.lines.join().includes('ridge'));
  const ridge = modelWords('network', ['cloud'], true, false, true);
  assert.equal(ridge.net, 'our neural network');
  assert.ok(ridge.lines.some(line => line.startsWith('temperature: ridge')));
  assert.ok(ridge.lines.some(line => line.endsWith('cloud 19\u00a0points')));
  assert.ok(!ridge.lines.join().includes('hPa'));
  const old = modelWords('network', ['cloud'], false, false, true);
  assert.ok(!old.lines.join().includes('ridge'));
  const meteo = modelWords('meteo', [], false, false, true);
  assert.equal(meteo.net, '');
  assert.ok(meteo.from.includes('not ours'));
  assert.equal(modelWords('none', [], false, false, true).from, 'no forecast reached this page');
  assert.equal(modelWords('none', [], false, false, false).from, 'loading forecast');
});

test('the fleet\'s facts come from its orbits', () => {
  const orb = { n: 3, a: new Float32Array([1.08, 1.1, 6.6]), mDot: new Float32Array([.00111, .00105, .0000729]) };
  const facts = fleetFacts(orb, 6378.135);
  close(facts.lowShare, 2 / 3);
  close(facts.lapMin, 2 * Math.PI / .00105 / 60, .01);
  assert.equal(fleetFacts({ n: 0, a: [], mDot: [] }, 6378.135).lapMin, 0);
});

test('a temperature falls in one of seven bands, cold to hot', () => {
  assert.equal(TEMP_BANDS.length, TEMP_EDGES.length + 1);
  assert.deepEqual([-41, -20, -10.1, -0.1, 0, 9.9, 19, 29.9, 30, 45].map(tempBand), [0, 1, 1, 2, 3, 3, 4, 5, 6, 6]);
  assert.equal(new Set(TEMP_TONES).size, 14, 'sea and land tones must differ in every band');
});

test('cloud glyphs and isobars stay readable on the temperature layer', () => {
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
    return .2126 * r + .7152 * g + .0722 * b;
  };
  TEMP_TONES.forEach((hex, i) => {
    const l = luminance(hex), dim = luminance(TEMP_TONES_DIM[i]);
    assert.ok(1.05 / (l + .05) >= 3, `${hex} against white`);
    // Land tones carry the black isobars at full contrast; the darker sea keeps them visible.
    assert.ok((l + .05) / .05 >= (i % 2 ? 3 : 2), `${hex} against black`);
    assert.ok((luminance('#969696') + .05) / (dim + .05) >= 3, `dim cloud on ${TEMP_TONES_DIM[i]}`);
    assert.ok((l + .05) / (dim + .05) >= 1.8, `${hex} must stand out from ${TEMP_TONES_DIM[i]}`);
  });
});

test('scores come from the days the networks forecast, as root mean squares', () => {
  const day = (net, model, repeat) => ({ net, cloud: { model, repeat }, temp: { model: 1, repeat: 4 }, pressure: net ? { model: 9, repeat: null } : { model: 9, repeat: 25 } });
  const scores = scoreFacts([day(false, 900, 900), ...Array.from({ length: 7 }, () => day(true, 400, 625))]);
  assert.equal(scores.days, 7);
  assert.deepEqual(scores.cloud, { model: 20, repeat: 25 });
  assert.deepEqual(scores.temp, { model: 1, repeat: 2 });
  assert.equal(scores.pressure, null, 'a day with no repeat score is left out');
  assert.equal(scoreFacts(undefined).days, 0);
  const live = modelWords('network', ['cloud', 'temp'], true, false, true, scores);
  assert.ok(live.lines.includes('typical miss, last 7 days: cloud 20\u00a0points, temperature 1.0°C'));
  assert.ok(live.lines.includes('repeating the day before misses by 25\u00a0points, 2.0°C'));
  // Pressure has no score here, and under a week of days is too few: both keep the sealed test numbers.
  assert.ok(modelWords('network', ['cloud', 'temp', 'pressure'], true, true, true, scores).lines.some(line => line.startsWith('typical miss on 28 test days')));
  assert.ok(modelWords('network', ['cloud'], false, false, true, scoreFacts([day(true, 400, 625)])).lines.some(line => line.endsWith('cloud 19\u00a0points')));
});
