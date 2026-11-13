# nas01010101.github.io

Personal site. Static HTML, no build step, no dependencies.

- `index.html`: the page.
- `reading.js`: the weekly reading list, newest first. The home page shows the first entry. Every Tuesday: add a line at the top.
- `reading.html`: every paper on that list.
- `flow.html`: redirects to the method section at the end of `earth.html`, linked from "what am i seeing here".
- `method.js`: fills that section's live scores from `forecast.json`.
- `earth.html`, `earth.js`, `earthmap.js`, `mapmath.js`: the Earth in 3D with every object at its true height and the forecast map below it, opened by clicking the planet or the "pale blue dot" link.
- `planet.js`: the glyph planet, land mask and cloud frames used by the home page and the 3D view.
- `orbits.js`: propagates the satellites in `sats.bin`.
- `scripts/update_sats.py`: rebuilds `sats.bin` from CelesTrak.
- `scripts/land_mask.py`: rewrites the land mask in `planet.js` from Natural Earth.

Clouds, rain, scores, element files and corrections come from [ascii-earth-forecast](https://github.com/Nas01010101/ascii-earth-forecast), read from its `data` branch. `sats.bin` here is the fallback when that branch is unavailable.

Tests: `NODE_PATH=<dir with satellite.js> node --test tests/*.test.cjs`. `tests/layout-matrix.js` and `tests/earth-matrix.js` run in a browser.
