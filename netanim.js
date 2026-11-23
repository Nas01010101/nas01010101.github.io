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

// A drifting field that looks like cloud; `cell` columns share one value, so deeper levels look coarser.
function field(x, y, t, cell) {
  const cx = Math.floor(x / cell) * cell, cy = Math.floor(y / cell) * cell;
  const v = 0.5 + 0.28 * Math.sin(cx * 0.7 + t * 0.9) * Math.cos(cy * 1.3 - t * 0.6) + 0.22 * Math.sin((cx + cy) * 0.45 + t * 0.5);
  return SHADE[Math.max(0, Math.min(SHADE.length - 1, Math.floor(v * SHADE.length)))];
}

// The U-Net: encoder down the left, decoder up the right, skip links across. Blocks shrink as the grid halves.
const BLOCKS = [ // name, first row, rows, first column, width, level (1 = full grid)
  ['A', 1, 3, 0, 8, 1], ['B', 5, 2, 2, 6, 2], ['C', 8, 1, 4, 4, 4], ['G', 9, 1, 17, 2, 8],
  ['F', 8, 1, 30, 4, 4], ['E', 5, 2, 30, 6, 2], ['D', 1, 3, 30, 8, 1],
];
const SKIPS = [2, 5, 8]; // one row per full, half and quarter grid
const UNET_PERIOD = 5.6;

function unetFrame(t) {
  const g = blank(12), stage = Math.floor((t % UNET_PERIOD) / UNET_PERIOD * BLOCKS.length);
  put(g, 0, 0, 'Open-Meteo, 30 days');
  put(g, 0, 30, 'today', '');
  BLOCKS.forEach(([name, row, rows, col, width, level], k) => {
    const cls = k !== stage ? 'm' : name === 'D' ? 'net' : '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) g[row + r][col + c] = [field(col + c, row + r, t, level), cls];
  });
  // Skip links copy each encoder level across; a dot travels along each one.
  SKIPS.forEach((row, k) => {
    put(g, row, 9, '┄'.repeat(20));
    put(g, row, 9 + Math.floor((t * 6 + k * 7) % 20), '•', '');
  });
  const lit = s => (s === stage ? '' : 'm');
  put(g, 4, 5, '▼', lit(0)); put(g, 7, 5, '▼', lit(1));
  put(g, 9, 5, '└──────────►', lit(2));
  put(g, 9, 20, '──────────┘', lit(3));
  put(g, 7, 31, '▲', lit(4)); put(g, 4, 31, '▲', lit(5));
  put(g, 11, 0, 'U-Net, 24×48 → 3×6 → 24×48 grid');
  return g;
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
function start() {
  const frames = { unet: unetFrame, mlp: mlpFrame }, boxes = [...document.querySelectorAll('pre[data-net]')].filter(e => frames[e.dataset.net]);
  if (!boxes.length) return;
  const draw = t => boxes.forEach(e => { e.innerHTML = html(frames[e.dataset.net](t)); });
  draw(2.2);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const shown = new Set();
  const seen = new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? shown.add(e.target) : shown.delete(e.target))));
  boxes.forEach(e => seen.observe(e));
  setInterval(() => { if (shown.size && !document.hidden) draw(performance.now() / 1000); }, 100);
}

if (typeof module !== 'undefined') module.exports = { unetFrame, mlpFrame, html, COLS };
else start();
})();
