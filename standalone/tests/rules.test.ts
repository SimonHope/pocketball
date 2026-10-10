import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIM } from '../src/config';
import { LEVELS } from '../src/levels';
import { isValidName, randomName } from '../src/net/names';
import type { BallUpdate } from '../src/net/protocol';
import { LIMITS, MoveChecker, rankPlayers, routeProgress } from '../src/net/rules';
import { Autopilot } from '../src/sim/autopilot';
import { resolveLevel, type ResolvedLevel } from '../src/sim/geometry';
import type { Vec3 } from '../src/sim/math';
import { makeSim, skipCountdown } from './helpers';

const START_AT = 1_000_000; // server clock ms of GO
const LATENCY = 40;

interface Trace { updates: BallUpdate[]; finishTime: number }

/** An honest player's updates: the autopilot racing, sampled at 20 Hz like the real client. */
async function honestTrace(index: number, route: 'main' | 'stars' = 'main'): Promise<Trace> {
  const sim = await makeSim(LEVELS[index]);
  skipCountdown(sim);
  const pilot = new Autopilot(sim, 16, { route });
  const updates: BallUpdate[] = [{ t: START_AT - 20, p: sim.position(), v: sim.velocity() }];
  let steps = 0;
  const finished = () => sim.phase === 'finished'; // (a call, so TS doesn't narrow across steps)
  while (!finished() && steps < 150 * 120) {
    sim.step(pilot.input());
    sim.drainEvents();
    steps++;
    if (steps % 6 === 0 || finished()) {
      updates.push({ t: START_AT + steps * SIM.dt * 1000, p: sim.position(), v: sim.velocity() });
    }
  }
  const finishTime = sim.elapsed;
  sim.dispose();
  return { updates, finishTime };
}

const traces: Trace[] = [];
const levels: ResolvedLevel[] = LEVELS.map(resolveLevel);
beforeAll(async () => {
  for (let i = 0; i < LEVELS.length; i++) traces.push(await honestTrace(i));
});
afterAll(() => { traces.length = 0; });

function feed(checker: MoveChecker, updates: BallUpdate[]) {
  return updates.map((u) => checker.check(u, u.t + LATENCY));
}

describe('MoveChecker: honest players', () => {
  it.each(LEVELS.map((l, i) => [l.name, i]))('%s: every update accepted, finish time matches the sim', (_n, i) => {
    const checker = new MoveChecker(levels[i], START_AT);
    const results = feed(checker, traces[i].updates);
    const rejected = results.filter((r) => !r.ok);
    expect(rejected, JSON.stringify(rejected[0])).toEqual([]);
    const finish = results.find((r) => r.ok && r.finishTime !== undefined);
    expect(finish && finish.ok && finish.finishTime).toBeCloseTo(traces[i].finishTime, 1);
    expect(checker.reached.every(Boolean)).toBe(true);
  });

  it.each(LEVELS.map((l, i) => [l.name, i]))('%s: a player taking the risky lines for the stars passes too', async (_n, i) => {
    const trace = await honestTrace(i, 'stars');
    const checker = new MoveChecker(levels[i], START_AT);
    const results = feed(checker, trace.updates);
    const rejected = results.filter((r) => !r.ok);
    expect(rejected, JSON.stringify(rejected[0])).toEqual([]);
    const finish = results.find((r) => r.ok && r.finishTime !== undefined);
    expect(finish && finish.ok && finish.finishTime).toBeCloseTo(trace.finishTime, 1);
  });

  it('allows respawning at the start or a reached checkpoint', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    const upd = traces[0].updates;
    const mid = upd.findIndex((u) => u.p[2] < -40); // past checkpoint 0 at z = -34
    feed(checker, upd.slice(0, mid));
    expect(checker.reached[0]).toBe(true);
    const t = upd[mid - 1].t + 50;
    const cp = levels[0].checkpoints[0].position;
    expect(checker.check({ t, p: [cp[0], cp[1] + 1.2, cp[2]], v: [0, 0, 0] }, t).ok).toBe(true);
    expect(checker.check({ t: t + 50, p: levels[0].start.position, v: [0, 0, 0] }, t + 50).ok).toBe(true);
  });
});

