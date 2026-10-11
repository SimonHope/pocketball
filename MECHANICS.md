# Mechanics catalog

This file lists everything a course can be built from, and it is also the switchboard: the **On** column in the Segments and Star challenges tables is read by the course generator.

Use it to:
- see what exists and which courses use it;
- turn mechanics on or off;
- find where each one is tuned;
- check that a new idea doesn't overlap an existing one.

For why the game is designed this way, see `DESIGN.md`. For the level file format, see `standalone/README.md`.

## How to use this file

- **Turn a mechanic off or on:** change its **On** cell to `off` or `on`, then run `npm run gen-levels` in `standalone/`.
  - A switched-off segment or star kind is never placed, even when a course asks for it. If a course's opening or finale is left empty, it draws from its build-up mix instead.
  - Courses already saved as JSON keep the mechanic until they're regenerated.
  - Switching off `starSpur` (or the `spur` star) removes the fallback star, so some courses may need more seeds to find their 3 stars.
- **Adjust a mechanic:** the **Gets harder with `d`** column says what difficulty (0 = gentle, 1 = hardest) changes. The numbers live in that segment's builder in `standalone/src/levels/generator.ts` (`SEGMENTS`), mostly as `mix(gentle, hardest, d)`. Physics values for pieces live in `SIM` in `standalone/src/config.ts`, or on the pieces themselves. Regenerate afterwards; the bots re-check every course.
- **Choose where a mechanic appears:** each course's mix (`weights`) and its acts (opening, twist, finale) are in `standalone/scripts/targets.ts`.
- **Remove a mechanic:** switch it off here first and regenerate. Delete its code only when nothing needs it any more.
- **Add a mechanic:** follow [Adding a new mechanic](#adding-a-new-mechanic) below.
- **Try a mechanic on its own:** run `npm run dev` and open `localhost:5173/?sandbox=<segment>`, for example `?sandbox=keys&d=0.5&star`.
  - It plays a short course of just that segment at difficulty `d` (0 to 1, default 0.5); `star` hides its star.
  - Links in the corner make it easier or harder, give a new layout, or toggle the star; the menu button gives a new layout.
  - Nothing is saved or sent.

`npm test` checks that this file and the code agree. Every segment and star kind in the code must appear exactly once here, and nothing unknown may appear. The **On** cells must say `on` or `off`. The **Courses** column must match `scripts/targets.ts`. If you change a course's mix, update its row; the test tells you exactly what it expects.

## Design space

Each mechanic asks the player to do one main thing. Before adding a new one, find its verb here. A crowded row means a new idea should do something different, or replace one.

| The player has to… | Segments | Star challenges |
|---|---|---|
| **Aim** (pick a line before leaving the ground) | `jump`, `boostJump`, `moonJump`, `crumbleJump`, `springUp`, `drop` | `edge`, `super`, `fall` |
| **Steer in the air** | `moonJump`, `updraft` | `moon`, `column` |
| **Time a pass** (slip through a gap in something moving) | `sweeper`, `gauntlet`, `sweeperBelt`, `pinball`, `pendulum`, `rollers`, `logSlope` | `tip`, `gap`, `pocket`, `arc`, `pinch`, `dodge` |
| **Ride or read a moving floor** | `mover`, `sideMover`, `lift`, `keys`, `turntable`, `rocker`, `wheel` | `elevator`, `firstRide`, `beat`, `rim`, `tilt`, `climb` |
| **Balance** (keep on top of something you're moving) | `ironBall` | `steer` |
| **Read the open way** (pick from choices that change) | `trickGates` | `peek` |
| **Stop exactly** | `brakePad` | `lip` |
| **Hold a narrow line** | `bridge`, `zigzag`, `split`, `slalom`, `fork` (beam) | `tightrope`, `lane`, `corner`, `shortcut` |
| **Fight a force** (wind, belts) | `windBridge`, `treadmill`, `conveyor`, `windCrumble`, `bumperTreadmill`, `liftWind` | `downwind`, `fastLane` |
| **Commit** (no stopping, the floor won't wait) | `crumbleBridge`, `windCrumble`, `crumbleJump`, `fork` (tiles) | `detour` |
| **Carry speed** | `boostRamp`, `boostJump`, `steep`, `spiral`, `cascade`, `hairpin` (downhill), `boostSpring`, `paperWall` | `crest`, `noBrake`, `race`, `smash` |
| **Choose risk** | `fork`, `split`, `paperWall` | `shortcut`, `race`, `spur`, `smash` |
| **Just roll** (breathers) | `straight`, `turn`, `curve`, `rampDown`, `rampUp`, `stairs` | — |

**Thin spots worth filling:** anything to do with other players outside the party modes, and power-ups. The October 2026 batch filled stopping exactly (`brakePad`), floors that change or turn (`keys`, `turntable`, `rocker`) and moving bumpers (`pinball`). "Time a pass" is now the most crowded row: a new idea there needs a clearly different shape.

**Not in any course yet:** `brakePad`, `pinball`, `keys`, `turntable`, `pendulum`, `rocker`, `rollers`, `paperWall`, `ironBall`, `wheel`, `trickGates` and `logSlope`. Play them in the sandbox first, then add them to courses in `scripts/targets.ts`.

## Pieces

These are the building blocks: the solid things and volumes a level is made of. This table is for reference and can't be switched off here, because hand-made levels may use any piece. Fields and defaults are in `standalone/README.md` → "Levels".

| Piece | What it does | Main tuning |
|---|---|---|
| `pad`, `path`, `block` | Floors, ramps and walls. `open: true` means no safety walls | Size, width, rails |
| `bumper` | Knocks the ball away. With `to` and `period` it slides to and fro | `SIM.bumperImpulse`, `SIM.bumperRestitution`, `period`, `phase` |
| `sweeper` | A spinning arm on a post | `length`, `speed` |
| `mover` | A platform sliding between two points (a lift if they differ in height; a piano key with `hold`) | `period`, `phase`, `hold` (time resting at each end) |
| `turntable` | A spinning disc with a low rim, open at `gaps` | `radius`, `speed`, `gaps` |
| `pendulum` | A rod and bob swinging across a direction | `length`, `swing`, `period`, `phase` |
| `rocker` | A plank tilting from side to side about its long middle line | `tilt`, `period`, `phase` |
| `roller` | A log rolling one way along the floor, again and again (from a launcher with `launcher`, waiting `wait` seconds between runs) | `period`, `phase`, `radius`, `length`, `wait` |
| `paper` | A wall a fast ball tears through (only for that player, until they respawn) | `speed` |
| `ironball` | A giant iron ball (a sphere, real physics) you ride on top of; one per player, back in place when you respawn. With `roll` it rolls on by itself while you ride it and you steer it; without, your push rolls it | `radius`, `roll`, `yaw`, `SIM.carrier` |
| `spikes` | A floor that sends you back to your last checkpoint | — |
| `wheel` | A Ferris wheel of level steps turning across a direction | `radius`, `speed`, `steps` |
| `gate` | A door that sinks into the floor (open) and rises (shut) on the clock | `period`, `phase`, `open` |
| `boost` | Launches you along its direction | `speed` (default 30) |
| `spring` | Bounces you up (`push` also sends you forward) | `power`, `push`, `SIM.springCooldown` |
| `conveyor` | A belt carrying you along (`open: true` for no walls) | `speed`, `SIM.conveyorAccel` |
| `crumble` | Falls away after you touch it | `delay`, `respawn` |
| `wind` | A box of moving air: crosswinds and updrafts | `strength`, `speed`, `dir` |
| `lowgrav` | A box of low gravity | `scale` |
| `checkpoint`, `goal` | Where you respawn, and the finish | — |
| `star` | A collectible. It can slide (`to` and `period`), circle (`center` and `speed`), ride any moving piece (`ride`: the piece's index) or wait for a switch (`button` and `time`) | `SIM.starRadius`, `SIM.buttonRadius` |
| `zone` | A hill for King of the Hill (arenas only) | `radius` |

## Segments

Each segment is a stretch of course built from pieces, with its own bot route. **Kind** is one of:
- **breather:** nothing to get right;
- **hard:** a gap, hazard or timing challenge;
- **combo:** two mechanics at once;
- **risk:** a choice between a safe and a risky line.

| Segment | On | Kind | What the player does | Gets harder with `d` | Star | Courses |
|---|---|---|---|---|---|---|
| `straight` | on | breather | Rolls down a railed straight | — | — | Warm-Up, Sweeper Alley, Candy Hop, Frosty Slide, Glacier Run, Moonlit Path |
| `slalom` | on | hard | Weaves between bumpers | 2 bumpers, then 3 | — | Warm-Up, Switchback Ridge, Candy Hop, Gumdrop Gauntlet, Polar Plunge |
| `rampDown` | on | breather | Rolls down a ramp | — | — | Zig-Zag, Frosty Slide, Glacier Run, Polar Plunge, Avalanche |
| `rampUp` | on | breather | Climbs a ramp onto a landing | — | — | — |
| `turn` | on | breather | Turns 90° on a pad (with a checkpoint) | — | — | Warm-Up, Zig-Zag, Sweeper Alley, Candy Hop, Gumdrop Gauntlet, Sugar Rush, Frosty Slide, Glacier Run, Polar Plunge, Moonlit Path, Starlight Circuit, Midnight Maze |
| `curve` | on | breather | Takes a smooth railed curve | — | — | Warm-Up, Zig-Zag, Rolling Hills, Switchback Ridge, Summit Run, Taffy Twist, Lollipop Leap, Sugar Mountain, Avalanche, Crystal Caverns, Frozen Falls, Comet Jump, Nebula Spiral |
| `hairpin` | on | breather | Takes a descending switchback | — | `noBrake` | Switchback Ridge, Summit Run, Avalanche, Frozen Falls, Nebula Spiral, Starfall Peak |
| `steep` | on | breather | Plunges down a steep railed slope | — | `noBrake` | Summit Run, Sugar Mountain, Frozen Falls, Starfall Peak |
| `spiral` | on | breather | Rides a corkscrew down under its own start | — | `noBrake` | Summit Run, Sugar Mountain, Nebula Spiral, Starfall Peak |
| `drop` | on | hard | Rolls off a cliff onto a walled pad below | — | `fall` | Summit Run, Sugar Mountain, Polar Plunge, Frozen Falls, Starfall Peak |
| `cascade` | on | breather | Drops down wide waterfall steps | — | `noBrake` | Summit Run, Sugar Mountain, Frozen Falls, Starfall Peak |
| `stairs` | on | breather | Rolls down steps | — | — | Rolling Hills, Lollipop Leap, Avalanche, Crystal Caverns |
| `bridge` | on | hard | Crosses a narrow bridge | Width 5.5 → the course's narrowest; tightrope beam 3 → 2.5 | `tightrope` | Zig-Zag, Moonlit Path, Starlight Circuit, Midnight Maze, Comet Jump, Nebula Spiral |
| `zigzag` | on | hard | Crosses a narrow bridge that zig-zags | Width 6 → 5 | `corner` | Zig-Zag, Candy Hop, Sugar Rush, Midnight Maze |
| `split` | on | hard | Picks one of two lanes around a hole | Lanes 5 → 4 wide; star lane 3.5 → 3 | `lane` | Rolling Hills, Switchback Ridge, Taffy Twist, Crystal Caverns |
| `jump` | on | hard | Jumps a gap off a kicker | Gap 4 → 6 | `edge` | Lollipop Leap |
| `boostJump` | on | hard | Boosts off a kicker over a long gap | Gap 12 → 15 | `edge` | Summit Run, Sugar Rush, Sugar Mountain, Comet Jump |
| `moonJump` | on | hard | Floats over a huge gap in low gravity | Gap 16 → 22; star swerve 2.5 → 3.5 | `moon` | Moonlit Path, Comet Jump, Starfall Peak |
| `springUp` | on | hard | Bounces off a spring onto a ledge | Ledge 3 → 5 high; super spring power 21 → 24 | `super` | Warm-Up, Rolling Hills, Candy Hop, Lollipop Leap, Sugar Mountain |
| `boostRamp` | on | breather | Boosts up a climb | — | `crest` | Warm-Up, Rolling Hills, Sugar Rush, Frosty Slide, Starlight Circuit |
| `updraft` | on | hard | Rides a column of rising air onto a ledge | — | `column` | Crystal Caverns, Nebula Spiral |
| `mover` | on | hard | Rides a platform across a gap | Gap 10 → 16 | `firstRide` | Starlight Circuit |
| `sideMover` | on | hard | Crosses on a platform sliding sideways | Period 9 → 7.5 s | — | Gumdrop Gauntlet |
| `lift` | on | hard | Rides a lift up to a tower | — | `elevator` | Switchback Ridge, Lollipop Leap, Glacier Run, Crystal Caverns, Starlight Circuit |
| `sweeper` | on | hard | Crosses an arena with a spinning arm | Arm 0.8 → 1.3 rad/s | `tip` | Sweeper Alley, Gumdrop Gauntlet, Sugar Rush |
| `gauntlet` | on | hard | Runs a wall-less path past two arms | Arms 0.5 → 0.8 rad/s | `gap` | Sweeper Alley, Taffy Twist, Comet Jump |
| `crumbleBridge` | on | hard | Crosses tiles that fall behind you | 3 → 5 tiles, width 6 → 5, they fall after 0.7 → 0.45 s | `detour` | Sweeper Alley, Gumdrop Gauntlet, Glacier Run, Polar Plunge, Midnight Maze |
| `conveyor` | on | breather | Is carried along by a belt | — | `fastLane` | Sweeper Alley, Sugar Rush, Taffy Twist |
| `treadmill` | on | hard | Climbs a belt running down at you | Belt 5 → 7 | — | Taffy Twist |
| `windBridge` | on | hard | Crosses a narrow bridge in a crosswind | Width 6 → narrowest (at least 4.5), wind 6 → 10 | `downwind` | Zig-Zag, Avalanche, Frozen Falls, Midnight Maze |
| `fork` | on | risk | Takes a railed detour, or a wall-less shortcut half as long | Beam 3.5 → 3 wide; tiles 4.5 → 4 | `shortcut` or `race` | every paced course (its twist) |
| `starSpur` | on | risk | Detours down a dead-end plank for a star | — | `spur` | every course with stars (fallback) |
| `sweeperBelt` | on | combo | Rides a belt under a sweeping arm | Belt 8 → 10, arm 0.9 → 1.4 rad/s | — | Sweeper Alley, Sugar Rush, Taffy Twist |
| `windCrumble` | on | combo | Crosses crumbling tiles in a crosswind | Wind 5 → 8 | `detour` | Zig-Zag, Gumdrop Gauntlet, Glacier Run, Avalanche, Frozen Falls, Midnight Maze |
| `boostSpring` | on | combo | Springs onto a ledge, then boosts up a climb | As `springUp` and `boostRamp` | `super`, `crest` | Warm-Up, Rolling Hills, Candy Hop, Lollipop Leap, Sugar Mountain, Starlight Circuit |
| `liftWind` | on | combo | Rides a lift, then crosses a windy bridge | As `lift` and `windBridge` | `elevator`, `downwind` | Switchback Ridge, Lollipop Leap, Glacier Run, Crystal Caverns, Starlight Circuit, Nebula Spiral |
| `bumperTreadmill` | on | combo | Climbs a down-belt between bumpers | Belt 4 → 6; 2 bumpers, then 3 | — | Taffy Twist |
| `crumbleJump` | on | combo | Runs up crumbling tiles into a jump | Gap 4 → 6 | `edge` | Summit Run, Gumdrop Gauntlet, Frosty Slide, Polar Plunge, Moonlit Path, Comet Jump, Starfall Peak |
| `brakePad` | on | hard | Brakes down a steep slope onto a small open pad, then turns off it | Drop 4 → 6; pad 9 → 6.5 wide | `lip` | — |
| `pinball` | on | hard | Slips past rows of toadstools sliding across a lane | 2 rows, then 3; slide 4 → 2.8 s; no walls from 0.6 | `pocket` | — |
| `keys` | on | hard | Keeps pace with piano keys sinking and rising in a wave | 4 → 6 keys; beat 5.2 → 4.2 s; time up 38% → 32%; the wave runs at about 6.5 units/s | `beat` | — |
| `turntable` | on | hard | Rolls onto a turning disc through a gap in its rim, and off when a gap lines up with the way out | Radius 8.5 → 7; 0.5 → 0.8 rad/s | `rim` | — |
| `pendulum` | on | hard | Times a pass under conkers swinging across a bridge | 1 swing, then 2; period 3.4 → 2.8 s; bridge 5 → 4 | `arc` | — |
| `rocker` | on | hard | Crosses a ruler tipping from side to side | Tilt 6° → 12°; period 5 → 3.5 s; 5 → 4 wide | `tilt` | — |
| `rollers` | on | hard | Crosses rows of logs rolling across the way, with no walls | 2 rows, then 3; logs 7 → 12 units/s | `pinch` | — |
| `paperWall` | on | risk | Weaves through the gaps in paper walls, or boosts and tears straight through | Tears at 14 → 18 units/s | `smash` | — |
| `ironBall` | on | hard | Rolls onto a giant iron ball at the end of the start pad. It rolls on across a pit of spikes by itself; push sideways to steer it, and keep your balance on top | Field 18 → 26 long; it rolls 2.5 → 4 units/s | `steer` | — |
| `wheel` | on | hard | Rides a Ferris wheel's step up to a high ledge | Radius 6 → 8 (a higher climb); 6 steps, then 5 | `climb` | — |
| `trickGates` | on | hard | Picks the one open door in a row, all of them switching at once | 2 doors, then 3; 1 row, then 2; open 1.8 → 1.2 s | `peek` | — |
| `logSlope` | on | hard | Climbs a slope while logs roll down at it from launchers at the top (a lamp flashes before each one), waiting in side bays | 2 lanes, then 3; logs 7 → 9 units/s; pause between logs 2.2 → 1.4 s; steeper | `dodge` | — |

## Star challenges

Each star asks for something more than the safe line does. A course never uses the same kind twice, except `spur`, the fallback. **Type** is one of:
- **static:** the star stays put;
- **riding:** it moves with a mechanism, and you catch it;
- **switch:** a button shows it for a few seconds.

| Kind | On | Type | Segment | What it asks |
|---|---|---|---|---|
| `super` | on | static | `springUp` | Take the stronger spring beside the normal one; the star is at the top of its bounce |
| `edge` | on | static | `jump`, `boostJump`, `crumbleJump` | Take the kicker on its edge; the star is over the gap, off-centre |
| `moon` | on | static | `moonJump` | Steer in low gravity to a star beside the arc |
| `column` | on | static | `updraft` | Stay in the air column to a star near its top |
| `fall` | on | static | `drop` | Roll off the cliff at the side to fall through the star |
| `crest` | on | static | `boostRamp` | Steer to the rail at boost speed; the star is on the crest |
| `detour` | on | static | `crumbleBridge`, `windCrumble` | Get on and off an open crumbling side tile before it drops |
| `downwind` | on | static | `windBridge` | Let the wind carry you onto an open ledge, then fight back |
| `tightrope` | on | static | `bridge` | Cross a thin open beam beside the bridge |
| `fastLane` | on | static | `conveyor` | Ride a narrow, faster, open belt, and hop back before it ends |
| `lane` | on | static | `split` | Take the narrower open lane |
| `corner` | on | static | `zigzag` | Reach the corner's outer tip |
| `gap` | on | static | `gauntlet` | Reach the open edge between the two arms |
| `tip` | on | riding | `sweeper` | Wait in a corner and snatch the star off the arm's tip |
| `elevator` | on | riding | `lift` | Catch the star riding its own lift beside the tower |
| `firstRide` | on | switch | `mover` | Press the button as the platform comes, and make that one trip |
| `shortcut` | on | static | `fork` | Take the risky line; the star is halfway along it |
| `race` | on | switch | `fork` | Press the button on the way in; only the shortcut beats the timer |
| `noBrake` | on | switch | `hairpin`, `spiral`, `steep`, `cascade` | Roll over the button at the top and don't brake |
| `lip` | on | static | `brakePad` | Stop right at the brink: the star is just past the pad's far edge |
| `pocket` | on | static | `pinball` | Dart into a pocket a sliding toadstool slides into, and out before it comes back |
| `beat` | on | riding | `keys` | Step out onto a wide side key beside the last key (it stays up a little longer than its neighbour), then on to the pad; the star sinks with it |
| `rim` | on | riding | `turntable` | Wait out near the rim for the star riding round on the disc |
| `arc` | on | static | `pendulum` | Step out to the pad's edge, right where the bob swings low |
| `tilt` | on | static | `rocker` | Go out to the edge of the tipping ruler; the star is just off it |
| `pinch` | on | static | `rollers` | Stop out in a row of logs, off the straight line |
| `smash` | on | switch | `paperWall` | Press the button on the way in; only tearing straight through the paper beats the timer |
| `steer` | on | static | `ironBall` | Steer the iron ball off the straight line to a star over the spikes |
| `climb` | on | switch | `wheel` | Press the button on the start pad, then board the very next step |
| `peek` | on | static | `trickGates` | Go through the narrow side door, which opens half as often |
| `dodge` | on | static | `logSlope` | Dodge into the next lane, just above the second bay |
| `spur` | on | static | `starSpur` | Detour down a dead-end plank (used only when nothing else offered a star) |

Treadmills, `sweeperBelt`, `bumperTreadmill`, `slalom` and `sideMover` offer no star yet. A bot can't reliably collect one there (a slowed ball can't recover on a down-belt, and you can't stop on a moving belt). Those are open slots for a new star kind.

## Course pacing

These are knobs rather than mechanics; all are in `standalone/src/levels/generator.ts`.

| Knob | Where | Now |
|---|---|---|
| How a course is split into acts | `planSlots` | Opening ~20%, build-up ~45%, twist ~20%, finale the last 1–2 segments |
| Difficulty per act | `planSlots` | Opening 0 → 0.2, build-up 0.25 → 0.7, twist 0.6 → 0.85, finale 0.9 → 1 |
| Breathers | `BREATHERS`, `buildCourse` | One after each opening segment; one after every two hard segments |
| Which segments can hide a star | `STAR_SEGMENTS` | See the Star column above |
| Stars per course | `STARS` in `scripts/generate-levels.ts` | 3 |
| Medal times | `scripts/generate-levels.ts` | Gold = min(0.85 × the careful bot's time, 0.95 × the star route's time); silver 1.1×; bronze 1.5× |
| Switch-star timers | `SWITCH_SLACK` in `scripts/generate-levels.ts` | 1.2× the bot's button-to-star time |

## Mazes

Mazes are built by a separate generator (`standalone/src/levels/maze.ts`), with options set per maze in `scripts/targets.ts`: `loops`, `rooms` (sweeper rooms), `bumpers`, `bridges` (over pits), `holes`, `springs`, `lowGravity`, and the wall colour. Each maze hides 3 stars at the ends of side branches; the farthest is a switch star. Mazes: Hedge Maze, Candy Labyrinth, Ice Catacombs, Night Vault.

## Adding a new mechanic

1. **Find its verb** in [Design space](#design-space). If that row already has two or three mechanics, make sure yours asks for something they don't, or plan to replace one.
2. **Is it a new piece or a new segment?** Most ideas are segments built from existing pieces. A truly new piece also needs:
   - a schema entry and validation (`src/levels/schema.ts`);
   - geometry and physics (`src/sim/geometry.ts`, `src/sim/simulation.ts`);
   - drawing (`src/render/level-view.ts`) and editor fields (`src/editor/fields.ts`);
   - a physics test in `tests/mechanics.test.ts`;
   - for the Roblox port, solids made only of boxes and cylinders (spheres only where nothing else will do; the iron ball is one).
3. **Write the segment builder** in `SEGMENTS` (`src/levels/generator.ts`):
   - claim its space;
   - add its pieces and bot waypoints;
   - scale its numbers with `d`, so that `d = 1` is the hardest a careful bot reliably finishes.
4. **Give it a star challenge if it can,** one that asks for the mechanic used harder or differently. Then add the kind to `StarKind`, and add the segment to `STAR_SEGMENTS`.
5. **Add rows to this file** in Segments (and Star challenges), with **On** set to `on`. Add any feel effects (`feel()` in `src/main.ts`) following `DESIGN.md`.
   - Moving pieces must be a pure function of the sim clock (a `Motion` in `src/sim/geometry.ts`), so every player and the server see them in the same place.
   - Where the bot must wait for something moving, mark the waypoint `timed`. The bot then looks ahead (`src/sim/predict.ts`) and goes when the way is clear, with floor under it.
6. **Play it in the sandbox** (`?sandbox=<segment>`) at `d=0` and `d=1` before using it anywhere.
7. **Use it in some courses** (`scripts/targets.ts`), then update the **Courses** column.
8. **Prove it:** `tests/course.test.ts` has a test that builds each segment (and its star) on its own and races the bots over it. Then run `npm run gen-levels`, `npm run check` and a playtest (`?playtest`).
