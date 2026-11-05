// Layout, state and frame-cost matrix for earth.html. Run through browser_run_code_unsafe with the site on 127.0.0.1:8765.
// Published data comes from a fixture directory, so these runs say nothing about real weather.
async (page) => {
  const root = 'FIXTURES/'; // Replace with the folder holding forecast.json, planet.bin, sats.bin and variants/.
  const shots = 'SHOTS/'; // Replace with the folder for screenshots.
  const CORS = { 'access-control-allow-origin': '*' };
  // files maps a published name to a fixture path, or to null for a 404.
  const serve = async files => {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await page.route('https://raw.githubusercontent.com/**', r => {
      const tail = r.request().url().split('?')[0].split('/data/').pop();
      const file = tail in files ? files[tail] : tail === 'forecast.json' ? 'variants/forecast-pressure.json' : tail;
      if (file === null) return r.fulfill({ status: 404, body: '', headers: CORS });
      return r.fulfill({ path: root + file, headers: CORS });
    });
    if (files.noBundledDots) await page.route('**/sats.bin', r => (r.request().url().includes('127.0.0.1') ? r.fulfill({ status: 404, body: '' }) : r.fallback()));
  };
  const open = async query => {
    await page.goto(`http://127.0.0.1:8765/earth.html?t=2026-11-05T12:00Z${query || ''}&m=${Date.now()}`);
  };
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const probe = () => {
    const box = id => { const el = document.getElementById(id); if (!el || el.hidden || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY }; };
    const over = (a, b) => !!a && !!b && !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const stage = box('stage'), map = box('map'), top = box('top'), note = box('note'), scale = box('scale'), forecast = box('forecast');
    const ink = [...document.querySelectorAll('#top *, #map-read, #map-src, #note .t, #scale-text')].filter(e => e.getClientRects().length && e.textContent).map(e => e.getBoundingClientRect());
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inkPast: Math.max(0, ...ink.map(r => Math.round(r.right - innerWidth + 8)), ...ink.map(r => Math.round(8 - r.left))),
      stage: Math.round(stage.b - stage.t), stageW: Math.round(stage.r - stage.l), map: Math.round(map.b - map.t), mapW: Math.round(map.r - map.l),
      below: map.t >= stage.b - 1, beside: map.l >= stage.r - 1,
      collide: [['note scale', note, scale], ['top map', top, map], ['forecast stage', forecast, stage]].filter(([, a, b]) => over(a, b)).map(([n]) => n),
      cols: mCols, rows: mRows, scroll: document.documentElement.scrollHeight - innerHeight,
    };
  };
  const sizes = [[280,653],[320,568],[320,640],[360,740],[390,844],[430,932],[568,320],[667,375],[844,390],[932,430],[600,960],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,600],[1280,800],[1440,900],[1920,1080],[2560,1440],[3440,1440],[900,500],[1000,1100]];
  await serve({});
  const rows = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await open('');
    await page.waitForFunction(() => orb && mCols, null, { timeout: 20000 });
    await page.waitForTimeout(200);
    if ([1440, 768, 390].includes(w)) await page.screenshot({ path: `${shots}map-${w}.png` });
    const p = await page.evaluate(probe), bad = [];
    const short = h <= 500 && w > h;
    if (p.overflowX > 0) bad.push('overflowX ' + p.overflowX);
    if (p.inkPast) bad.push('text within 8px of edge by ' + p.inkPast);
    if (p.collide.length) bad.push('overlap ' + p.collide.join(', '));
    if (short ? !p.beside : !p.below) bad.push('map not ' + (short ? 'beside' : 'below'));
    if (p.stage < p.map) bad.push(`globe ${p.stage} shorter than map ${p.map}`);
    if (p.cols < 40 || p.rows < 10) bad.push(`map only ${p.cols}x${p.rows} cells`);
    rows.push(`${w}x${h} stage=${p.stageW}x${p.stage} map=${p.mapW}x${p.map} cells=${p.cols}x${p.rows} scroll=${p.scroll} ${bad.length ? 'BAD: ' + bad.join('; ') : 'ok'}`);
  }

  // Each way the data can be missing, wrong or stale, read as the visitor sees it.
  const read = () => ({
    from: $('map-from').textContent, net: !$('map-net').hidden, text: $('map-text').textContent, count: $('count').textContent,
    cloudNote: $('cloud-note').hidden ? null : $('cloud-note').textContent, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  });
  const states = {};
  await page.setViewportSize({ width: 1280, height: 800 });
  const cases = {
    network: [{}, ''],
    noPressure: [{ 'forecast.json': 'variants/forecast-real.json' }, ''],
    oldFormat: [{ 'forecast.json': 'forecast.json' }, ''],
    noGrid: [{ 'forecast.json': 'variants/forecast-dry.json' }, ''],
    forecastFailed: [{ 'forecast.json': null }, ''],
    nothingLoaded: [{ 'forecast.json': null, 'planet.bin': null }, ''],
    noSatFile: [{ 'sats.bin': null }, ''],
    noDots: [{ 'sats.bin': null, noBundledDots: true }, ''],
  };
  for (const [name, [files, query]] of Object.entries(cases)) {
    await serve(files);
    await open(query);
    await page.waitForFunction(() => mCols, null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    states[name] = await page.evaluate(read);
    await page.screenshot({ path: `${shots}state-${name}.png` });
  }

  // Reduced motion: nothing moves until the visitor acts.
  await serve({});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open('');
  await page.waitForFunction(() => orb && mCols);
  await page.waitForTimeout(300);
  const a = await page.evaluate(() => [$('orbit').toDataURL(), $('sky').toDataURL(), clock()].join());
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => [$('orbit').toDataURL(), $('sky').toDataURL(), clock()].join());
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Frame cost on a phone, without and with a 6x CPU slowdown.
  const perf = {};
  const cdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const rate of [1, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await open('');
    await page.waitForFunction(() => orb && mCols, null, { timeout: 60000 });
    perf['x' + rate] = await page.evaluate(async () => {
      const times = [], end = performance.now() + 4000;
      while (performance.now() < end) {
        // The turn makes the map repaint its window, the most expensive thing a frame can do.
        view.yaw += .01; dirty = true;
        const start = performance.now(); tick(); times.push(performance.now() - start);
        await new Promise(r => setTimeout(r, 66));
      }
      times.sort((x, y) => x - y);
      return { frames: times.length, medianMs: +times[times.length >> 1].toFixed(1), p95Ms: +times[Math.floor(times.length * .95)].toFixed(1) };
    });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  return { rows, states, stillSame: a === b, perf, errors };
}