describe('MoveChecker: cheats', () => {
  const at = (i: number, dt: number): number => traces[0].updates[i].t + dt;
  const goal = (): Vec3 => { const g = levels[0].goal!.position; return [g[0], g[1] + 1, g[2]]; };

  it('rejects teleporting to the goal', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    feed(checker, traces[0].updates.slice(0, 20));
    const r = checker.check({ t: at(19, 50), p: goal(), v: [0, 0, 0] }, at(19, 50));
    expect(r).toMatchObject({ ok: false, strike: true });
  });

  it('rejects teleporting after waiting (no "saving up" distance with rejected updates)', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    feed(checker, traces[0].updates.slice(0, 3));
    const t0 = traces[0].updates[2].t;
    for (let i = 1; i <= 100; i++) { // 5 s of trying to jump to the goal
      const t = t0 + i * 50;
      expect(checker.check({ t, p: goal(), v: [0, 0, 0] }, t).ok).toBe(false);
    }
  });

  it('rejects impossible speed', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    feed(checker, traces[0].updates.slice(0, 20));
    const u = traces[0].updates[20];
    expect(checker.check({ ...u, v: [0, 0, -LIMITS.maxSpeed - 1] }, u.t)).toMatchObject({ ok: false, reason: 'too fast' });
  });

  it('rejects timestamps from the future', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    const u = traces[0].updates[10];
    expect(checker.check(u, u.t - LIMITS.clockAhead - 100)).toMatchObject({ ok: false, reason: 'from the future' });
  });

  it('rejects respawning at a checkpoint not yet reached', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    feed(checker, traces[0].updates.slice(0, 5));
    const cp = levels[0].checkpoints[2].position;
    expect(checker.check({ t: at(4, 50), p: [cp[0], cp[1] + 1.2, cp[2]], v: [0, 0, 0] }, at(4, 50))).toMatchObject({ ok: false, strike: true });
  });

  it('rejects moving before GO', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    const s = levels[0].start.position;
    expect(checker.check({ t: START_AT - 500, p: [s[0], s[1], s[2] - 8], v: [0, 0, -10] }, START_AT - 480)).toMatchObject({ ok: false });
  });

  it('rejects malformed payloads', () => {
    const checker = new MoveChecker(levels[0], START_AT);
    expect(checker.check({ t: START_AT, p: [0, NaN, 0], v: [0, 0, 0] }, START_AT)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(checker.check({ t: START_AT } as unknown as BallUpdate, START_AT)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('placings', () => {
  it('route progress grows over an honest run', () => {
    const upd = traces[0].updates;
    const p = upd.map((u) => routeProgress(levels[0], u.p));
    expect(p[0]).toBeLessThan(2);
    expect(p.at(-1)!).toBeGreaterThan(p[Math.floor(p.length / 2)]);
    expect(p.at(-1)!).toBeGreaterThan(150);
  });

  it('ranks finishers by time, then by progress, DNF last', () => {
    expect(rankPlayers([
      { id: 'slow', finishTime: 30, progress: 0, dnf: false },
      { id: 'racing', finishTime: -1, progress: 80, dnf: false },
      { id: 'fast', finishTime: 25, progress: 0, dnf: false },
      { id: 'cheat', finishTime: -1, progress: 200, dnf: true },
      { id: 'behind', finishTime: -1, progress: 20, dnf: false },
    ])).toEqual(['fast', 'slow', 'racing', 'behind', 'cheat']);
  });
});

describe('names', () => {
  it('generates only valid names and rejects anything typed', () => {
    for (let i = 0; i < 50; i++) expect(isValidName(randomName())).toBe(true);
    expect(isValidName('Zippy Hammy')).toBe(true);
    expect(isValidName('Zippy  Hammy')).toBe(false);
    expect(isValidName('Bad Word')).toBe(false);
    expect(isValidName(42)).toBe(false);
  });
});
