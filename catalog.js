// Names and full elements behind the dots: a day's element snapshot, in the same order as sats.bin.
'use strict';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCatalog(text) {
  const [head, ...rows] = parseCsv(text), col = name => head.indexOf(name);
  const name = col('OBJECT_NAME'), norad = col('NORAD_CAT_ID'), epoch = col('EPOCH'), anomaly = col('MEAN_ANOMALY');
  if (!rows.length || [name, norad, epoch, anomaly].includes(-1)) throw new Error('catalog columns');
  return {
    head, rows,
    names: rows.map(r => r[name]),
    lower: rows.map(r => r[name].toLowerCase()),
    norads: rows.map(r => +r[norad]),
    anomalies: rows.map(r => +r[anomaly]),
    epochs: rows.map(r => Date.parse(r[epoch].slice(0, 23) + 'Z')),
    index: new Map(rows.map((r, i) => [+r[norad], i])),
  };
}

// True when row i of the catalog is dot i: same count, and each dot's stored mean anomaly (radians) matches its row.
function alignsWith(catalog, orb) {
  if (catalog.rows.length !== orb.n) return false;
  for (let i = 0; i < orb.n; i++) if (Math.abs(orb.m[i] * 180 / Math.PI - catalog.anomalies[i]) > .001) return false;
  return true;
}

// Number first, exact then prefix, then names in catalog order.
function searchCatalog(catalog, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = new Set();
  if (/^\d+$/.test(q)) {
    if (catalog.index.has(+q)) hits.add(catalog.index.get(+q));
    for (let i = 0; i < catalog.norads.length && hits.size < limit; i++) if (String(catalog.norads[i]).startsWith(q)) hits.add(i);
  }
  for (let i = 0; i < catalog.lower.length && hits.size < limit; i++) if (catalog.lower[i].includes(q)) hits.add(i);
  return [...hits].slice(0, limit);
}

// Row i as the record satellite.js reads: text fields stay text, the rest become numbers.
function elementRecord(catalog, i) {
  return Object.fromEntries(catalog.head.map((key, k) => {
    const text = /NAME|ID$|EPOCH|TYPE$/.test(key) && key !== 'NORAD_CAT_ID';
    return [key, text ? catalog.rows[i][k] : +catalog.rows[i][k]];
  }));
}

if (typeof module !== 'undefined') module.exports = { parseCsv, loadCatalog, alignsWith, searchCatalog, elementRecord };
