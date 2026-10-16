# Pocket Ball: design philosophy

This document covers what the game is trying to be and the rules we design by. Related files:
- `MECHANICS.md`: every obstacle and route type, the switches to turn them on or off, and the checklist for adding new ones.
- `standalone/README.md`: how things are built.
- `TRACKER.md`: what's done and what's next.

## The game in one line

**A hamster in a see-through ball tries to break free from its human, racing through a world built from the house around it: alone against the clock, or in a bumping crowd of up to 16 friends.**

The fantasy is smallness and pluck. Everyday things are huge and turned into obstacles: a pencil sweeps the floor, a cracker crumbles under you, a sofa towers over the rug. You are tiny, determined and a bit chaotic.

## The story: breaking free

The hamster wants out. Each world is one feeling on the way, and each one is a place the hamster *believes* it has escaped to. The backdrop quietly tells the truth.

| World | Feeling | What the hamster believes | What the backdrop reveals |
|---|---|---|---|
| Meadow | Freedom, for the first time in its life | A vast green plain with a strong wind | The living room: a sofa, a floor lamp, the TV, a bookshelf, and a desk fan making the "wind" |
| Candy | Joy | A jewel-coloured world of candy, jelly and cake | The kitchen |
| Ice | Endurance | A blizzard where everything is slippery and breakable | The refrigerator |
| Night | Peace | Free at last, above the city under a green aurora and the stars | A city at night, far below. Maybe it's real, maybe it's a dream |

**The arc runs belief → joy → endurance → peace.** Each world's backdrop moves a step further out: from obviously still indoors, to outside (or is it?).

**Night stays open.** It could be the escape, a dream in the cage, or the hamster's last moment. Players can read it any of those ways, and we never pick one for them:
- Nothing on screen says "dream", "waking" or "dying". There's no cage, no sad music and no text.
- Peace, not grief. The ending is warm and quiet, because many players are children.
- The last course ends with one short beat on its first finish: the hamster curls up asleep in its ball under the aurora, and the camera drifts up to the stars.

**The feeling decides the gameplay.** Each world has one physics rule and a course character that serve its feeling (see "Worlds" under Course design). The story is told by the world itself: one line under each world's name on the level select, and nothing else to read.

## Pillars

Every feature should serve at least one of these. When two pull against each other, the earlier one wins.

1. **Readable first.** You can always tell what's floor, what's a hazard, where to go and what just knocked you off. Style never hides gameplay.
2. **Easy to pick up, deep to master.** Rolling is one stick. The depth comes from momentum, lines, risk and timing, not from more buttons.
3. **Every run teaches something.** A course introduces its idea, builds on it, twists it and tests it. Failing should feel like your mistake and show you what to try next.
4. **Risk is a choice.** The safe line always gets you home. Speed and stars are for players who choose the risky line.
5. **Fun with friends, fair for everyone.** Bumping is part of the fun, but the rules are the same for everyone, the server checks them, and nobody can pay to win.
6. **Light enough for any device.** It runs well in a browser on a modest laptop or phone, with no install and quick loads.

## Movement and feel

- **Physical, not floaty.** Momentum is real: you carry speed into ramps, slide on ice and get thrown by bumpers. The controls steer the ball's push; they don't snap it around. Tuning lives in `SIM` (`src/config.ts`).
- **Small air control.** You can nudge a jump in the air (40% of normal push), enough to correct a line or reach a star beside the arc, not enough to save a bad jump.
- **Falling is cheap.** A fall costs a couple of seconds and puts you back at the last checkpoint. Checkpoints are frequent, so a mistake never costs you the whole course.
- **The camera serves the player.** It chases by default, with fixed and top-down views one key away; mazes start top-down. It leans out with speed, and short shakes mark impacts.
- **Game-feel principles.** Every effect must:
  - answer something the player did (land, boost, bump, collect, fall);
  - be short;
  - never cover the floor ahead.
  
  Each effect should be cheap enough to keep on the low graphics setting, or easy to turn off there. Sound and motion carry most of it: a hit you can feel beats a big explosion you have to look at.
- **What answers what:**

  | Action | Response |
  |---|---|
  | Landing | Dust, a squash, a thump and a sand puff; big landings also dip the camera and hold for a beat (hit-stop) |
  | Boost | Streaks shot backwards, a punch of field of view |
  | Spring | A dust ring and a tall stretch |
  | Bumper or another ball | Sparks, a squash, and the hamster wobbles, dizzy |
  | Crumbling tile | Crumbs falling |
  | Star | Sparkles and a beat of hit-stop |
  | Checkpoint | The ring swells, with sparkles |
  | Respawn | A poof, and the ball pops back in |
  | Finish | Confetti; the hamster hops and spins |
  | Tearing through paper | Paper flakes and bright scraps, a papery rip, a small squash |
  | A piano key about to sink | It turns orange just before it drops (a warning, not a reaction) |
  | A gate about to move | It glows red just before it rises and shuts, green just before it opens |
  | Spikes | A bright spray of sparks and a sharp "ow", then the respawn poof |
  | A log launcher about to fire | Its lamp flashes amber, then red, and the next log drops into place (a warning) |
  | A log reaching the bottom | It breaks into splinters with a dry crack |

  Underneath it all, a rolling rumble follows your speed (quieter and brighter on ice, with a scraping hiss when you skid), and wind rises when you fly. The hamster leans into acceleration and turns, and flails its feet in the air.
