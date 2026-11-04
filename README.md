# nas01010101.github.io

Personal site. Static HTML, no build step, no dependencies.

- `index.html`: the page. Its comment above `#reading` marks the weekly reading edit.
- `flow.html`: the data flow and scores behind the planet, linked from "what am i seeing here".
- `orbits.js`: propagates the satellites in `sats.bin`.
- `scripts/update_sats.py`: rebuilds `sats.bin` from CelesTrak.

Clouds, rain and scores come from [ascii-earth-forecast](https://github.com/Nas01010101/ascii-earth-forecast), read from its `data` branch. `sats.bin` here is the fallback when that branch is unavailable.
