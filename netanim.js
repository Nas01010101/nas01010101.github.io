// Moving ASCII drawings of the two networks in the method section of the planet page:
// a pulse passing through the weather U-Net, and a wave passing through the satellite residual net.
// A frame depends only on its time, so the tests can check any frame without a browser.
// Wrapped in a function: the page's scripts share one global scope, and names like put and field are taken.
(() => {
'use strict';

const COLS = 38; // what a 390px phone shows at the page's font size
const SHADE = ' .:-=+*#%@';
const NODE = '·∘○◉●';

// A grid is rows of [character, class] cells; class '' is full ink, 'm' muted, 'net' the network's green.
const blank = rows => Array.from({ length: rows }, () => Array.from({ length: COLS }, () => [' ', 'm']));
const put = (g, r, c, s, cls = 'm') => [...s].forEach((ch, i) => { if (c + i < COLS) g[r][c + i] = [ch, cls]; });

// 0 to 1 from three integers, so each node's flicker is fixed for a given cycle.
function hash(a, b, c) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// A drifting field that looks like cloud, drawn until the real data loads; `cell` columns share one value, so deeper levels look coarser.
function field(x, y, t, cell) {
  const cx = Math.floor(x / cell) * cell, cy = Math.floor(y / cell) * cell;
  const v = 0.5 + 0.28 * Math.sin(cx * 0.7 + t * 0.9) * Math.cos(cy * 1.3 - t * 0.6) + 0.22 * Math.sin((cx + cy) * 0.45 + t * 0.5);
  return SHADE[Math.max(0, Math.min(SHADE.length - 1, Math.floor(v * SHADE.length)))];
}

// The U-Net: encoder down the left, decoder up the right, skip links across. Each block is a small world map,
// north up, that halves as the grid does: A is the input day, D the network's forecast for today.
const BLOCKS = [ // name, first row, rows, first column, width
  ['A', 1, 6, 0, 12], ['B', 8, 3, 3, 6], ['C', 12, 2, 4, 4], ['G', 14, 1, 17, 2],
  ['F', 12, 2, 30, 4], ['E', 8, 3, 29, 6], ['D', 1, 6, 26, 12],
];
const SKIPS = [[3, 12, 14], [9, 9, 20], [12, 8, 22]]; // row, first column, length: full, half and quarter grid
const UNET_PERIOD = 5.6, DAY_STEP = 0.3; // seconds a pulse takes, seconds each input day is shown
const GRID_H = 24, GRID_W = 48; // the forecast grid, 7.5 degrees, row 0 at the south pole
const CLOUD = '·.:-=+*#%@'; // 0 to 100% cloud; the clear end is a dot so the land or sea colour shows

// Mean of a 24 × 48 grid over each of h × w cells, north row first.
function pool(grid, h, w) {
  const out = new Float64Array(h * w);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const r0 = Math.floor(r * GRID_H / h), r1 = Math.floor((r + 1) * GRID_H / h), c0 = Math.floor(c * GRID_W / w), c1 = Math.floor((c + 1) * GRID_W / w);
    let s = 0;
    for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) s += grid[(GRID_H - 1 - y) * GRID_W + x];
    out[r * w + c] = s / ((r1 - r0) * (c1 - c0));
  }
  return out;
}

// Sea (-1) or a land height band (0 low to 3 high) for each cell of every block size, by majority of 16 points in the cell.
// land(lat, lon) and band(lat, lon) take radians; on the page they are the globe's own coastline and ERA5 terrain.
function groundGrids(land, band) {
  const out = {};
  for (const [, , h, , w] of BLOCKS) {
    const g = out[`${h}x${w}`] = new Int8Array(h * w);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const votes = [0, 0, 0, 0];
      let sea = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const lat = (0.5 - (r + (i + 0.5) / 4) / h) * Math.PI, lon = ((c + (j + 0.5) / 4) / w - 0.5) * 2 * Math.PI;
        if (land(lat, lon)) votes[band(lat, lon)]++; else sea++;
      }
      const most = votes.indexOf(Math.max(...votes));
      g[r * w + c] = 16 - sea >= 6 ? most : -1;
    }
  }
  return out;
}

