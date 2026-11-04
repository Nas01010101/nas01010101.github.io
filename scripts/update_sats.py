#!/usr/bin/env python3
"""Packs CelesTrak's active satellite list into sats.bin for orbits.js.

CelesTrak sends no CORS header and refreshes every 2 hours, so the site serves its own copy.
Layout: float64 base epoch in ms, then for each satellite eight float32s, little-endian:
seconds from base to epoch, mean motion (rev/day), eccentricity, inclination, RAAN,
argument of perigee, mean anomaly (degrees), first derivative of mean motion / 2 (rev/day^2).
"""
import csv, datetime as dt, io, struct, sys, urllib.request

URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv'


def epoch_ms(text):
    return dt.datetime.fromisoformat(text).replace(tzinfo=dt.timezone.utc).timestamp() * 1000


def pack(text):
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SystemExit('no satellites in the download')
    base = max(epoch_ms(r['EPOCH']) for r in rows)
    out = bytearray(struct.pack('<d', base))
    for r in rows:
        out += struct.pack('<8f', (epoch_ms(r['EPOCH']) - base) / 1000, float(r['MEAN_MOTION']), float(r['ECCENTRICITY']),
                           float(r['INCLINATION']), float(r['RA_OF_ASC_NODE']), float(r['ARG_OF_PERICENTER']),
                           float(r['MEAN_ANOMALY']), float(r['MEAN_MOTION_DOT']))
    return bytes(out), len(rows)


def main(path='sats.bin', source=None):
    if source:
        text = open(source, encoding='utf-8').read()
    else:
        req = urllib.request.Request(URL, headers={'User-Agent': 'nas01010101.github.io'})
        text = urllib.request.urlopen(req, timeout=120).read().decode()
    data, n = pack(text)
    open(path, 'wb').write(data)
    print(f'{n} satellites, {len(data)} bytes')


if __name__ == '__main__':
    main(*sys.argv[1:])
