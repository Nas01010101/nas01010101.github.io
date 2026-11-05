'use strict';
// Draws the forecast network top to bottom, one small row per layer it computes. The whole map enters at once, so
// waves of the map's own characters travel down the layers; the prediction appears once the first wave arrives.
const MAP_ROWS = 24, MAP_COLS = 48, ROW_SECONDS = .15, HOLD_SECONDS = 2, RATE = .9;
const WAVE_ROWS_PER_SECOND = 8, WAVE_GAP = 12, FAN_SLOPES = [-3, -2, -1, 0, 1, 2, 3], FAN_ROWS = 4;
const EMPTY = '. '.repeat(MAP_COLS / 2);

// forecast/cloudnet.py: each block is two convolutions, and the row of nodes narrows as the grid halves.
const NET_LAYERS = [
  { nodes: 15, label: '62 inputs' },
  { nodes: 15, label: '64 at 48x24' }, { nodes: 15 },
  { nodes: 11, label: '128 at 24x12' }, { nodes: 11 },
  { nodes: 7, label: '256 at 12x6' }, { nodes: 7 },
  { nodes: 3, label: '256 at 6x3' }, { nodes: 3 },
  { nodes: 7, label: '256 at 12x6' }, { nodes: 7 },
  { nodes: 11, label: '128 at 24x12' }, { nodes: 11 },
  { nodes: 15, label: '64 at 48x24' }, { nodes: 15 },
  { nodes: 1, label: '1 output' },
  { nodes: 1, label: 'plus base' },
  { nodes: 1, label: '0 to 100' },
];
// Each block going down hands its output to the block coming back up at the same grid: [from layer, to layer, column].
const NET_SKIPS = [[2, 13, 0], [4, 11, 4], [6, 9, 8]], BOTTOM_LAYER = 8;
const NET_X = 17, LABEL_X = 36;
const Y = { caption: 25, top: 26, net: 27, fan: 62, head: 66, output: 67, rows: 91 };
const layerY = i => Y.net + 2 * i;
const netColumns = n => Array.from({ length: n }, (_, i) => NET_X + 2 * i - n + 1);
const ARRIVES = (Y.head - Y.top) / WAVE_ROWS_PER_SECOND;

function drawPipeline(box, r, still) {
  const w = r && r.weather, pre = el('pre');
  const input = w ? w.last_scored.actual : [], output = w ? w.today.map : [];
  box.replaceChildren(pre);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', w ? `Cloud cover and six other fields up to ${w.last_scored.date} enter a U-Net drawn top to bottom: 62 inputs, four blocks that halve the grid from 48x24 to 6x3, three blocks that double it back and take the output of the matching block on the way down, one output added to a base forecast, held to 0 to 100, which becomes the predicted map for ${w.today.date}.` : 'The network with no data in it.');
  pre.style.setProperty('--cols', MAP_COLS);

  // moved is how many rows the first wave has travelled, or null in the still picture.
  function paint(row, reveal, moved) {
    const grid = Array.from({ length: Y.rows }, () => Array.from({ length: MAP_COLS }, () => [' ', '']));
    const set = (x, y, c, k) => { if (grid[y] && x >= 0 && x < MAP_COLS) grid[y][x] = [c, k]; };
    const text = (x, y, value, k) => [...value].forEach((c, i) => set(x + i, y, c, k));
    const wave = y => moved !== null && y - Y.top <= moved && (moved - (y - Y.top)) % WAVE_GAP < 2;
    // What travels is the map itself: the input until the narrowest layer and the prediction after it.
    const carried = (x, y) => { const c = ((y < layerY(BOTTOM_LAYER) ? input : output)[y * 5 % MAP_ROWS] || '')[x]; return !c || c === ' ' ? '.' : c; };
    const link = (x, y, glyph) => { const on = wave(y); set(x, y, on ? carried(x, y) : glyph, on ? 'g3' : 'g1'); };

    netColumns(NET_LAYERS[0].nodes).forEach(x => link(x, Y.top, '|'));
    for (let step = 0; step < FAN_ROWS; step++) FAN_SLOPES.forEach(s => link(NET_X + s * (step + 1), Y.fan + step, s < 0 ? '/' : s > 0 ? '\\' : '|'));
    NET_SKIPS.forEach(([from, to, x]) => {
      const first = netColumns(NET_LAYERS[from].nodes)[0];
      for (let y = layerY(from); y <= layerY(to); y++) link(x, y, '|');
      [from, to].forEach(i => { set(x, layerY(i), '+', 'g2'); for (let c = x + 1; c < first; c++) set(c, layerY(i), '-', 'g1'); });
    });
    NET_LAYERS.forEach((layer, i) => {
      const y = layerY(i), on = wave(y), columns = netColumns(layer.nodes), next = NET_LAYERS[i + 1];
      columns.forEach(x => set(x, y, on ? 'O' : 'o', on ? 'g3' : 'g2'));
      if (layer.label) text(LABEL_X, y, layer.label, 'm');
      if (!next) return;
      const below = netColumns(next.nodes);
      columns.forEach(x => {
        // Each node feeds the nearest node below; a straight line needs the same column.
        const target = below.reduce((best, c) => Math.abs(c - x) < Math.abs(best - x) ? c : best);
        link(x, y + 1, target === x ? '|' : target < x ? '/' : '\\');
      });
    });

    // Cloud cover is white and only the network is green. The row being written is inverted so it stands out.
    input.forEach((rowText, y) => text(0, 1 + y, rowText, 'map'));
    output.forEach((rowText, y) => text(0, Y.output + y, y < reveal ? rowText : EMPTY, y === row && moved !== null ? 'scan' : y < reveal ? 'map' : 'dim'));
    text(0, 0, w ? `input: cloud cover ${w.last_scored.date}` : 'input: no data', 'map');
    if (w) text(0, Y.caption, 'and temperature, rain, pressure, wind, vapour', 'm');
    text(0, Y.head, w ? `prediction: cloud cover ${w.today.date}` : 'prediction: no data', 'map');

    const spans = [];
    grid.forEach((cells, y) => {
      let value = '', k = cells[0][1];
      // A blank joins the span before it, except that an inverted row keeps its own blanks and ends with them.
      for (const [c, kind] of cells) { if (kind !== k && (c !== ' ' || k === 'scan' || kind === 'scan')) { spans.push([value, k]); value = ''; k = kind; } value += c; }
      spans.push([value + (y < grid.length - 1 ? '\n' : ''), k]);
    });
    pre.replaceChildren(...spans.map(([value, k]) => { const e = document.createElement('span'); e.textContent = value; if (k) e.className = k; return e; }));
  }

  const cycle = ARRIVES + MAP_ROWS * ROW_SECONDS + HOLD_SECONDS;
  const frame = t => {
    const at = t % cycle, filled = Math.floor((at - ARRIVES) / ROW_SECONDS);
    paint(filled, Math.max(0, Math.min(filled + 1, MAP_ROWS)), at * WAVE_ROWS_PER_SECOND);
  };
  if (still || !w) { clearInterval(box.timer); paint(-1, MAP_ROWS, null); return; }
  animate(box, frame);
}

