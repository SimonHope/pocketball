import { readFileSync, writeFileSync } from 'node:fs';
import { formatLevel } from '../src/levels/format';
import { extendLevel, generateLevel, type Segment, type StarKind } from '../src/levels/generator';
import { switchedOff } from '../src/levels/mechanics-doc';
import { addSafetyWalls } from '../src/levels/guard';
import { generateMaze } from '../src/levels/maze';
import { parseLevel, type LevelData } from '../src/levels/schema';
import { TARGETS } from './targets';
import { Autopilot, type PilotStyle } from '../src/sim/autopilot';
import { resolveLevel } from '../src/sim/geometry';
import { initPhysics, Simulation } from '../src/sim/simulation';

// Generates race courses and keeps only ones the bots can actually finish and whose 3 stars a
// bot on the star route can all collect (same checks as tests/course.test.ts), while the careful
// bot on the safe line gets none. Switch stars' timers are set from the star-route bot's run
// (it's cautious, so players have room to spare), then medal times from the bots' runs, and the
// course is saved as JSON.
// Usage: npm run gen-levels   (courses: scripts/targets.ts; switch mechanics on/off: MECHANICS.md; output: src/levels/)


const STARS = 3;

/** Time the switch star route bot gets for each switch star: its own button-to-star time, plus this much. */
const SWITCH_SLACK = 1.2;

function race(level: LevelData, style: PilotStyle): { time: number; falls: number; stars: number; switchTimes: Map<number, number> } | null {
  const sim = new Simulation(resolveLevel(level));
  try {
    while (sim.phase === 'countdown') sim.step({ x: 0, z: 0 });
    sim.drainEvents();
    const pilot = new Autopilot(sim, 16, style);
    let falls = 0;
    const pressed = new Map<number, number>(), switchTimes = new Map<number, number>(); // star index → seconds
    for (let t = 0; t < 300 && sim.phase !== 'finished'; t += 1 / 120) {
      sim.step(pilot.input());
      for (const e of sim.drainEvents()) {
        if (e.type === 'fall') falls++;
        if (e.type === 'switch') pressed.set(e.index, sim.elapsed);
        if (e.type === 'star' && pressed.has(e.index)) switchTimes.set(e.index, sim.elapsed - pressed.get(e.index)!);
      }
      if (falls > 0 && !style.lane) return null; // the careful bot must never fall
    }
    return sim.phase === 'finished' ? { time: sim.elapsed, falls, stars: sim.stars.filter(Boolean).length, switchTimes } : null;
  } finally {
    sim.dispose();
  }
}

await initPhysics();
const only = process.argv[2];
// MECHANICS.md (repo root) switches mechanics on and off: switched-off ones are never placed.
const catalog = switchedOff(readFileSync(new URL('../../MECHANICS.md', import.meta.url), 'utf8'));
const off = { segments: catalog.segments as Segment[], stars: catalog.stars as StarKind[] };
if (off.segments.length || off.stars.length) console.log(`Switched off in MECHANICS.md: ${[...off.segments, ...off.stars.map((k) => `★${k}`)].join(', ')}`);
for (const target of TARGETS.filter((t) => !only || t.file === only)) {
  let saved = false;
  for (let seed = target.firstSeed; seed < target.firstSeed + 400 && !saved; seed++) {
    const plan: string[] = []; // segments in order, e.g. "springUp(0)★super": printed for the saved course
    const onSegment = (seg: string, _act: string, d: number, star?: string) => plan.push(`${seg}(${d.toFixed(1).replace(/\.0$/, '')})${star ? `★${star}` : ''}`);
    const raw = target.maze ? generateMaze({ ...target, seed, stars: STARS })
      : target.extend ? extendLevel(parseLevel(JSON.parse(readFileSync(`src/levels/bases/${target.file}.json`, 'utf8'))), { ...target, seed, stars: STARS, onSegment, off })
      : generateLevel({ ...target, seed, stars: STARS, onSegment, off });
    if (!raw) continue;
    // A star spur is the last resort: for the first 350 seeds, look for a layout without one.
    if (seed < target.firstSeed + 350 && plan.some((p) => p.startsWith('starSpur'))) continue;
    const level = addSafetyWalls(raw); // low walls on every edge you could roll off by accident
    if (target.needs?.some((type) => level.pieces.filter((p) => p.type === type).length < (target.needCount ?? 1))) continue;
    const goal = level.pieces.find((p) => p.type === 'goal');
    if (target.minDrop && goal && level.start.position[1] - 1 - goal.position[1] < target.minDrop) continue;
    try { parseLevel(JSON.parse(JSON.stringify(level))); } catch { continue; }
    // Every star can be reached: the careful bot on the risky lines gets them all without a fall.
    const first = race(level, { route: 'stars' });
    if (!first || first.stars !== STARS) continue;
    // Switch stars: time for that bot to make it again, with some slack (half seconds).
    const stars = level.pieces.filter((p) => p.type === 'star');
    for (const [i, dt] of first.switchTimes) stars[i].time = Math.ceil((dt * SWITCH_SLACK + 0.5) * 2) / 2;
    const risky = race(level, { route: 'stars' });
    if (!risky || risky.stars !== STARS) continue;
    // The safe line gets no stars: each one asks for something more.
    const careful = race(level, {});
    if (!careful || careful.stars) continue;
    const outer = [race(level, { lane: -2.5, pace: 0.9 }), race(level, { lane: 2.5, pace: 0.9 })];
    if (outer.some((r) => !r)) continue;
    // Gold rewards taking the risky lines (if they're faster); bronze stays easy.
    const t = careful.time;
    level.medals = { gold: Math.round(Math.min(t * 0.85, risky.time * 0.95)), silver: Math.round(t * 1.1), bronze: Math.round(t * 1.5) };
    writeFileSync(`src/levels/${target.file}.json`, formatLevel(level));
    console.log(`${target.name.padEnd(18)} seed ${seed}: ${level.pieces.length} pieces, bot ${t.toFixed(1)}s, star route ${risky.time.toFixed(1)}s → gold ${level.medals.gold}s`);
    if (plan.length) console.log(`  ${plan.join(' → ')}`);
    saved = true;
  }
  if (!saved) console.log(`${target.name}: no playable course found in 400 seeds — adjust weights`);
}
