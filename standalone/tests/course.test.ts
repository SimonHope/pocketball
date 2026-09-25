import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { Autopilot } from '../src/sim/autopilot';
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
      for (let t = 0; t < 70; t += 1 / 120) {
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
