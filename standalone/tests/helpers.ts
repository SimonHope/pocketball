import { resolveLevel } from '../src/sim/geometry';
import { initPhysics, Simulation, type Input, type SimEvent } from '../src/sim/simulation';
import { SIM } from '../src/config';
import { LEVELS } from '../src/levels';
import type { LevelData } from '../src/levels/schema';
import type { Vec3 } from '../src/sim/math';

export const NO_INPUT: Input = { x: 0, z: 0 };

export async function makeSim(level: LevelData = LEVELS[0]) {
  await initPhysics();
  return new Simulation(resolveLevel(level));
}

/** Steps `seconds` of simulation, collecting events. `input` may be a function evaluated each step. */
export function run(sim: Simulation, seconds: number, input: Input | (() => Input) = NO_INPUT): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds / SIM.dt);
  for (let i = 0; i < steps; i++) {
    sim.step(typeof input === 'function' ? input() : input);
    events.push(...sim.drainEvents());
  }
  return events;
}

export function skipCountdown(sim: Simulation) {
  while (sim.phase === 'countdown') sim.step(NO_INPUT);
  sim.drainEvents();
}

/** Puts the ball at `p` (ball center) at rest, as if it had respawned there. */
export function teleport(sim: Simulation, p: Vec3) {
  sim.spawn = { position: p, yaw: 0 };
  const phase = sim.phase;
  sim.phase = 'countdown'; // no time penalty
  sim.respawn();
  sim.phase = phase;
  sim.drainEvents();
}

export const toward = (sim: Simulation, x: number, z: number) => (): Input => {
  const p = sim.position();
  const dx = x - p[0], dz = z - p[2];
  const m = Math.hypot(dx, dz);
  return m < 0.1 ? NO_INPUT : { x: dx / m, z: dz / m };
};

export const horizSpeed = (v: Vec3) => Math.hypot(v[0], v[2]);

/**
 * An honest run's ball updates at 20 Hz (like the real client), with `t` in ms since GO
 * (+ `startAt`). Uses the careful autopilot. Returns the updates and the sim's finish time.
 */
export async function autopilotTrace(level: LevelData, startAt = 0, opts: { fallAfter?: number } = {}) {
  const { Autopilot } = await import('../src/sim/autopilot');
  const sim = await makeSim(level);
  skipCountdown(sim);
  const pilot = new Autopilot(sim);
  const updates = [{ t: startAt - 20, p: sim.position(), v: sim.velocity() }];
  let steps = 0;
  const finished = () => sim.phase === 'finished';
  while (!finished() && steps < 150 * 120) {
    if (opts.fallAfter !== undefined && steps === Math.round(opts.fallAfter * 120)) sim.respawn(); // "falls" once
    sim.step(pilot.input());
    sim.drainEvents();
    steps++;
    if (steps % 6 === 0 || finished()) updates.push({ t: startAt + steps * SIM.dt * 1000, p: sim.position(), v: sim.velocity() });
  }
  const time = sim.elapsed;
  sim.dispose();
  return { updates, time };
}
