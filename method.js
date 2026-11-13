// The live numbers in the method section at the end of the planet page, read from the same forecast.json as the map.
'use strict';

const BAR = 20;

// Daily root mean square miss of the network and of repeating the day before, per field, over the days the networks ran.
// The file keeps mean squares, so each day is square-rooted on its own.
function dailyMisses(losses) {
  const rows = (Array.isArray(losses) ? losses : []).filter(r => r && r.net), out = {};
  for (const name of ['cloud', 'temp', 'pressure']) {
    const kept = rows.filter(r => r[name] && Number.isFinite(r[name].model) && Number.isFinite(r[name].repeat));
    out[name] = kept.map(r => ({ date: r.date, model: Math.sqrt(r[name].model), repeat: Math.sqrt(r[name].repeat) }));
  }
  return out;
}

// A bar from zero, BAR characters at `top`, so half the miss draws half the bar.
function bar(value, top) {
  return '█'.repeat(Math.max(1, Math.min(BAR, Math.round(value / (top || value || 1) * BAR))));
}

// Rows of { days, n, corrected, sgp4, model } from the latest satellite score, shortest horizon first.
function satRows(losses) {
  const last = Array.isArray(losses) && losses.length ? losses[losses.length - 1] : null;
  if (!last || !last.days) return { date: '', rows: [] };
  const rows = Object.entries(last.days).map(([days, s]) => ({ days: +days, n: s.n, corrected: s.corrected, sgp4: s.sgp4_km, model: s.model_km }))
    .filter(r => Number.isFinite(r.days) && Number.isFinite(r.sgp4) && Number.isFinite(r.model)).sort((a, b) => a.days - b.days);
  return { date: last.date || '', rows };
}

const UNITS = { cloud: ['cloud', 'points', 0], temp: ['temperature', '°C', 1], pressure: ['pressure', 'hPa', 1] };

// Fills #method-weather and #method-sats. meta is the parsed forecast.json, or null when it did not load.
function renderMethod(meta) {
  const wBox = document.getElementById('method-weather'), sBox = document.getElementById('method-sats');
  if (!wBox || !sBox) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  wBox.replaceChildren();
  sBox.replaceChildren();
  if (!meta) {
    wBox.append(el('p', 'm', 'the scores did not load'));
    sBox.append(el('p', 'm', 'the scores did not load'));
    return;
  }
  const daily = dailyMisses(meta.weather && meta.weather.losses), days = daily.cloud.length;
  if (!days) wBox.append(el('p', 'm', 'no scored network forecasts yet'));
  else {
    wBox.append(el('p', '', `Last ${days} scored day${days > 1 ? 's' : ''}, ${daily.cloud[0].date} to ${daily.cloud[days - 1].date}.`));
    const pre = el('pre');
    for (const [name, [word, unit, dp]] of Object.entries(UNITS)) {
      const d = daily[name];
      if (!d.length) continue;
      const rms = key => Math.sqrt(d.reduce((s, r) => s + r[key] ** 2, 0) / d.length), net = rms('model'), rep = rms('repeat'), top = Math.max(net, rep);
      pre.append(el('span', '', `${word}, ${unit}\n`));
      pre.append(el('span', 'net', `  network    ${bar(net, top).padEnd(BAR)} ${net.toFixed(dp)}\n`));
      pre.append(el('span', 'm', `  yesterday  ${bar(rep, top).padEnd(BAR)} ${rep.toFixed(dp)}\n`));
    }
    wBox.append(pre);
  }
  const sat = satRows(meta.satellites && meta.satellites.losses);
  if (!sat.rows.length) { sBox.append(el('p', 'm', 'no scored satellite forecasts yet')); return; }
  sBox.append(el('p', '', `Median miss in km, scored on ${sat.date}.`));
  const pre = el('pre');
  pre.append(el('span', 'm', 'days  objects  corrected   SGP4  network\n'));
  for (const r of sat.rows) pre.append(el('span', '', `${String(r.days).padStart(4)}  ${String(r.n).padStart(7)}  ${String(r.corrected).padStart(9)}  ${r.sgp4.toFixed(1).padStart(5)}  ${r.model.toFixed(1).padStart(7)}\n`));
  sBox.append(pre);
  const none = sat.rows.filter(r => r.corrected === 0).map(r => r.days);
  if (none.length) sBox.append(el('p', 'm', `At ${none.join(' and ')} days the forecasts began before the network ran, so their miss is SGP4's.`));
}

if (typeof module !== 'undefined') module.exports = { dailyMisses, bar, satRows };
