// Layout and performance matrix for the site. Run through browser_run_code_unsafe.
// Published data is served from a synthetic fixture, so these runs say nothing about real weather.
async (page) => {
  const fixture = '/path/to/fixture/'; // Directory written by tests/make_fixture.py in ascii-earth-forecast.
  await page.route('https://raw.githubusercontent.com/**', r => {
    const name = r.request().url().split('/').pop();
    // The fixture has no fleet, so the page takes its fallback and perf runs on the 16,844 real satellites.
    if (name === 'sats.bin') return r.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ path: fixture + name, headers: { 'access-control-allow-origin': '*' } });
  });
  const sizes = [[280,653],[320,568],[320,640],[360,740],[390,844],[430,932],[568,320],[667,375],[844,390],[932,430],[600,960],[768,1024],[820,1180],[1024,768],[1024,1366],[1280,600],[1280,800],[1440,900],[1920,1080],[2560,1440],[3440,1440],[900,500],[1000,1100]];
  const probe = () => {
    const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY }; };
    const copy = rect(document.getElementById('copy')), note = rect(document.getElementById('note')), read = rect(document.getElementById('reading')), link = rect(document.getElementById('what'));
    const ink = [...document.querySelectorAll('#copy .t, #note .t, #reading .t, #what .t')].map(e => e.getBoundingClientRect());
    const inkR = Math.max(...ink.map(r => r.right)), inkL = Math.min(...ink.map(r => r.left));
    const o = globe();
    const hit = b => { const dx = Math.max(b.l - o.x, 0, o.x - b.r), dy = Math.max(b.t - o.y, 0, o.y - b.b); return Math.hypot(dx, dy) < o.R * RIM - 1; };
    const over = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const readInk = rect(document.querySelector('#reading .split'));
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inkPast: Math.max(0, Math.round(inkR - innerWidth + 8), Math.round(8 - inkL)),
      font: parseFloat(getComputedStyle(document.documentElement).fontSize),
      globeHitsCopy: hit(copy), globeHitsNote: hit(note), globeHitsReading: hit(read), globeHitsLink: hit(link), copyHitsNote: over(copy, note),
      linkHitsCopy: over(link, copy), linkHitsNote: over(link, note), linkHitsReading: over(link, read), readingHitsCopy: over(read, copy),
      centred: Math.abs((read.l + read.r) / 2 - document.documentElement.clientWidth / 2) < 2, readingTop: Math.round(read.t), under: link.t >= o.y + o.R * RIM - 2,
      R: Math.round(o.R), offTop: o.y - o.R * RIM < -1,
      scroll: document.documentElement.scrollHeight - innerHeight,
      prStars: pr.length, clouds: !!cover,
    };
  };
  const rows = [];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('http://127.0.0.1:8765/index.html?m=' + Date.now());
    await page.waitForFunction(() => document.getElementById('fleet').style.visibility === '' && document.getElementById('weather').style.visibility === '');
    await page.waitForTimeout(50);
    const p = await page.evaluate(probe);
    const bad = [];
    if (p.overflowX > 0) bad.push('overflowX ' + p.overflowX);
    if (p.inkPast) bad.push('text within 8px of edge by ' + p.inkPast);
    for (const k of ['globeHitsCopy', 'globeHitsNote', 'globeHitsReading', 'globeHitsLink', 'copyHitsNote', 'linkHitsCopy', 'linkHitsNote', 'linkHitsReading', 'readingHitsCopy', 'offTop']) if (p[k]) bad.push(k);
    if (!p.centred) bad.push('reading not centred');
    if (p.readingTop > 32) bad.push('reading not at top');
    if (!p.under) bad.push('link not under planet');
    if (p.R < .18 * Math.min(w, h)) bad.push('planet small');
    if (p.prStars < 6) bad.push('only ' + p.prStars + ' stars for hover');
    if (!p.clouds) bad.push('no clouds');
    rows.push(`${w}x${h} font=${p.font} R=${p.R} scroll=${p.scroll} ${bad.length ? 'BAD: ' + bad.join('; ') : 'ok'}`);
  }

  // Height-only resize: the backing store must follow the canvas.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:8765/index.html?m=' + Date.now());
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.waitForTimeout(300);
  const resize = await page.evaluate(() => ({ cssH: cv.getBoundingClientRect().height, backing: cv.height, H, stretch: +(cv.getBoundingClientRect().height / (cv.height / (cv.width / innerWidth))).toFixed(2) }));

  // Cloud cover on screen tracks the published grid: a fully overcast and a fully clear frame.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:8765/index.html?m=' + Date.now());
  await page.waitForFunction(() => document.getElementById('weather').style.visibility === '');
  const cloudTrack = await page.evaluate(() => {
    const out = {};
    for (const pct of [0, 25, 50, 75, 100]) {
      let hit = 0, tot = 0;
      for (let j = 0; j < MH; j++) { const w = Math.cos((j / MH - .5) * Math.PI); for (let i = 0; i < MW; i++) { tot += w; if (cloudAt(j, i) > threshold(pct)) hit += w; } }
      out[pct] = +(100 * hit / tot).toFixed(1);
    }
    return out;
  });
  // A stale file: every frame is in the past, so the sky must go clear instead of showing an old day.
  const stale = await page.evaluate(() => { showFrame(weather.start + 864e5 * 30); return { cover: !!cover, frameShown }; });

  // Frame cost on a phone, without and with a 6x CPU slowdown.
  const perf = {};
  const cdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const rate of [1, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto('http://127.0.0.1:8765/index.html?m=' + Date.now());
    await page.waitForFunction(() => document.getElementById('fleet').style.visibility === '' && document.getElementById('weather').style.visibility === '');
    perf['x' + rate] = await page.evaluate(async () => {
      const times = [], end = performance.now() + 4000;
      let t = 40;
      while (performance.now() < end) { const a = performance.now(); frame(t += .066); times.push(performance.now() - a); await new Promise(r => setTimeout(r, 66)); }
      times.sort((a, b) => a - b);
      const a = performance.now(); frameShown = -1; showFrame(now()); const upsample = +(performance.now() - a).toFixed(1);
      return { frames: times.length, medianMs: +times[times.length >> 1].toFixed(1), p95Ms: +times[Math.floor(times.length * .95)].toFixed(1), upsample };
    });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.unroute('https://raw.githubusercontent.com/**');
  return { rows, resize, cloudTrack, stale, perf };
}
