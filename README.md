# Arrowfall

A bow-and-arrow battle in the browser (20 v 20, 10 v 10, 5 v 5, free-for-all or any size you like), built with Three.js and Vite, with public online servers. There are no asset files: models are low-poly and generated in code, animation is procedural and every sound comes from the Web Audio API.

## The front page

The site opens as **Numberwell**, a working maths helper:
- **A step-by-step solver** for sums (with exact fractions, powers, roots, percentages such as "15% of 80", π and trigonometry in degrees) and for **linear equations** such as 3(x − 2) = 2x + 5. Equations are solved the way you would on paper, ending with a check.
- **Quick practice:** seven topics, including equations, with a streak and a count of questions answered today.
- **Printable worksheets:** pick a topic and a length. Each sheet has a name and date line, and its answer key prints on a separate page.
- **Interactive resources** on sets, pi, trigonometry, angles, statistics (mean, median, mode, range), Pythagoras and ratio.
- **Twelve revision notes**, a times-table grid, and About, Help and Privacy pages in the footer.

Type **1+1** and press Solve (spaces and a trailing "=" are fine). The answer, 2, appears like any other sum. A moment later a **class sign-in** card opens, asking for a "student code" (the player code). The page source contains no trace of the game: its markup, code, Three.js and models are a separate download, sent only after sign-in. The tab title stays the same.

### Staying signed in

The sign-in card has **Keep me signed in on this device**, ticked by default. With it ticked, the login lasts 90 days and renews itself as it is used, so typing 1+1 goes straight into the game without the code. Unticked, the login ends when the browser closes (or after 12 hours). Guest logins last a day. Logins are signed tokens rather than server memory, so they survive Render's restarts and sleeps. **Log out** in the game's start menu ends a login straight away. Revoking a code or banning a player still takes effect immediately.

## Running it

```bash
npm install && npm run dev
```

