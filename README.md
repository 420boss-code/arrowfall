# Arrowfall

A 20 v 20 bow-and-arrow battle in the browser, built with Three.js and Vite, with public online servers. There are no asset files: models are low-poly and generated in code, animation is procedural and every sound comes from the Web Audio API.

## The front page

The site opens as **Numberwell**, a working maths solver and practice page. It solves sums step by step with exact fractions, and has quick-fire practice questions, topic notes and a times-table grid. Type **1+1** into the solver and press Solve (spaces and a trailing "=" are fine) to open the game. The game code and Three.js are a separate download, fetched only at that moment, and the tab title stays the same.

## Running it

```bash
npm install && npm run dev
```

This starts two things side by side: the game server on port 8787 and the Vite dev server. Open the URL Vite prints (normally http://localhost:5173). Vite forwards `/api` and `/ws` to the game server.

Click the game window to capture the mouse. Press Esc for the menu.

## Meshy tree models

The game can use AI-generated tree models from [Meshy](https://www.meshy.ai) instead of its built-in trees. Put GLB files in `public/models/trees/` (`pine_1.glb`, `broadleaf_1.glb`, `bush_1.glb` and so on) and they replace the matching built-in trees and bushes. Anything missing keeps the built-in version.

**Included models.** `public/models/trees/` now holds a Meshy pine, oak and grass clump (see `CREDITS.md` there for prompts and task IDs). Bushes use the built-in model. The Meshy grass is scattered through the built-in grass rather than replacing it, so the field stays dense.

**Generating more.** Creating a Meshy API key needs a paid Meshy plan. In a cloud session where the key is injected by a network proxy, run the script with `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses the proxy. Each model costs about 30 credits (20 for the mesh, 10 for the texture). Run the script on your own machine; it shows the plan and cost and spends nothing until you add `--yes`:

```bash
MESHY_API_KEY=your-key npm run meshy
```

```bash
MESHY_API_KEY=your-key npm run meshy -- --yes
```

Options: `--only pine,broadleaf,bush`, `--variants 2` (default: 2 of each kind, about 180 credits) and `--polycount 1000`. The script saves the models, updates `manifest.json`, and records each prompt and task ID in `CREDITS.md`. The key is read from the environment and never written to disk. You can also make trees in Meshy's web app and export them as GLB with the same names.

**How the game uses them.** Each model is:

- rebased so its trunk sits at the origin, and scaled to the tree it replaces;
- simplified to at most 800 triangles (300 for bushes), with a coarser version at about a fifth of that for distance;
- given a cheap material that sways in the wind;
- shadowed using the coarse version.

Thousands of trees are drawn at once, so these limits matter; they're in `config.js` under `forest`. Check Meshy's terms for how you may use and must credit the models.

## Online play

From the game's start menu choose **Play online – public servers**:

- **Public servers:** three always-on rooms (Greenwood – Team Deathmatch; Hollow Oak – King of the Field; Blackthorn – Hard bots with friendly fire). They sleep while empty and start a fresh match when the first player arrives.
- **Create a server:** pick a name, mode, bot difficulty and friendly fire. Tick or untick "List publicly"; private servers get a five-letter code that friends can enter under "Private server code". Empty player-made servers close after two minutes.
- **Bots fill every slot a human isn't in**, so a server is always 20 v 20. Joining takes over a living bot on the smaller human team; leaving hands the archer back to a bot.

How it works: the server runs the real game simulation headlessly (one copy per room, 60 ticks a second) and is the authority on hits, damage, deaths, arrow counts, rounds and scores. Clients move their own archer immediately and send their position 30 times a second. The server sends compact binary snapshots 20 times a second, plus events for shots, hits, kills, pick-ups and rounds. Every shot a client sends is checked by the server for origin, speed, cooldown and remaining arrows. Between rounds the server waits 10 seconds (15 after a match) and then carries on automatically. The Esc menu doesn't pause an online game.

Abuse limits: names are cleaned to letters, digits, spaces, `_` and `-`. Each IP may make one server every 10 seconds, run at most 3 at once and hold at most 8 connections. Messages are capped at 4 KB and about 120 per second, and the server holds at most 30 rooms. All of these are in `config.js` under `server`.

### Putting the servers on the internet

One Node process serves the site, the API and the WebSockets:

```bash
npm install
```

```bash
npm run build
```

```bash
PORT=8787 npm start
```

Any host that runs a long-lived Node process with WebSockets will do, for example a small VPS, Render, Railway or Fly.io. Use `npm install && npm run build` as the build command and `npm start` as the start command. The host's `PORT` variable is respected. Behind a reverse proxy or platform load balancer, set `TRUST_PROXY=1` so the per-IP limits see real addresses. `/api/health` reports the number of rooms and players. Static hosts such as GitHub Pages can serve the page and offline mode, but not the game server.

## Controls

| Action | Key |
| --- | --- |
| Move | WASD |
| Sprint (uses stamina) | Shift |
| Crouch (quieter, steadier aim, lower view) | C toggles, or hold Ctrl (sprinting or jumping stands you up) |
| Jump | Space |
| Draw / loose | Hold / release left mouse |
| Zoom while drawing | Right mouse |
| Pick up arrows (ground, trees, fallen archers) | E |
| Switch first person (default) / third person | V |
| Scoreboard | Tab |
| Performance overlay | F3 |

**Ctrl+W:** browsers treat Ctrl+W as "close tab", so holding Ctrl to crouch while walking forwards can close the game. Use **C** (toggle) instead, or tick **Fullscreen** in the start menu. Fullscreen turns on the Keyboard Lock API, which captures Ctrl+W in Chromium-based browsers.

**First person** is the default view. Your arms and bow are drawn in a separate pass on top of the world, so they never clip into trees. The string comes back to your cheek as you draw, the view bobs as you walk, the bow kicks on release and drops when you sprint. The HUD shows when you're crouched.

## The game

- **Map:** 300 × 300 m. Dense mixed forest (pines, broadleaves, bushes, gentle hills) surrounds an open circular field 80 m across, with rocks and two fallen logs for cover. Red spawns in the west and Blue in the east.
- **Archery (Minecraft-style bow):** hold to draw. Power follows Minecraft's curve, (f² + 2f) / 3, where f is the fraction of a 1-second draw. That gives about 19% power after 0.25 s, 42% after 0.5 s and full power at 1 s. A tap under 10% power fires nothing and keeps the arrow.
  - Arrows leave at power × 60 m/s (3 blocks a tick) plus your own movement.
  - In flight they lose 1% of their speed every 1/20 s and fall at 20 m/s², so long shots drop a lot: about 1.3 m at 20 m, 5 m at 40 m and 12 m at 60 m.
  - Damage depends on how fast the arrow is going when it lands. Full power deals 6, and every full-power arrow is critical, adding a random bonus for 6–11 in Minecraft terms. These numbers are scaled ×5 because archers here have 100 HP rather than Minecraft's 20, so it's still 2–4 good hits to kill.
  - Critical arrows leave a sparkle trail.
  - Hits knock the target back. For half a second afterwards they can only be hurt by a harder hit, and weaker arrows bounce off.
  - There are no headshots and no hold sway. Accuracy is the same small random scatter whatever you're doing.
  - Drawing slows you to a fifth of walking speed, and the view narrows by up to 15% as you draw; right mouse still zooms further.
  - Stuck arrows can be picked up and despawn after a minute. Trunks and canopies block arrows and sight; bushes block sight only.
  - All of this is in `config.js` under `bow` and `arrows`. Setting `headshotMultiplier` to 2 or `swayMax` above 0 brings those features back.
- **AI:** each bot runs a state machine (patrol → advance → take cover → engage → retreat, plus hold and scavenge). Bots move in squads of four. Cautious squads skirt round the field through the forest; bold ones regroup at the treeline and cross together at a sprint. In the forest they fight from behind trunks, drawing in cover and stepping out to shoot. They lead moving targets with a proper ballistic solution. Difficulty changes aim error, reaction time, aggression, how far ahead they lead and how often they think.
- **Modes:** Team Deathmatch is best of five rounds, won by wiping out the other team (or having more survivors when the 8-minute round timer runs out). King of the Field puts a capture zone in the middle of the clearing: holding it uncontested scores points, fallen archers respawn after 6 s, and the first team to 120 wins.

## Code layout

```
scripts/    meshy-trees.mjs generates tree models with the Meshy API (run locally with your own key)
public/models/trees/        drop-in tree models (GLB) + manifest.json
server/     index.js        HTTP (site, /api/servers, /api/health) + WebSocket, rooms, fixed-step loop
            Room.js         one server: headless authoritative Game, slots, snapshots and events
src/
  config.js                 every tunable: damage, speeds, map and team size, AI difficulty, graphics, server limits
  main.js                   the Numberwell maths page and the 1+1 trigger
  game-entry.js             loaded on demand: game styles and bootstrap
  site/     solver.js       step-by-step exact-fraction arithmetic solver; site.css
  net/      protocol.js     wire format shared by server and client; NetClient.js (browser WebSocket)
  core/     Game.js         main loop, rounds, modes; offline, server (headless) and client roles
            Input.js        keyboard, mouse, pointer lock
            utils.js        seeded RNG, value noise, intersection maths
  world/    Terrain.js      heightfield, ground, wind-swayed grass, sky, lighting, forest/field fog blend
            Forest.js       chunked instanced trees, bushes and ferns with two LODs, props, collision grid, LOS, cover search
            foliage.js      tiered pines, leafy broadleaves, flared trunks, curved grass, ferns, flowers, wind shader
            treeModels.js   loads Meshy (or any GLB) tree models: rebase, simplify, LOD, wind
  entities/ Archer.js       shared archer state and movement physics
            ArcherRenderer.js  all 40 archers in 2 instanced draw calls with procedural animation and IK
            Player.js       player controls, crouch toggle, aiming and the first/third-person camera
            ViewModel.js    first-person arms, bow, string and arrow
  ai/       AIController.js state machine, perception, ballistic aiming
            AIManager.js    squads, routes, time-sliced thinking
  combat/   Projectiles.js  pooled instanced arrows: flight, sticking, pick-ups
            Combat.js       shot release, damage, headshots, friendly fire, kills
  ui/       HUD.js, Minimap.js, Menus.js, styles.css
  audio/    Audio.js        procedural bowstring, whoosh, thuds, footsteps by surface, wind and birdsong
```

## Performance notes

- Trees, bushes, grass, arrows and archer bodies are all drawn with `InstancedMesh`. The forest is split into 50 m chunks, which gives per-chunk frustum culling. Each chunk switches between high- and low-detail geometry depending on its distance from the camera.
- Arrows come from a fixed pool of 1,600. When the pool runs dry, the oldest stuck arrow is recycled.
- AI "thinking" (perception, line-of-sight rays and decisions) is time-sliced: no more than 4 bots think in any one frame, each roughly every 0.2–0.55 s depending on difficulty. Steering and aiming run every frame because they are cheap.
- Distant archers animate at half rate.
- **Adaptive resolution** lowers the render resolution if the frame rate drops below about 50 fps and raises it again when there is headroom. Untick **Shadows** in the start menu for a further boost on weak GPUs.
- Press **F3** in-game to see the frame rate, CPU time per frame, draw calls, triangles, active arrows and AI thinks per frame.

### Measured results

These figures come from a headless Chromium test with Hard bots. All 40 archers were kept alive and fighting in and around the field for 2,400 frames (40 s of battle), which put about 720 arrows into the world:

| Per-frame CPU cost | Average | 99th percentile | Worst frame |
| --- | --- | --- | --- |
| Whole simulation (AI, physics, arrows, animation, HUD) | 0.31 ms | 2.8 ms | 9.0 ms |
| AI only | 0.08 ms | 1.1 ms | 8.3 ms |

- No more than 4 bots ever thought in a single frame, against a 60 fps budget of 16.7 ms.
- The worst views drew 113–166 draw calls and 344–451k triangles, plus the shadow pass.

The test machine has no GPU, so the true GPU frame rate couldn't be measured there. Use F3 on your own machine to check it. If it drops below about 50 fps, adaptive resolution steps in automatically.
