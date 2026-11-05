// The cities under the planet: local clock, day or night, and our forecast for the grid cell each sits in. Pure, so the tests can reach it.
'use strict';
const CITIES = [
  { name: 'Montréal', zone: 'America/Toronto', lat: 45.5, lon: -73.57, place: 'Montreal' },
  { name: 'Kyoto', zone: 'Asia/Tokyo', lat: 35.01, lon: 135.77 },
  // Morocco keeps UTC all year since 2026-09-20 (tzdata 2026c); older browsers still put Africa/Casablanca an hour ahead.
  { name: 'Casablanca', zone: 'UTC', lat: 33.57, lon: -7.59 },
];
const CITY_ROWS = 24, CITY_COLS = 48, CITY_RAD = Math.PI / 180;
// Sunrise and sunset are when the top of the sun crosses the horizon, refraction included.
const HORIZON = Math.sin(-.833 * CITY_RAD);

// The grid cell holding a place, south to north and west to east, as forecast/weather.py picks it.
const cellOf = (lat, lon) => Math.min(CITY_ROWS - 1, Math.floor((lat / 180 + .5) * CITY_ROWS)) * CITY_COLS
  + Math.min(CITY_COLS - 1, Math.floor(((lon / 360 + .5) % 1 + 1) % 1 * CITY_COLS));
const sunHeight = (city, sun) => Math.sin(city.lat * CITY_RAD) * Math.sin(sun.dec)
  + Math.cos(city.lat * CITY_RAD) * Math.cos(sun.dec) * Math.cos(city.lon * CITY_RAD - sun.lon);
const clockIn = (zone, ms) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

// The next sunrise or sunset within a day, to the minute; null under midnight sun or polar night.
function nextSun(city, ms, subsolar) {
  const up = sunHeight(city, subsolar(ms)) > HORIZON;
  for (let t = ms + 6e4; t <= ms + 864e5; t += 6e4) if (sunHeight(city, subsolar(t)) > HORIZON !== up) return { word: up ? 'sunset' : 'sunrise', at: t };
  return null;
}

// Each city's values from the day's grids; the older format kept only Montréal's cell, under places.
function forecastFor(today) {
  const grid = name => (Array.isArray(today[name]) && today[name].length === CITY_ROWS * CITY_COLS ? today[name] : null);
  const cloud = grid('cloud'), temp = grid('temp'), pressure = grid('pressure');
  const num = v => (Number.isFinite(v) ? v : null);
  return CITIES.map(city => {
    const i = cellOf(city.lat, city.lon);
    const kept = city.place && Array.isArray(today.places) ? today.places.find(p => p && String(p.place).includes(city.place)) : null;
    const v = { cloud: num(cloud ? cloud[i] : kept && kept.cloud), temp: num(temp ? temp[i] : kept && kept.temp), pressure: num(pressure && pressure[i]) };
    return v.cloud === null && v.temp === null ? null : v;
  });
}

// The lines under the planet. today is the published forecast for a recent date, or null.
function cityLines(ms, today, subsolar) {
  const values = today ? forecastFor(today) : CITIES.map(() => null), any = values.some(Boolean);
  const cell = (v, unit, width) => (v === null ? '-' : `${Math.round(v)}${unit}`).padStart(width);
  const rows = CITIES.map((city, k) => {
    const v = values[k], when = `${city.name.padEnd(11)}${clockIn(city.zone, ms)} ${sunHeight(city, subsolar(ms)) > HORIZON ? 'day  ' : 'night'}`;
    return any ? when + (v ? cell(v.temp, '', 4) + cell(v.cloud, '%', 6) : cell(null, '', 4) + cell(null, '', 6)) : when.trimEnd();
  });
  const sun = nextSun(CITIES[0], ms, subsolar), here = values[0];
  const detail = [sun && `${sun.word} ${clockIn(CITIES[0].zone, sun.at)}`, here && here.pressure !== null && `${Math.round(here.pressure)} hPa`].filter(Boolean);
  return {
    head: any ? ''.padEnd(11) + 'now'.padEnd(11) + '°C'.padStart(4) + 'cloud'.padStart(6) : '',
    rows,
    detail: detail.length ? `${CITIES[0].name}: ${detail.join(', ')}` : '',
    // A cell is 7.5 degrees on a side, so a coastal city's value mixes in the sea.
    source: any ? 'our forecast, day mean, 800\u00a0km cell' : '',
  };
}

if (typeof module !== 'undefined') module.exports = { CITIES, cellOf, nextSun, forecastFor, cityLines };
