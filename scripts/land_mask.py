#!/usr/bin/env python3
"""Rewrites the land mask in planet.js from Natural Earth's land polygons.

usage: land_mask.py ne_50m_land.geojson planet.js
Source: https://github.com/nvkelso/natural-earth-vector (geojson/ne_50m_land.geojson, public domain).
Needs numpy.
"""
import base64
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

WIDTH, HEIGHT = 720, 360  # Half a degree, the same numbers as MASK_W and MASK_H in planet.js.
SAMPLES = 3  # Per cell side.
LAND_AT = 3  # Of the 9 samples: below half a cell, so narrow land like Italy or Japan stays.


def rings(geojson):
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        for polygon in polygons:
            yield from polygon


def rasterise(all_rings):
    """Even-odd scan lines. Holes such as the Caspian are rings too, so crossing one turns land off again."""
    rows, cols = HEIGHT * SAMPLES, WIDTH * SAMPLES
    flips = np.zeros((rows, cols + 1), dtype=np.int8)
    for ring in all_rings:
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            if y0 == y1:
                continue
            low, high = min(y0, y1), max(y0, y1)
            for row in range(math.ceil((low + 90) * rows / 180 - .5), math.ceil((high + 90) * rows / 180 - .5)):
                lat = (row + .5) * 180 / rows - 90
                lon = x0 + (lat - y0) / (y1 - y0) * (x1 - x0)
                flips[row, min(cols, max(0, math.ceil((lon + 180) * cols / 360 - .5)))] ^= 1
    inside = np.bitwise_xor.accumulate(flips[:, :cols], axis=1)
    return inside.reshape(HEIGHT, SAMPLES, WIDTH, SAMPLES).sum(axis=(1, 3)) >= LAND_AT


def main(source, target):
    land = rasterise(rings(json.loads(Path(source).read_text())))
    encoded = base64.b64encode(np.packbits(land.ravel(), bitorder="little").tobytes()).decode()
    text = Path(target).read_text()
    text, found = re.subn(r"(const MASK = Uint8Array\.from\(atob\(')[^']*('\))", lambda m: m[1] + encoded + m[2], text)
    if found != 1:
        raise SystemExit("planet.js: no MASK line")
    Path(target).write_text(text)
    print(f"{land.mean():.1%} land, {len(encoded)} characters")


if __name__ == "__main__":
    main(*sys.argv[1:])
