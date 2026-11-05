# nas01010101.github.io

Personal site. Static HTML, no build step, no dependencies.

- `index.html`: the page. Its comment above `#reading` marks the weekly reading edit.
- `flow.html`: the data flow and scores behind the planet, linked from "what am i seeing here".
- `earth.html`, `earth.js`: the Earth in 3D with every object at its true height, opened by clicking the planet. Search or click a satellite to see where SGP4 and the network put it.
- `planet.js`: the glyph planet and cloud frames used by the 3D view.
- `catalog.js`: reads the day's element file and searches it by name or number.
- `correct.js`: reads `corrections.bin` and applies a network correction to an SGP4 position.
- `vendor/sgp4.js`: satellite.js 7.1.0 propagation, bundled with esbuild, MIT.
- `orbits.js`: propagates the satellites in `sats.bin`.
- `scripts/update_sats.py`: rebuilds `sats.bin` from CelesTrak.

Clouds, rain, scores, element files and corrections come from [ascii-earth-forecast](https://github.com/Nas01010101/ascii-earth-forecast), read from its `data` branch. `sats.bin` here is the fallback when that branch is unavailable.

Tests: `NODE_PATH=<dir with satellite.js> node --test tests/*.test.cjs`. `tests/layout-matrix.js` and `tests/flow-matrix.js` run in a browser.
