// Geometry of the forecast map under the globe. Angles in radians. Classic script: its names are globals for the viewer.
'use strict';
const MAP_RAD = Math.PI / 180;
// Polar caps look like cloud in glyphs, and cutting them leaves a wider, shorter map.
const MAP_TOP = 66 * MAP_RAD;
// A geostationary ring, 6.6 Earth radii out, has to fit on screen.
const ZOOM_MIN = .1;
const GRID_ROWS = 24, GRID_COLS = 48;

// Longitude as a share of the way round from 180W, in 0..1.
const turnShare = lon => ((lon / (2 * Math.PI) + .5) % 1 + 1) % 1;

// The place at the centre of a map cell; row 0 is the north edge.
function mapPlace(col, row, cols, rows) {
  return { lat: MAP_TOP * (1 - 2 * (row + .5) / rows), lon: (2 * (col + .5) / cols - 1) * Math.PI };
}

function mapCell(lat, lon, cols, rows) {
  if (Math.abs(lat) >= MAP_TOP) return null;
  return {
    col: Math.min(cols - 1, Math.floor(turnShare(lon) * cols)),
    row: Math.min(rows - 1, Math.floor((1 - lat / MAP_TOP) / 2 * rows)),
  };
}

// CSS pixels of a place on a map w wide and h tall, for lines drawn over the glyphs.
const mapPoint = (lat, lon, w, h) => ({ x: turnShare(lon) * w, y: (1 - lat / MAP_TOP) / 2 * h });

// The place under a pixel of that map, held inside the map's edges.
function mapAt(x, y, w, h) {
  const across = Math.max(0, Math.min(1, x / w)), down = Math.max(0, Math.min(1, y / h));
  return { lat: (1 - 2 * down) * MAP_TOP, lon: (2 * across - 1) * Math.PI };
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

// Runs of a ground track, broken at the date line and where it leaves the map; a run needs two points to draw.
function trackSegments(points) {
  const runs = [];
  let run = [];
  const close = () => { if (run.length > 1) runs.push(run); run = []; };
  for (const point of points) {
    if (Math.abs(point.lat) >= MAP_TOP) { close(); continue; }
    if (run.length && Math.abs(point.lon - run[run.length - 1].lon) > Math.PI) close();
    run.push(point);
  }
  close();
  return runs;
}

// An angle in (-pi, pi], the short way round.
const wrapYaw = a => a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));

// Index into planet.js RAMP for a cloud percent; under 5% draws nothing.
const percentGlyph = p => (p < 5 ? -1 : Math.min(8, Math.floor(p / 100 * 9)));

// Far enough back to hold an orbit reaching rMax Earth radii, never closer than the current zoom.
const zoomForOrbit = (rMax, zoom) => Math.max(ZOOM_MIN, Math.min(zoom, 1, 1 / rMax));

if (typeof module !== 'undefined') module.exports = { MAP_TOP, ZOOM_MIN, mapPlace, mapCell, mapPoint, mapAt, gridIndex, fieldAt, seenFrom, chooseField, trackSegments, wrapYaw, percentGlyph, zoomForOrbit };
