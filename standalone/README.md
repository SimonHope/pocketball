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
npm run gen-levels   # generate race courses (scripts/targets.ts; switch mechanics on/off in ../MECHANICS.md); prints each course's plan
npm run add-walls    # rebuild safety walls on every race course (after editing a level)
                     # try one mechanic on its own: npm run dev, then /?sandbox=<segment>&d=0.5&star (see ../MECHANICS.md)
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
  levels/themes.ts     world themes: sky, light, floor colors, tagline, and each world's one physics rule (meadow gusts, candy bounce, ice grip, night gravity)
  levels/generator.ts  course generator (segments → pieces + bot route): straights, ramps, turns, curves,
                       switchbacks, jumps, split paths, stairs, bridges, movers, sweepers;
                       downhill: steep plunges, corkscrews, cliff drops, cascades; combos, forks
                       and stars; paced in acts (see "How courses are paced" below)
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

## How courses are paced

Each generated race course tells a short story instead of repeating one idea. `scripts/generate-levels.ts` gives every course `acts`:

| Act | Share | What happens | Difficulty `d` |
|---|---|---|---|
| Intro | ~20% | The course's signature mechanic in its easiest form, with a breather after each | 0 → 0.2 |
| Build-up | ~45% | The signature mixed with the course's other segments (`weights`); after two hard segments comes a breather | 0.25 → 0.7 |
| Twist | ~20% | A risk/reward piece (`acts.risk`: a fork, split, paper walls or brake pad), then **combos** (two mechanics at once) | 0.6 → 0.85 |
| Finale | last 1–2 | The signature mechanic at its hardest, right before the goal | 0.9 → 1 |

- **Difficulty** sets each segment's numbers: bridges narrow, gaps widen, sweepers and belts speed up, crumbling tiles fall sooner, wind gets stronger. `d = 1` is about as hard as the bots can reliably manage.
- **Combos:** `sweeperBelt` (a belt under a sweeping arm), `windCrumble` (crumbling tiles in a crosswind), `boostSpring` (spring onto a launch strip), `liftWind` (a lift up to a windy bridge), `bumperTreadmill` (climb a down-belt past bumpers), `crumbleJump` (a run-up that crumbles behind you).
- **Forks:** a railed detour out to the side, or straight across a narrow beam or crumbling tiles with no safety walls. The risky line is about half as long.
- **Spring shortcuts:** wherever you wait for a moving floor (`lift`, `wheel`, `mover`, `sideMover`), springs in a row beside it skip the wait (`springHops` in `generator.ts`). Each floating spring throws you onto the next; miss one and you fall. The bot `route` waits and `starRoute` takes the springs.
- `npm run gen-levels` prints each course's plan, e.g. `springUp(0) → turn(0.2) → … → fork(0.6) → boostSpring(0.8) → springUp(0.9) → springUp(1)`.

## Stars

Every race course hides **3 stars**, and each one asks you to use the mechanic it sits on harder or differently than the safe line does. The careful bot on the safe line never gets one (`gen-levels` rejects courses where it does).

