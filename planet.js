// The planet both pages draw: sun, land, clouds and glyphs. Classic script: its names are globals for the page's own script.
'use strict';
const RAD = Math.PI / 180, HERE_LAT = 45.5 * RAD, HERE_LON = -73.57 * RAD;
// ?t=2026-06-21T17:00Z previews any moment.
const forced = Date.parse(new URLSearchParams(location.search).get('t') || '');
const now = () => (Number.isNaN(forced) ? Date.now() : forced);
// Where on Earth the sun is overhead, from a truncated solar series.
function subsolar(ms) {
  const n = ms / 864e5 + 2440587.5 - 2451545, g = (357.528 + .9856003 * n) * RAD;
  const lam = (280.46 + .9856474 * n + 1.915 * Math.sin(g) + .02 * Math.sin(2 * g)) * RAD, eps = (23.439 - 4e-7 * n) * RAD;
  return {
    dec: Math.asin(Math.sin(eps) * Math.sin(lam)),
    lon: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) - (280.46061837 + 360.98564736629 * n) * RAD,
  };
}
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = x - xi, v = y - yi, w = z - zi;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w), mix = (p, q, k) => p + (q - p) * k;
  return mix(
    mix(mix(hash(xi, yi, zi), hash(xi + 1, yi, zi), a), mix(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), a), b),
    mix(mix(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), a), mix(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), a), b), c);
}
function fbm(x, y, z, oct) { let s = 0, a = .5, n = 0; for (let i = 0; i < oct; i++) { s += a * noise(x, y, z); n += a; a /= 2; x *= 2; y *= 2; z *= 2; } return s / n; }

