import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { generateLevel, type Segment, type StarKind } from '../src/levels/generator';
import { addSafetyWalls } from '../src/levels/guard';
import type { LevelData } from '../src/levels/schema';
import { Autopilot, type PilotStyle } from '../src/sim/autopilot';
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
async function race(level: LevelData, style: PilotStyle = {}) {
  const sim = await makeSim(level);
  try {
    skipCountdown(sim);
    const pilot = new Autopilot(sim, 16, style);
    let falls = 0;
    for (let t = 0; t < 300 && sim.phase !== 'finished'; t += 1 / 120) {
      sim.step(pilot.input());
      falls += sim.drainEvents().filter((e) => e.type === 'fall').length;
    }
    return { finished: sim.phase === 'finished', time: sim.elapsed, falls, stars: sim.stars.filter(Boolean).length, waypoint: pilot.index };
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
  ];
  const timed = new Set<StarKind>(['firstRide', 'race', 'noBrake']);
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
