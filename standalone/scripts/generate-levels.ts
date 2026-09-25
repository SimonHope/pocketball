import { readFileSync, writeFileSync } from 'node:fs';
import { formatLevel } from '../src/levels/format';
import { extendLevel, generateLevel, type GenOptions } from '../src/levels/generator';
import { addSafetyWalls } from '../src/levels/guard';
import { generateMaze, type MazeOptions } from '../src/levels/maze';
import { parseLevel, type LevelData, type Piece } from '../src/levels/schema';
import { Autopilot, type PilotStyle } from '../src/sim/autopilot';
import { resolveLevel } from '../src/sim/geometry';
import { initPhysics, Simulation } from '../src/sim/simulation';

// Generates race courses and keeps only ones the bots can actually finish (same checks as
// tests/course.test.ts), then sets medal times from the bot's run and saves them as JSON.
// Usage: npm run gen-levels   (edit TARGETS below; output goes to src/levels/)

type Target = {
  file: string;
  firstSeed: number;
  /** Downhill: the goal must be at least this far below the start. */
  minDrop?: number;
  /** The course's signature mechanic: keep only layouts containing these pieces. */
  needs?: Piece['type'][];
  /** How many of each needed piece (default 1). */
  needCount?: number;
} & (
  | ({ maze?: false; /** Continue this hand-made course (src/levels/bases/<file>.json) past its finish. */ extend?: boolean } & Omit<GenOptions, 'seed'>)
  | ({ maze: true } & Omit<MazeOptions, 'seed'>)
);