| Kind | Where | What it asks |
|---|---|---|
| Super spring | `springUp` | A smaller, stronger spring beside the normal one; the star waits at the top of its bounce |
| Edge line | jumps | The star is over the gap off the kicker's edge: take the jump on its edge |
| Moon swerve | `moonJump` | The star floats beside the low-gravity arc: steer in the air |
| Column | `updraft` | Near the top of the air column, off to one side: ride the draft |
| Steer the fall | `drop` | Just past the cliff edge, to one side: roll off there |
| Crest | `boostRamp` | On the crest beside a rail: steer to the edge at boost speed |
| Crumbling detour | crumble bridges | An open crumbling side tile: on and off before it drops |
| Downwind ledge | `windBridge` | An open ledge the wind blows you toward; then fight back |
| Tightrope / narrow lane | `bridge`, `split` | A thin open beam alongside, or the narrower open lane |
| Fast lane | `conveyor` | A narrow, faster, open belt beside the main one |
| Corner, gap | `zigzag`, `gauntlet` | The corner's outer tip; the open edge between two arms |
| Catch the tip (riding) | `sweeper` | Rides the arm's tip: wait in a corner and snatch it as it swings past |
| Elevator (riding) | `lift` | Rides its own lift beside the tower: catch it at the top edge |
| First ride (switch) | `mover` | A button on the near pad; the star on the far pad for one platform trip |
| Shortcut / race (switch) | `fork` | On the risky line, or a switch star at the exit that only the risky line beats |
| Don't brake (switch) | downhill curves, plunges, cascades | A button at the top, the star at the bottom |
| Lip | `brakePad` | Just past the pad's far edge: stop right at the brink |
| Pocket | `pinball` | In a pocket a sliding toadstool slides into: dart in and out |
| Beat (riding) | `keys` | Over a side key in time with its neighbour |
| Rim (riding) | `turntable` | Rides the disc near its rim: wait out there for it |
| Arc | `pendulum` | At the pad's edge, where the bob swings low |
| Tilt | `rocker` | Just off the edge of the tipping ruler |
| Pinch | `rollers` | Out in a row of logs, off the straight line |
| Smash (switch) | `paperWall` | A button on the way in; only tearing straight through the paper beats the timer |
| Steer | `ironBall` | Over the spike field off the straight line: steer the iron ball there |
| Climb (switch) | `wheel` | A button on the start pad; only boarding the very next step beats the timer |
| Peek | `trickGates` | Behind a narrow side door that opens half as often |
| Dodge | `logSlope` | In the next lane in, just above the second bay |
| Spur | any | A dead-end plank: only when nothing else on the course offered one |

- **Choosing:** stars go one per third of the course (before the finale). The course's own mechanics (its acts) get the first half of each third, then any segment that can hide one may. A course never repeats a kind (except the spur). `npm run gen-levels` prints each star's kind in the plan, e.g. `springUp(0)★super`.
- **Riding stars** (`to` + `period`, or `center` + `speed`, or `ride`: the index of any moving piece) move exactly in step with the mover, arm, key or disc they copy. The star route waits for them at `catch` points.
- **Switch stars** (`button`, `time`) are a faint ghost until you roll over their red button; then the button lights up, the star shows for `time` seconds (a ⏱ timer in the HUD ticks down), and it blinks in its last 2 s. `gen-levels` sets `time` to 1.2× the star-route bot's button-to-star time. Mazes make their farthest star a switch star, with the button at its junction.
- **Collecting:** roll through one. Stars stay collected after a fall and reset when you restart.
- **Saving:** stars count once you finish, and add up across runs (saved in the browser, like best times). The HUD, the results screen and the level select (stars on each map) show them.
- **Multiplayer:** races have no stars for now.
- **Gold times** take the risky lines into account: gold is the lower of 0.85× the careful bot's time and 0.95× the star route's time.
- **The star route:** levels have a second bot route, `starRoute`, through the risky lines and past every star. Tests check that a bot following it collects all 3 without falling, and that the server's anti-cheat accepts such a run.

## Themes and cosmetics

- **Themes (worlds):** set `"theme"` on a level: `meadow`, `candy`, `ice` or `night`. Each is one feeling on the hamster's escape (`DESIGN.md` → The story) with one physics rule, set on the theme and applied by the simulation (`MECHANICS.md` → World rules):
  - `gust` (meadow): wind volumes swell and ease on the clock (`gustAt()`); their streaks show it.
  - `bounce` (candy): floors' restitution, so landings hop.
  - `grip` (ice): floor friction × 0.3.
  - `gravity` (night): × 0.85, also used by the generator's jump and spring arcs (`gravityOf()`).
  - `tagline`: one line under the world's name on the level select.
  - The first finish of the last course (Starfall Peak) plays a wordless ending beat (`playEnding()` in `main.ts`): the hamster curls up asleep and the camera drifts up to the stars. Any key skips it.
