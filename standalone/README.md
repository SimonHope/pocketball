# Pocket Ball (web)

A Hamsterball-style marble racer for the browser. Built with TypeScript, Three.js for rendering and Rapier for physics.

```sh
npm install
npm run dev        # game at http://localhost:5173, editor at /editor.html
npm run server     # multiplayer server on ws://localhost:2567 (second terminal; needed for Multiplayer only)
npm run check      # typecheck + lint + unit/integration tests
npm run test:e2e   # browser tests on the production build (needs Google Chrome; starts both servers)
npm run loadtest -- 4 16 0   # rooms × bots per room × level: server CPU and race results
npm run loadtest -- 4 quick 2  # 4 Quick Play rooms (1 client + 7 server bots), 2 games each
npm run gen-levels   # generate race courses (edit TARGETS in scripts/generate-levels.ts)
npm run add-walls    # rebuild safety walls on every race course (after editing a level)
npm run build:pages  # single-player build for GitHub Pages (no server) → dist-pages/
                     # gen-levels also extends Warm-Up, Zig-Zag, Sweeper Alley from src/levels/bases/
npm run analytics    # retention, session length, course funnel, top errors (from DATA_DIR)
npm run build:server # bundle the server into dist-server/ (npm start runs it)
npm run build:portal -- crazygames   # portal zip in release/ (also poki, itch); set VITE_SERVER_URL
npm run build      # production bundle in dist/ (game + editor pages)
```

**Game settings (build time):**
- The game finds the server at `ws://<same host>:2567` and its API at `http://<same host>:2567/api`.
- Set `VITE_SERVER_URL` (and optionally `VITE_API_URL`) to point elsewhere.
- `VITE_TEST_HOOKS=1` is for the browser-test build only. It adds an autopilot hook; never set it for release builds.

**Server settings (environment variables):**

