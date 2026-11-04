'use strict';
// Draws one pipeline as a green stream between steps. A pulse lights each step, reads its equations,
// then runs down the stream into the next step. Strips scroll real map rows from the published run.
function drawPipeline(box, steps, still) {
  const W = 48, MID = 15, RAMP = '.:-=+*#%@', STEP_SECONDS = 2.6, READ = .6, FRONT = .4, CURSOR = 2, BAND_SECONDS = 6, LANE = 7;
  const noise = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const blank = () => Array.from({ length: W }, () => [' ', '']);
  const put = (row, x, text, cls) => [...text].forEach((c, i) => { if (x + i < W) row[x + i] = [c, cls]; });
  const runs = (pre, rows) => pre.replaceChildren(...rows.flatMap((row, y) => {
    const out = [];
    let text = '', cls = row[0][1];
    for (const [c, k] of row) { if (k !== cls && c !== ' ') { out.push([text, cls]); text = ''; cls = k; } text += c; }
    out.push([text + (y < rows.length - 1 ? '\n' : ''), cls]);
    return out.map(([value, k]) => { const s = document.createElement('span'); s.textContent = value; if (k) s.className = k; return s; });
  }));

  // One falling streak per column, brightened where the pulse is passing.
  function streak(x, y, rows, t, front, strength = 1) {
    const speed = 3 + 5 * noise(x, 1), length = 5 + 9 * noise(x, 2);
    const fall = (y - t * speed + 40 * noise(x, 3)) / length, tail = fall - Math.floor(fall);
    let v = tail * tail * strength;
    if (front !== null && Math.abs(y - front * rows) < 1.5) v = Math.min(1, v + .75);
    if (v < .08) return null;
    return [RAMP[Math.floor(v * (RAMP.length - 1))], v > .7 ? 'g3' : v > .35 ? 'g2' : v > .18 ? 'g1' : 'g0'];
  }

  // A channel that narrows to the next stream's width and meanders.
  function stream(part, t, front) {
    const { pre, rows, from, to, label } = part, grid = [];
    for (let y = 0; y < rows; y++) {
      const row = blank(), half = (from + (to - from) * y / rows) / 2, mid = MID + Math.round(Math.sin(y * .6 - t * 1.3) * 1.5);
      for (let x = Math.max(0, Math.round(mid - half)); x < Math.min(W, Math.round(mid + half)); x++) {
        const glyph = streak(x, y, rows, t, front);
        if (glyph) row[x] = glyph;
      }
      grid.push(row);
    }
    put(grid[rows >> 1], W - label.length, label, 'm');
    runs(pre, grid);
  }

  // One lane per input, as wide and as bright as its weight, merging into the single output of the next step.
  function lanes(part, t, front) {
    const { pre, rows, names, bands, label } = part, band = bands[still ? 0 : Math.floor(t / BAND_SECONDS) % bands.length];
    const sizes = band.weights.map(Math.abs), top = Math.max(...sizes) || 1, head = [blank(), blank(), blank()], grid = [];
    put(head[0], 0, `${band.name}: 7 inputs x 7 weights`, 'g2');
    names.forEach((name, i) => {
      const w = band.weights[i];
      put(head[1], i * LANE, name, 'g3');
      put(head[2], i * LANE, (w < 0 ? '-' : '+') + Math.abs(w).toFixed(2).replace(/^0/, ''), 'g2');
    });
    for (let y = 0; y < rows; y++) {
      const row = blank(), merged = y / (rows - 1), pull = merged * merged;
      names.forEach((_, i) => {
        const size = sizes[i] / top, home = i * LANE + 2, mid = home + (MID - home) * pull, half = Math.max(.5, (.5 + 2.5 * size) * (1 - .6 * pull));
        for (let x = Math.max(0, Math.round(mid - half)); x < Math.min(W, Math.round(mid + half)); x++) {
          const glyph = streak(x, y, rows, t, front, .35 + .65 * size);
          if (glyph) row[x] = glyph;
        }
      });
      grid.push(row);
    }
    put(grid[rows - 1], W - label.length, label, 'm');
    runs(pre, [...head, ...grid]);
  }

  // Columns behind the cursor brighten; the cursor itself cycles through the ramp.
  function read(part, phase, t) {
    const at = phase * part.blocks.length, grid = part.art.map(row => [...(row || ' ')].map(c => [c, 'g2']));
    part.blocks.forEach((block, k) => {
      const reach = Math.min(1, Math.max(0, at - k)) * block.width;
      for (let y = block.from; y < block.to; y++) grid[y].forEach((cell, x) => {
        if (x >= reach) return;
        cell[1] = 'g3';
        if (reach < block.width && x >= reach - CURSOR && cell[0] !== ' ') cell[0] = RAMP[Math.floor(noise(x + y, Math.floor(t * 20)) * RAMP.length)];
      });
    });
    runs(part.eq, grid);
  }

  const parts = steps.map((step, i) => {
    const title = line('', 'step'), eq = el('pre', 'eq'), art = [], blocks = [];
    step.eq.forEach((e, k) => {
      if (k) art.push('');
      blocks.push({ from: art.length, to: art.length + e.rows.length, width: Math.max(...e.rows.map(r => r.length)) });
      art.push(...e.rows);
    });
    eq.textContent = art.join('\n');
    eq.setAttribute('role', 'img');
    eq.setAttribute('aria-label', step.eq.map(e => e.say).join('. '));
    const part = { title: title.firstChild, name: step.title, eq, art, blocks, text: eq.textContent };
    part.title.textContent = `o ${step.title}`;
    box.append(title, eq);
    for (const d of step.detail) box.append(line(d, 'm'));
    if (step.strip) {
      part.strip = { pre: el('pre', 'strip'), rows: step.strip.rows };
      part.strip.pre.setAttribute('aria-hidden', 'true');
      box.append(part.strip.pre, line(step.strip.caption, 'm'));
    }
    if (step.stream) {
      const pre = el('pre', 'stream'), next = steps[i + 1].stream;
      pre.setAttribute('aria-hidden', 'true');
      part.stream = { pre, ...step.stream, from: step.stream.width, to: next ? next.width : step.stream.width };
      box.append(pre);
    }
    return part;
  });
  const flowOne = (part, t, front) => (part.stream.bands ? lanes : stream)(part.stream, t, front);
  function strips(t) {
    for (const { strip } of parts) {
      if (!strip) continue;
      const shift = Math.floor(t * 2);
      strip.pre.textContent = strip.rows.map(row => { const k = shift % row.length; return (row.slice(k) + row.slice(0, k)).slice(0, W); }).join('\n');
    }
  }

  let lit = 0;
  function frame(t) {
    const clock = t / STEP_SECONDS, now = Math.floor(clock) % parts.length, phase = clock % 1;
    if (now !== lit) { const old = parts[lit]; old.eq.textContent = old.text; old.title.classList.remove('on'); old.title.textContent = `o ${old.name}`; lit = now; }
    parts[now].title.classList.add('on');
    parts[now].title.textContent = `@ ${parts[now].name}`;
    read(parts[now], Math.min(phase / READ, 1), t);
    parts.forEach((p, i) => { if (p.stream) flowOne(p, t, i === now && phase > FRONT ? (phase - FRONT) / (1 - FRONT) : null); });
    strips(t);
  }

  clearInterval(box.timer);
  if (still) { parts.forEach(p => { if (p.stream) flowOne(p, 1, null); }); strips(0); return; }
  let seen = true;
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(box);
  frame(performance.now() / 1000);
  box.timer = setInterval(() => { if (seen && !document.hidden) frame(performance.now() / 1000); }, 100);
}
