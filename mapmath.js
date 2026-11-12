// Geometry of the forecast map under the globe. Angles in radians. Classic script: its names are globals for the viewer.
'use strict';
const MAP_RAD = Math.PI / 180;
// Equal Earth (Savric, Patterson, Jenny 2018): every place keeps its true share of the map's area, and the whole globe fits.
const EE_A1 = 1.340264, EE_A2 = -.081106, EE_A3 = .000893, EE_A4 = .003796, EE_M = Math.sqrt(3) / 2;
const eeY = t => { const t2 = t * t, t6 = t2 * t2 * t2; return t * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2)); };
const eeDen = t => { const t2 = t * t, t6 = t2 * t2 * t2; return EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2); };
const EE_X = Math.PI / (EE_M * EE_A1), EE_Y = eeY(Math.PI / 3);
// earth.html's #map aspect-ratio repeats this number; a test holds them equal.
const MAP_RATIO = EE_X / EE_Y;
// Near the poles longitude neighbours are close together, so extremes there are noise.
const MARK_TOP = 75 * MAP_RAD;
// A geostationary shell, 6.6 Earth radii out, has to fit on screen.
const ZOOM_MIN = .1;
const GRID_ROWS = 24, GRID_COLS = 48;

// Longitude as a share of the way round from 180W, in 0..1.
const turnShare = lon => ((lon / (2 * Math.PI) + .5) % 1 + 1) % 1;

// A place as shares of the map's width and height. Longitude in -pi..pi, not wrapped here so the seam keeps both its edges.
function project(lat, lon) {
  const t = Math.asin(EE_M * Math.sin(lat));
  return { u: (lon * Math.cos(t) / (EE_M * eeDen(t)) / EE_X + 1) / 2, v: (1 - eeY(t) / EE_Y) / 2 };
}
const projectWrapped = (lat, lon) => project(lat, turnShare(lon) * 2 * Math.PI - Math.PI);

// The place under shares of the map; |lon| past pi means off the outline. dy/dt is eeDen, so Newton needs no other derivative.
function inverse(u, v) {
  const y = (1 - 2 * v) * EE_Y;
  let t = y / EE_A1;
  for (let k = 0; k < 5; k++) t -= (eeY(t) - y) / eeDen(t);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, Math.sin(t) / EE_M))),
    lon: (2 * u - 1) * EE_X * EE_M * eeDen(t) / Math.cos(t),
  };
}

// The place at the centre of a map cell; row 0 is the north edge. Null when the cell is off the outline.
function mapPlace(col, row, cols, rows) {
  const place = inverse((col + .5) / cols, (row + .5) / rows);
  return Math.abs(place.lon) > Math.PI ? null : place;
}

function mapCell(lat, lon, cols, rows) {
  const { u, v } = projectWrapped(lat, lon);
  return { col: Math.min(cols - 1, Math.floor(u * cols)), row: Math.min(rows - 1, Math.floor(v * rows)) };
}

// CSS pixels of a place on a map w wide and h tall, for lines drawn over the glyphs.
function mapPoint(lat, lon, w, h) {
  const { u, v } = projectWrapped(lat, lon);
  return { x: u * w, y: v * h };
}

// Whether a pixel of that map lies inside the Earth's outline.
const mapOn = (x, y, w, h) => Math.abs(inverse(x / w, y / h).lon) <= Math.PI;

// The place under a pixel of that map, held inside the map's edges and the outline.
function mapAt(x, y, w, h) {
  const place = inverse(Math.max(0, Math.min(1, x / w)), Math.max(0, Math.min(1, y / h)));
  return { lat: place.lat, lon: Math.max(-Math.PI, Math.min(Math.PI, place.lon)) };
}

// The grid cell holding a place, south to north and west to east, as forecast/weather.py picks it.
function gridIndex(lat, lon, rows = GRID_ROWS, cols = GRID_COLS) {
  const row = Math.max(0, Math.min(rows - 1, Math.floor((lat / Math.PI + .5) * rows)));
  const col = Math.min(cols - 1, Math.floor(turnShare(lon) * cols));
  return { row, col, index: row * cols + col };
}

// Bilinear between cell centres, as planet.js coverFrom does for the globe.
function fieldAt(grid, lat, lon, rows = GRID_ROWS, cols = GRID_COLS) {
  const y = Math.max(0, Math.min(rows - 1, (lat / Math.PI + .5) * rows - .5)), y0 = Math.min(rows - 2, Math.floor(y)), fy = y - y0;
  const x = turnShare(lon) * cols - .5, x0 = Math.floor(x), fx = x - x0, a = (x0 + cols) % cols, b = (a + 1) % cols;
  const south = grid[y0 * cols + a] * (1 - fx) + grid[y0 * cols + b] * fx;
  const north = grid[(y0 + 1) * cols + a] * (1 - fx) + grid[(y0 + 1) * cols + b] * fx;
  return south * (1 - fy) + north * fy;
}

