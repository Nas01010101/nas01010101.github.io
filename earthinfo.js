// The words under the map, worked out from the day's grids and the orbits. Pure, so the tests can reach them.
'use strict';

// World mean by cell area, and where the day's extremes sit. Grids run south to north, west to east.
function dayFacts(grid, temp, pressure, rows, cols) {
  const placeOf = i => {
    const col = i % cols, row = (i - col) / cols;
    return { lat: ((row + .5) / rows - .5) * Math.PI, lon: ((col + .5) / cols - .5) * 2 * Math.PI };
  };
  const extreme = (values, better) => {
    if (!values) return null;
    let at = 0;
    for (let i = 1; i < values.length; i++) if (better(values[i], values[at])) at = i;
    return { value: values[at], ...placeOf(at) };
  };
  let cloud = null;
  if (grid) {
    let sum = 0, weight = 0;
    for (let i = 0; i < grid.length; i++) {
      const area = Math.cos(placeOf(i).lat);
      sum += grid[i] * area;
      weight += area;
    }
    cloud = sum / weight;
  }
  return {
    cloud,
    hot: extreme(temp, (a, b) => a > b),
    cold: extreme(temp, (a, b) => a < b),
    low: extreme(pressure, (a, b) => a < b),
  };
}

// "11N 8E" from radians.
function placeWords(lat, lon) {
  const part = (angle, plus, minus) => `${Math.round(Math.abs(angle) * 180 / Math.PI)}${angle < 0 ? minus : plus}`;
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
}

// Typical miss is the root mean square on the 28 sealed days 2026-10-07 to 2026-11-03, written out in the forecast repo. Shown until a week of issued forecasts has been scored.
const MODEL_FIELDS = {
  cloud: { word: 'cloud', miss: 'cloud 19\u00a0points', show: v => `${Math.round(v)}\u00a0points` },
  temp: { word: 'temperature', miss: 'temperature 0.9°C', show: v => `${v.toFixed(1)}°C` },
  pressure: { word: 'pressure', miss: 'pressure 2.6\u00a0hPa', show: v => `${v.toFixed(1)}\u00a0hPa` },
};
const SCORED_DAYS = 7;

// Root mean square miss over the days the networks forecast, beside the miss of repeating the day before. The file keeps mean squares.
function scoreFacts(losses) {
  const rows = (Array.isArray(losses) ? losses : []).filter(r => r && r.net), out = { days: rows.length };
  for (const name of Object.keys(MODEL_FIELDS)) {
    const kept = rows.map(r => r[name]).filter(v => v && Number.isFinite(v.model) && Number.isFinite(v.repeat));
    const rms = key => Math.sqrt(kept.reduce((sum, v) => sum + v[key], 0) / kept.length);
    out[name] = kept.length ? { model: rms('model'), repeat: rms('repeat') } : null;
  }
  return out;
}

// Who made the map on screen: { net, from, lines }. `net` is shown green, `from` is the plain source. `scores` is scoreFacts of the published losses, if any.
function modelWords(kind, nets, hasTemp, hasPressure, settled, scores) {
  if (kind === 'network') {
    const made = ['cloud', 'temp', 'pressure'].filter(name => nets.includes(name) && (name !== 'temp' || hasTemp) && (name !== 'pressure' || hasPressure));
    const words = made.map(name => MODEL_FIELDS[name].word), many = made.length > 1;
    const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
    const lines = [
      'trained on 40 years of world weather',
      `${many ? 'read' : 'reads'} the past 30 days, forecast${many ? '' : 's'} today's ${list}`,
    ];
    if (hasTemp && !nets.includes('temp')) lines.push('temperature: ridge regression, a straight-line fit');
    if (scores && scores.days >= SCORED_DAYS && made.every(name => scores[name])) {
      lines.push(`typical miss, last ${scores.days} days: ${made.map(name => `${MODEL_FIELDS[name].word} ${MODEL_FIELDS[name].show(scores[name].model)}`).join(', ')}`);
      lines.push(`repeating the day before misses by ${made.map(name => MODEL_FIELDS[name].show(scores[name].repeat)).join(', ')}`);
    } else lines.push(`typical miss on 28 test days: ${made.map(name => MODEL_FIELDS[name].miss).join(', ')}`);
    return { net: many ? 'our neural networks' : 'our neural network', from: '', lines };
  }
  if (kind === 'meteo') return { net: '', from: "Open-Meteo's forecast, not ours", lines: ['our network has no forecast for this date yet'] };
  return { net: '', from: settled ? 'no forecast reached this page' : 'loading forecast', lines: [] };
}

// Share of objects under 2,000 km, and the median time for one lap in minutes. a is in Earth radii, mDot in radians a second.
function fleetFacts(orb, earthKm) {
  if (!orb.n) return { n: 0, lowShare: 0, lapMin: 0 };
  const laps = new Float32Array(orb.n);
  let low = 0;
  for (let i = 0; i < orb.n; i++) {
    if ((orb.a[i] - 1) * earthKm < 2000) low++;
    laps[i] = 2 * Math.PI / orb.mDot[i] / 60;
  }
  laps.sort();
  return { n: orb.n, lowShare: low / orb.n, lapMin: laps[orb.n >> 1] };
}

// Hours ahead the satellite forecast offers; 0 is the present.
const LEADS = [0, 1, 6, 24];
const leadLabel = hours => (hours ? `+${hours}\u00a0h` : 'now');
// When the dots are drawn for, as words: "now", or "in 6 h, 00:12 UTC".
const leadWords = (hours, ms) => (hours ? `in ${hours}\u00a0h, ${new Date(ms + hours * 36e5).toISOString().slice(11, 16)}\u00a0UTC` : 'now');
const dotWords = hours => (hours
  ? `each dot: one object in ${hours}\u00a0h, its published orbit run forward, no neural network`
  : 'each dot: one object at this second, from its published orbit, no neural network');

if (typeof module !== 'undefined') module.exports = { dayFacts, placeWords, scoreFacts, modelWords, fleetFacts, LEADS, leadLabel, leadWords, dotWords };
