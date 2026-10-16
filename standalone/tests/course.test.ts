import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { generateLevel, type Segment, type StarKind } from '../src/levels/generator';
import { addSafetyWalls } from '../src/levels/guard';
import type { LevelData } from '../src/levels/schema';
import { SIM } from '../src/config';
import { MoveChecker } from '../src/net/rules';
import { Autopilot, type PilotStyle } from '../src/sim/autopilot';
import { resolveLevel } from '../src/sim/geometry';
import { initPhysics } from '../src/sim/simulation';
import { makeSim, skipCountdown } from './helpers';

// Proves every level can actually be finished by following its route.
describe('course completion', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s can be finished by the autopilot', async (_name, level) => {
    const sim = await makeSim(level);
    try {
      skipCountdown(sim);
      const pilot = new Autopilot(sim);
      let falls = 0;
      const log: string[] = [];
      for (let t = 0; t < 300 && sim.phase !== 'finished'; t += 1 / 120) {
        sim.step(pilot.input());
        for (const e of sim.drainEvents()) {
          if (e.type === 'fall') {
            falls++;
            log.push(`fell near waypoint ${pilot.index} at ${sim.elapsed.toFixed(1)}s`);
          }
        }
      }
      const summary = `phase=${sim.phase} time=${sim.elapsed.toFixed(2)}s waypoint=${pilot.index} falls=${falls} ${log.join('; ')}`;
      console.log(`${level.name}: ${summary}`);
      expect(sim.phase, summary).toBe('finished');
      expect(falls, summary).toBe(0);
      // The (cautious) autopilot should always earn at least bronze; gold is for skilled players.
      if (level.medals) expect(sim.elapsed, summary).toBeLessThan(level.medals.bronze);
    } finally {
      sim.dispose();
    }
  });
});

describe('autopilot recovery', () => {
  it('carries on after being knocked off (as Quick Play bots will need to)', async () => {
    const sim = await makeSim(LEVELS[0]);
    try {
      skipCountdown(sim);
      const pilot = new Autopilot(sim);
      for (let i = 0; i < 6 * 120; i++) sim.step(pilot.input()); // well past checkpoint 0
      sim.respawn(); // as if it fell
      sim.drainEvents();
      for (let t = 0; t < 240 && sim.phase !== 'finished'; t += 1 / 120) sim.step(pilot.input());
      expect(sim.phase).toBe('finished');
    } finally {
      sim.dispose();
    }
  });
});

describe('bots with styles', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s: bots in the outer lanes still finish', async (_name, level) => {
    for (const lane of [-2.5, 2.5]) {
      const sim = await makeSim(level);
      try {
        skipCountdown(sim);
        const pilot = new Autopilot(sim, 16, { lane, pace: 0.9 });
        for (let t = 0; t < 300 && sim.phase !== 'finished'; t += 1 / 120) sim.step(pilot.input());
        expect(sim.phase, `lane ${lane}`).toBe('finished');
      } finally {
        sim.dispose();
      }
    }
  });

  it('8 bots racing together mostly avoid knocking each other off', async () => {
    const { gridSpot } = await import('../src/sim/geometry');
    const sims = await Promise.all(Array.from({ length: 8 }, () => makeSim(LEVELS[0])));
    try {
      const pilots = sims.map((sim, i) => {
        sim.restart(0.01, gridSpot(sim.level, i));
        sim.step({ x: 0, z: 0 });
        sim.drainEvents();
        return new Autopilot(sim, 16, { lane: ((i % 5) - 2) * 1.2, pace: 0.85 + (i % 4) * 0.05, avoid: true });
      });
      // Bronze is 1.5× the careful bot's time; a bit more leaves room for slow paces and a crowded start.
      for (let t = 0; t < LEVELS[0].medals!.bronze * 1.2; t += 1 / 120) {
        sims.forEach((sim, i) => {
          sim.setOthers(sims.filter((_, j) => j !== i).map((o, j) => ({ id: String(j), position: o.position(), velocity: o.velocity() })));
          sim.step(pilots[i].input());
          sim.drainEvents();
        });
        if (sims.every((s) => s.phase === 'finished')) break;
      }
      const finished = sims.filter((s) => s.phase === 'finished').length;
      console.log(`crowd: ${finished}/8 finished; times ${sims.map((s) => s.phase === 'finished' ? s.elapsed.toFixed(1) : '—').join(' ')}`);
      expect(finished).toBeGreaterThanOrEqual(7);
    } finally {
      sims.forEach((s) => s.dispose());
    }
  });
});