This starts two things side by side: the game server on port 8787 and the Vite dev server. Open the URL Vite prints (normally http://localhost:5173). Vite forwards `/api` and `/ws` to the game server.

Click the game window to capture the mouse. Press Esc for the menu.

## Meshy prop models

The knife and the quiver come from Meshy too: `public/models/props/knife.glb` and `quiver.glb`, made with `scripts/meshy-props.mjs` (untextured meshes at 5 credits each; the game paints them itself – steel, brass and a wrapped handle for the knife, leather with dark bands for the quiver, which also gets a few fletched arrows standing out of it). If either file is missing, built-in shapes are used.

```bash
MESHY_API_KEY=your-key node scripts/meshy-props.mjs --yes
```

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

## Player codes, admin panel and factions

The maths page is public. Typing **1+1** asks for a code, and the server sends nothing else (the game itself, the tree models, the server list and multiplayer) without a login.

- **Players** each have their own 8-digit **player code**: 3 digits of player number (001–999) and a 5-digit check, e.g. `007 70397`. Codes are calculated from the secret `CODE_SECRET` rather than stored, so they keep working on hosts whose disk is wiped on restart. The same number always gives the same code; changing `CODE_SECRET` changes every code.
- **Anyone can make their own code:** the login card has a **New here? Get your own code** button. Self-made codes are 11 digits (a 6-digit player number plus the 5-digit check, e.g. `473040 71934`), and the new player is logged straight in. Each address can make 3 codes an hour, with at most 60 an hour overall. While the server runs, every number is different. After a restart, a repeat is very unlikely but possible, because nothing is stored. The admin can switch sign-up off in the admin panel; setting `ALLOW_SIGNUP=0` keeps it closed at every start.
- **Guests** can choose **Continue without a code** on the sign-in card. A guest gets a one-day session with no player number: they can play offline, join public servers and join parties by code, but cannot start servers or parties, or use friends. Each address can start 10 guest sessions an hour, with at most 300 an hour overall. Guest play starts switched on; setting `ALLOW_GUESTS=0` keeps it off at every start.
- **The admin** logs in with the admin password: a 5-letter word and 2 digits, e.g. `otter58`. This adds an **Admin panel** to the start and pause menus, where the admin can:
  - **Create player codes:** pick a number (the next free one is suggested) and an optional name, then hand the code to that player.
  - **Revoke or restore a code:** revoking logs that player out at once.
  - **See who's online,** with their player numbers, and kick or ban them. A ban revokes only that player's code. Banning a guest blocks guest logins from their address, but leaves anyone there with their own code alone (useful on a shared school or office network).
  - **Switch guest play on or off.** Switching it off logs every guest out at once.
  - **Change the admin password** (until the next restart; set `ADMIN_PASSWORD` to change it for good).
  - **Create and delete factions:** each has a name, a tag of up to 5 letters, and a colour. The tag appears before members' names and members are put on the same team.

**Security:** passwords are stored only as salted scrypt hashes, logins are HMAC-signed tokens in an HttpOnly cookie (90 days with "Keep me signed in", otherwise until the browser closes), and after 5 wrong attempts an address is locked out for 1 minute, growing to 10 minutes with repeated failures. The admin password format is short, so the lockout matters: keep it private.

**Settings (environment variables):**

| Variable | What it does |
| --- | --- |
| `ADMIN_PASSWORD` | The admin password (5 letters + 2 digits) |
| `CODE_SECRET` | Long random secret that player codes are calculated from. Keep it private. |
| `REVOKED_PLAYERS` | Optional: player numbers blocked for good, e.g. `7,12` |
| `ALLOW_SIGNUP` | `0` closes self sign-up at every start; otherwise it starts open |
| `ALLOW_GUESTS` | `0` switches guest play off at every start; otherwise it starts on |
| `DATA_DIR` | Optional: where admin-panel changes are saved |

Changes made in the admin panel (names, revocations, factions, admin password) are saved to `data/auth.json`, which Render's free tier wipes on every restart. Player codes themselves are never lost. For a block that must survive restarts, add the number to `REVOKED_PLAYERS`.

## Match sizes

The start menu and the party menu both offer **Free-for-all, 5 v 5, 10 v 10, 20 v 20 or Custom**.

- **Teams** can be any size from 1 to 20 a side, and need not be even (3 v 7 is fine). Unused places simply aren't in the match.
- **Free-for-all** takes 2 to 40 archers, each in their own colour, spread round a ring at the edge of the clearing. There are no teammates: the minimap shows only rivals within earshot, and every hit counts. It is a single round won by the last archer standing, or by whoever has the most kills when time runs out. King of the Field needs teams, so it is greyed out for free-for-all.
- **Round length** scales with the number of archers: 4 minutes for up to 10, 6 minutes for up to 20, and 8 minutes above that. In small games bots go hunting after 40 seconds of quiet, and standing near your own spawn slowly refills your quiver, so small matches don't stall.

## Online play

From the game's start menu choose **Play online – servers and parties**:

- **Public servers:** three always-on 20 v 20 rooms (Greenwood – Team Deathmatch; Hollow Oak – King of the Field; Blackthorn – Hard bots with friendly fire). They sleep while empty and start a fresh match when the first player arrives. The list shows each server's layout and how many people are in it.
- **Parties:** under **Start a game**, leave "Who can join" on **Party**, pick the match size, mode, bot difficulty and friendly fire, and choose **Create party**. You get a five-letter **party code** to send to friends; they enter it under **Join a party**. The code also shows in the Esc menu while you play. Parties are never listed publicly. Choose **Public** instead to make a listed server. Empty player-made games close after two minutes.
- **Bots:** with **Fill empty places with bots** ticked, bots take every place a human isn't in, so the match is always full. Joining takes over a living bot; leaving hands the archer back. Untick it for people only: the match waits until there is someone on each side (or two people in a free-for-all) and grows as friends arrive.

## Marketplace

**Marketplace** on the start menu sells six items each week. The stock changes every Monday at 00:00 UTC, is the same for everyone (it is picked by a generator seeded with the week number), and one item each week is a 30% deal. There are 35 items in all, so things come back round in later weeks.

- **Cosmetics**, seen by everyone, online too: bow finishes, hood colours, knife finishes, arrow trails (sparkles behind every arrow you shoot) and kill effects (the colour of the burst when you take someone down). Common 150, rare 300, epic 500 silver.
- **Perks**: one equipped at a time, 500–900 silver:
  - Deep Quiver: 6 more arrows at the start of each life, and 6 more carried.
  - Field Medic: 3 bandages a life instead of 2.
  - Fleet Foot: 5% faster.
  - Iron Lungs: 20% more stamina.
  - Steady Hands: full draw in 0.9 s instead of 1 s.
  - Herbalist: herbs heal 60 instead of 40.
  - Quick Blade: stab again 25% sooner.
  - Second Wind: natural healing starts after 4 s instead of 6.
- **Silver** is earned in every match, offline or online: 2 for a hit, 20 for a takedown (+10 with the knife), 10 for surviving a round, 30 for a round win, 75 more for winning the match, 100 for winning a free-for-all. New players start with 250. A small "+20 ◆" shows as you earn, and the round screen shows the total.
- **Your kit** (in the same panel) lets you choose what to wear from what you own; a purchase is equipped straight away.

Silver and items are saved in the browser, like the settings, so they stay on that device and are not shared between devices. Because of that, they can be edited by anyone who knows how, and an online server accepts whichever perk a player says they have. The perks are kept small for that reason. The marketplace data is in `src/core/items.js`.

## Friends

Everyone with a player code has a **player number** (shown in the start menu and in the Friends panel). It is not the login code, so it is safe to share.

- Open **Friends** from the start or Esc menu, enter a friend's number and, if you like, a nickname.
- Once you have **both** added each other, you see whether they are offline, online in the menus, or in a game, with its name, size and head count. A **Join** button takes you straight into their game, parties included. Until they add you back they show as "has not added you back yet", and you see nothing about them; they see nothing about you either.
- **Party invites:** while you're in an online game (a party or a server), open **Friends** from the Esc menu and press **Invite** next to any friend who has added you back and is online. They get a pop-up wherever they are – in the menus or in the middle of a match – saying who invited them and to what. **Join** (or **J** mid-match) takes them straight into your game, on your side; **Not now** dismisses it. Invites last two minutes, and you can send the same friend one every 15 seconds.
- Joining a friend from the **Join** button in the list also puts you on their side.
- **Hearts:** friends playing in the same game as you have a **♥** by their name in the scoreboard (Tab), the kill feed, the death recap and the end-of-round tables, and a pink "♥ name" label above their head (within 60 m, even on the other side). When a friend joins your game, "♥ name joined your game" appears, and the Friends panel marks them with a heart.
- Your list is kept in this browser (up to 100 friends). The server only keeps it in memory for working out who may see whom, and the game checks in every 8 seconds while you're signed in, which is also how invites arrive.

## Settings

**Settings** (start menu or Esc menu) holds mouse sensitivity, invert Y, crouch as toggle or hold, field of view (60–100°), starting in first person, fullscreen on start, shadows, render resolution (automatic or fixed at full, three quarters or half), death particles, health bars, damage numbers, the performance readout and volume. Changes apply at once and are saved in the browser.

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
| Crouch (quieter, steadier aim, lower view) | C toggles (or hold C, if chosen in Settings), or hold Ctrl; sprinting or jumping stands you up |
| Jump | Space |
| Draw / loose | Hold / release left mouse |
| Zoom while drawing | Right mouse |
| Pick up arrows (ground, trees, fallen archers) | E |
| Bandage (kneel to heal; moving, drawing or being hit interrupts) | Q |
| Knife stab (close quarters) | F |
| Switch first person (default) / third person | V |
| Scoreboard | Tab |
| Performance overlay | F3 |

**Ctrl+W:** browsers treat Ctrl+W as "close tab", so holding Ctrl to crouch while walking forwards can close the game. Use **C** instead, or tick **Fullscreen on start** in Settings. Fullscreen turns on the Keyboard Lock API, which captures Ctrl+W in Chromium-based browsers.

**First person** is the default view. Your arms and bow are drawn in a separate pass on top of the world, so they never clip into trees. The string comes back to your cheek as you draw, the view bobs as you walk, the bow kicks on release and drops when you sprint. The HUD shows when you're crouched.

## The look

Archers, bows and the field have a blocky pixel-art style, all original to Arrowfall and drawn in code (`src/world/pixelArt.js`), with no image files. Every texture is shown with nearest-neighbour filtering, so texels stay crisp squares:
- **Archers:** square limbs and a cube head with an 8×8 pixel face (hair fringe, eyes, mouth) and hair at the back. The hood is a cap in team colour, or in your marketplace hood colour. Clothes have a speckled pixel weave tinted with team colours.
- **Bow:** built from small cubes along a stepped curve, with a darker wrapped grip and lighter tips. Marketplace finishes recolour it. The first-person arms are chunkier and pixel-textured to match.
- **Field:** grass tufts are crossed pixel-art quads that still sway in the wind. The wildflowers are pixel sprites, and the ground has a 16-pixel tile per metre over its colours.

The trees, rocks and logs keep their earlier look.

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
- **Knife:** every archer carries a small blade on the right hip. Press **F** to stab the nearest enemy within about 2 m in front of you: 30 damage, doubled (and critical) from behind: four stabs from the front, or two from behind, finish an archer at full health. A stab takes 0.45 s, cancels your draw, and you can stab again after 0.75 s. Bots use it when you get too close, and charge with it once their quivers are empty. Online, the server decides whether a stab lands, as it does for arrows. Values are in `config.js` under `knife`.
- **Health:** 100 HP.
  - You start healing naturally (3 HP/s) after 6 seconds without being hit.
  - Each life has 2 bandages: kneel for 3 seconds to heal 35. Moving, drawing, jumping or being hit stops it, keeping whatever was healed.
  - Glowing red-berried healing herbs (12 around the map, shown in pink on the minimap) heal 40 when you walk over them while hurt, and regrow after 35 seconds.
  - Below 30 HP you limp.
  - The HUD shows a segmented health bar where lost health lingers briefly, a regeneration glow, floating damage numbers, health bars over teammates and enemies you've recently hit, and a heartbeat with a red pulse at low health. When you die, a recap shows who killed you and every hit.
  - All values are in `config.js` under `health`.
- **Animations** (procedural):
  - Legs swing in the direction you're actually moving (strafing, walking backwards), feet shuffle when turning on the spot, and idle archers breathe and look around.
  - Archers turn side-on to shoot, with the bow arm straight out and the string drawn back to the cheek, the elbow high behind. On release the string snaps forward and quivers. The drawing hand then reaches over the right shoulder to the quiver, pulls out the next arrow and carries it round to the string.
  - Knife stabs wind up at the hip and drive forward with a twist of the body.
  - They crouch to pick up arrows and kneel to bandage.
  - Hits make them flinch, jumps end in a landing squash, wounded archers limp, and the winning team cheers at the end of a round.
  - There are four deaths: falling backwards or forwards, toppling sideways, crumpling to the knees, or spinning down.
  - In first person the bow comes up with the arrow lying on the line to the crosshair, your hand pulls the string back to your cheek, flies out of view on release and returns from over your shoulder with the next arrow. The knife thrusts up from the lower right. You also see the bandage gesture; the camera shakes when you're hit, dips on landing and pickups, and falls to the ground when you die.
- **AI:** each bot runs a state machine (patrol → advance → take cover → engage → retreat, plus hold and scavenge). Bots move in squads of four. Cautious squads skirt round the field through the forest; bold ones regroup at the treeline and cross together at a sprint. In the forest they fight from behind trunks, drawing in cover and stepping out to shoot. They lead moving targets with a proper ballistic solution. Difficulty changes aim error, reaction time, aggression, how far ahead they lead and how often they think.
- **Modes:** Team Deathmatch is best of five rounds, won by wiping out the other team (or having more survivors when the round timer runs out). King of the Field puts a capture zone in the middle of the clearing: holding it uncontested scores points, fallen archers respawn after 6 s, and the first team to 120 wins.

## Code layout

```
scripts/    meshy-trees.mjs generates tree models with the Meshy API (run locally with your own key)
public/models/trees/        drop-in tree models (GLB) + manifest.json
server/     index.js        HTTP (site, servers, parties, guests, friends, admin) + WebSocket, rooms, fixed-step loop
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
  ui/       HUD.js, Minimap.js, Menus.js, LayoutPicker.js, Settings.js, WorldOverlay.js, styles.css
  audio/    Audio.js        procedural bowstring, whoosh, thuds, footsteps by surface, wind and birdsong
```

## Performance notes

- Trees, bushes, grass, arrows and archer bodies are all drawn with `InstancedMesh`. The forest is split into 50 m chunks, which gives per-chunk frustum culling. Each chunk switches between high- and low-detail geometry depending on its distance from the camera.
- Arrows come from a fixed pool of 1,600. When the pool runs dry, the oldest stuck arrow is recycled.
- AI "thinking" (perception, line-of-sight rays and decisions) is time-sliced: no more than 4 bots think in any one frame, each roughly every 0.2–0.55 s depending on difficulty. Steering and aiming run every frame because they are cheap.
- Distant archers animate at half rate.
- **Adaptive resolution** lowers the render resolution if the frame rate drops below about 50 fps and raises it again when there is headroom. Untick **Shadows** in Settings for a further boost on weak GPUs, or fix the resolution there.
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
