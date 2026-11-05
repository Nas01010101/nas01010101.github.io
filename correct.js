// The satellite network's stored corrections and how the page applies them. forecast/drift.py pack_corrections writes the file.
'use strict';
const NET_HEADER = 28, NET_TENTHS = 10, NET_NO_MISS = 65535;

function loadCorrections(buffer) {
  if (buffer.byteLength < NET_HEADER) throw new Error('corrections.bin size');
  const view = new DataView(buffer), n = view.getUint32(12, true), count = view.getUint32(16, true);
  const date = String.fromCharCode(...new Uint8Array(buffer, 0, 10));
  if (buffer.byteLength !== NET_HEADER + n * (4 + 6 * count + 4)) throw new Error('corrections.bin size');
  const horizons = Array.from({ length: count }, (_, i) => view.getUint16(20 + 2 * i, true));
  const norad = new Int32Array(buffer, NET_HEADER, n);
  const grid = new Int16Array(buffer, NET_HEADER + 4 * n, n * count * 3);
  const misses = new Uint16Array(buffer, NET_HEADER + 4 * n + 6 * n * count, n * 2);
  return { date, n, horizons, norad, grid, misses, index: new Map(Array.from(norad, (id, row) => [id, row])) };
}

// Height, along and cross in km for an object dt days past its elements, or null where the file has no answer.
// Below the first horizon the network never trained, so it stays silent rather than extrapolate.
// Between horizons a correction grows about as dt squared: at p90, interpolating in dt^2 sits 19-67% as far from running the network as linear in dt.
function correctionAt(table, norad, dt) {
  const row = table.index.get(norad), { horizons } = table, last = horizons.length - 1;
  if (row === undefined || dt < horizons[0] || dt > horizons[last]) return null;
  let high = 1;
  while (high < last && horizons[high] < dt) high++;
  const low = high - 1, k = (dt * dt - horizons[low] ** 2) / (horizons[high] ** 2 - horizons[low] ** 2), at = (row * horizons.length + low) * 3;
  return [0, 1, 2].map(axis => (table.grid[at + axis] * (1 - k) + table.grid[at + 3 + axis] * k) / NET_TENTHS);
}

// The last 1-day forecast's misses in km, SGP4 then network, or null when that forecast was not checked.
function lastMisses(table, norad) {
  const row = table.index.get(norad);
  if (row === undefined || table.misses[row * 2] === NET_NO_MISS) return null;
  return [table.misses[row * 2] / NET_TENTHS, table.misses[row * 2 + 1] / NET_TENTHS];
}

// A correction is truth minus prediction along the predicted orbit (drift._curvilinear), so it adds to r.
function applyCorrection(r, v, [height, along, cross]) {
  const size = Math.hypot(...r), up = r.map(x => x / size);
  const nx = r[1] * v[2] - r[2] * v[1], ny = r[2] * v[0] - r[0] * v[2], nz = r[0] * v[1] - r[1] * v[0], nn = Math.hypot(nx, ny, nz);
  const w = [nx / nn, ny / nn, nz / nn], s = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]];
  const rho = size + height, u = along / size, c = cross / size;
  return [0, 1, 2].map(i => rho * Math.cos(c) * (Math.cos(u) * up[i] + Math.sin(u) * s[i]) + rho * Math.sin(c) * w[i]);
}

if (typeof module !== 'undefined') module.exports = { loadCorrections, correctionAt, lastMisses, applyCorrection };