/** Races the careful autopilot (or `style`) over `level`: finished, time, falls and stars. */
async function race(level: LevelData, style: PilotStyle = {}, { wait = 0 } = {}) {
  const sim = await makeSim(level);
  try {
    skipCountdown(sim);
    for (let t = 0; t < wait; t += 1 / 120) sim.step({ x: 0, z: 0 }); // set off later (moving pieces elsewhere in their cycle)
    sim.drainEvents();
    const pilot = new Autopilot(sim, 16, style);
    let falls = 0, springs = 0;
    // The run as the server sees it: 20 updates a second, from GO.
    const updates: { t: number; p: [number, number, number]; v: [number, number, number] }[] = [{ t: -20, p: sim.position(), v: sim.velocity() }];
    for (let step = 1; step <= 300 * 120 && sim.phase !== 'finished'; step++) {
      sim.step(pilot.input());
      const events = sim.drainEvents();
      falls += events.filter((e) => e.type === 'fall').length;
      springs += events.filter((e) => e.type === 'spring').length;
      if (step % 6 === 0) updates.push({ t: (wait + step * SIM.dt) * 1000, p: sim.position(), v: sim.velocity() });
    }
    return { finished: sim.phase === 'finished', time: sim.elapsed, falls, stars: sim.stars.filter(Boolean).length, waypoint: pilot.index, springs, updates };
  } finally {
    sim.dispose();
  }
}

describe('stars', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s: the star route collects every star without a fall', async (_name, level) => {
    const r = await race(level, { route: 'stars' });
    const summary = `finished=${r.finished} time=${r.time.toFixed(1)}s stars=${r.stars} falls=${r.falls} waypoint=${r.waypoint}`;
    expect(r.finished, summary).toBe(true);
    expect(r.stars, summary).toBe(3);
    expect(r.falls, summary).toBe(0);
  });
});

describe('star challenges', () => {
  // Each segment that can hide a star does it its own way; the star route must collect it, and
  // (except switch stars, whose timers generate-levels tunes) the safe line must not.
  const segments: Segment[] = [
    'springUp', 'jump', 'crumbleJump', 'boostJump', 'moonJump', 'updraft', 'drop', 'crumbleBridge', 'windCrumble', 'windBridge',
    'bridge', 'split', 'zigzag', 'gauntlet', 'sweeper', 'lift', 'mover', 'fork', 'hairpin', 'spiral', 'steep', 'cascade',
    'boostRamp', 'conveyor',
    'brakePad', 'pinball', 'keys', 'turntable', 'pendulum', 'rocker', 'rollers', 'paperWall',
    'ironBall', 'wheel', 'trickGates', 'logSlope',
  ];
  const timed = new Set<StarKind>(['firstRide', 'race', 'noBrake', 'smash', 'climb']);
  it.each(segments)('%s hides its own star and the star route gets it', async (seg) => {
    await initPhysics(); // addSafetyWalls asks the physics world about edges
    let result = '';
    for (let seed = 1; seed < 40 && result !== 'ok'; seed++) {
      let kind: StarKind | undefined;
      const raw = generateLevel({
        seed, name: seg, theme: 'meadow', length: 3, stars: 1, weights: { [seg]: 3, straight: 1 },
        onSegment: (s, _act, _d, star) => { if (s === seg && star) kind = star; },
      });
      if (!raw || !kind) continue;
      const level = addSafetyWalls(raw);
      for (const p of level.pieces) if (p.type === 'star' && p.button) p.time = 60; // reachable at all (gen-levels sets the real timer)
      const risky = await race(level, { route: 'stars' });
      const safe = timed.has(kind) ? null : await race(level);
      result = risky.finished && risky.falls === 0 && risky.stars === 1 && (!safe || safe.stars === 0) ? 'ok'
        : `seed ${seed} (${kind}): stars=${risky.stars} falls=${risky.falls} safe line stars=${safe?.stars}`;
    }
    expect(result).toBe('ok');
  });
});