- **Particle budget:** particles come from two fixed pools, so they're always two draw calls. They're halved on the low setting.
- **Hit-stop is solo only.** It skips simulation steps, so race times and the server's checks are unaffected.
- **Comfort:** the "Motion effects: Reduced" setting (the default when the system asks for reduced motion) turns off shake, field-of-view kicks, dips and hit-stop, and halves particles.

## Course design

Courses are generated from segments, verified by bots, and then polished by hand. The generator encodes the design rules so every course follows them.

- **Each course is a short story in acts:**
  1. **Intro:** the course's signature mechanic in its gentlest form, with a breather after each.
  2. **Build-up:** that mechanic mixed with others as they get harder, with a breather after every two hard sections.
  3. **Twist:** a risk/reward choice (a fork, a narrow lane, paper to tear through or a brake pad, different from the courses around it) and combos (two mechanics at once).
  4. **Finale:** the signature mechanic at its hardest, right before the goal.
- **Difficulty is a dial, not a coin flip.** Each section takes a difficulty from 0 to 1 that narrows bridges, widens gaps and speeds up sweepers, belts, crumbling tiles and wind. Its hardest setting (1) is the hardest a careful bot can reliably finish.
- **Every course must be finishable with no falls.** A careful bot must finish it with zero falls, and so must bots in the outer lanes and an 8-bot crowd. Medal times come from those runs:
  - **Bronze** is easy: 1.5× the careful bot's time.
  - **Silver** is 1.1×.
  - **Gold** asks for the risky lines: 0.85× the careful bot's time, or 0.95× the time of a bot taking the risky lines and every star, whichever is faster.
- **Never just wait.** Where you wait for a moving floor (a lift, the wheel, a sliding platform), springs in a row beside it are a faster, riskier way past: land every hop or fall.
- **Safety walls on edges you could roll off by accident,** and none where the course means you to leave the floor: jumps, drops and risky lines. A missing wall should always mean something.
- **Forks offer a real choice:** a railed detour, or a straight line about half as long across a narrow beam or crumbling tiles with no walls.
- **Everything that moves runs on the clock.** A moving piece's position is a pure function of time, so every player sees it in the same place, the server's replays agree, and bots can look ahead to time it.
- **Telegraph change.** Anything about to change shows it first (a key turns orange before it sinks, crumbling tiles shake), in game colours.
- **Try new mechanics alone first.** The sandbox (`/?sandbox=<segment>`) plays one mechanic at a chosen difficulty, before it goes into any course.

### Worlds

Each world's feeling (see "The story") chooses its one physics rule and which mechanics lead its courses. A rule is set on the theme (`src/levels/themes.ts`), so every course in the world shares it, and the world's first course teaches it gently.

| World | Feeling | Physics rule | Course character |
|---|---|---|---|
| Meadow | Freedom | **Gusts:** wind swells and eases on the clock, like a fan turning | Wide floors and long sightlines; wind on most courses; forks and splits, because freedom means choosing |
| Candy | Joy | **Bounce:** floors are springy, so landings hop | Springs, pinball bumpers and boost-springs; short, lively and playful |
| Ice | Endurance | **Grip:** floors are slippery | Longer courses with more hard sections between breathers; crumbling floors, thin ice and crosswinds (the blizzard) |
| Night | Peace | **Lighter gravity:** everything floats a little | Flowing curves and air time. Few hazards that hit you (sweepers, gauntlets, pendulums); the challenge is precision in the air |

- **One rule per world, and only one.** A world's rule changes how everything in it behaves, so it has to be easy to feel on the first course and never surprise you later. Everything else (springs, boosts, checkpoints) behaves the same everywhere.
- **The feeling leads the mix.** When choosing a course's signature or mix, prefer what fits its world's feeling. A peaceful world isn't an easy one, though: Night is still the last world, and its difficulty comes from the air rather than from being hit.

## Stars

Stars are the reason to replay a course you've already finished.

- **Three per course**, one per third of the course before the finale.
- **Each star uses the mechanic it sits on, harder or differently than the safe line does.** Examples:
  - a stronger spring beside the normal one;
  - the edge line of a jump;
  - a swerve in low gravity;
  - a crumbling side tile you get on and off before it drops;
  - a ledge the wind blows you toward.
- **Some stars move or are timed.** Riding stars move with a mechanism, so you time the catch. Switch stars appear for a few seconds after you roll over a button, so you race the clock.
- **No repeats, and the course's own mechanics come first.** A course never uses the same kind of star twice. A plain dead-end spur is the last resort.
- **Two checks on every star:** the careful bot on the safe line never collects a star, and a bot on the risky lines collects all three without falling. So stars are always optional and always possible.
- **Stars are counted, not required.** They add up across runs and show on the level select, but they never lock progress.

