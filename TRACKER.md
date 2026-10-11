# Pocket Ball — Progress Tracker

**Goal:** a commercial Hamsterball-style racer. Web launch first (own site + portals such as CrazyGames/Poki), then a Roblox port. Online rooms of 2–16 players you create and join with a code. Small team (2–4 people).

**Full roadmap:** `~/.claude/plans/if-i-need-to-dazzling-oasis.md`
**Last updated:** 2026-10-11

## Status at a glance

| Milestone | Est. | Status |
|---|---|---|
| Prototype (pre-M0) | — | ✅ Done |
| M0 Foundation | 2 wks | 🟡 Tech done; business tasks, first commit and hosting open |
| M1 Single-player vertical slice | 6–8 wks | 🟡 Code side done; art, music and outside playtests open |
| M2 Multiplayer core | 6–8 wks | 🟡 Code side done; needs a hosted server, human playtests and scaling past ~31 rooms per process |
| M3 Content and modes | 8–10 wks | 🟡 Code side done; art, level polish and playtests open |
| M4 Accounts, progression, monetization | 4–6 wks | 🟡 Code side done; needs Stripe and portal accounts, a hosted database and a legal review |
| M5 Beta and soft launch | 4–6 wks | 🟡 Code side done; needs hosting, real devices, legal sign-off and the actual soft launch |
| M6 Web launch and live ops | 2–4 wks | ⬜ Not started |
| M7 Roblox port | 8–12 wks | ⬜ Not started |

Target: web launch about 10–11 months after M0, Roblox about 14 months. Add about 25% buffer.

---

## ✅ Achieved

### Prototype
- [x] Playable browser game: a see-through ball with an animated hamster inside
- [x] "Warm-Up" course: bumpers, a downhill ramp, a rotating sweeper arm, a narrow bridge, a moving platform, a climb and the goal
- [x] Countdown, timer, checkpoints, falling adds a 2 s penalty, best time saved in the browser
- [x] Dynamic chase camera: follows behind the ball, zooms and widens with speed, rises on descents, shakes on impacts, Q/E or mouse drag to rotate, C switches to the fixed camera
- [x] Generated sound effects (no audio files)

### M0 Foundation (technical)
- [x] Moved to TypeScript (strict), ESLint and Vitest
- [x] Swapped cannon-es for Rapier physics; the ball has continuous collision detection so it can't pass through thin rails
- [x] Split the code into a simulation layer (`src/sim/`, no rendering or DOM) and a rendering layer (`src/render/`)
- [x] Fixed 120 Hz simulation that reports what happens as events; ball drawn smoothly between physics steps
- [x] Levels as JSON (`src/levels/*.json`) with a validator that gives readable errors
- [x] Level solids are only boxes and cylinders, ready to map onto Roblox Parts
- [x] Autopilot that follows each level's waypoint route (tests now, Quick Play bots later)
- [x] 15 headless tests: level files, physics, race rules, and the autopilot finishing the whole course with zero falls
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, lint, tests, build
- [x] Checked in headless Chrome: loads with no console errors, countdown works, holding W reaches 80 km/h
- [x] Git repo created (nothing committed yet)

### M1 Single-player vertical slice (code side)
- [x] **Game shell:** main menu with a bot playing a course in the background, level select (best time and medal per course), pause, results screen (time, medal, personal best, target times, next/retry), loading screen
- [x] **3 greybox courses:** Warm-Up, Zig-Zag (narrow diagonals, platform sliding sideways across a gap), Sweeper Alley (two sweeper arenas, bumper field, moving platform, very narrow final bridge)
- [x] **Medals** (gold/silver/bronze times) in the level format; best times and medals saved in the browser
- [x] **Settings:** volume, camera mode, camera sensitivity, graphics quality (high/low), controls hint; saved across reloads
- [x] **Gamepad:** left stick rolls (analog), right stick turns the camera, Start pauses, Y restarts, X goes to the last checkpoint, Back switches camera; full menu navigation with D-pad/stick, A and B
- [x] **Touch:** joystick on the left half of the screen, camera drag on the right half, pause button
- [x] **Auto-pause** when the tab or window loses focus (web portals expect this)
- [x] **Level editor** (`editor.html`): click to select, drag gizmo, property panel, add/duplicate/delete, route editing, undo/redo, open/save/copy JSON, autosaved draft, **Check with bot**, **Playtest ▶** in the real game
- [x] Saved levels keep the readable one-piece-per-line format (round-trip tested)
- [x] **Browser smoke tests** (Playwright) in CI: menu → race → pause → quit, settings persist, editor bot check and playtest, full gamepad flow
- [x] 24 unit tests + 4 browser tests passing

