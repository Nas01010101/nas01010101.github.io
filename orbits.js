// Satellite positions from mean elements: Kepler plus the J2 secular drift and CelesTrak's drag term.
// A full SGP4 costs too much for 17,000 objects at 15 fps; tests/orbits.test.cjs measures the difference.
const RE = 6378.135, KE = 60 / Math.sqrt(RE ** 3 / 398600.8), J2 = .001082616, DEG = Math.PI / 180, DAY = 86400, TAU = 2 * Math.PI;

function loadOrbits(buffer) {
  const base = new DataView(buffer).getFloat64(0, true), raw = new Float32Array(buffer, 8), n = raw.length / 8;
  const o = { base, n, off: new Float32Array(n), a: new Float32Array(n), e: new Float32Array(n), b: new Float32Array(n), ci: new Float32Array(n), si: new Float32Array(n),
    raan: new Float32Array(n), raanDot: new Float32Array(n), argp: new Float32Array(n), argpDot: new Float32Array(n), m: new Float32Array(n), mDot: new Float32Array(n), drag: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const k = i * 8, e = raw[k + 2], inc = raw[k + 3] * DEG, ci = Math.cos(inc), no = raw[k + 1] * TAU / 1440, beta2 = 1 - e * e, beta = Math.sqrt(beta2);
    // Elements are Kozai means; recover the Brouwer mean motion and axis the way SGP4 does.
    const a1 = (KE / no) ** (2 / 3), f = .75 * J2 * (3 * ci * ci - 1) / (beta * beta2);
    const d1 = f / (a1 * a1), a0 = a1 * (1 - d1 / 3 - d1 * d1 - 134 / 81 * d1 ** 3), d0 = f / (a0 * a0);
    const nn = no / (1 + d0) / 60, a = a0 / (1 - d0), p2 = (a * beta2) ** 2;
    o.off[i] = raw[k]; o.a[i] = a; o.e[i] = e; o.b[i] = beta; o.ci[i] = ci; o.si[i] = Math.sin(inc);
    o.raan[i] = raw[k + 4] * DEG; o.raanDot[i] = -1.5 * J2 * ci / p2 * nn;
    o.argp[i] = raw[k + 5] * DEG; o.argpDot[i] = .75 * J2 * (5 * ci * ci - 1) / p2 * nn;
    o.m[i] = raw[k + 6] * DEG; o.mDot[i] = nn * (1 + .75 * J2 * beta * (3 * ci * ci - 1) / p2);
    o.drag[i] = raw[k + 7] * TAU / (DAY * DAY);
  }
  return o;
}

// Writes x, y, z per satellite to out, in Earth radii in the true-equator frame. from and to limit it to a slice of the fleet.
function orbitsAt(o, ms, out, from = 0, to = o.n) {
  const now = (ms - o.base) / 1000;
  for (let i = from; i < to; i++) {
    const dt = now - o.off[i], e = o.e[i], M = o.m[i] + dt * (o.mDot[i] + dt * o.drag[i]);
    let E = M;
    for (let k = 0; k < (e > .05 ? 8 : 2); k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const cE = Math.cos(E), q = 1 - e * cE, r = o.a[i] * q, nu = Math.atan2(o.b[i] * Math.sin(E), cE - e);
    const u = nu + o.argp[i] + dt * o.argpDot[i], W = o.raan[i] + dt * o.raanDot[i];
    const cu = Math.cos(u), su = Math.sin(u), cW = Math.cos(W), sW = Math.sin(W);
    out[i * 3] = r * (cW * cu - sW * su * o.ci[i]);
    out[i * 3 + 1] = r * (sW * cu + cW * su * o.ci[i]);
    out[i * 3 + 2] = r * su * o.si[i];
  }
}

if (typeof module !== 'undefined') module.exports = { loadOrbits, orbitsAt, RE };