// Runs a frame ten times a second while the picture is on screen.
function animate(box, frame) {
  clearInterval(box.timer);
  let seen = true;
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(box);
  frame(performance.now() / 1000);
  box.timer = setInterval(() => { if (seen && !document.hidden) frame(performance.now() / 1000); }, 100);
}

// The satellite network, top to bottom. Each row is a layer it has, drawn with fewer nodes than it holds. A block
// is two layers whose output is added back to the block's input, which the bar on the left marks.
const SAT_NODES = 15, SAT_LABEL_X = 34, SAT_BLOCKS = 6;
const SAT_LAYERS = [
  { label: '45 inputs', nodes: SAT_NODES },
  { label: 'linear 256', nodes: SAT_NODES },
  ...Array.from({ length: SAT_BLOCKS }, (_, b) => [
    { label: `block ${b + 1}`, nodes: SAT_NODES, bar: true },
    { label: '', nodes: SAT_NODES, bar: true, closes: true },
  ]).flat(),
  { label: '4 outputs', nodes: 4 },
  { label: '3 corrections', nodes: 3 },
  { label: 'mean of 3 nets', nodes: 3 },
];

function satColumns(n) {
  return Array.from({ length: n }, (_, i) => n === SAT_NODES ? 2 + 2 * i : 2 + Math.round((i + .5) * 2 * SAT_NODES / n));
}

function drawSatNet(box, still) {
  const pre = el('pre');
  box.replaceChildren(pre);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `A network drawn top to bottom: 45 inputs, a layer 256 wide, ${SAT_BLOCKS} residual blocks 256 wide, 4 outputs, 3 corrections, and the mean of 3 such networks.`);
  pre.style.setProperty('--cols', MAP_COLS);
  function paint(lit) {
    const parts = [];
    SAT_LAYERS.forEach((layer, y) => {
      const on = y === lit, row = Array(SAT_LABEL_X).fill(' '), next = SAT_LAYERS[y + 1];
      satColumns(layer.nodes).forEach(x => { row[x] = on ? 'O' : 'o'; });
      if (layer.bar) row[0] = '+';
      parts.push([row.join(''), on ? 'g3' : 'g2'], [`${layer.label}\n`, 'm']);
      if (!next) return;
      const link = Array(SAT_LABEL_X).fill(' '), to = satColumns(next.nodes);
      if (layer.bar && !layer.closes) link[0] = '|';
      satColumns(layer.nodes).forEach(x => {
        // Each node feeds the nearest node below; a straight line needs the same column.
        const target = to.reduce((best, c) => Math.abs(c - x) < Math.abs(best - x) ? c : best);
        link[x] = target === x ? '|' : target < x ? '/' : '\\';
      });
      parts.push([`${link.join('').trimEnd()}\n`, on ? 'g2' : 'g1']);
    });
    pre.replaceChildren(...parts.map(([value, k]) => el('span', k, value)));
  }
  if (still) { clearInterval(box.timer); paint(-1); return; }
  animate(box, t => paint(Math.floor(t * RATE * 4) % (SAT_LAYERS.length + 2)));
}