// data, when the files have loaded: { days: [{ date, cloud }], today: { date, cloud }, ground: groundGrids(...) }.
// The input block steps through the last 30 days of Open-Meteo cloud; the encoder blocks pool that day,
// the decoder blocks pool the network's forecast. Colour is the ground under each cell: blue sea, green to brown land.
function unetFrame(t, data) {
  const g = blank(17), stage = Math.floor((t % UNET_PERIOD) / UNET_PERIOD * BLOCKS.length);
  const real = data && data.days && data.days.length && data.today && data.ground;
  const day = real && data.days[Math.floor(t / DAY_STEP) % data.days.length];
  put(g, 0, 0, real ? `Open-Meteo ${day.date.slice(5)}` : 'Open-Meteo, 30 days');
  put(g, 0, 25, 'network today', stage === BLOCKS.length - 1 ? 'net' : '');
  BLOCKS.forEach(([name, row, rows, col, width], k) => {
    const dim = k !== stage ? ' d' : '';
    if (!real) {
      const cls = k !== stage ? 'm' : name === 'D' ? 'net' : '';
      for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) g[row + r][col + c] = [field(col + c, row + r, t, GRID_W / width), cls];
      return;
    }
    const cloud = pool(k < 4 ? day.cloud : data.today.cloud, rows, width), ground = data.ground[`${rows}x${width}`];
    for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) {
      const v = cloud[r * width + c], ch = CLOUD[Math.max(0, Math.min(CLOUD.length - 1, Math.floor(v / 100 * CLOUD.length)))];
      g[row + r][col + c] = [ch, `g${ground[r * width + c] + 1}${dim}`];
    }
  });
  // Skip links copy each encoder level across; a dot travels along each one.
  SKIPS.forEach(([row, col, len], k) => {
    put(g, row, col, '┄'.repeat(len));
    put(g, row, col + Math.floor((t * 6 + k * 7) % len), '•', '');
  });
  const lit = s => (s === stage ? '' : 'm');
  put(g, 7, 5, '▼', lit(0)); put(g, 11, 5, '▼', lit(1));
  put(g, 14, 5, '└──────────►', lit(2));
  put(g, 14, 19, '─────────────┘', lit(3));
  put(g, 11, 32, '▲', lit(4)); put(g, 7, 32, '▲', lit(5));
  put(g, 15, 0, 'U-Net, 24×48 → 3×6 → 24×48 grid');
  if (real) {
    put(g, 16, 0, 'sea', 'g0'); put(g, 16, 4, 'low', 'g1'); put(g, 16, 8, 'high', 'g3');
    put(g, 16, 14, '·:=*%@ cloud 0→100%');
  } else put(g, 16, 0, 'cloud, 0 to 100%');
  return g;
}

// The last 30 days of history.npz (numpy savez_compressed of days and cloud) as [{ date, cloud }], oldest first.
// Reads the zip's central directory, inflates the two members with the browser's DecompressionStream.
async function readHistory(buffer, keep = 30) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), files = {};
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    const method = view.getUint16(at + 10, true), nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    let size = view.getUint32(at + 20, true), offset = view.getUint32(at + 42, true);
    // Sizes or offsets too big for 32 bits move to a zip64 extra field, in this order.
    for (let e = at + 46 + nameLen; e < at + 46 + nameLen + extraLen;) {
      const id = view.getUint16(e, true), len = view.getUint16(e + 2, true);
      if (id === 1) {
        let p = e + 4;
        if (view.getUint32(at + 24, true) === 0xffffffff) p += 8;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(p, true)); p += 8; }
        if (offset === 0xffffffff) offset = Number(view.getBigUint64(p, true));
      }
      e += 4 + len;
    }
    files[new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))] = { method, size, offset };
    at += 46 + nameLen + extraLen + commentLen;
  }
  const member = async name => {
    const f = files[name];
    if (!f) throw new Error(`${name} missing`);
    const start = f.offset + 30 + view.getUint16(f.offset + 26, true) + view.getUint16(f.offset + 28, true), raw = bytes.slice(start, start + f.size);
    if (f.method === 0) return raw;
    return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  };
  const npy = b => {
    const v = new DataView(b.buffer, b.byteOffset), headLen = b[6] === 1 ? v.getUint16(8, true) : v.getUint32(8, true), start = (b[6] === 1 ? 10 : 12) + headLen;
    const head = new TextDecoder().decode(b.subarray(b[6] === 1 ? 10 : 12, start));
    return { descr: /'descr':\s*'([^']+)'/.exec(head)[1], shape: /'shape':\s*\(([^)]*)\)/.exec(head)[1].split(',').filter(s => s.trim()).map(Number), data: b.slice(start) };
  };
  const days = npy(await member('days.npy')), cloud = npy(await member('cloud.npy'));
  if (cloud.descr !== '<f8' || cloud.shape[1] !== GRID_H || cloud.shape[2] !== GRID_W) throw new Error('unexpected cloud array');
  const width = +days.descr.slice(2), chars = new Uint32Array(days.data.buffer), all = new Float64Array(cloud.data.buffer), cell = GRID_H * GRID_W;
  const out = [];
  for (let k = Math.max(0, cloud.shape[0] - keep); k < cloud.shape[0]; k++) {
    out.push({ date: String.fromCodePoint(...chars.subarray(k * width, (k + 1) * width)).replace(/\0+$/, ''), cloud: all.subarray(k * cell, (k + 1) * cell) });
  }
  return out;
}

