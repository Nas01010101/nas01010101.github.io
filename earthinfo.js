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

// Typical miss is the root mean square on the 28 sealed days 2026-10-07 to 2026-11-03, written out in the forecast repo.
const MODEL_FIELDS = {
  cloud: { word: 'cloud', miss: 'cloud 19\u00a0points' },
  temp: { word: 'temperature', miss: 'temperature 0.9°C' },
  pressure: { word: 'pressure', miss: 'pressure 2.6\u00a0hPa' },
};

// Who made the map on screen: { net, from, lines }. `net` is shown green, `from` is the plain source.
function modelWords(kind, nets, hasTemp, hasPressure, settled) {
  if (kind === 'network') {
    const made = ['cloud', 'temp', 'pressure'].filter(name => nets.includes(name) && (name !== 'temp' || hasTemp) && (name !== 'pressure' || hasPressure));
    const words = made.map(name => MODEL_FIELDS[name].word), many = made.length > 1;
    const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
    const lines = [
      'trained on 40 years of world weather',
      `${many ? 'read' : 'reads'} the past 30 days, forecast${many ? '' : 's'} today's ${list}`,
    ];
    if (hasTemp && !nets.includes('temp')) lines.push('temperature: ridge regression, a straight-line fit');
    lines.push(`typical miss on 28 test days: ${made.map(name => MODEL_FIELDS[name].miss).join(', ')}`);
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

if (typeof module !== 'undefined') module.exports = { dayFacts, placeWords, modelWords, fleetFacts };