- **Art direction, "the hamster's world":** courses are built from things a hamster finds around a house, and each world is a place the hamster believes is the outside. Meadow (the living room, seen as a meadow), Candy (a kitchen counter), Ice (the refrigerator's freezer) and Night (above the city on a heavenly night).
  - A theme's `look` (`src/levels/themes.ts`) says what each floor palette, rail, wall, bumper and sweeper is made of. In the meadow: floorboards, a green shag rug on soil, toy boards, popsicle-stick rails, box hedges, toadstool bumpers, pencil sweepers, crackers for crumbling tiles, and pennant checkpoints. At night, bumpers are glowing mushrooms in turn of `bumper.colours`.
  - Textures are painted on canvas once (`src/render/surfaces.ts`) and tiled in world units across the merged meshes. Floor and rail sides darken towards the bottom via vertex colours.
  - The sky is a world-locked painted panorama (`src/render/backdrop.ts`): gradient, sun glow, the floor far below, and giant soft shapes around the horizon (the living room's furniture and desk fan, the kitchen, the fridge, the city). It costs nothing extra to draw. Specks drift in the light (off on the low graphics setting), and a CSS vignette frames the picture.
  - The textures and shaders are prepared while the menu is idle (`src/render/prewarm.ts`), so a theme's first course doesn't stall.
  - Icy surfaces (`GLOSS` in `surfaces.ts`) reflect the painted sky. A look with `cold` adds the ice feel in `main.ts` (`coldFeel`): steering across or against a slide throws up shavings with a scraping hiss, landings glint, and your breath puffs every couple of seconds.
  - Night: fairy lights and star stickers glow (`EMISSIVE` in `surfaces.ts`: the texture is its own glow map), stars are painted all round the sky, and `Aurora` (`backdrop.ts`) draws live Lifestream-green aurora curtains around the ball, with a soft glow of them below the horizon, in one draw call (hidden on the low graphics setting, which keeps a painted one). Low-gravity zones in every theme are drifting, twinkling stardust (`stardustPoints` in `level-view.ts`: all zones in one GPU-animated Points mesh). A look's `trail` sheds stardust behind a fast or flying ball, `glints` sparkle on landings, and `chime` rings on big landings and springs.
  - Add a theme's look by giving it a `look`, plus any new surface kinds or backdrop shapes it needs.
- **Game feel** (see `DESIGN.md`):
  - **Particles:** `src/render/effects.ts`, two fixed pools and two draw calls: dust, streaks, sparks, crumbs, sparkles and confetti.
  - **Ball and hamster:** squash and stretch, the respawn pop, lean, in-air flailing, dizziness and the finish cheer, all in `src/render/ball-view.ts`.
  - **Camera:** field-of-view kicks and landing dips in `src/render/camera.ts`.
  - **Sound:** a continuous rolling and wind sound, plus landing, respawn and confetti sounds, in `src/render/audio.ts`.
  - **Hit-stop:** solo-only, on star grabs and big landings.
  - **Where they're triggered:** `feel()` in `src/main.ts` maps each simulation event to its response.
  - **Settings:** "Motion effects: Reduced" tones it all down.
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
| `bumper` | `position` (base), `radius?`, `height?`. With `to` + `period` (+ `phase?`) it slides there and back |
| `sweeper` | `position` (floor under the pivot), `length`, `speed` (rad/s) |
| `mover` | `from`, `to` (top-surface centers), `w`, `d`, `period` (s), `phase?` (s ahead in its cycle), `hold?` (fraction resting at each end; piano keys) |
| `turntable` | `center` (top middle), `radius`, `speed` (rad/s), `gaps?` (degrees round from +x where the rim is open) |
| `pendulum` | `pivot`, `length` (to the bob's centre), `swing` (degrees either side), `period`, `phase?`, `yaw?` (it swings across this direction), `radius?` (the bob) |
| `rocker` | `center` (top middle), `w`, `d`, `tilt` (degrees either side), `period`, `phase?`: tilts about its longer middle line |
| `roller` | `from`, `to` (floor points), `period`, `phase?`, `radius?`, `length?`, `launcher?`, `wait?`: a log rolling from `from` to `to`, then starting again. With `launcher`, it comes out of a hopper whose lamp counts down to each launch, and breaks into splinters at `to`; `wait` is the seconds of each period it waits in the hopper first |
| `paper` | `position` (floor under its middle), `w`, `h?`, `yaw?`, `speed?` (default 15): a ball this fast tears through it (for that player, until they respawn) |
| `ironball` | `position` (the floor point it rests on), `radius?` (3), `roll?`, `yaw?`: a giant iron ball you ride. Real physics, one per player, held still until you land on it and put back on a respawn. With `roll` (a speed), it rolls on along `yaw` by itself while you ride it: your sideways push steers it, pushing along its way moves you over its top, and a gentle pull keeps you near the top (`SIM.carrier`). Without it, your push rolls it |
| `spikes` | `center` (top middle), `w`, `d`: touching it sends you back to your last checkpoint |
| `wheel` | `center` (the hub), `radius` (to the top of each step), `speed` (rad/s), `steps?` (6), `w?`, `d?` (step size), `yaw?`: a Ferris wheel of level steps |
| `gate` | `position` (floor under its middle), `w`, `h?`, `yaw?`, `period`, `phase?`, `open?` (fraction of the period it's open, default 0.5): a door that sinks into the floor to open |
| `checkpoint` | `position`, `yaw?` |
| `goal` | `position`, `radius?` (exactly one per race course) |
| `zone` | `position`, `radius?` (arenas only: King of the Hill zones) |
| `star` | `position` (the star's centre, about 1.4 above the floor): a collectible; race courses only. Optional: `to` + `period` (slides there and back like a mover), `center` + `speed` (circles like a sweeper arm's tip), `ride` (the index of a moving piece it rides with, placed relative to that piece at rest), `button` (floor point of a switch) + `time` (seconds it shows, default 6) |
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

The route's waypoints can also set:
- `lane`: the widest lane bots may take there; 0 means tight, racing line only.
- `catch`: hold there until a star is collected (for riding stars).
- `ride`: stay on the moving platform you're on until it brings you to this point (a wheel's step).
- `timed`: hold there until the way on is clear. The bot looks ahead along the route (`src/sim/predict.ts`) until the next timed point or a spot out of reach of every moving piece. It goes when no moving piece will be in its way and there will be floor under it all along. Every moving piece is a function of the sim clock, so this is exact maths, not guessing. Use it before keys, turntables, pendulums, rollers and sliding bumpers.

`pad`, `path`, `crumble` and `conveyor` pieces can set `open: true`: no safety walls on them (risky lines that are meant to be fallen off).

`starRoute` (optional) is a second list of waypoints that takes the risky lines and collects every star. The editor's **Check with bot** also runs it. The editor doesn't edit `starRoute` yet: if you move pieces it passes through, edit the JSON or regenerate the course.

`route` is a list of waypoints (`p`, plus optional `speed` and `wait`) that the autopilot follows. The course test fails if the autopilot can't finish a level without falling, so every level needs a route. `wait: true` holds until a moving platform arrives under that point.

To add a level, create `src/levels/<name>.json`, register it in `src/levels/index.ts`, run `npm run add-walls`, then run `npm test`.

**Safety walls:** `npm run add-walls` puts a low wall (colour `#eef1f6`) on every floor edge you could roll off. It leaves gaps where the route leaves the floor (jumps, drops, gaps to platforms, lifts and updrafts), and skips edges that already have a rail, a wall, or more floor beside them. Re-running rebuilds the walls. Arenas are left open.

**Conventions:** the course runs toward −z and the ball radius is 1. Every solid is a box or a cylinder (the iron ball is the one sphere), so each one maps directly onto a Roblox Part for the later port.

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
- `moving-pieces.test.ts`: the iron ball waits until you land on it, rolls the way you push and goes back on a respawn; spikes send you back; wheel steps carry you up and stay level; gates block while up; logs sit on slopes; iron balls are only drawn for others near their rider; every motion reports the velocity it really moves at; turntables carry a resting ball and keep it in except at gaps; piano keys drop a waiting ball; pendulums and rollers knock the ball; rockers tip it to the low side; sliding bumpers kick from where they are now; paper stops a slow ball, tears for a fast one and mends on respawn; stars ride any moving piece; bots wait for a gap in a swinging pendulum whenever they arrive. `course.test.ts` runs each new segment (brake pad, pinball, keys, turntable, pendulum, rocker, rollers, paper walls, iron ball, spin wheel, trick gates, log slope) at difficulty 0 and 1 with careful, side-lane and slower bots setting off at different moments, and the server accepts every run.
- `e2e/smoke.spec.ts` also plays the mechanic sandbox (`?sandbox=turntable`).
- `e2e/multiplayer.spec.ts`: two browsers: create, join by invite link, ready, race, agree on live positions, leave; wrong room code shows a clear error; Quick Play lobby counts down and bots fill the race.
- World rules: meadow wind gusts on the clock, candy floors bounce, night gravity is lighter (`world-rules.test.ts`).
- Stars and pacing: stars are collected once, kept after a fall, reset on restart; riding stars stay in step with their mover or arm; switch stars show only while their timer runs, which survives a fall (`mechanics.test.ts`); every star-hiding segment hides its own kind of star, which the star route collects and the safe line doesn't (`course.test.ts`); stars use the course's mechanics first and never repeat a kind (`levels.test.ts`); every course has 3 stars and a star route that a bot finishes with all 3 and no falls (`course.test.ts`); star-route runs pass the server checks (`rules.test.ts`); courses run intro → build-up → twist → finale and get harder, forks have an open risky line (`levels.test.ts`); every combo segment builds and can be finished (`course.test.ts`).
- `feedback.test.ts`: the run recorder (falls, sections, splits, restarts), layout versions, and the per-course feedback numbers; `meta.test.ts` checks the report includes them, and `e2e/smoke.spec.ts` rates a course in playtest mode, exports it, and answers the quit form.
- `meta.test.ts`, `api.test.ts`: accounts and recovery, level curve, rewards (paid once per claim), buying and equipping, level unlocks, ad-double limits, purchases, challenges, solo replay checks (honest run, run with a fall, cheat, unfinished), leaderboards, the HTTP API, CORS, Stripe webhooks (valid, forged, stale, retried), multiplayer rewards, the analytics report.
- `e2e/smoke.spec.ts` also checks: Customize (free items persist, locked items show requirements); a full solo run in the browser that the server checks, pays out and ranks; the stats consent (nothing sent without a yes); delete-my-data.
- `cluster.test.ts`: gateway + 2 workers + Redis. Accounts work on either worker, room codes and Quick Play match across workers, rooms spread out, and crashed workers restart. Skipped without Redis; CI provides it.
- `shutdown.test.ts`: a deploy mid-race lets the race finish before the server stops.
- `portal-build.test.ts`: CrazyGames, Poki and web builds (SDK script, relative paths, no shop or editor on portals).
- `quality.test.ts`: auto quality steps down on slow frames, ignores hidden-tab hiccups, and doesn't flip back and forth.

## Playtesting and course feedback

Every course can collect feedback for tuning: what players think of it, and what happened on their runs.

- **Run data (automatic):** each finish or quit records where the ball left the floor before every fall, the time at each checkpoint, restarts, and the stars found (`RunRecorder` in `src/meta/feedback.ts`). It rides along on the `level_finish` / `level_quit` events.
- **Ratings:** after a run, one tap each for Fun (😴 … 🤩), Difficulty, Length, the Stars and Variety, plus tapping the course map where it was most frustrating (this run's falls show as red dots). Quitting asks why instead (too hard, too long, boring, lost).
- **When it asks:** open the game with **`?playtest`** (remembered; `?playtest=0` turns it off) and the form appears after every finish and quit, with a comment box and a PLAYTEST tag in the HUD. Otherwise there's just a **📝 Rate this course** button on the results screen (highlighted the first time).
- **Where it goes:** always kept in the browser (the last 300 events), so it works on the offline Pages build: **Settings → Export course feedback** downloads it as a file. With stats consent and a server, it's also sent as anonymous events.
- **Reading it:** `npm run analytics` adds a per-course feedback table (the courses that need attention first); `npm run analytics -- a.json b.json` adds exported files, and `npm run analytics -- --export all.json` writes the server's feedback as a file. Open **`/feedback.html`** (the feedback viewer) and drop files in to see each course's map with falls and marked spots, rating bars, section times, star find rates and comments.
- Feedback is per course **layout** (`v`, a hash of the pieces): regenerating a course starts its feedback fresh.

## Single-player version on GitHub Pages

`npm run build:pages` builds a single-player version into `dist-pages/`. It needs no server:
- **Included:** all 36 courses (with stars), Customize (everything unlocked except paid Starter Pack items), the level editor and Settings.
- **Left out:** Quick Play, rooms, the shop, leaderboards, accounts and analytics.
- **Offline:** it makes no network requests, and asset paths are relative, so it works under `https://<you>.github.io/<repo>/`.
- **Saved progress:** best times and your look are stored in the browser.

`.github/workflows/pages.yml` publishes it on every push to `main` or `master`. One-time setup: on GitHub, open the repo's **Settings → Pages** and set **Source** to **GitHub Actions**. Pages on a private repo needs a paid GitHub plan; on a free plan, make the repo public (it contains no secrets).