// Whether a point of the surface faces the camera and lands on the stage. R is the planet's radius in pixels.
function seenFrom(lat, lon, view, R, W, H) {
  const cl = Math.cos(lat), sl = Math.sin(lat), d = lon - view.yaw, cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const ez = cl * Math.cos(d), sz = sl * sp + ez * cp;
  if (sz <= 0) return false;
  const x = W / 2 + R * cl * Math.sin(d), y = H / 2 - R * (sl * cp - ez * sp);
  return x >= 0 && x <= W && y >= 0 && y <= H;
}

// The network only answers for its own day, so before the daily job has run the map falls back to the forecast frame.
function chooseField(today, isoDate, frameOk) {
  const own = today && today.net && today.date === isoDate && Array.isArray(today.cloud) && today.cloud.length === GRID_ROWS * GRID_COLS;
  if (own) return 'network';
  return frameOk ? 'meteo' : 'none';
}

// An angle in (-pi, pi], the short way round.
const wrapYaw = a => a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));

// Index into planet.js RAMP for a cloud percent; under 5% draws nothing.
const percentGlyph = p => (p < 5 ? -1 : Math.min(8, Math.floor(p / 100 * 9)));

// Sea, then land under 300 m, to 1000 m, to 2500 m and above. Mid tones, so white cloud glyphs and black isobars both read on every one.
const BANDS = ['#2a6f97', '#3f8f4f', '#a08e3e', '#a5694a', '#a77ba8'];
// The same colours at about half strength outside the part of the Earth the camera sees: the lit window is what ties the map to the globe.
const BANDS_DIM = ['#15384b', '#1f4727', '#50471f', '#533425', '#533d54'];