### M2 Multiplayer core (code side)
- [x] **Colyseus 0.18 server** (`server/`): create a room, join by 6-character code or invite link (`?room=CODE`), up to 16 players, lobby with ready-up, host picks the course and starts
- [x] **Countdown synced to the server clock:** my own ping/pong clock sync, which agrees between clients within 40 ms even with a 300 ms round trip
- [x] **Client simulates its own ball** and sends it 20 times a second; other balls are drawn 100 ms in the past, smoothly between updates (with brief extrapolation)
- [x] **Ball-to-ball bumping:** each browser bounces its own ball; both balls bounce apart
- [x] **Starting grid** (5 across, 4 rows; tested to fit on every level's start pad)
- [x] **Live positions** HUD and **results** screen; the host takes everyone back to the lobby
- [x] **Connection problems:** seat held 20 s with automatic reconnect; host handover when the host leaves; late joiners watch the race (camera follows the leader) and join the next one
- [x] **Server checks** (`src/net/rules.ts`), using the same level geometry as the game: speed limit, plausible distance per update (can't be "saved up"), plausible timestamps, respawns only at the start or reached checkpoints, checkpoints and exact finish times worked out by the server, finishes faster than half the gold time rejected, disqualification after 10 rejected updates
- [x] **Generated player names** (adjective + hamster name, reroll button); nothing is typed, so no moderation is needed
- [x] Player colors on balls, name tags above other balls, a status toast for connection problems
- [x] **Headless bot** (`src/net/bot.ts`) that plays like a real client, for tests, the load test and future Quick Play
- [x] **Tests:** 13 rules tests; 10 real-server integration tests; a 300 ms latency test; 2 two-browser multiplayer tests
- [x] **Load test** (`npm run loadtest`): 4 rooms × 16 bots on Warm-Up. Server used ~10% of one core (~2.5% per room), event-loop p99 11.7 ms, ~120 MB; honest bots got 0 rejected updates.

### M3 Content and modes (code side)
- [x] **Quick Play:** public matchmaking. Starts by itself (15 s, or 3 s once 8 humans are in), server bots fill up to 8 racers, cycles modes, closes when only bots are left.
- [x] **Server bots:** the real simulation inside the room, checked by the same anti-cheat as humans (0 strikes in every test and load run).
- [x] **Smarter bots:**
  - Their own racing lane, which shrinks automatically where floor or obstacles don't allow it (it checks the floor along the path and a ball-sized clearance).
  - Pace (skill) and avoidance of other balls.
  - A per-waypoint `lane` limit for tight spots.
  - Recovery after falling.
  - Result: all 8 bots in a crowd race finish (4 of 8 before).
- [x] **4 themes** (Meadow, Candy, Ice, Night): sky, fog, light, floor colors and clouds; Ice floors grip 30% as much. There's a theme picker in the editor.
- [x] **28 race courses** (7 per theme) + **2 arenas** (Candy Bowl, Night Summit).
- [x] **12 complex courses** (added 2026-09-25):
  - 8 generated courses (2 per theme) using new pieces: smooth curves with continuous rails, descending switchbacks, jumps over gaps, split paths around a pit, staircases, and gauntlets of spinning arms.
  - 4 **top-down mazes** (Hedge Maze, Candy Labyrinth, Ice Catacombs, Night Vault). They are carved grids with loops (several ways through), sweeper rooms, narrow bridges over pits, bumpers, and dead ends with no floor. Checkpoint gates make every ball pass over the checkpoints.
- [x] **4 downhill courses** (added 2026-09-25): Summit Run, Sugar Mountain, Frozen Falls, Starfall Peak.
  - Each starts on a summit and finishes 70–90 units below.
  - They use four new generator pieces: steep railed plunges with a runout, full corkscrew spirals that pass under their own entrance, cliff drops onto walled landing pads, and waterfall cascades.
  - A valley floor far below shows how high you are.
  - Level-select cards show a "Downhill ↓N m" tag.
- [x] **Course mechanics** (added 2026-09-25). Every course has a signature mechanic, and many now climb as well as descend:
  - Boost pads, springs (launch pads), conveyor belts, crumbling tiles, wind (updrafts and crosswinds), low-gravity zones, and lifts (vertical movers). All are in the editor.
  - Belts shift your top speed: faster riding with the belt, about half speed fighting it. Crumbled tiles come back at once when you respawn.
  - Each has its own look, animation and sound. The level-select cards list each course's mechanics.
  - New generator segments: boost ramps, boost jumps over long gaps, springs up to ledges, lifts up to towers, updrafts over pits, crumbling bridges, belts and treadmills, crosswind bridges, low-gravity moon jumps.
  - The generator's self-overlap check now uses each piece's full height range, so courses can pass over and under themselves.
  - Maze mechanics: spring shortcuts over walls (Hedge Maze), belt corridors (Candy Labyrinth), crumbling floors (Ice Catacombs), low gravity with springs (Night Vault).
  - Hand-made courses: Warm-Up has a boost up the final climb, Zig-Zag a crosswind, Sweeper Alley a belt into the first sweeper and a crumbling final bridge.
  - Long course maps are drawn sideways to fill the card.
  - Multiplayer: crumbling tiles are per player, so each client sees only its own tiles fall.
- [x] **Single-player build for GitHub Pages** (2026-09-25):
  - `npm run build:pages` builds it with no server, no network requests and relative paths.
  - It keeps the level editor. Cosmetics are unlocked except the paid packs. The online buttons and settings are hidden.
  - `.github/workflows/pages.yml` deploys it on every push.
  - Tested served from a sub-folder: zero console errors and no off-site requests.
- [x] **Longer courses** (2026-09-25). The bot's run times went from 16–71 s (about 37 s on average) to 26–106 s (about 64 s):
  - Generated courses have about 1.7× the segments, and downhill courses drop further (Summit Run 117, Starfall Peak 90+).
  - Mazes are bigger (8×9 to 9×11 cells) with more mechanics.
  - Warm-Up, Zig-Zag and Sweeper Alley keep their hand-made start. The generator continues each one past its old finish (`extendLevel`; the originals are in `src/levels/bases/`), and the old goal pad becomes a checkpoint.
  - The finish grace period after the first finisher went from 30 s to 45 s.
- [x] **Safety walls on every race course** (added 2026-09-25; `npm run add-walls`, and part of course generation):
  - A low wall goes on every floor edge you could roll off.
  - Gaps are left only where the route leaves the floor (jumps, drops, gaps to platforms, lifts, updrafts).
  - Edges that already have rails, walls or more floor beside them are skipped.
  - Arenas stay open.
  - Bots now check that the way on is clear before taking a lane into a tight spot.
- [x] **Paced courses, combos, forks and stars** (2026-10-10). Courses used to draw every segment from one fixed mix, so each felt the same from start to finish:
  - **Acts:** every generated course now runs intro (the signature mechanic, gently, with breathers) → build-up (mixed in, getting harder; a breather after two hard segments) → twist (a fork and combos) → finale (the signature at its hardest, right before the goal).
  - **Difficulty ramp:** each segment takes a difficulty (0–1) that narrows bridges, widens gaps, and speeds up sweepers, belts, crumbling and wind.
  - **6 combo segments** (two mechanics at once): a belt under a sweeper, crumbling tiles in a crosswind, a spring onto a launch strip, a lift up to a windy bridge, a down-belt between bumpers, a run-up that crumbles behind you.
  - **Risk/reward forks:** a railed detour, or a straight line half as long across a narrow beam or crumbling tiles with no safety walls (`open: true` pieces).
  - **Stars:** 3 per race course (28 courses, mazes included), off the safe line. They show in the HUD, on the results screen and on the level-select maps, and are saved per course in the browser (not in multiplayer). Gold times account for the faster risky lines.
  - **Star route:** each level has a `starRoute` for bots and tests. Tests check that a bot collects all 3 stars with no falls on every course, and that the server's anti-cheat accepts star-route runs. The editor's bot check runs it too.
  - All 24 generated race courses were regenerated; Warm-Up, Zig-Zag and Sweeper Alley keep their hand-made openings.
- [x] **Mechanics catalog** (2026-10-10). `MECHANICS.md` lists every piece, segment and star kind, with what it asks of the player, what difficulty changes, where it's used, a "design space" map of player verbs to spot overlaps and gaps, and a checklist for adding new ones.
  - Its **On** column is live: the generator never places a switched-off segment or star kind.
  - A test keeps the file and the code in step. Course targets moved to `scripts/targets.ts`.
- [x] **New mechanics, batch 2** (2026-10-11): the iron ball (ride a giant sphere across spikes: it rolls on by itself and you steer and keep your balance, the first real-physics piece, synced to other players), a Ferris-wheel spin wheel up to a high ledge, trick gates (one open door at a time, all switching together) and a log slope (climb against logs rolling down, waiting in side bays). Each has its own star. Bots balance on the iron ball and ride wheel steps (`ride` waypoints). Not in any course yet.
- [x] **New mechanics, batch 1** (2026-10-11). Eight new segments, each with its own star challenge, built after looking at how Fall Guys, Astro Bot, Mario 3D World and marble games design stages:
  - brake pad (stop exactly), pinball (sliding toadstools), piano keys (floors sinking in a wave), turntable (a lazy Susan with gaps in its rim), pendulum (conkers swinging across a bridge), rocker (a tipping ruler), rollers (rows of logs), paper walls (tear through at speed, or weave).
  - New clock-driven motions (held slides with a phase, spin about a centre, swing, one-way travel), riding on turning and tilting floors, sliding bumpers, a per-player breakable paper wall, and stars that ride any moving piece (`ride`).
  - Bots look ahead at `timed` waypoints (`src/sim/predict.ts`): moving pieces are pure functions of the clock, so a bot can check the way is clear before it goes.
  - **Mechanic sandbox:** `/?sandbox=<segment>&d=0.5&star` plays a short course of one mechanic, with links to change difficulty, layout and star. Nothing is saved.
  - Not in any course yet: existing courses are byte-identical. Next, play them in the sandbox and choose which courses get which.
- [x] **Game feel** (2026-10-10). Every action answers back:
  - **Particles:** dust on landings and springs, boost streaks, sparks off bumpers and other balls, crumbs, sparkles for stars and checkpoints, and confetti at the finish. They come from two pooled draw calls.
  - **Ball and hamster:** the ball squashes and stretches and pops in after a respawn; the hamster leans, flails in the air, gets dizzy and cheers.
  - **Camera:** field-of-view kicks and landing dips.
  - **Sound:** a rolling rumble and wind that follow your speed, plus landing and respawn sounds.
  - **Hit-stop:** solo only, on star grabs and big landings.
  - **Setting:** "Motion effects: Reduced" for comfort.

  Frame times are within noise of before.
- [x] **Art direction, first pass: Meadow as a garden** (2026-10-10). The "hamster's world": courses built from garden things (paving, lawn, deck boards, popsicle-stick rails, hedges, toadstool bumpers, pencil sweepers, cracker tiles, pennant flags) under a painted panorama with giant soft plants, a gnome and a watering can around the horizon. Procedural textures and no post-processing: frame times are within noise of the old look, and textures and shaders are prepared while the menu is idle. Candy, Ice and Night next.
- [x] **Course feedback for playtests** (2026-10-10). `?playtest` asks after every finish (fun, difficulty, length, stars, variety, the most frustrating spot on the map, a comment) and why on every quit; normal players get an optional Rate button. Every run also records where the ball fell, checkpoint times, restarts and stars. Kept in the browser and exportable (works offline), and sent with stats consent. `npm run analytics` reports it per course (also from exported files), and `/feedback.html` shows each course's map with falls and marked spots.
- [x] **Star challenges tied to each mechanic** (2026-10-10). Every star now asks you to use the segment it's on harder or differently: a super spring, a jump's edge line, a swerve in low gravity, a crumbling side tile, a downwind ledge, a tightrope, a fast belt lane, and more (17 kinds; see README "Stars").
  - **Riding stars** move with a sweeper's tip or their own lift beside the tower; **switch stars** appear for a few seconds after you roll over a red button (a ⏱ timer in the HUD), e.g. at a fork's exit where only the shortcut beats the clock.
  - Stars go to the course's own mechanics first; a course never repeats a kind; the careful bot on the safe line gets none. Spur fallbacks dropped from about 2 per course to 8 across all 72 race-course stars.
  - A glow behind every star so it stands out (against yellow sweeper arms especially). Editor fields for all of it; `catch` route points for riding stars.
  - All 24 generated courses regenerated again (layouts and medal times changed).
- [x] **Top-down camera:** C cycles chase → fixed → top-down (also in Settings). Mazes start in top-down (`"camera": "topdown"` on the level). Top-down keeps its heading when you respawn.
- [x] **Static level geometry merged** into one mesh per floor palette and wall colour (in the game; the editor keeps one mesh per piece). The busiest new course went from 329 to 43 draw calls, and Warm-Up from 120 to 61.
- [x] **Tests:** 284 unit and integration (a physics test per mechanic; safety walls; all 28 courses: careful bot with no falls, outer-lane bots, crowd race, anti-cheat replay; maze and curve generators; camera cycling) + 12 browser tests (level select maps and theme groups, mazes starting top-down, C cycling).
- [x] **Course maps on the level select:** each card shows a top-down map of the course (floors shaded by height, walls, bumpers, sweepers, checkpoints, start and goal). Cards are grouped by theme, and mazes have a Top-down tag.
- [x] **Course generator** (`npm run gen-levels`): chains segments (straights, bumper slaloms, ramps, turns, bridges, moving platforms, sweeper pads, zig-zags) and writes the bot route. It keeps only courses the bots finish in both outer lanes, and sets medal times from the bot's run. The 9 new courses came from it, as starting points for designers.
- [x] **Party modes:** Elimination (rounds until one is left), King of the Hill (score while alone in the zone; the zone moves), Bumper Arena (last one standing). The server keeps score; there's a mode picker in the lobby; the HUD shows per-mode standings, a countdown timer and round banners; the results screen is per mode.
- [x] **Arena format:** `kind: "arena"`, `zone` pieces, no goal or route; editor support.
- [x] **Cosmetics:** 7 ball skins, 7 hats, 7 fur colors, 6 trails; a Customize screen with a live preview; synced and validated in multiplayer; bots wear random looks.
- [x] **Tests:** 134 unit and integration (including all 12 courses with outer-lane bots, a crowd race, all 4 modes end-to-end with server bots, and cosmetics sync) + 8 browser tests (Quick Play, Customize).
- [x] **Load test** (`npm run loadtest -- 4 quick 2`): 4 Quick Play rooms with 28 server bots → about 12% of a core (about 3% per room, like a 16-human room); modes cycled correctly.

### M4 Accounts, progression, monetization (code side)
- [x] **Guest accounts with no personal data:** a random token in the browser plus a recovery code to move devices; only hashes stored; restoring on a new device signs the old one out.
- [x] **Server:** SQLite via Node's built-in `node:sqlite` (no new dependency) and an account API on the game server (`/api`), with CORS and per-IP rate limits.
- [x] **Progression:** XP and levels, coins, and cosmetic unlocks by level, coins or real-money pack. The server decides what you own, so a hacked client can't wear locked items in multiplayer.
- [x] **Rewards:**
  - Solo: finish, first finish, and new medal tiers.
  - Multiplayer: paid by placing, sent to each player at game end.
  - Daily challenges: 3 per day.
  - Every reward is paid once per claim ID.
- [x] **Checked solo leaderboards:** the server replays each run's recorded path (20 samples a second) through the multiplayer anti-cheat and works out the time itself, including fall penalties.
- [x] **Rewarded ads:** an adapter for the CrazyGames and Poki SDKs with a dev stand-in; "double your coins", at most 5 a day, within 10 minutes of the reward.
- [x] **Shop:** Stripe Checkout (REST) with a signature-checked webhook, off unless keys are configured; a Starter Pack of 3 exclusive cosmetics for $2.99; nothing that affects racing and no coin sales.
- [x] **Analytics and errors:** anonymous events and deduplicated error reports, plus `npm run analytics` (retention after 1 and 7 days, session length, course funnel, top errors).
- [x] **UI:**
  - Menu: profile chip (level, XP bar, coins) and daily challenges.
  - Results: rewards, rank, level-ups and unlocks, a double-coins button and the leaderboard.
  - Customize: locked items with their requirement, and buying with coins.
  - Shop.
  - Settings: recovery code and restore.
  - Multiplayer results: rewards.
- [x] **Tests:** 159 unit and integration + 9 browser tests. A full solo run in the browser is checked by the server, paid out and ranked.

### M5 Beta and soft launch (code side)
- [x] **Using every CPU core:** a gateway plus N worker processes sharing matchmaking through Redis.
  - WebSockets are routed by Colyseus process ID; the API is round-robin.
  - Crashed workers restart.
  - Room placement is randomized among the least-loaded workers (Colyseus's default piled a burst of rooms onto one process).
- [x] **Load test on a 4-worker cluster:** 8 Quick Play rooms ran all modes with 0 bot strikes. Load is spread evenly (about 2–3% per worker); roughly 30–60 rooms per core depending on mode.
- [x] **Deploys don't cut races short:** on SIGTERM rooms warn players, finish the current game (at most 3 min), then close.
- [x] **Production server:** bundled to one 145 KB JS file (`npm run build:server`), runs with production dependencies only; multi-stage Dockerfile (non-root, health check), `docker-compose.yml` (Redis + 2 workers), `fly.toml` (volume, health checks, 5-min drain, no auto-stop).
- [x] **Monitoring:** `/api/health` and `/api/metrics` (rooms, clients, memory, uptime); `STATS=1` logs CPU and event-loop per worker.
- [x] **Client performance:** an 8-racer race went from 482 to about 206 draw calls. A browser test enforces a 260 budget.
- [x] **Auto graphics quality** (High, Medium, Low) with a `?stats` overlay for testers.
- [x] **Privacy:**
  - Anonymous stats need a yes; nothing is sent otherwise (tested).
  - "Delete my data": account, progress and stats; purchase records unlinked.
  - Draft privacy policy and terms pages.
- [x] **Portal builds:** `npm run build:portal -- crazygames|poki|itch` → zip with relative paths, the portal SDK, and no shop or editor (tested).
- [x] **Launch docs:** `docs/launch/deploy.md`, `soft-launch.md` (checklist and device matrix), `legal.md` (facts and questions for the lawyer, age-rating answers).
- [x] **Tests:** 173 unit and integration (including the cluster with real Redis, deploy draining and portal builds) + 11 browser tests, all passing on repeated runs.

**Found by tests and fixed:**
- [x] A spinning ball could climb walls and bumpers → only floors have friction now
- [x] At top speed you overshot the goal pad and fell off the course → added a back wall behind the goal
- [x] The ball fell off the moving platform → it now rides along with it
- [x] Sweeper Alley's first two bumpers were too close together; the ball pinballed between them and got flung off → widened the gap
- [x] Starting a course with a gamepad crashed the game ("null pointer passed to rust"); the same crash would hit the menu background when the bot moved to the next course → fixed, and covered by a browser test
- [x] **Anti-cheat hole:** a cheater could send rejected teleports until enough time passed that the jump to the goal looked legal → allowed movement per update is now capped at half a second's worth
- [x] Every player spawned on the same spot, stacked inside each other → starting grid
- [x] After a bump or bumper kick, the ball's old spin dragged it back the way it came, killing the bounce → spin now matches the new direction (bumpers feel punchier too)
- [x] The autopilot never recovered after a fall → it now picks the nearest waypoint after respawning (needed for Quick Play bots)
- [x] Rails were shorter than the ball's radius, so a bumper-knocked ball rolled over them → rails raised from 0.8 to 1.2
- [x] **Finished players blocked the goal:** after finishing, a player stops sending, so others saw a frozen ball on the goal and bumped into it → finished and disqualified players no longer collide and disappear from others' screens
- [x] **Wrong level in party modes:** the browser client (and test bots) loaded a race course for arena modes, so players were flagged for being away from their grid spot → the course list is picked by mode
- [x] King of the Hill bots all piled into the zone, so it was always contested and nobody scored → bots take turns, wait on their own side of the zone and give a lone holder a moment
- [x] Name tags were huge when a ball was near the camera → constant on-screen size
- [x] **Consent banner could never be dismissed:** CSS `display: flex` overrode the `hidden` attribute → a global `[hidden]` rule
- [x] **Workers crashed when starting together** ("database is locked" while switching a new SQLite file to WAL) → the gateway prepares the database first; the store retries briefly
- [x] **Leaving a room the server had already closed hung forever** (e.g. after a server restart) → leave now times out
- [x] **Uneven load across workers** → randomized least-loaded room placement
- [x] **Orphaned workers:** when a gateway was killed, its workers kept running (and burned CPU writing logs to a dead pipe) → workers exit when their gateway goes away; the load test stops its whole process tree
- [x] **Flaky gamepad browser test:** fake presses were timed in milliseconds, but the game reads the pad once per frame → presses are now held for exactly one rendered frame

---

## ⏳ Left to do

### M0: remaining
- [ ] **First commit and push to GitHub**, which turns CI on
- [ ] **Deploy previews:** pick a host (Cloudflare Pages or Vercel) and deploy every branch automatically
- [ ] **Name and trademark search.** The working name is now **Pocket Ball**. Don't use "Hamsterball" (Raptisoft's trademark). "Pocket ball" is also a common name for pool/billiards games, so check the name on the trademark databases, Steam, Roblox, the app stores and web portals before launch.
- [ ] **Choose an art style** (reference board)
- [ ] **One-page pitch:** hook, audience, how it differs from existing hamster-ball games on Roblox
- **Exit test:** CI green on GitHub, plus the business tasks above done

### M1: Single-player vertical slice (remaining; mostly people, not code)
- [ ] **Playtest and tune game feel:** force, top speed, camera (`src/config.ts`). Only real players can judge this.
- [ ] **Tune medal times** with real players. Current times are based on the cautious bot: gold is about 15% faster than the bot, bronze about 50% slower.
- [ ] **Pick the theme** for the 3 vertical-slice courses and redesign them in the editor (the current courses are greybox)
- [ ] **Final art (artist):** modelled and animated hamster (glTF), ball shader, themed floor materials, obstacle models, sky
- [ ] **Code for art:** load glTF models for the hamster and obstacles, a place for themed materials in the level format
- [ ] **Music and final sound effects (contractor)**; the volume setting and audio system are ready
- [ ] **Try touch and gamepad on real devices:** phones and tablets (Safari and Chrome), Xbox and PlayStation controllers. Checked so far only with simulated input in the browser.
- [ ] **Editor extras if the designers ask:** rotate gizmo, animated preview of moving parts, snapping settings
- **Exit test:** 15–20 outside players, and most replay without being asked

### M2: Multiplayer core (remaining)
- [ ] **Host the server somewhere** (Fly.io, Hetzner or Colyseus Cloud) so friends can play over the internet. It currently only runs locally. Also needs TLS (`wss://`) and setting `VITE_SERVER_URL` in the build.
- [ ] **Human playtests:** 8–16 people on real connections, including one or two on a slow connection. Do bumps feel fair? Does 100 ms interpolation feel laggy? Tune `INTERP_DELAY_MS`, `ballBounce` and `ballBumpBoost`.
- [ ] **Capacity: 50+ rooms per server.** Measured about 31 rooms per Node process (2.5% of a core per 16-player room). Either run 2+ processes (Colyseus multi-process with Redis) or profile and optimize (likely patch encoding and WebSocket sends).
- [ ] **Packet-loss testing:** WebSockets run over TCP, so loss shows up as latency spikes rather than missing updates. Test on a throttled real network; consider WebTransport later.
- **Exit test:** 16-player races at 150 ms lag feel fair; one server handles 50+ rooms

### M3: Content and modes (remaining)
- [ ] **Play the new mechanics in the sandbox** (brake pad, pinball, keys, turntable, pendulum, rocker, rollers, paper walls, iron ball, spin wheel, trick gates, log slope), then add them to courses in `scripts/targets.ts`, ideally so each course has a signature mechanic of its own, and regenerate.
- [ ] **Playtest the pacing and stars:** do intros feel too easy, finales too hard? Are forks tempting, and stars worth the detour? Tune the act shares and difficulty ranges in `planSlots` (`src/levels/generator.ts`) and the per-segment `mix(...)` values.
- [ ] **Playtest the star challenges:** the switch-star timers (1.2× the bot's time) and the riding-star catches are tuned for bots; check they feel fair but not free for players. Treadmills, `sweeperBelt` and `slalom` still offer no star; 8 courses still use one spur.
- [ ] **Stars beyond the browser:** count them on the server (the solo replay already has the path), pay XP for them, add "collect N stars" daily challenges, and decide on stars in multiplayer.
- [ ] **Polish the 17 generated courses and 4 mazes** in the editor. They're playable and bot-verified, but generic. The generator now makes curves, jumps and split paths; hand-made set pieces are still missing.
- [ ] **Check course length with players:** most races now take 40–100 s. Elimination (up to 7 rounds) could run long, so consider shorter courses for Elimination or fewer rounds.
- [ ] **Tune the mechanics with players:** boost speed, spring power, belt pull, crumble timing, wind strength, low gravity. All values are in `SIM` or on the pieces.
- [ ] **Decide on crumbling tiles in multiplayer:** each client only sees its own tiles fall (not synced). Fine for racing; sync them if players find it confusing.
- [ ] **Playtest the mazes** with real players: cell size, wall height, and top-down camera height (`VIEW.camera.top`).
- [ ] **Final theme art (artist):** textures, props and skyboxes per theme; theme music.
- [ ] **Final cosmetic art:** real hat models, ball skins and trail effects (the current ones are built from primitives). Aim for at least 30 items for M4 unlocks.
- [ ] **Tune the party modes** with real players: zone size and timing, the Elimination quarter, Bumper Arena arena size and bumper strength.
- [ ] **Ghosts** (recorded runs of real players) as extra Quick Play opponents. We did bots only for now, since bots can react (bump) and ghosts can't.
- [ ] **More arenas:** 2 is thin for two modes. Aim for 4–6.
- **Exit test:** 8+ player sessions where people ask for another round

### M4: Accounts, progression, monetization (remaining)
- [ ] **Stripe account** (business details, tax settings), then set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` and register the webhook URL `https://<server>/api/shop/webhook`. Test in Stripe's test mode first.
- [ ] **Portal developer accounts** (CrazyGames, Poki). Check the SDK calls in `src/platform/platform.ts` against their current docs, and check each portal's rules on in-game purchases (portals usually don't allow our own shop, so hide it there).
- [ ] **Legal review:** privacy policy (anonymous analytics, no personal data), terms, refunds, and whether the recovery code counts as an account for COPPA/GDPR purposes. Get a lawyer's opinion before launch (M5).
- [ ] **Hosted database:** SQLite is fine for one server machine. Move to Postgres when running several (M5 scaling).
- [ ] **Optional real sign-in** (Google or Apple) as an alternative to recovery codes, if playtests show people losing progress.
- [ ] **Tune the economy** with real data: XP curve, coin prices, challenge rewards.
- [ ] **More cosmetics** (aim for 30+), so the unlock track lasts.
- **Exit test:** the full loop of play, earn, unlock and show off works end to end (code done and tested; confirm with real players)

### M5: Beta and soft launch (remaining)
- [ ] **Deploy** (`docs/launch/deploy.md`): Fly.io app, volume, Redis, secrets; run the Docker image build once (Docker wasn't running on the dev machine; the bundle was checked without it).
- [ ] **Real-device performance** (`docs/launch/soft-launch.md` device matrix): 60 fps on a low-end laptop and 30 fps on mid-range phones in an 8-player race. Only simulated so far (software rendering in headless Chrome).
- [ ] **Legal sign-off** (`docs/launch/legal.md`): privacy and terms finalized, COPPA/GDPR questions answered, IARC age rating.
- [ ] **Portal accounts and submission:** CrazyGames first, then itch.io. Check the SDK calls against current portal docs.
- [ ] **Going wider than one machine:** Postgres instead of SQLite, plus per-machine WebSocket routing. Only needed if one large machine isn't enough; see deploy.md.
- [ ] **Uptime alerts** (BetterStack or UptimeRobot on `/api/health`) and backups (Litestream or volume snapshots, with a restore test).
- [ ] **Load levels as needed:** not needed yet (all 14 levels add a few KB); revisit when final art adds heavy models or textures.
- **Exit test:** at least 25–30% of players come back the next day; servers stable

### M6: Web launch and live ops
- [ ] Launch on more portals and our own domain
- [ ] Press kit, trailer, short-video clips, Discord server
- [ ] Monthly updates (levels and cosmetics)

### M7: Roblox port (only if the web version is doing well)
- [ ] Rojo project and a Luau rewrite of the game code
- [ ] Importer that turns level JSON into Roblox Parts
- [ ] Re-tune for Roblox units (gravity 196.2 studs/s²)
- [ ] Each player's client controls their own ball; server runs the same checks as M2
- [ ] Game passes, one-off purchases, user-made items
- [ ] Roblox maturity questionnaire, soft launch
- **Exit test:** Race mode plus 2 party modes on Roblox

---

## Known issues and tech debt
- **Bundle size:** about 1.3 MB gzipped, mostly Rapier's physics engine embedded in the code. It's well under the 20 MB target, so there's no action needed. Switching to the version that loads the engine as a separate file would speed up the first load a little.
- **Level routes are hand-tuned.** If a level's layout changes, its autopilot route may need updating, and the course test will say so.
- **Moving-platform carry is a gameplay fudge** in `rideMovingPlatform`, not real physics. Multiplayer will need the same rule on every client and the server.
- **Browser tests use software WebGL** (SwiftShader), so they check that things work, not how fast they run. Performance testing on real devices is M5.
- **The editor preview doesn't animate** movers and sweepers; use Playtest to see them move.
- **Saves are browser-only** (best times, settings, editor draft). Clearing site data loses them; cloud saves come in M4.
- **Bots are placeholder AI:** good enough to fill races (lanes, avoidance, turn-taking on the hill), but predictable. Human testers will find their patterns.
- **Generated courses look generic:** they follow a grid of 90° turns and straight pieces. The editor is where they become memorable.
- **Party modes are multiplayer-only:** Solo is race-only; Quick Play with bots is the way to practice modes.
- **Spin isn't sent over the network:** other balls' rolling is recreated from their velocity. It looks right when rolling, but not after spin-only moments.
- **Multiplayer times aren't saved** as personal bests; conditions differ from solo runs.
- **Invite links assume the server** is on the same host at port 2567 unless `VITE_SERVER_URL` is set.
- **A lost token means lost progress** unless the player saved their recovery code. The UI shows it in Settings, but consider prompting players to save it after they first reach level 3.
- **Rate limits are per server process, in memory.** Multiple processes need a shared store (Redis).
- **The editor can't edit `starRoute`:** moving pieces a star route passes through means editing the JSON or regenerating. Check with bot reports a broken star route.
- **Stars are browser-only,** like best times: clearing site data loses them, and the server doesn't know about them.
- **Ad rewards can't be verified by the server** (portal SDKs don't provide receipts), so they're capped per day instead.

## Decisions log
| Date | Decision | Why |
|---|---|---|
| 2026-10-11 | The iron ball is a real sphere with real physics, one per player, its position sent to the others | Balancing is the mechanic, so it can't be clock-driven; Roblox has Ball parts; others need to see what you're riding |
| 2026-10-11 | Moving pieces are pure functions of the sim clock; bots time them by looking ahead (`timed` waypoints) | The same for every player and in the server's replays, and bots can predict them exactly instead of reacting |
| 2026-10-11 | New mechanics are tried in a sandbox before they go into courses | Prototype alone first (as Astro Bot does), and don't churn course layouts and medal times for ideas that may not survive |
| 2026-10-10 | Each star challenge uses its segment's own mechanic; riding and switch stars added | Generic spur stars were the same on every course; the bot must still collect every star, and the safe line none |
| 2026-09-24 | Web first, Roblox later | Prove the game and build an audience cheaply; Roblox is the likely bigger earner |
| 2026-09-24 | Online rooms of 2–16 players, joined by code | The core social hook; Quick Play bots avoid empty lobbies |
| 2026-09-24 | TypeScript + Three.js + Rapier | Type safety for a team; fast physics with continuous collision detection; runs in the browser and on a Node server |
| 2026-09-24 | Clients simulate their own balls; server only checks | Responsive controls; avoids months of full server-side physics |
| 2026-09-24 | Levels built from boxes and cylinders, stored as JSON | Map straight onto Roblox Parts; lets us build a level editor |
| 2026-09-24 | Only floors have friction | Stops spinning balls from climbing walls and bumpers |
| 2026-09-24 | No free-text chat (preset quick-chat and emotes only) | Kids play on portals and Roblox; avoids most moderation and child-privacy risk |
| 2026-10-10 | Courses paced in acts (intro → build-up → twist → finale) with a difficulty ramp | Each course used to repeat one mechanic at one difficulty from start to finish |
| 2026-10-10 | Stars: 3 per course, saved locally, solo only; risky lines have no safety walls | A replay goal and a reason to take risks, without touching the economy or anti-cheat yet |
| 2026-09-24 | Level editor is a separate page (`editor.html`) | Keeps editor code out of the game download; anyone on the team can use it in a browser |
| 2026-09-24 | Menus are HTML, not drawn in 3D | Fast to build, accessible, keyboard and gamepad focus for free |
| 2026-09-24 | Medal times start from the bot's time | Guarantees every level is winnable; tune with real players |
| 2026-09-24 | Colyseus 0.18 (`@colyseus/core` + WebSocket transport only, not the full `colyseus` package) | Fewer dependencies (no auth, monitor or Redis until needed) |
| 2026-09-24 | Server doesn't run physics; it checks updates against the level geometry | ~2.5% of a core per 16-player room; physics stays on clients, as planned |
| 2026-09-24 | Own ping/pong clock sync rather than the SDK clock | The SDK clock only gets samples from its input system, which we don't use |
| 2026-09-24 | Names generated from word lists; no typed names | Child safety on portals and Roblox without a moderation system |
| 2026-09-24 | Quick Play bots run on the server (not recorded ghosts) | Bots can react and bump, which the arena modes need; they cost about 3% of a core per room |
| 2026-09-24 | Courses come from a generator that only keeps bot-verified layouts; designers refine them | 9 playable courses quickly; every one guaranteed finishable |
| 2026-09-24 | Cosmetics referenced by index; the catalog is append-only | Tiny network sync; old saves stay valid |
| 2026-09-24 | King of the Hill scores only when a player is alone in the zone | Forces bumping (the core fun); contested zones score for nobody |
| 2026-09-24 | Guest accounts + recovery codes, no email or passwords | No personal data from children; nothing to leak; portal-friendly |
| 2026-09-24 | SQLite via Node's built-in `node:sqlite` | No new dependency; fine for one server; Postgres later |
| 2026-09-24 | Solo leaderboard times come from the server replaying the run | The same anti-cheat as multiplayer, so leaderboards are credible |
| 2026-09-24 | Sell cosmetic packs only (no coin sales, no loot boxes) | No pay-to-win; avoids virtual-currency and loot-box rules aimed at kids |
| 2026-09-24 | Own analytics and error collection instead of a third-party SDK | No third-party tracking of children; swap in Sentry later if needed |
| 2026-09-24 | Multi-core: gateway + worker processes + Redis, not Node's cluster module | Colyseus rooms are pinned to a process; the gateway routes WebSockets by process ID |
| 2026-09-24 | One machine first (SQLite on a volume), bigger machine before more machines | 30–60 rooms per core covers a soft launch; going wider needs Postgres |
| 2026-09-24 | Portal builds drop the Shop and editor | Portals don't allow outside payments; the editor is a team tool |
| 2026-09-25 | Mazes are generated grids with a top-down default camera | Readable from above; loops and hazards give several routes; still bot-verified like every course |
| 2026-09-25 | Merge static level boxes at load (game only) | Curvy courses have hundreds of pieces; one mesh per look keeps draw calls phone-friendly |
| 2026-09-25 | Mechanics are effects on floor solids (boost, spring, belt, crumble) plus volumes (wind, low gravity) | One code path in the simulation; each maps to a Roblox Part with a script; bots and anti-cheat need no special cases |
| 2026-09-25 | Crumbling tiles are simulated per client, not synced | Each client simulates its own ball; syncing tile state would need server authority for little gain in a race |
| 2026-09-25 | Safety walls are generated and baked into level JSON, not added at load time | The editor, the Roblox importer and the course maps all see them; re-running rebuilds them |
| 2026-09-25 | Game renamed from Hamball to **Pocket Ball** | Owner's choice. Browser-storage keys and the database file keep the old `hamball` name, so no one's saves are lost. A trademark and store search for the new name is still open (M0). |
