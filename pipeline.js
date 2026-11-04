'use strict';
// Draws the forecast model top to bottom, one small layer per step it computes. Only the weights are trained.
// A scan moves down the input map; each row's own characters travel through the band that row belongs to
// and the prediction for that row appears on the output map.
const INPUTS = ['yest', '2d', '3d', 'N', 'S', 'E', 'W'], BAND_NAMES = ['tropics', 'mid-latitudes', 'poles'];
const MAP_ROWS = 24, MAP_COLS = 48, ROW_SECONDS = .4, HOLD_SECONDS = 2, RATE = .9;

// Rows run north to south on a 7.5 degree grid, with the same band limits as the model.
const EMPTY = '. '.repeat(MAP_COLS / 2);
const latOf = row => 90 - (row + .5) * 7.5;
const bandOf = row => { const lat = Math.abs(latOf(row)); return lat < 30 ? 0 : lat < 60 ? 1 : 2; };

function segment([x0, y0], [x1, y1]) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1), dx = x1 - x0, dy = y1 - y0;
  const glyph = Math.abs(dy) * 3 < Math.abs(dx) ? '-' : Math.abs(dx) * 3 < Math.abs(dy) ? '|' : dx * dy > 0 ? '\\' : '/';
  return { glyph, points: Array.from({ length: n + 1 }, (_, i) => [Math.round(x0 + dx * i / n), Math.round(y0 + dy * i / n)]) };
}

// Where everything sits. The layers fill the left of the map's width and their names the right.
const Y = { input: 1, status: 25, names: 31, raw: 32, minus: 34, weight: 36, sum: 42, plus: 46, clip: 48, char: 50, head: 56, output: 57, rows: 81 };
const LABEL_X = 36, MIDDLE = 16, BAND_X = [29, 16, 3], BAND_TEXT = [26, 10, 1];
const nodeX = i => i * 5 + 1, rimX = i => Math.round((i + .5) * MAP_COLS / INPUTS.length);
const LABELS = [[Y.names, 'inputs', 'm'], [Y.minus, 'minus usual', 'm'], [Y.weight, 'times weight', 'g2'], [Y.sum, 'sum', 'm'], [Y.plus, 'plus usual', 'm'], [Y.clip, '0 to 100', 'm'], [Y.char, 'to character', 'm']];
const LINKS = {
  funnel: INPUTS.map((_, i) => segment([rimX(i), Y.status + 1], [nodeX(i), Y.names - 1])),
  minus: INPUTS.map((_, i) => segment([nodeX(i), Y.raw], [nodeX(i), Y.minus])),
  weight: INPUTS.map((_, i) => segment([nodeX(i), Y.minus], [nodeX(i), Y.weight])),
  bands: BAND_X.map(x => ({ in: INPUTS.map((_, i) => segment([nodeX(i), Y.weight + 1], [x, Y.sum - 1])), out: segment([x, Y.sum + 2], [MIDDLE, Y.plus - 1]) })),
  steps: [segment([MIDDLE, Y.plus], [MIDDLE, Y.clip]), segment([MIDDLE, Y.clip], [MIDDLE, Y.char])],
  fan: INPUTS.map((_, i) => segment([MIDDLE, Y.char + 1], [rimX(i), Y.head - 1])),
};

