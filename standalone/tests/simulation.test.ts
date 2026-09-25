import { SPRINT } from './fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { SIM } from '../src/config';
import type { Simulation } from '../src/sim/simulation';
import { horizSpeed, makeSim, NO_INPUT, run, skipCountdown, teleport, toward } from './helpers';

let sim: Simulation;
afterEach(() => sim?.dispose());

describe('ball physics', () => {
  it('rests on the start pad without drifting', async () => {
    sim = await makeSim();
    run(sim, 2);
    const [x, y, z] = sim.position();
    expect(x).toBeCloseTo(0, 2);
    expect(y).toBeCloseTo(1, 1);
    expect(z).toBeCloseTo(3, 2);
    expect(sim.grounded).toBe(true);
  });

  it('reaches top speed on the flat within 1.3s, and no faster', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    teleport(sim, [0, 1, -8]);
    run(sim, 1.3, { x: 0, z: -1 }); // stops short of the bumper at z = -29
    const speed = horizSpeed(sim.velocity());
    expect(speed).toBeGreaterThan(SIM.move.maxSpeed - 1.5);
    expect(speed).toBeLessThan(SIM.move.maxSpeed + 1);
  });

  it('can climb the final ramp', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    teleport(sim, [32, -5, -100]);
    const steer = toward(sim, 32, -135);
    for (let i = 0; i < 4 * 120 && sim.position()[2] > -127; i++) sim.step(steer());
    expect(sim.position()[2]).toBeLessThan(-127); // made it past the top of the ramp (z = -125)
    expect(sim.position()[1]).toBeGreaterThan(-0.5); // top pad is at y = -1, ball center at 0
  });

  it('bumpers kick the ball away', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    teleport(sim, [-2.5, 1, -10]); // straight at the bumper at z = -15
    const events = run(sim, 1.2, { x: 0, z: -1 });
    expect(events.some((e) => e.type === 'bump')).toBe(true);
  });

  it('moving platform carries the ball for a full cycle', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    // wait until the platform is back at its start, then place the ball on it
    run(sim, 7 - (sim.time % 7));
    teleport(sim, [32, -5, -74]);
    for (let i = 0; i < 8; i++) {
      run(sim, 7 / 8);
      expect(sim.position()[1]).toBeGreaterThan(-5.5);
    }
  });
});

describe('race rules', () => {
  it('ignores input during the countdown, then starts', async () => {
    sim = await makeSim();
    const events = run(sim, SIM.countdown - 0.1, { x: 0, z: -1 });
    expect(sim.phase).toBe('countdown');
    expect(horizSpeed(sim.velocity())).toBeLessThan(0.01);
    expect(events.filter((e) => e.type === 'countdown').map((e) => e.type === 'countdown' && e.n)).toEqual([3, 2, 1]); // 3 comes from restart()
    const more = run(sim, 0.2);
    expect(more.some((e) => e.type === 'go')).toBe(true);
    expect(sim.phase).toBe('playing');
  });

  it('falling respawns at the last checkpoint with a time penalty', async () => {
    sim = await makeSim(SPRINT); // a start pad with no safety walls
    skipCountdown(sim);
    let fell = false;
    for (let i = 0; i < 4 * 120 && !fell; i++) { // roll off the side of the start pad
      sim.step({ x: 1, z: 0 });
      fell = sim.drainEvents().some((e) => e.type === 'fall');
    }
    expect(fell).toBe(true);
    expect(sim.elapsed).toBeGreaterThan(SIM.fallPenalty);
    const [x, , z] = sim.position();
    expect(Math.hypot(x, z - 3)).toBeLessThan(6);
  });

  it('checkpoints move the respawn point', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    teleport(sim, [0, 1, -32]);
    const events = run(sim, 1, toward(sim, 0, -34));
    expect(events).toContainEqual({ type: 'checkpoint', index: 0 });
    expect(sim.spawn.position[2]).toBe(-34);
  });

  it('keeps race time on the fixed step', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    run(sim, 2, NO_INPUT);
    expect(sim.elapsed).toBeCloseTo(2, 5);
  });
});

describe('ball-to-ball bumps', () => {
  it('bounces off another ball and reports it once per contact', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    teleport(sim, [0, 1, -8]);
    run(sim, 0.6, { x: 0, z: -1 }); // build up speed toward -z
    const [x, y, z] = sim.position();
    sim.setOthers([{ id: 'rival', position: [x, y, z - 2.5], velocity: [0, 0, 0] }]);
    const before = sim.velocity()[2];
    const events = run(sim, 0.3);
    expect(before).toBeLessThan(-8);
    expect(sim.velocity()[2]).toBeGreaterThan(0); // bounced back
    expect(events.filter((e) => e.type === 'ballBump')).toHaveLength(1);
  });

  it('ignores balls that are not touching', async () => {
    sim = await makeSim();
    skipCountdown(sim);
    sim.setOthers([{ id: 'far', position: [10, 1, 3], velocity: [0, 0, 0] }]);
    const events = run(sim, 0.5);
    expect(events.some((e) => e.type === 'ballBump')).toBe(false);
  });

  it('restart() can start from a server-given countdown', async () => {
    sim = await makeSim();
    sim.restart(1.25);
    sim.drainEvents();
    const events = run(sim, 1.3);
    expect(events.map((e) => e.type)).toEqual(['countdown', 'go']);
  });
});
