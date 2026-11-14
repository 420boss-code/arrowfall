# Tree models

Put tree models here and the game uses them instead of its built-in trees:

- `pine_1.glb`, `pine_2.glb` … – conifers
- `broadleaf_1.glb`, `broadleaf_2.glb` … – deciduous trees
- `bush_1.glb` … – bushes

`npm run meshy` generates them with Meshy (see the main README). Models made in Meshy's web app work too: export as GLB, give them these names and either list them in `manifest.json` or just drop them in. The game finds `<kind>.glb` and `<kind>_1.glb` to `<kind>_3.glb` on its own.

Any size or orientation (Y up) is fine: each model is rebased to its trunk, scaled to fit, simplified to at most 2,500 triangles, and given a coarser version for distance (both limits are in `config.js` under `forest`).