describe('moving-floor segments', () => {
  // Turntables, piano keys, pendulums, rockers, rollers, sliding bumpers, paper walls, the brake
  // pad, the iron ball, the spin wheel, trick gates and the log slope: at their easiest and hardest, the careful bot (and bots out in the side lanes,
  // setting off at different moments) gets through with no falls, and the server accepts the run.
  const segments: Segment[] = [
    'brakePad', 'pinball', 'keys', 'turntable', 'pendulum', 'rocker', 'rollers', 'paperWall', 'ironBall', 'wheel', 'trickGates', 'logSlope',
  ];
  const cases = segments.flatMap((seg) => [0, 1].map((d) => [seg, d] as const));
  it.each(cases)('%s at difficulty %d', async (seg, d) => {
    await initPhysics(); // addSafetyWalls asks the physics world about edges
    const problems: string[] = [];
    let built = 0;
    for (let seed = 1; seed < 30 && built < 3; seed++) {
      const used: Segment[] = [];
      const raw = generateLevel({ seed, name: seg, theme: 'meadow', length: 3, stars: 1, difficulty: d, weights: { [seg]: 3, straight: 1 }, onSegment: (s) => used.push(s) });
      if (!raw || !used.includes(seg)) continue;
      built++;
      const level = addSafetyWalls(raw), resolved = resolveLevel(level);
      for (const [style, wait] of [[{}, 0], [{ lane: 2.5 }, 0.7], [{ lane: -2.5, pace: 0.85 }, 1.9]] as const) {
        const r = await race(level, style, { wait });
        if (!r.finished || r.falls) problems.push(`seed ${seed} ${JSON.stringify(style)}: finished=${r.finished} falls=${r.falls} waypoint=${r.waypoint}`);
        const checker = new MoveChecker(resolved, 0);
        const rejected = r.updates.map((u) => checker.check(u, u.t + 40)).filter((c) => !c.ok);
        if (rejected.length) problems.push(`seed ${seed}: server rejected ${JSON.stringify(rejected[0])}`);
      }
    }
    expect(built).toBe(3);
    expect(problems).toEqual([]);
  });
});

describe('fork and spur variants', () => {
  // Forks open the twist on some courses, and spurs are the stars' last resort; each comes in
  // several shapes so courses don't all share one. Every shape is finished cleanly by the careful
  // bot, and the star route collects its star.
  const forkLine = (l: LevelData) => l.pieces.some((p) => p.type === 'mover' && p.hold) ? 'keys'
    : l.pieces.some((p) => p.type === 'bumper' && p.to) ? 'toadstools'
    : l.pieces.some((p) => p.type === 'crumble' && p.open) ? 'tiles'
    : l.pieces.some((p) => p.type === 'pad' && p.open) ? 'stones' : 'beam';
  const spurKind = (l: LevelData) => l.pieces.some((p) => p.type === 'spring') ? 'perch'
    : l.pieces.some((p) => p.type === 'pad' && p.open) ? 'stones' : 'plank';
  const cases = [
    ...['beam', 'tiles', 'stones', 'keys', 'toadstools'].map((v) => ['fork', v] as const),
    ...['plank', 'perch', 'stones'].map((v) => ['starSpur', v] as const),
  ];
  it.each(cases)('%s: %s', async (seg, variant) => {
    await initPhysics(); // addSafetyWalls asks the physics world about edges
    const shape = seg === 'fork' ? forkLine : spurKind;
    let result = 'not built';
    for (let seed = 1; seed < 200 && result !== 'ok'; seed++) {
      const raw = generateLevel({ seed, name: seg, theme: 'meadow', length: 3, stars: 1, weights: { [seg]: 3, straight: 1 } });
      if (!raw || shape(raw) !== variant || !raw.pieces.some((p) => p.type === 'star')) continue;
      const level = addSafetyWalls(raw);
      for (const p of level.pieces) if (p.type === 'star' && p.button) p.time = 60;
      const risky = await race(level, { route: 'stars' }), safe = await race(level);
      result = risky.finished && !risky.falls && risky.stars === 1 && safe.finished && !safe.falls ? 'ok'
        : `seed ${seed}: risky finished=${risky.finished} falls=${risky.falls} stars=${risky.stars}; safe finished=${safe.finished} falls=${safe.falls}`;
    }
    expect(result).toBe('ok');
  });
});