const TARGETS: Target[] = [
  // Each course has a signature mechanic (`needs`: the layout must contain those pieces).
  // Meadow
  { extend: true, file: 'warm-up', name: 'Warm-Up', theme: 'meadow', length: 6, firstSeed: 4000, needs: ['boost', 'spring'], weights: { springUp: 2, curve: 2, boostRamp: 1, slalom: 2, straight: 1, turn: 1 } },
  { extend: true, file: 'zig-zag', name: 'Zig-Zag', theme: 'meadow', length: 7, firstSeed: 4100, needs: ['wind'], weights: { zigzag: 3, windBridge: 2, curve: 2, bridge: 1, rampDown: 1, turn: 1 } },
  { extend: true, file: 'sweeper-alley', name: 'Sweeper Alley', theme: 'meadow', length: 7, firstSeed: 4200, needs: ['conveyor', 'crumble'], weights: { sweeper: 3, gauntlet: 2, conveyor: 2, crumbleBridge: 1, straight: 1, turn: 1 } },
  { file: 'rolling-hills', name: 'Rolling Hills', theme: 'meadow', length: 15, firstSeed: 1000, needs: ['spring'], weights: { springUp: 3, curve: 3, stairs: 2, boostRamp: 1, split: 1 } },
  { file: 'switchback-ridge', name: 'Switchback Ridge', theme: 'meadow', length: 15, firstSeed: 1100, needs: ['mover'], weights: { lift: 3, hairpin: 3, curve: 2, split: 1, slalom: 1 } },
  { file: 'summit-run', name: 'Summit Run', theme: 'meadow', length: 19, firstSeed: 3000, downhill: true, minDrop: 80, needs: ['boost'], weights: { boostJump: 3, steep: 2, spiral: 1, drop: 2, cascade: 2, hairpin: 2, curve: 1 } },
  { maze: true, file: 'hedge-maze', name: 'Hedge Maze', theme: 'meadow', firstSeed: 2000, needs: ['spring'], needCount: 3, cols: 8, rows: 9, loops: 4, bumpers: 3, bridges: 2, holes: 3, springs: 6, palette: 'green', wallColor: '#2e5e27' },

  // Candy
  { file: 'candy-hop', name: 'Candy Hop', theme: 'candy', length: 12, firstSeed: 100, needs: ['spring'], weights: { springUp: 3, slalom: 2, turn: 2, zigzag: 1, straight: 1 } },
  { file: 'gumdrop-gauntlet', name: 'Gumdrop Gauntlet', theme: 'candy', length: 14, firstSeed: 200, needs: ['crumble'], weights: { crumbleBridge: 3, slalom: 2, sweeper: 2, turn: 2, sideMover: 1 } },
  { file: 'sugar-rush', name: 'Sugar Rush', theme: 'candy', length: 14, firstSeed: 300, needs: ['boost', 'conveyor'], weights: { boostRamp: 2, boostJump: 2, conveyor: 2, turn: 2, sweeper: 1, zigzag: 1 } },
  { file: 'taffy-twist', name: 'Taffy Twist', theme: 'candy', length: 17, firstSeed: 1200, needs: ['conveyor'], weights: { conveyor: 2, treadmill: 3, curve: 3, gauntlet: 1, split: 1 } },
  { file: 'lollipop-leap', name: 'Lollipop Leap', theme: 'candy', length: 17, firstSeed: 1300, needs: ['spring', 'mover'], weights: { springUp: 3, lift: 2, jump: 2, curve: 2, stairs: 1 } },
  { maze: true, file: 'candy-labyrinth', name: 'Candy Labyrinth', theme: 'candy', firstSeed: 2100, needs: ['conveyor'], needCount: 3, cols: 8, rows: 10, loops: 5, rooms: 2, bumpers: 3, bridges: 2, holes: 4, conveyors: 6, palette: 'blue', wallColor: '#ff6fb5' },
  { file: 'sugar-mountain', name: 'Sugar Mountain', theme: 'candy', length: 20, firstSeed: 3100, downhill: true, minDrop: 70, needs: ['spring', 'boost'], weights: { spiral: 2, steep: 2, cascade: 2, drop: 2, curve: 2, boostJump: 2, springUp: 2 } },

  // Ice
  { file: 'frosty-slide', name: 'Frosty Slide', theme: 'ice', length: 10, firstSeed: 400, maxSpeed: 12, needs: ['boost'], weights: { boostRamp: 3, rampDown: 3, turn: 2, straight: 1 } },
  { file: 'glacier-run', name: 'Glacier Run', theme: 'ice', length: 12, firstSeed: 500, maxSpeed: 11, needs: ['mover', 'crumble'], weights: { lift: 3, crumbleBridge: 2, rampDown: 2, turn: 2, straight: 1 } },
  { file: 'polar-plunge', name: 'Polar Plunge', theme: 'ice', length: 14, firstSeed: 600, maxSpeed: 11, needs: ['crumble'], weights: { crumbleBridge: 3, drop: 2, rampDown: 2, turn: 2, slalom: 1 } },
  { file: 'avalanche', name: 'Avalanche', theme: 'ice', length: 15, firstSeed: 1400, maxSpeed: 11, needs: ['wind'], weights: { windBridge: 3, hairpin: 3, stairs: 2, curve: 2, rampDown: 1 } },
  { file: 'crystal-caverns', name: 'Crystal Caverns', theme: 'ice', length: 17, firstSeed: 1500, maxSpeed: 11, needs: ['mover', 'wind'], weights: { lift: 2, updraft: 3, curve: 2, split: 1, stairs: 1 } },
  { maze: true, file: 'ice-catacombs', name: 'Ice Catacombs', theme: 'ice', firstSeed: 2200, needs: ['crumble'], cols: 8, rows: 10, loops: 5, rooms: 2, bumpers: 3, bridges: 2, holes: 4, crumbles: 5, maxSpeed: 10, bridgeWidth: 5, palette: 'blue', wallColor: '#f4fbff' },
  { file: 'frozen-falls', name: 'Frozen Falls', theme: 'ice', length: 19, firstSeed: 3200, downhill: true, minDrop: 80, maxSpeed: 11, needs: ['wind'], weights: { cascade: 3, drop: 2, windBridge: 2, steep: 2, hairpin: 2, curve: 1 } },

  // Night
  { file: 'moonlit-path', name: 'Moonlit Path', theme: 'night', length: 12, firstSeed: 700, bridgeWidth: 4.5, needs: ['lowgrav'], weights: { moonJump: 3, bridge: 2, turn: 2, straight: 1 } },
  { file: 'starlight-circuit', name: 'Starlight Circuit', theme: 'night', length: 14, firstSeed: 800, bridgeWidth: 4, needs: ['mover', 'boost'], weights: { lift: 2, boostRamp: 2, bridge: 2, turn: 2, mover: 1 } },
  { file: 'midnight-maze', name: 'Midnight Maze', theme: 'night', length: 15, firstSeed: 900, bridgeWidth: 4, needs: ['wind', 'crumble'], weights: { windBridge: 3, crumbleBridge: 2, bridge: 2, zigzag: 1, turn: 2 } },
  { file: 'comet-jump', name: 'Comet Jump', theme: 'night', length: 17, firstSeed: 1600, bridgeWidth: 4, needs: ['lowgrav', 'boost'], weights: { moonJump: 2, boostJump: 2, curve: 2, bridge: 1, gauntlet: 1 } },
  { file: 'nebula-spiral', name: 'Nebula Spiral', theme: 'night', length: 19, firstSeed: 1700, bridgeWidth: 4, needs: ['wind'], weights: { updraft: 3, spiral: 2, hairpin: 2, curve: 2, bridge: 1 } },
  { maze: true, file: 'night-vault', name: 'Night Vault', theme: 'night', firstSeed: 2300, needs: ['spring'], needCount: 2, cols: 9, rows: 11, loops: 4, rooms: 2, bumpers: 4, bridges: 3, holes: 5, springs: 5, springPower: 11, springPush: 5, lowGravity: 0.5, palette: 'purple', wallColor: '#ffd166' },
  { file: 'starfall-peak', name: 'Starfall Peak', theme: 'night', length: 20, firstSeed: 3300, downhill: true, minDrop: 90, bridgeWidth: 4.5, needs: ['lowgrav'], weights: { moonJump: 2, spiral: 2, drop: 2, steep: 2, cascade: 2, hairpin: 1 } },
];