// ERA5 surface height, 2 bits per 2.5 degree cell, south edge first (research/weather/bake_terrain.py in ascii-earth-forecast).
const TERRAIN = Uint8Array.from(atob('////////////////////////////////////////////////u6qqqqqqqqqqqqqqqqqqqqr/////////////////////////VQEAVFWlqqqqqlZVpaqqqqqq+v////////////////+/qqpVAAAAVFWpqqqqagUAQEVVqqqq+v///////////////7+qqgEAAABAVamqqqqqWgEAAAVQpaqq//////////////////+qqgUAAAAAUKqqalWpWlUFAAAAVar6////////q/7///////+/qgIAAAAAAAAEAABVVVVqAAAAAJCq/v////+/qur///////+rqloAAAAAAAAAAAAAAABpAAAAAABVqapVqvr/Gqn+//////+qqlUAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAKmqWkCqqqqqqqpaFQAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAVAABAVVUFVFUBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAAAAAAAAAAAAEAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAGAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAIAGAAAAAAAAAAAVAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAIAWAAAAAAAAAEBqAAAAAAAAAABAAQBAAQAAAAAAAAAAAAAAAEALUAAAAAAAAECpAQAAAAAAAABAVQEAAQAAAAAAAAAAAAAAAEAfUAEAAAAAAJCpAQAAAAAAAABQVQVQAAAAAAAAAAAAAAAAAEAfUAUAAAAAAKCqARAAAAAAAABQVQUQAAAAAAAAAAAAAAAAAAAvUBUAAAAAAKRmARAAAAAAAAAAUBUEAAAAAAAAAAAAAAAAAEBvUFUAAAAAAKSWBlAAAAAAAAAAQAEEAAAAAAAAAAAAAAAAAOBbUFUAAAAAAKRqFUAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAPgCVVUAAAAAAKSqVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGkAFVUAAAAAAKSqVgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABoAFFQFAAAAAFSVGgAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAYAAEABAAAAAFRVKgAAAAAAAAAAAAAVAAAAAAAAAAAAAAAAAAIAAAAAAAAAAFSVagAAAAAAAAAAAFABAAAAAAAAAAAAAAAAAAYAAAAAAAAAAFWVagAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABkABAAAAAAAAFVVagAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAChUAAAAAAAAAFVVVQUAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAGRUAAAAAAAAAFVVpRUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAEAFQFVVpVoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAVUFVVpVUAABAAAAAAAAAAAAAAAAAAAAAAAABABQAAAAAAAABVUFVVlRUAAFAAAAAAAAAAAAAAAAAAAAAAAABVAQAAAAAAAAAAVUVVVWgBAFAAQBAAAAAAAAAAAAAAAAAAAJAGAAAAAAAAAEBFVVVVFVkBAFQBUAUAAAAAAAAAAAAAAAAAAKACAAAAAAAAAEBFVZVVFVUAAFAFVAUAAAAAAAAAAAAAAAAAAKQBAAAAAAAAAABFZVVVRFUAAFAFlFoAAAAAAAAAAAAAAAAAAKkAAAAAAAAAAEAVVFUQURVAFRRQlWpVAAAAAAAAAAAAAAAAQGoAAAAAAAAAAABVVRUAVAWpZkD+/1tBAAAAAAAAAAAAAAAAQGoBAAAAAAAAAABZBQUAUEGqpeH//1sBAAAAAAAAAAAAAAAAlWoBAAAAAAAAAABUBQAAUJGauvr//68BAAAAAAAAAAAAAAAAqmoBUAAAAAAAAAAQVQAAVaWmpf///6sFAEAAAAAAAAAAAABAqm4FQAEAAAAAAABUAABBqmpQkL+q/6oGAAAAAAAAAAAAAACQqmoVAAUAAAAAAABUAQAFVWoAULqqqqpqUAAAAAAAAAAAAACQqmpVABAAAAAAAAAUFVAFABUAQKWqqqpqUQAAAAAAAAAAAABAqVZVAUEAAAAAAAAAlBYUAAAAAFVVqqpaQRAAAAAAAAAAAABQqlVVEVQBAAAAAAAAUFUVAAAAUFWlqqpWVVAAAAAAAAAAAACkalVQAVAVAAAAAAAAAAAAAABAQBWlqlpWFVUAAAAAAAAAAACpWlUAAFBVAAAAAAAAAAAAAABAAABQpVVaVRUAQAAAAAAAAEBqVVUAAFAVAAAAAAAAAAAAAABAAABAVVWqVRUAQAEAAAAAAJVaVVUAAAAQAAAAAAAAQAAAAABAAAAAVFVVVVUBAAAAAABQlapaAVUAAAAAACkAAAAAUAUAAABAAAAAVFUVFZBWFUABAABQVakWUQUAAAABAGoAAAUAABUAAAAAAAAAVVUFQJVqVVUBAABUVVUFVAEAAAAUQKoWAAAAAFQAAAAAAAAAVVUVUJVVQFVRAEBVVQFAAAAAAEABQOqvBgAAAEAFAAAAAAAAVVUBUFEBABBUAAAAAAAAAAAAABQAkPq/FgAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAUAAApP7/WgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUABUqv+vagAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQQWlqqqqWgAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUFVVVamqFQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), c => c.charCodeAt(0));

function terrainBand(lat, lon) {
  const i = Math.floor(turnShare(lon) * 144), j = Math.min(71, Math.floor((lat / Math.PI + .5) * 72)), k = j * 144 + i;
  return TERRAIN[k >> 2] >> (2 * (k & 3)) & 3;
}

// Which edges a cell's line joins, by which of its corners are above the level: top, right, bottom, left, as t r b l.
const CROSSINGS = ['', 'lt', 'tr', 'lr', 'rb', '', 'tb', 'lb', 'lb', 'tb', '', 'rb', 'lr', 'tr', 'lt', ''];

// Lines of equal value over the map, every `step`, as flat u0 v0 u1 v1 runs in shares of its width and height.
// Each crossing is traced on a regular lattice, then projected, so the shared ends of two runs stay equal.
// The bilinear field has kinks along its grid lines, and the smoothing keeps them out of the lines.
function contours(grid, step, rows = GRID_ROWS, cols = GRID_COLS, density = 4) {
  const nu = cols * density, nv = rows * density;
  let now = new Float64Array(nu * (nv + 1)), lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < nu; i++) now[j * nu + i] = fieldAt(grid, Math.PI / 2 * (1 - 2 * j / nv), (2 * i / nu - 1) * Math.PI, rows, cols);
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(now.length);
    for (let j = 0; j <= nv; j++) {
      const up = Math.max(0, j - 1), down = Math.min(nv, j + 1);
      for (let i = 0; i < nu; i++) {
        const w = (i + nu - 1) % nu, e = (i + 1) % nu;
        next[j * nu + i] = (4 * now[j * nu + i] + 2 * (now[j * nu + w] + now[j * nu + e] + now[up * nu + i] + now[down * nu + i]) + now[up * nu + w] + now[up * nu + e] + now[down * nu + w] + now[down * nu + e]) / 16;
      }
    }
    now = next;
  }
  for (const value of now) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
  const out = [];
  const put = (across, down) => { const { u, v } = project(Math.PI / 2 * (1 - 2 * down), (2 * across - 1) * Math.PI); out.push(u, v); };
  for (let level = Math.ceil(lo / step) * step; level <= hi; level += step) {
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = now[j * nu + i], b = now[j * nu + (i + 1) % nu], c = now[(j + 1) * nu + (i + 1) % nu], d = now[(j + 1) * nu + i];
        const code = (a > level) | (b > level) << 1 | (c > level) << 2 | (d > level) << 3;
        if (code === 0 || code === 15) continue;
        let pairs = CROSSINGS[code];
        // Where opposite corners agree, the middle of the cell says which of them join.
        if (!pairs) pairs = (code === 5) === ((a + b + c + d) / 4 > level) ? 'trlb' : 'ltrb';
        for (let k = 0; k < pairs.length; k++) {
          const edge = pairs[k];
          if (edge === 't') put((i + (level - a) / (b - a)) / nu, j / nv);
          else if (edge === 'b') put((i + (level - d) / (c - d)) / nu, (j + 1) / nv);
          else if (edge === 'l') put(i / nu, (j + (level - a) / (d - a)) / nv);
          else put((i + 1) / nu, (j + (level - b) / (c - b)) / nv);
        }
      }
    }
  }
  return out;
}