| Variable | What it does |
|---|---|
| `PORT` | Server port (default 2567) |
| `LATENCY_MS` | Add delay, to simulate a slow connection |
| `STATS=1` | Print CPU and event-loop stats |
| `DATA_DIR` | Where the SQLite database goes (default `./data`) |
| `PUBLIC_URL` | Where the game is served (for Stripe's return links) |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Open the shop |
| `SHOP_DEV=1` | Grant packs without paying (local testing only) |
| `WORKERS` + `REDIS_URL` | Use several CPU cores: a gateway plus n worker processes sharing matchmaking through Redis |
| `DEBUG_STRIKES=1` | Log why anti-cheat rejected an update |

**Build settings:**
- `VITE_PLATFORM=crazygames|poki|itch` makes a portal build: relative paths, the portal SDK, and no shop or editor.
- Add `?stats` to the game URL for an FPS, draw-call and quality overlay.

**Deploying:** see `../docs/launch/deploy.md` (Docker, Fly.io, scaling, monitoring). Soft launch: `../docs/launch/soft-launch.md`. Legal: `../docs/launch/legal.md`.

| | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Roll | WASD / arrows | Left stick | Drag on the left half (joystick) |
| Camera | Q / E, mouse drag | Right stick | Drag on the right half |
| Pause | Esc / P | Start | Pause button |
| Restart | R | Y | Pause menu |
| Last checkpoint | Backspace | X | — |
| Camera mode (chase → fixed → top-down) | C | Back / Select | Settings |
| Menus | Arrows, Enter, Esc | D-pad / stick, A, B | Tap |

## Architecture

The code is split into a **simulation** and a **presentation** layer. The simulation has no rendering or DOM code, so the same code runs in the browser, in tests and bots, and later on the multiplayer server.

```
src/
  config.ts            SIM (gameplay/physics tuning) and VIEW (camera) settings
  levels/
    *.json             levels as data
    schema.ts          level format types + parseLevel() validator with readable errors
    index.ts           list of playable levels
  sim/                 no Three.js, no DOM
    geometry.ts        level pieces → solids (boxes/cylinders + motion), used by physics AND renderer
    simulation.ts      Rapier world, ball control, race rules; fixed 120 Hz step; emits SimEvents
    autopilot.ts       follows a level's route (tests now, Quick Play bots later)
    math.ts            tiny Vec3/Quat helpers
  render/              browser only
    scene.ts, level-view.ts, ball-view.ts, camera.ts, hud.ts, audio.ts
    input.ts           keyboard, mouse, gamepad, touch joystick
    settings.ts        player settings (localStorage)
    progress.ts        best times + medals (localStorage; cloud saves in M4)
  game/session.ts      one level being played: sim + views, disposed as a unit
  ui/screens.ts        menu screens (HTML in index.html) + keyboard/gamepad focus navigation
  main.ts              game app: menu (bot demo in the background) → level select → race → results
  editor/              level editor (separate page: editor.html)
  cosmetics.ts         catalog: ball skins, hats, fur colors, trails (append only; referenced by index)
  levels/themes.ts     world themes: sky, light, floor colors, floor grip (ice is slippery)
  levels/generator.ts  course generator (segments → pieces + bot route): straights, ramps, turns, curves,
                       switchbacks, jumps, split paths, stairs, bridges, movers, sweepers;
                       downhill: steep plunges, corkscrews, cliff drops, cascades
  levels/maze.ts       top-down maze generator: carved grid, loops, sweeper rooms, bridges over pits,
                       bumpers, holes; route = shortest path; checkpoint gates
  render/course-map.ts top-down 2D map of a course (level select cards)
  sim/arena-pilot.ts   arena bot: chase a target, stay away from edges
  game/multiplayer.ts  rooms, Quick Play, modes, lobby UI, other players' balls, live positions, results
  ui/customize.ts      Customize screen
  net/                 shared by browser, bots and server (no DOM)
    protocol.ts        room state schema, messages, timing constants
    rules.ts           server-side checks (MoveChecker), route progress, placings
    modes.ts           party-mode rules: Elimination count, King of the Hill scoring, rankings
    net-client.ts      connection: clock sync, 20 Hz ball updates, interpolating other balls
    bot.ts             headless player (tests, load test, future Quick Play bots)
    names.ts           generated player names (no typed names)
server/                Colyseus server: race-room.ts (all modes, Quick Play, bots), server-bot.ts, main.ts
scripts/               load test
tests/                 headless Vitest suites (including real server + bot races)
e2e/                   Playwright browser tests (game, editor, gamepad, two-player multiplayer)
```

## Game modes and Quick Play

| Mode | Levels | How it works |
|---|---|---|
| Race | race courses | First to the goal. |
| Elimination | race courses | Back-to-back rounds on different courses. The slowest quarter (at least 1) is out each round; a round ends as soon as enough racers finish. 16 players → a winner in 7 rounds. |
| King of the Hill | arenas | 90 s. You score only while you're **alone** in the glowing zone; a contested zone scores for nobody. The zone moves every 20 s. |
| Bumper Arena | arenas | Falling off knocks you out (no respawn). Last hamster standing wins (90 s limit). |

**Quick Play** (main menu) matches you into a public room:
- The game starts 15 s after the first player joins, or 3 s after 8 humans are in.
- Server bots fill the starting grid up to 8 racers.
- Rooms cycle through modes: Race, King of the Hill, Race, Bumper Arena, Race, Elimination.
- Rooms with only bots left close themselves.

**Server bots** run the real simulation inside the room:
- **Race modes:** the racing autopilot with a random lane, pace and avoidance.
- **Arena modes:** the arena pilot. In King of the Hill, the bot nearest the zone goes in while others wait at the edge. They give a lone holder 1.5–4 s before attacking.
- Bots' updates pass through the same anti-cheat checks as humans'.
- Load test: about 3% of a core per Quick Play room.

## Accounts, progression and monetization

- **Accounts:**
  - Every player gets an anonymous **guest account**: a random token kept in the browser.
  - To move to another device, copy the **recovery code** shown in Settings.
  - There's no email and no password, so we collect no personal data. That suits portals and a young audience.
  - The server stores only hashes of the token and the recovery code.
- **Progression** (server-side, `src/meta/progression.ts`):
  - XP and levels. Level 2 needs 100 XP, and each level after that needs 50 more.
  - Coins.
  - Cosmetics unlock at a level, for coins, or in a real-money pack (the `UNLOCKS` table in `src/cosmetics.ts`). Only cosmetics are sold, never coins or anything that affects racing.
- **Rewards:**
  - **Solo:** you get XP for finishing, a bonus for your first finish on a course, and a bonus for each new medal tier. First the server replays the run through the multiplayer anti-cheat checks and works out the time itself; only then does the time reach the per-course **leaderboard**.
  - **Multiplayer:** signed-in players are paid at the end of each game, more for placing higher. Every reward is paid once per claim ID.
  - **Daily challenges:** 3 per day, the same for everyone, picked from the date (`src/meta/challenges.ts`).
- **Ads:** `src/platform/platform.ts` detects the CrazyGames or Poki SDK at runtime, or shows a stand-in ad in development. The only ad is a rewarded "double your coins" offer, at most 5 a day, within 10 minutes of the reward. Check the SDK calls against each portal's current docs before launch.
- **Shop:**
  - Uses Stripe Checkout through its REST API. Items are granted by a webhook whose signature is verified (HMAC, 5-minute window).
  - It's closed unless the Stripe keys are set.
  - Starter Pack: $2.99 for three exclusive cosmetics.
- **Analytics and errors:**
  - Anonymous events and error reports, stored in SQLite (`src/platform/analytics.ts`).
  - `npm run analytics` prints the report.
  - Swap in Sentry once we're hosted if preferred.

API (`server/meta/http.ts`, on the game server at `/api`):
- **Account:** `POST /guest`, `POST /restore`, `GET /me`, `POST /me/look`, `POST /me/name`, `POST /me/buy`
- **Runs and rewards:** `POST /solo`, `POST /rewards/ad-double`, `GET /leaderboard/:level`
- **Shop:** `POST /shop/checkout`, `POST /shop/webhook`
- **Analytics:** `POST /events`, `POST /errors`, `GET /health`

## Performance

- **Graphics tiers (Settings):** High, Medium and Low.
  - **Auto** (the default) starts at High on desktop and Medium on touch devices.
  - It steps down while the frame rate is below 40 fps, and steps up at most once when there's plenty of headroom (`src/render/quality.ts`).
  - Low turns off shadows and trails and renders at 1× pixel density.
- **Draw calls kept low:**
  - Hamster parts merged by material, and only the body casts a shadow.
  - Ball rings merged; hat parts merged by color.
  - Clouds are one mesh per level.
  - Each trail is one particle system.
  - Floors share checker textures.
  - Result: an 8-racer race went from 482 to about 206 draw calls, and the browser tests fail above 260.
- **Download size:** about 1.3 MB gzipped (Rapier's WebAssembly is most of it).

## Themes and cosmetics

- **Themes:** set `"theme"` on a level: `meadow`, `candy`, `ice` (floors grip 30% as much) or `night`. This is placeholder art until final art arrives.
- **Cosmetics:** choose them on the Customize screen. Locked items show how to unlock them. Your look syncs in multiplayer: signed-in players get their account's owned look, and players without an account get free items only.

## Multiplayer

- **Rooms:** Create one from the Multiplayer menu to get a 6-character code, or share the invite link (`/?room=CODE`). Up to 16 players per room.
- **Lobby:** everyone except the host marks themselves ready; the host picks the course and starts.
- **Late joiners** watch the current race (the camera follows the leader) and race in the next one.
- **Movement:** each player's own browser simulates their ball and sends its position 20 times a second. Other balls are drawn 100 ms in the past, smoothly between updates. Each browser handles bumps for its own ball only; because both sides do this, both balls bounce apart.
- **Server checks:** the server doesn't run physics. For every update it checks that the timestamp is plausible, the speed is under 60 units/s, and the ball moved no further than possible. Respawning is only allowed at the start or at checkpoints that player has reached. The server works out checkpoints and exact finish times from the ball's path. A finish faster than half the gold time is rejected. 10 rejected updates disqualify a player.
- **Starting grid:** 5 across and 4 rows. A 12×12 start pad fits 16 players, and a test checks every level for this.
- **Connection drops:** a dropped player's seat is held for 20 seconds and the game reconnects automatically. If the host leaves, the player who has been in the room longest becomes host.

## Level editor

Open `/editor.html`, or choose **Level Editor** from the main menu.

- **Selecting:** click a piece or waypoint, or pick it from the lists on the left.
- **Moving:** drag the arrows (snaps to 0.5 units). Moving a path or mover moves both its ends.
- **Exact values:** type them into the property panel on the right.
- **Level settings:** press Esc to deselect; name, start position and medal times appear on the right.
- **Shortcuts:** Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo, Cmd/Ctrl+D duplicate, Delete removes, F focuses the selection.
- **Check with bot** runs the same autopilot check as CI in the browser and points to the waypoint where the bot got stuck.
- **Playtest ▶** opens the level in the real game (`/?play=draft`); quitting brings you back.
- **Autosave:** your work is saved as a draft in the browser. When you're done, use **Save .json** and add the file to `src/levels/` (see below).

## Levels

A level is a JSON file listing its pieces:

| Piece | Fields |
|---|---|
| `pad` | `center` (top-surface middle), `w`, `d`, `palette?` |
| `path` | `from`, `to` (top-surface centerline, works for ramps), `width`, `rails?`, `palette?` |
| `block` | `position` (center), `size`, `yaw?` (degrees), `color?` |
| `bumper` | `position` (base), `radius?`, `height?` |
| `sweeper` | `position` (floor under the pivot), `length`, `speed` (rad/s) |
| `mover` | `from`, `to` (top-surface centers), `w`, `d`, `period` (s) |
| `checkpoint` | `position`, `yaw?` |
| `goal` | `position`, `radius?` (exactly one per race course) |
| `zone` | `position`, `radius?` (arenas only: King of the Hill zones) |
| `boost` | `position` (floor), `yaw?`, `w?`, `d?`, `speed?` (default 30): shoots you along `yaw` |
| `spring` | `position` (floor), `radius?`, `power?` (up speed, default 16), `yaw?`, `push?` (forward speed; unset keeps yours) |
| `conveyor` | `from`, `to` (belt runs this way), `width`, `speed?` (default 12), `rails?`: your top speed counts relative to the belt |
| `crumble` | `center`, `w`, `d`, `delay?` (0.6 s), `respawn?` (4 s): falls away after you touch it; back at once if you respawn |
| `wind` | `center`, `size` (a box), `dir`, `speed?`, `strength?`: updrafts (`dir` up) and crosswinds |
| `lowgrav` | `center`, `size` (a box), `scale?` (default 0.35 of normal gravity) |

Levels also have:
- `medals`: `gold` ≤ `silver` ≤ `bronze`, in seconds
- `start`: `position` is the ball's center, `yaw` is in degrees
- `theme`
- `kind`: `race` (the default) or `arena`. An arena has no goal and no route, and needs at least one `zone`.
- Lifts are `mover` pieces whose `from` and `to` differ in height. Bots ride them with `wait` waypoints at the bottom and the top.
- `camera`: `topdown` starts the course in the top-down camera (mazes use it). Players can still switch with C.

The route's waypoints can also set `lane` (the widest lane bots may take there; 0 means tight, racing line only).

`route` is a list of waypoints (`p`, plus optional `speed` and `wait`) that the autopilot follows. The course test fails if the autopilot can't finish a level without falling, so every level needs a route. `wait: true` holds until a moving platform arrives under that point.

To add a level, create `src/levels/<name>.json`, register it in `src/levels/index.ts`, run `npm run add-walls`, then run `npm test`.

**Safety walls:** `npm run add-walls` puts a low wall (colour `#eef1f6`) on every floor edge you could roll off. It leaves gaps where the route leaves the floor (jumps, drops, gaps to platforms, lifts and updrafts), and skips edges that already have a rail, a wall, or more floor beside them. Re-running rebuilds the walls. Arenas are left open.

**Conventions:** the course runs toward −z and the ball radius is 1. Every solid is a box or a cylinder, so each one maps directly onto a Roblox Part for the later port.

## Tests

- `levels.test.ts`: every level validates; the validator rejects bad data; path geometry is exact.
- `simulation.test.ts`: resting, top speed, climbing a ramp, bumpers, moving-platform ride, countdown, falling and respawning, checkpoints, fixed-step timer.
- `course.test.ts`: every level can be finished by the autopilot with zero falls, faster than bronze.
- `rules.test.ts`: honest autopilot runs pass the server checks with matching finish times; cheats (teleports, including after waiting; speed hacks; timestamps from the future; respawning at an unreached checkpoint; moving before GO; malformed data) are rejected; placings; names.
- `server.test.ts`: real server and bots: codes, joining, names, colors, host handover, ready-up, full 3-player race to results, late joiners watching, cheater disqualified, other balls interpolated, dropped connection reconnects.
- `server-lag.test.ts`: the same race with a 300 ms round trip; clocks agree and nobody is flagged.
- `e2e/smoke.spec.ts`: menu → race → pause → quit; settings persist; editor bot check + playtest; full gamepad flow.
- `server-quick.test.ts`: Quick Play fills with bots and rolls into the next game; matchmaking puts two players in the same room; Elimination runs to a single winner; King of the Hill scores and ranks by score; Bumper Arena knocks players out.
- `modes.test.ts`, `cosmetics.test.ts`: mode rules and catalog checks.
- `course.test.ts` also runs bots in the outer lanes on every course, and an 8-bot crowd race.
- `e2e/multiplayer.spec.ts`: two browsers: create, join by invite link, ready, race, agree on live positions, leave; wrong room code shows a clear error; Quick Play lobby counts down and bots fill the race.
- `meta.test.ts`, `api.test.ts`: accounts and recovery, level curve, rewards (paid once per claim), buying and equipping, level unlocks, ad-double limits, purchases, challenges, solo replay checks (honest run, run with a fall, cheat, unfinished), leaderboards, the HTTP API, CORS, Stripe webhooks (valid, forged, stale, retried), multiplayer rewards, the analytics report.
- `e2e/smoke.spec.ts` also checks: Customize (free items persist, locked items show requirements); a full solo run in the browser that the server checks, pays out and ranks; the stats consent (nothing sent without a yes); delete-my-data.
- `cluster.test.ts`: gateway + 2 workers + Redis. Accounts work on either worker, room codes and Quick Play match across workers, rooms spread out, and crashed workers restart. Skipped without Redis; CI provides it.
- `shutdown.test.ts`: a deploy mid-race lets the race finish before the server stops.
- `portal-build.test.ts`: CrazyGames, Poki and web builds (SDK script, relative paths, no shop or editor on portals).
- `quality.test.ts`: auto quality steps down on slow frames, ignores hidden-tab hiccups, and doesn't flip back and forth.

## Single-player version on GitHub Pages

`npm run build:pages` builds a single-player version into `dist-pages/`. It needs no server:
- **Included:** all 28 courses, Customize (everything unlocked except paid Starter Pack items), the level editor and Settings.
- **Left out:** Quick Play, rooms, the shop, leaderboards, accounts and analytics.
- **Offline:** it makes no network requests, and asset paths are relative, so it works under `https://<you>.github.io/<repo>/`.
- **Saved progress:** best times and your look are stored in the browser.

`.github/workflows/pages.yml` publishes it on every push to `main` or `master`. One-time setup: on GitHub, open the repo's **Settings → Pages** and set **Source** to **GitHub Actions**. Pages on a private repo needs a paid GitHub plan; on a free plan, make the repo public (it contains no secrets).