function race(level: LevelData, style: PilotStyle): { time: number; falls: number } | null {
  const sim = new Simulation(resolveLevel(level));
  try {
    while (sim.phase === 'countdown') sim.step({ x: 0, z: 0 });
    sim.drainEvents();
    const pilot = new Autopilot(sim, 16, style);
    let falls = 0;
    for (let t = 0; t < 300 && sim.phase !== 'finished'; t += 1 / 120) {
      sim.step(pilot.input());
      falls += sim.drainEvents().filter((e) => e.type === 'fall').length;
      if (falls > 0 && !style.lane) return null; // the careful bot must never fall
    }
    return sim.phase === 'finished' ? { time: sim.elapsed, falls } : null;
  } finally {
    sim.dispose();
  }
}

await initPhysics();
const only = process.argv[2];
for (const target of TARGETS.filter((t) => !only || t.file === only)) {
  let saved = false;
  for (let seed = target.firstSeed; seed < target.firstSeed + 400 && !saved; seed++) {
    const raw = target.maze ? generateMaze({ ...target, seed })
      : target.extend ? extendLevel(parseLevel(JSON.parse(readFileSync(`src/levels/bases/${target.file}.json`, 'utf8'))), { ...target, seed })
      : generateLevel({ ...target, seed });
    if (!raw) continue;
    const level = addSafetyWalls(raw); // low walls on every edge you could roll off by accident
    if (target.needs?.some((type) => level.pieces.filter((p) => p.type === type).length < (target.needCount ?? 1))) continue;
    const goal = level.pieces.find((p) => p.type === 'goal');
    if (target.minDrop && goal && level.start.position[1] - 1 - goal.position[1] < target.minDrop) continue;
    try { parseLevel(JSON.parse(JSON.stringify(level))); } catch { continue; }
    const careful = race(level, {});
    if (!careful) continue;
    const outer = [race(level, { lane: -2.5, pace: 0.9 }), race(level, { lane: 2.5, pace: 0.9 })];
    if (outer.some((r) => !r)) continue;
    const t = careful.time;
    level.medals = { gold: Math.round(t * 0.85), silver: Math.round(t * 1.1), bronze: Math.round(t * 1.5) };
    writeFileSync(`src/levels/${target.file}.json`, formatLevel(level));
    console.log(`${target.name.padEnd(18)} seed ${seed}: ${level.pieces.length} pieces, bot ${t.toFixed(1)}s → gold ${level.medals.gold}s`);
    saved = true;
  }
  if (!saved) console.log(`${target.name}: no playable course found in 400 seeds — adjust weights`);
}
