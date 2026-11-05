// Layout and failure states of flow.html. Run through browser_run_code_unsafe with the site served on 8765.
// Uses a new context because the default one has a frozen clock.
async (page) => {
  const ctx = await page.context().browser().newContext(), p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const url = 'https://raw.githubusercontent.com/Nas01010101/ascii-earth-forecast/data/forecast.json';
  const live = await (await ctx.request.get(url)).json();
  const row = (i, issued) => ({ date: new Date(Date.UTC(2026, 9, 7 + i)).toISOString().slice(0, 10), issued, cloud: { model: 300 + 40 * Math.sin(i), repeat: 400 }, temp: { model: 5, repeat: 6 } });
  const losses = Array.from({ length: 28 }, (_, i) => row(i, i > 20));
  const sat = (i, issued) => ({ date: row(i).date, issued, days: { 1: { n: 9000, sgp4_km: 1.1, model_km: .9 }, 3: { n: 9000, sgp4_km: 3.4, model_km: +(2.5 + Math.sin(i) / 2).toFixed(2) }, 7: { n: 9000, sgp4_km: 12, model_km: 7 } } });
  const satLosses = Array.from({ length: 28 }, (_, i) => sat(i, i > 20));
  const mixed = losses.map((r, i) => ({ ...r, net: i > 20 }));
  const short = [{ date: '2026-10-07', issued: false, days: { 1: { n: 9000, sgp4_km: 1.1, model_km: .9 } } }];
  const states = {
    live,
    network: { ...live, weather: { ...live.weather, model: undefined, today: { ...live.weather.today, net: true }, losses: mixed } },
    ridgeToday: { ...live, weather: { ...live.weather, model: undefined, today: { ...live.weather.today, net: false }, losses: mixed } },
    losses: { ...live, weather: { ...live.weather, losses } },
    replayed: { ...live, weather: { ...live.weather, losses: losses.map(r => ({ ...r, issued: false })) } },
    oneDay: { ...live, weather: { ...live.weather, losses: [row(0, true)] } },
    noLosses: { ...live, weather: { ...live.weather, losses: [] } },
    stale: { ...live, weather: { ...live.weather, losses }, generated: '2026-01-01T00:00:00+00:00', status: { weather: { ok: false, updated: '2026-01-01' } } },
    satRows: { ...live, satellites: { ...live.satellites, losses: satLosses } },
    satOneDay: { ...live, satellites: { ...live.satellites, losses: [sat(0, true)] } },
    satTooShort: { ...live, satellites: { ...live.satellites, losses: short } },
    satGone: { ...live, satellites: undefined },
    missing: null,
  };
  const probe = () => {
    const c = document.documentElement, text = document.body.innerText;
    const clipped = [...document.querySelectorAll('pre')].filter(e => e.scrollWidth > e.clientWidth + 1).length;
    const net = document.querySelector('#pipeline pre');
    return { net: !!net && net.textContent.includes('prediction:') && net.textContent.includes('256 at 6x3'), h: c.scrollHeight, overflow: c.scrollWidth - c.clientWidth, bad: /undefined|NaN|\[object|global|repeat|persistence/.test(text), chart: !!document.querySelector('#loss pre'), noneYet: document.getElementById('loss').innerText.includes('no scored forecasts yet'), satNet: !!document.querySelector('#satnet pre') && document.querySelector('#satnet pre').textContent.includes('block 6'), satChart: !!document.querySelector('#satloss pre'), satNone: document.getElementById('satloss').innerText.includes('no scored forecasts yet'), clipped, state: document.getElementById('state').parentElement.hidden ? '' : document.getElementById('state').textContent };
  };
  const rows = {};
  for (const [name, body] of Object.entries(states)) {
    await p.unroute(url).catch(() => {});
    await p.route(url, r => (body ? r.fulfill({ json: body }) : r.fulfill({ status: 404, body: '' })));
    for (const [w, h] of [[1440, 900], [1200, 800], [900, 700], [768, 1024], [390, 844], [280, 653]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
      await p.waitForTimeout(600);
      const r = await p.evaluate(probe);
      rows[`${name} ${w}`] = `${r.h}px${r.net ? '' : ' NO NETWORK'}${r.overflow > 0 ? ' OVERFLOW ' + r.overflow : ''}${r.bad ? ' BAD TEXT' : ''}${r.chart ? ' chart' : r.noneYet ? ' none yet' : ' NO LOSS'}${r.satNet ? '' : ' NO SAT NET'}${r.satChart ? ' satchart' : r.satNone ? ' satnone' : ' NO SAT LOSS'}${r.clipped ? ' CLIPPED ' + r.clipped : ''}${r.state ? ' state: ' + r.state : ''}`;
    }
  }
  // The picture moves and the output fills; with reduced motion it holds the filled map and stops.
  await p.unroute(url).catch(() => {});
  await p.setViewportSize({ width: 1440, height: 900 });
  const net = () => p.evaluate(() => document.querySelector('#pipeline pre').textContent);
  await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
  await p.waitForSelector('#pipeline pre');
  await p.waitForTimeout(600);
  const a = await net();
  await p.waitForTimeout(700);
  const moves = a !== await net();
  const rc = await ctx.browser().newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } }), q = await rc.newPage();
  await q.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
  await q.waitForTimeout(600);
  const still = () => q.evaluate(() => document.querySelector('#pipeline pre').textContent);
  const b = await still();
  await q.waitForTimeout(700);
  const lines = b.split('\n'), head = lines.findIndex(l => l.startsWith('prediction:'));
  const stops = b === await still(), full = !lines.slice(head + 1, head + 25).some(l => l.endsWith('. . '));
  // The maps on screen are the published rows, character for character, and row r belongs to the model's band.
  const trim = l => l.replace(/ +$/, '');
  const mapsMatch = Array.from({ length: 24 }, (_, y) => trim(lines[1 + y]) === trim(live.weather.last_scored.actual[y]) && trim(lines[head + 1 + y]) === trim(live.weather.today.map[y])).every(Boolean);
  const wide = await q.evaluate(() => getComputedStyle(document.querySelector('#pipeline pre')).getPropertyValue('--cols'));
  await rc.close();
  // Maps stay white and everything between them is green, apart from muted labels.
  const colours = await p.evaluate(() => {
    const head = document.querySelector('#pipeline pre').textContent.split('\n').findIndex(l => l.startsWith('prediction:'));
    const white = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return r === g && g === b; };
    let x = 0, y = 0, mapGreen = 0, netWhite = 0, scanRows = 0;
    for (const s of document.querySelectorAll('#pipeline pre span')) {
      const style = getComputedStyle(s), muted = s.classList.contains('m');
      if (s.className === 'scan') scanRows++;
      for (const c of s.textContent) {
        if (c === '\n') { x = 0; y++; continue; }
        const inMap = (y >= 1 && y < 25) || y >= head;
        if (c !== ' ' && inMap && !white(style.color)) mapGreen++;
        if (c !== ' ' && !inMap && y >= 1 && !muted && white(style.color)) netWhite++;
        x++;
      }
    }
    return { mapGreen, netWhite, scanRows };
  });
  // The loss chart has one column per day: white when issued, grey when replayed, never green. It draws rows as sent.
  await p.route(url, r => r.fulfill({ json: states.losses }));
  await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
  await p.waitForSelector('#loss pre');
  const chart = await p.evaluate(() => {
    const spans = [...document.querySelectorAll('#loss pre span')], ink = spans.filter(s => s.textContent.includes('*'));
    const first = document.querySelector('#loss pre').textContent.split('\n').pop();
    return { whiteBars: ink.filter(s => s.className === 'map').length, greyBars: ink.filter(s => s.className === 'm').length, green: spans.filter(s => /^g\d/.test(s.className)).length, dates: first };
  });
  // The satellite picture moves, shows every layer, and its chart draws the 3-day rows with the latest numbers in words.
  await p.route(url, r => r.fulfill({ json: states.satRows }));
  await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
  await p.waitForSelector('#satloss pre');
  // The chart marks ridge days and network days, and the page says when today's map came from the ridge.
  const said = async body => {
    await p.unroute(url).catch(() => {});
    await p.route(url, r => r.fulfill({ json: body }));
    await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
    await p.waitForSelector('#loss pre');
    return p.evaluate(() => ({ ridge: document.getElementById('about').innerText.includes("Today's map came from ridge"), legend: document.getElementById('loss').innerText.includes('o: ridge'), o: (document.querySelector('#loss pre').textContent.match(/o /g) || []).length, stars: (document.querySelector('#loss pre').textContent.match(/\* /g) || []).length }));
  };
  const marks = { network: await said(states.network), ridgeToday: await said(states.ridgeToday) };
  await p.unroute(url).catch(() => {});
  await p.route(url, r => r.fulfill({ json: states.satRows }));
  await p.goto('http://127.0.0.1:8765/flow.html?m=' + Date.now());
  await p.waitForSelector('#satloss pre');
  const satNet = () => p.evaluate(() => document.querySelector('#satnet pre').textContent);
  const s0 = await satNet();
  await p.waitForTimeout(700);
  const satellite = await p.evaluate(sat => {
    const ink = [...document.querySelectorAll('#satloss pre span')].filter(s => s.textContent.includes('*'));
    const net = document.querySelector('#satnet pre').textContent;
    return {
      white: ink.filter(s => s.className === 'map').length, grey: ink.filter(s => s.className === 'm').length,
      words: document.getElementById('satloss').innerText.includes(`SGP4 ${sat.sgp4_km}, corrected ${sat.model_km}`),
      blocks: (net.match(/block \d/g) || []).length, end: net.trimEnd().endsWith('mean of 3 nets'), green: [...document.querySelectorAll('#satnet pre span')].filter(s => /^g\d/.test(s.className)).length > 0,
    };
  }, satLosses[27].days[3]);
  const satMoves = s0 !== await satNet();
  await ctx.close();
  return { rows, errors, moves, stops, full, mapsMatch, wide, head, colours, chart, marks, satellite, satMoves };
}