## Art direction: the hamster's world

Courses are built from things a hamster finds around a house. Each world is a place the hamster believes is the outside, built from real household things seen from very close up.

| World | Place | Built from |
|---|---|---|
| Meadow | The living room, seen as a meadow | A green shag rug and moss for lawn, floorboards, painted toy boards, popsicle sticks, potted box hedges, toadstools, pencils, crackers; a sofa, floor lamp, TV, bookshelf and an oscillating desk fan towering behind; grass and motes rippling in the fan's gusts |
| Candy | A kitchen counter | Worktop, shortbread, wafers, iced cake tops and chocolate; candy-cane rails, cupcake bumpers, liquorice belts; a sweet jar, kettle, cereal box, mixer and cake towering behind; flour puffs, sugar in the air, sprinkles off a bump |
| Ice | The refrigerator's freezer | A frosted shelf, clear and grape ice cubes, bags of peas, fish-finger beams, thin ice that cracks; ice-tray rails, ice-cream-scoop bumpers, ice-lolly sweepers; tubs, boxes and lollies towering behind under an icicled ceiling, the fridge light glowing through; a blizzard of frost flakes, shavings when you skid, your breath in the cold |
| Night | Above the city on a heavenly night | Roof slates, terracotta ridge tiles, a painted sill and roofing felt, strung with glowing fairy lights; glowing mushrooms in soft colours, as bumpers and along the edges; glow-in-the-dark star stickers that peel away; a city skyline of lit windows far below; stars all round, the Milky Way, the moon and a live green aurora; stardust behind you and soft chimes |

**Rules for the look:**
- **Identity comes from materials and scale, not effects.** A plank that reads as a deck board does more than a fancy shader.
- **Giants in soft focus.** The world beyond the course is huge and blurred, which says "you are small" without costing anything to draw.
- **Gameplay pieces keep game colours.** Springs, boost pads, checkpoints, stars and the goal stay bright and consistent across themes, so players never have to relearn them. Stars glow so they stand out against anything.
- **Looks never change the rules.** A world's materials change what things look like. Only its one physics rule (see Worlds) changes how they behave.
- **Avoid the generic.** No pastel checkerboards, no default puffy clouds, no "AI-generated" sheen. If a choice would fit any marble game, find the hamster-world version of it.

**Performance budget for the look:**
- No post-processing passes.
- Static geometry is merged; at most 260 draw calls.
- Textures are painted once in code and shared.
- Distant scenery is painted into the sky.
- Anything optional steps down on the low setting.
- A new look must not make frame times noticeably worse, and a theme's first course must not stall: textures and shaders are prepared while the menu is idle.

## Multiplayer and modes

- **Rooms with friends by code**, and Quick Play matchmaking whose bots fill the grid, so there's never an empty lobby.
- **Modes:**
  - **Race:** first to the goal.
  - **Elimination:** the slowest quarter is out each round.
  - **King of the Hill:** you score only while alone in the zone.
  - **Bumper Arena:** the last ball standing wins.
- **Bumping is a feature,** but the server is in charge. It checks every move and decides placings, so a modified client can't cheat.
- **Bots play by the same rules** as people, through the same checks.
- **Stars are solo-only for now,** so races stay about racing.

## Progression and money

- **Progress is cosmetic.** XP, levels and coins unlock ball skins, hats, fur colours and trails. Nothing you earn or buy changes how you roll.
- **Rewards:**
  - finishing a course, with extra for your first finish and each new medal;
  - placing well in multiplayer;
  - three daily challenges.

  Every reward is paid once and checked by the server.
- **Fair money:** a small paid cosmetic pack. Coins are never sold. The only ad is optional: "double your coins", a few times a day.
- **No personal data.** Accounts are anonymous, with a recovery code. Stats are only collected with consent, and "Delete my data" removes everything.

## Tuning by evidence

- **Bots prove that a course works; people decide whether it's fun.** Every number set from bot runs (difficulty ranges, medal times, switch-star timers) is a starting point for playtests.
- **Playtest mode:** `?playtest` asks players what they thought after each course (fun, difficulty, length, stars, variety, the most frustrating spot) and why they quit. Every run also records where people fell. Look at the feedback viewer and `npm run analytics` before changing a course by feel.
- **Change one thing at a time,** and regenerate courses only knowing that layouts and medal times will change (ratings are kept per layout).

## Constraints we design within

- **Boxes and cylinders** for solid pieces, and a sphere only where nothing else will do (the iron ball). This keeps physics simple and maps one-to-one onto Roblox Parts (Block, Cylinder, Ball) for the planned port.
- **Real physics only where it's the point.** Everything else moves on the clock. The iron ball is the one exception, because balancing on it is the mechanic; each player has their own.
- **One simulation everywhere.** The browser, bots, tests and server run the same code at a fixed 120 Hz. Visual polish lives in the rendering layer and never changes the simulation.
- **Generated, then hand-polished.** The generator gives every course a sound structure; the editor is where courses get the moments people remember.