// Coastlines: Natural Earth 1:110m land (public domain), one bit per 2.5 degree cell, south edge first.
const MASK = Uint8Array.from(atob('////////////////////////////////////////////////APj///////////////////8PAPz///8fAP7///////////8AgPz///8BcPz///////////8HAMD///8PAMD///////////8BAACAgP/9AAD+//////////8HAAAAAAB8AACg////5/////8PAAAAAAAgAAAAACD+j////x8AAAAAAABAAAAAAABgAAAiAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAMAQAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAIAAAAAAA4AAAAAAAAAAAAAAAQAAAAAAA8AAAAAAAAAAAAAAQgAAAAAAD4AAAAAAAAAAAAAARAAAAAAAD4AQAAAAAAAAAAAA8AAAAAAAD4BwAAgAMAAADAwx8AAAAAAAD4DwAAgA8AAADA/x8AAAAAAAD4DwAAgB8AAADA/x8AAAAAAADwHwAAwB8AAADg/x8AAAAAAADwPwAAwD8GAADg/w8AAAAAAADw/wAA4D8GAADA/w8AAAAAAADw/wAA4D8MAAAA/gcAAAAAAAD4/wAA4P8MAAAAfgIAAAAAAAD+/wAA4P8IAAAAMAAAAAAAAAD+/wEA4P8AAAAAAAAAAAAAAAD//wMA4P8AAACABQEAAAAAAAD//wMA4P8AAAAEgAcAAAAAAAD//wEA8P8AAAACwQMAAAAAAAD/PwAA8P8BAABzMQAAAAAAAAD/DwAA8P8DAABzAAAAAAAAAAD+DwAA8P8HAIBhAAAAAAAAAAD+AQDw/f8PAAEBAAAAAAAAAID+AAD4//8PAIAABAAAAAAAAAAUAAD8//8JwIAGAAAAAAAAAHAAAAD+//8HwIAPAwAAAAAAAB4AAAD+//8e4IEHAQAAAAAAwBsYAAD8/39/4MMLAAAAAAAAwBEAAAD+/3//8OcHAAAAAAAA4AEAAAD8/79/+P9/AQAAAAAA8IEAAAD8/7/P////AAAAAAAA/IMAAADw///3////AQAAAAAA+n8AAADwf9f/////AQAAAAAA/v8BAADgD8D/////IAAAAACA//8DAAAAD+D/////yAAAAACA//8DAADwQPnP//9/BAEAAADA//8HAADwYW/P////DwEAAADA//8PAACA1wf3////PwIAAADA//8/AACA/6/v////fwAAAADA//8vBwDA/////////wAAAADg////AwDA/////////wAAAADw/3//AQCw+P///////8AAAAH4/x9+AABAKP//////f8ABgAf+/wdeAAAAfP7//////wEBwP///wMGcAAAfP7//////38fAP///684+AAB8P7///////9/z////z98+AMC4L/8////////4P//K9wc+B8AgH+g1///////AQIAPvYH+H8AAABguP//7x8AAADAAywA/P8AAABgAP4fAAEAAACAlAnw//8AAAAAB4AfAAAAAAAAyPzz//8A4AAAAAADAAAAAAAAAPCf//8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), ch => ch.charCodeAt(0));
const isLand = (lat, lon) => {
  const i = Math.floor((((lon / (2 * Math.PI) + .5) % 1 + 1) % 1) * 144), j = Math.min(71, Math.floor((lat / Math.PI + .5) * 72)), k = j * 144 + i;
  return MASK[k >> 3] >> (k & 7) & 1;
};
// Cloud layer. Open-Meteo sets how much of each 7.5 degree cell is cloudy and rainy; this noise only draws the edges inside a cell.
// Texture cells fill in as they first face the camera, so the noise never holds up first paint.
const MW = 384, MH = 192, cloud = new Float32Array(MW * MH).fill(-1);
function cloudAt(j, i) {
  const k = j * MW + i;
  if (cloud[k] < 0) {
    const lat = (j / MH - .5) * Math.PI, cl = Math.cos(lat), lon = i / MW * 2 * Math.PI;
    cloud[k] = fbm(cl * Math.sin(lon) * 3 + 9, Math.sin(lat) * 7 + 2, cl * Math.cos(lon) * 3 + 5, 4);
  }
  return cloud[k];
}
// The texture's area-weighted deciles, measured once, so that cover c% leaves c% of the sphere above its threshold.
const DECILES = [.168, .364, .414, .45, .482, .51, .539, .569, .604, .652, .893];
const threshold = pct => { const x = (100 - pct) / 10, i = Math.min(9, Math.floor(x)); return DECILES[i] + (DECILES[i + 1] - DECILES[i]) * (x - i); };
const FORECAST = 'https://raw.githubusercontent.com/Nas01010101/ascii-earth-forecast/data/';
const RAIN_TENTHS = 2; // 0.2 mm/h.
let weather = null, frameShown = -1, cover = null, rain = null;
function loadWeather(buffer) {
  const view = new DataView(buffer), start = view.getFloat64(0, true), frames = view.getUint16(8, true), step = view.getUint16(10, true), rows = view.getUint16(12, true), columns = view.getUint16(14, true);
  if (buffer.byteLength !== 16 + 2 * frames * rows * columns) throw new Error('planet.bin size');
  weather = { start, frames, step: step * 36e5, rows, columns, data: new Uint8Array(buffer, 16) };
}
// Smooths the coarse grid onto the texture's grid. It runs once per forecast frame, so drawing only looks values up.
function showFrame(ms) {
  if (!weather) return;
  const f = Math.round((ms - weather.start) / weather.step);
  // Past the last frame there is no real data for now, so the sky goes clear rather than show an old day.
  if (f < 0 || f >= weather.frames) { cover = rain = null; frameShown = -1; return; }
  if (f === frameShown) return;
  frameShown = f;
  const { rows, columns, frames, data } = weather, cells = rows * columns;
  coverFrom(data.subarray(f * cells), data.subarray((frames + f) * cells), rows, columns);
}
// Percent cloud and tenths of a mm/h rain, south to north and west to east. wet is null for a source without rain.
function coverFrom(clouds, wet, gr, gc) {
  const nextCover = new Float32Array(MW * MH), nextRain = wet && new Uint8Array(MW * MH);
  for (let j = 0; j < MH; j++) {
    const y = Math.max(0, Math.min(gr - 1.001, (j + .5) / MH * gr - .5)), y0 = Math.floor(y), fy = y - y0;
    for (let i = 0; i < MW; i++) {
      const x = (i + .5) / MW * gc - .5, x0 = Math.floor(x), fx = x - x0, a = (x0 + gc) % gc, b = (a + 1) % gc;
      const mix = grid => (grid[y0 * gc + a] * (1 - fx) + grid[y0 * gc + b] * fx) * (1 - fy) + (grid[(y0 + 1) * gc + a] * (1 - fx) + grid[(y0 + 1) * gc + b] * fx) * fy;
      nextCover[j * MW + i] = threshold(mix(clouds));
      if (wet) nextRain[j * MW + i] = mix(wet) >= RAIN_TENTHS;
    }
  }
  cover = nextCover; rain = nextRain;
}

// Stars and text stay grey; colour belongs to the planet, plus one amber mark for Montréal.
const RAMP = '.:-=+*#%@', GLYPHS = RAMP + '|';
const INKS = ['#3a3a3a', '#666', '#969696', '#c8c8c8', '#f2f2f2', '#17406f', '#20609f', '#3a8ad0', '#6cb6ea', '#2f5f3c', '#4a8a4f', '#7bb35f', '#b9cf78', '#ffb347'];
const OCEAN = 5, LAND = 9, HERE = 13, RIM = 1.1;
const DOT = 0, PLUS = 4, DASH = 2, PIPE = 9;

const level = (s, n) => Math.min(n - 1, Math.floor(s * n));
// One cell of the planet as glyph * 256 + ink, or -1 for no glyph.
function surface(lat, lon, shade) {
  const ground = isLand(lat, lon);
  // The night side hides the stars behind it, which keeps it a solid ball; faint land keeps it a planet while the camera passes.
  if (shade < .05) return ground ? LAND : -1;
  const v = Math.min(MH - 1, Math.floor((lat / Math.PI + .5) * MH)), u = Math.floor(((lon / (2 * Math.PI) + .5) % 1 + 1) % 1 * MW) % MW;
  if (cover && cloudAt(v, u) > cover[v * MW + u]) {
    if (rain && rain[v * MW + u]) return PIPE * 256 + OCEAN + 2 + level(shade, 2);
    return (3 + level(shade, 4)) * 256 + 2 + level(shade, 3);
  }
  if (Math.abs(lat) > (ground ? 68 : 78) * RAD) return (4 + level(shade, 4)) * 256 + 2 + level(shade, 3);
  if (ground) return (2 + level(shade, 5)) * 256 + LAND + level(shade, 4);
  // Sea stops at '-' so it never takes the heavy glyphs that draw the continents.
  return level(shade, 3) * 256 + OCEAN + level(shade, 4);
}
// Every glyph in every ink, so a frame only copies rectangles.
function makeAtlas(font, width, height) {
  const atlas = document.createElement('canvas');
  atlas.width = GLYPHS.length * width; atlas.height = INKS.length * height;
  const a = atlas.getContext('2d');
  a.font = font; a.textBaseline = 'top';
  INKS.forEach((ink, y) => { a.fillStyle = ink; for (let x = 0; x < GLYPHS.length; x++) a.fillText(GLYPHS[x], x * width, y * height); });
  return atlas;
}
const download = url => fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)));