describe('wait shortcuts', () => {
  // Where you wait for a moving floor (a lift, the wheel, a sliding platform), springs in a row
  // beside it are a risky way past. The careful bot waits; the star route takes the springs,
  // lands every hop and gets there sooner, and the server accepts the run.
  const hops = (seg: string) => ({ lift: 2, wheel: 3, mover: 2, sideMover: 1 })[seg] ?? 0;
  const cases = (['lift', 'wheel', 'mover', 'sideMover'] as const).flatMap((seg) => [0, 1].map((d) => [seg, d] as const));
  it.each(cases)('%s at d=%s', async (seg, d) => {
    await initPhysics(); // addSafetyWalls asks the physics world about edges
    let result = 'not built';
    for (let seed = 1; seed < 40 && result !== 'ok'; seed++) {
      const used: Segment[] = [];
      const raw = generateLevel({ seed, name: seg, theme: 'meadow', length: 3, stars: 1, difficulty: d, weights: { [seg]: 3, straight: 1 }, onSegment: (s) => used.push(s) });
      if (!raw || !used.includes(seg)) continue;
      const level = addSafetyWalls(raw);
      for (const p of level.pieces) if (p.type === 'star' && p.button) p.time = 60;
      const risky = await race(level, { route: 'stars' }), safe = await race(level);
      const checker = new MoveChecker(resolveLevel(level), 0);
      const cheats = risky.updates.map((u) => checker.check(u, u.t + 40)).filter((c) => !c.ok).length;
      result = risky.finished && !risky.falls && !cheats && risky.springs >= hops(seg) && risky.time < safe.time && safe.finished && !safe.falls ? 'ok'
        : `seed ${seed}: risky finished=${risky.finished} falls=${risky.falls} springs=${risky.springs} time=${risky.time.toFixed(1)} cheats=${cheats} waypoint=${risky.waypoint}; safe finished=${safe.finished} falls=${safe.falls} time=${safe.time.toFixed(1)}`;
      if (result !== 'ok') console.log(seg, d, result);
    }
    expect(result).toBe('ok');
  });
});

describe('combo segments', () => {
  const combos: Segment[] = ['sweeperBelt', 'windCrumble', 'boostSpring', 'liftWind', 'bumperTreadmill', 'crumbleJump', 'fork'];
  it.each(combos)('%s builds and the bot can finish it', async (combo) => {
    await initPhysics(); // addSafetyWalls asks the physics world about edges
    let ok = false;
    for (let seed = 1; seed < 30 && !ok; seed++) {
      const used: Segment[] = [];
      const raw = generateLevel({ seed, name: combo, theme: 'meadow', length: 3, weights: { [combo]: 1, straight: 1 }, onSegment: (s) => used.push(s) });
      if (!raw || !used.includes(combo)) continue;
      const level = addSafetyWalls(raw);
      const r = await race(level);
      ok = r.finished && r.falls === 0;
    }
    expect(ok).toBe(true);
  });
});