// Highs and lows: cells beyond every neighbour within two cells and clear of the ring around them, the strongest first.
function pressureMarks(grid, rows = GRID_ROWS, cols = GRID_COLS, clear = 3, apart = 6) {
  const found = [];
  for (let j = 0; j < rows; j++) {
    const lat = ((j + .5) / rows - .5) * Math.PI;
    if (Math.abs(lat) >= MARK_TOP) continue;
    for (let i = 0; i < cols; i++) {
      const value = grid[j * cols + i];
      let top = true, bottom = true, ring = 0, count = 0;
      for (let dj = -2; dj <= 2; dj++) {
        if (j + dj < 0 || j + dj >= rows) continue;
        for (let di = -2; di <= 2; di++) {
          if (!di && !dj) continue;
          const other = grid[(j + dj) * cols + (i + di + cols) % cols];
          if (other >= value) top = false;
          if (other <= value) bottom = false;
          if (Math.max(Math.abs(di), Math.abs(dj)) === 2) { ring += other; count++; }
        }
      }
      const beyond = Math.abs(value - ring / count);
      if ((top || bottom) && beyond >= clear) found.push({ lat, lon: ((i + .5) / cols - .5) * 2 * Math.PI, i, j, kind: top ? 'H' : 'L', value, beyond });
    }
  }
  found.sort((p, q) => q.beyond - p.beyond);
  const kept = [];
  for (const mark of found) {
    const near = kept.some(k => { const d = Math.abs(k.i - mark.i); return Math.max(Math.min(d, cols - d), Math.abs(k.j - mark.j)) < apart; });
    if (!near) kept.push(mark);
  }
  return kept;
}

// Label boxes for marks, strongest first, kept inside the w by h map and off `avoid` (one box or a list) and each other. A label that fits nowhere within one tile of its point is dropped.
function placeMarks(marks, w, h, tileW, tileH, avoid, limit) {
  const boxes = [].concat(avoid || []), placed = [];
  const clear = box => boxes.every(o => box.x + box.w <= o.x || o.x + o.w <= box.x || box.y + box.h <= o.y || o.y + o.h <= box.y);
  for (const mark of marks) {
    if (placed.length >= limit) break;
    const { x, y } = mapPoint(mark.lat, mark.lon, w, h), tile = tileW(mark);
    for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const box = {
        x: Math.max(0, Math.min(w - tile, x - tile / 2 + dx * tile)),
        y: Math.max(0, Math.min(h - tileH, y - tileH / 2 + dy * tileH)),
        w: tile, h: tileH,
      };
      if (!clear(box)) continue;
      boxes.push(box);
      placed.push({ mark, ...box });
      break;
    }
  }
  return placed;
}

// The caption after the word "network": what the networks made, then the one field that may come from the ridge.
function sourceWords(nets, hasTemp, hasPressure) {
  const made = [];
  if (nets.includes('cloud')) made.push('cloud');
  if (hasTemp && nets.includes('temp')) made.push('temperature');
  if (hasPressure && nets.includes('pressure')) made.push('pressure');
  if (hasTemp && !nets.includes('temp')) made.push('ridge temperature');
  return made.join(', ');
}

if (typeof module !== 'undefined') module.exports = { MAP_RATIO, ZOOM_MIN, BANDS, BANDS_DIM, mapPlace, mapCell, mapPoint, mapOn, mapAt, gridIndex, fieldAt, seenFrom, chooseField, wrapYaw, percentGlyph, terrainBand, contours, pressureMarks, placeMarks, sourceWords };