// The residual net: inputs, 6 hidden blocks, 3 outputs, then what the correction does along the track.
const LAYERS = [1, 5, 8, 11, 14, 17, 20, 24]; // columns: input, 6 blocks, output
const OUTPUTS = ['height', 'along', 'cross'];
const WAVE = 3, DAYS = 15;

function mlpFrame(t) {
  const g = blank(10), cycle = Math.floor(t / WAVE), front = (t % WAVE) / WAVE * 30 - 2;
  put(g, 0, 0, 'CelesTrak orbits');
  put(g, 0, 24, 'correction');
  const act = (col, row) => Math.exp(-(((col - front) / 3) ** 2)) * (0.35 + 0.65 * hash(col, row, cycle));
  LAYERS.forEach((col, k) => {
    const out = k === LAYERS.length - 1, rows = out ? [2, 3, 4] : [1, 2, 3, 4, 5];
    for (const row of rows) {
      const a = act(col, row), next = LAYERS[k + 1];
      put(g, row, col, NODE[Math.min(NODE.length - 1, Math.floor(a * NODE.length))], a < 0.4 ? 'm' : out ? 'net' : '');
      if (next && (k < LAYERS.length - 2 || OUTPUTS[row - 2])) put(g, row, col + 1, '─'.repeat(next - col - 1), act(col + 1, row) < 0.3 ? 'm' : '');
      if (out) put(g, row, col + 2, OUTPUTS[row - 2], a < 0.4 ? 'm' : '');
    }
  });
  put(g, 6, 0, 'residual net: 6 blocks × 256, 3 nets');
  // Along the track: SGP4 alone drifts from the truth as the days pass; the corrected dot stays nearer.
  const day = 1 + Math.floor(t % DAYS), off = Math.round(day * day / (DAYS * DAYS) * 18), x = 12;
  put(g, 8, 0, `day ${String(day).padStart(2)}`);
  put(g, 8, 7, '─'.repeat(COLS - 7));
  put(g, 8, x + off, '○', '');
  put(g, 8, x, 'x', '');
  put(g, 8, x + Math.round(off * 0.6), '●', 'net');
  put(g, 9, 0, '● SGP4 + net', 'net'); put(g, 9, 14, '○ SGP4 alone  x truth');
  return g;
}

// One line per row, with runs of the same class in one span. Every character comes from this file, so none needs escaping.
function html(grid) {
  return grid.map(row => {
    let out = '', run = '', cls = null;
    const flush = () => { if (run) out += cls ? `<span class="${cls}">${run}</span>` : run; run = ''; };
    for (const [ch, c] of row) { if (c !== cls) { flush(); cls = c; } run += ch; }
    flush();
    return out;
  }).join('\n');
}

// Draws each pre[data-net]; animates only while one is on screen, and holds one frame under reduced motion.
// The weather drawing switches to real data once forecast.json and history.npz load, fetched when the drawing nears the screen.
function start() {
  const boxes = [...document.querySelectorAll('pre[data-net]')].filter(e => e.dataset.net === 'unet' || e.dataset.net === 'mlp');
  if (!boxes.length) return;
  let data = null, t = 2.2;
  const draw = () => boxes.forEach(e => { e.innerHTML = html(e.dataset.net === 'unet' ? unetFrame(t, data) : mlpFrame(t)); });
  const load = () => {
    if (load.done || typeof FORECAST === 'undefined' || typeof DecompressionStream === 'undefined') return;
    load.done = true;
    const ok = r => (r.ok ? r : Promise.reject(r.status));
    Promise.all([
      fetch(`${FORECAST}forecast.json`).then(ok).then(r => r.json()),
      fetch(`${FORECAST}history.npz`).then(ok).then(r => r.arrayBuffer()).then(b => readHistory(b)),
    ]).then(([meta, days]) => {
      const today = meta && meta.weather && meta.weather.today;
      if (!today || !today.net || !Array.isArray(today.cloud) || today.cloud.length !== GRID_H * GRID_W || !days.length) return;
      data = { days, today, ground: groundGrids(isLand, terrainBand) };
      draw();
    }).catch(() => {}); // the drawing keeps its stand-in field
  };
  draw();
  if (!('IntersectionObserver' in window)) return load();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, shown = new Set();
  const seen = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { shown.add(e.target); load(); } else shown.delete(e.target);
  }), { rootMargin: '600px 0px' });
  boxes.forEach(e => seen.observe(e));
  if (still) return;
  setInterval(() => { if (shown.size && !document.hidden) { t = performance.now() / 1000; draw(); } }, 100);
}

if (typeof module !== 'undefined') module.exports = { unetFrame, mlpFrame, html, pool, groundGrids, readHistory, COLS };
else start();
})();