function drawPipeline(box, r, still) {
  const w = r && r.weather, pre = el('pre');
  const input = w ? w.last_scored.actual : [], output = w ? w.today.map : [], bands = w ? w.model.bands : [];
  const names = bands.length ? bands.map(b => b.name) : BAND_NAMES;
  box.replaceChildren(pre);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', w ? `Cloud cover on ${w.last_scored.date} flows row by row through 7 inputs, minus each cell's usual value, times the weights of that row's latitude band, summed, plus the usual value, held to 0 to 100, and becomes the predicted map for ${w.today.date}.` : 'The network with no data in it.');
  pre.style.setProperty('--cols', MAP_COLS);

  function paint(row, reveal, flowing, t) {
    const grid = Array.from({ length: Y.rows }, () => Array.from({ length: MAP_COLS }, () => [' ', '']));
    const set = (x, y, c, k) => { if (grid[y] && x >= 0 && x < MAP_COLS) grid[y][x] = [c, k]; };
    const text = (x, y, value, k) => [...value].forEach((c, i) => set(x + i, y, c, k));
    const active = bandOf(row), weights = bands[active] ? bands[active].weights : [];
    const inRow = input[row] || '', outRow = output[row] || '';

    const line = seg => seg.points.forEach(([x, y]) => set(x, y, seg.glyph, 'g1'));
    // The bands not in use stay visible as sparse dots, so the active fan reads on top of them.
    const faint = seg => seg.points.forEach(([x, y], i) => { if (i % 4 === 2) set(x, y, '.', 'g0'); });
    // Moving characters are the row's own data; a zero weight carries nothing.
    const flow = (seg, count, chars, phase) => {
      const n = seg.points.length;
      for (let j = 0; j < count; j++) {
        const at = Math.floor((((t * RATE + phase + j / count) % 1) + 1) % 1 * n);
        const c = chars[(at * 3 + j) % (chars.length || 1)];
        const [x, y] = seg.points[at];
        set(x, y, !c || c === ' ' ? '.' : c, 'g3');
        if (at) { const [px, py] = seg.points[at - 1]; set(px, py, seg.glyph, 'g2'); }
      }
    };
    // A layer lights up as the pulse passes it, in order from input to output.
    const node = (x, y, depth) => { const lit = flowing && Math.floor(t * RATE * 3) % 6 === depth; set(x, y, lit ? 'O' : 'o', lit ? 'g3' : 'g2'); };

    LINKS.bands.forEach((link, b) => { if (b !== active) { link.in.forEach(faint); faint(link.out); } });
    const own = LINKS.bands[active], straight = [...LINKS.funnel, ...LINKS.minus, ...LINKS.weight, ...own.in, own.out, ...LINKS.steps, ...LINKS.fan];
    straight.forEach(line);
    if (flowing && w) {
      const top = Math.max(...weights.map(Math.abs)) || 1;
      [LINKS.funnel, LINKS.minus, LINKS.weight].forEach(layer => layer.forEach((seg, i) => flow(seg, 1, inRow, i / 7)));
      own.in.forEach((seg, i) => { const size = Math.abs(weights[i] || 0); flow(seg, size < .005 ? 0 : 1 + Math.round(2 * size / top), inRow, i / 7); });
      [own.out, ...LINKS.steps].forEach(seg => flow(seg, 1, outRow, 0));
      LINKS.fan.forEach((seg, i) => flow(seg, 1, outRow, i / 7));
    }

    // Cloud cover is white and only the network is green. The row in flight is inverted so it still stands out.
    input.forEach((rowText, y) => text(0, Y.input + y, rowText, y === row && flowing ? 'scan' : 'map'));
    output.forEach((rowText, y) => text(0, Y.output + y, y < reveal ? rowText : EMPTY, y === row && flowing ? 'scan' : y < reveal ? 'map' : 'dim'));
    text(0, 0, w ? `input: cloud cover ${w.last_scored.date}` : 'input: no data', 'map');
    text(0, Y.head, w ? `prediction: cloud cover ${w.today.date}` : 'prediction: no data', 'map');
    if (w) { const lat = latOf(row); text(0, Y.status, `${Math.abs(lat).toFixed(0)} ${lat < 0 ? 'S' : 'N'}: ${names[active]}`, 'g2'); }
    LABELS.forEach(([y, label, k]) => text(LABEL_X, y, label, k));
    INPUTS.forEach((name, i) => {
      text(i * 5, Y.names, name, 'g3');
      node(nodeX(i), Y.raw, 0);
      node(nodeX(i), Y.minus, 1);
      if (weights.length) text(i * 5, Y.weight, (weights[i] < 0 ? '-' : '+') + Math.abs(weights[i]).toFixed(2).replace(/^0/, ''), 'g3');
      else set(nodeX(i), Y.weight, 'o', 'g2');
    });
    BAND_X.forEach((x, i) => {
      set(x, Y.sum, i === active ? '@' : 'o', i === active ? 'g3' : 'g1');
      text(BAND_TEXT[i], Y.sum + 1, names[i], i === active ? 'g3' : 'm');
    });
    [Y.plus, Y.clip, Y.char].forEach((y, i) => node(MIDDLE, y, i + 3));

    const spans = [];
    grid.forEach((cells, y) => {
      let value = '', k = cells[0][1];
      // A blank joins the span before it, except that an inverted row keeps its own blanks and ends with them.
      for (const [c, kind] of cells) { if (kind !== k && (c !== ' ' || k === 'scan' || kind === 'scan')) { spans.push([value, k]); value = ''; k = kind; } value += c; }
      spans.push([value + (y < grid.length - 1 ? '\n' : ''), k]);
    });
    pre.replaceChildren(...spans.map(([value, k]) => { const e = document.createElement('span'); e.textContent = value; if (k) e.className = k; return e; }));
  }

  const cycle = MAP_ROWS * ROW_SECONDS + HOLD_SECONDS;
  const frame = t => {
    const at = t % cycle, row = Math.min(Math.floor(at / ROW_SECONDS), MAP_ROWS - 1);
    paint(row, row + 1, at < MAP_ROWS * ROW_SECONDS, t);
  };
  if (still || !w) { clearInterval(box.timer); paint(MAP_ROWS >> 1, MAP_ROWS, false, 0); return; }
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
