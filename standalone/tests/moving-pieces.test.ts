import { describe, expect, it } from 'vitest';
import type { LevelData, Piece } from '../src/levels/schema';
import { parseLevel } from '../src/levels/schema';
import { Autopilot } from '../src/sim/autopilot';
import { pointVelocity, poseAt, resolveLevel, starAt } from '../src/sim/geometry';
import { conjugate, rotate, sub, type Vec3 } from '../src/sim/math';
import { carrierOf } from '../src/net/protocol';
import { horizSpeed, makeSim, run, skipCountdown, teleport, toward } from './helpers';

// Turntables, piano keys, pendulums, rockers, rollers, sliding bumpers and paper walls: the
// pieces that move on the clock (or tear), and the bots' look-ahead that times them.

function course(...extra: Piece[]): LevelData {
  return parseLevel({
    format: 1,
    name: 'Moving pieces',
    start: { position: [0, 1, 0] },
    pieces: [
      { type: 'pad', center: [0, 0, -20], w: 60, d: 60 },
      { type: 'goal', position: [0, 0, -45] },
      ...extra,
    ],
  });
}

describe('motions', () => {
  const level = resolveLevel(course(
    { type: 'mover', from: [0, 0, -10], to: [0, -8, -10], w: 4, d: 4, period: 3, phase: 0.4, hold: 0.3 },
    { type: 'turntable', center: [20, 0, -10], radius: 7, speed: 0.7, gaps: [0, 180] },
    { type: 'pendulum', pivot: [-20, 9, -10], length: 8, swing: 50, period: 2.6, phase: 0.3, yaw: 90 },
    { type: 'rocker', center: [0, 0, -30], w: 4, d: 14, tilt: 10, period: 3.5 },
    { type: 'roller', from: [-10, 0, -40], to: [10, 0, -40], period: 2.5, phase: 1 },
    { type: 'bumper', position: [5, 0, -5], to: [15, 0, -5], period: 4, phase: 1 },
    { type: 'wheel', center: [-20, 7, -30], radius: 7, speed: 0.4, steps: 5 },
    { type: 'gate', position: [10, 0, -30], w: 4, period: 3, phase: 0.5, open: 0.4 },
  ));

  it('report the velocity they really move at (for riding and look-ahead)', () => {
    const h = 1e-4;
    for (const solid of level.solids.filter((s) => s.motion)) {
      for (const t of [0.05, 0.9, 1.7, 3.3]) {
        const a = poseAt(solid, t - h).position, b = poseAt(solid, t + h).position;
        const v = poseAt(solid, t).velocity;
        if (solid.motion!.kind === 'travel' && Math.abs(((t + 1) / 2.5) % 1) < 0.01) continue; // the jump back to the start
        for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo((b[i] - a[i]) / (2 * h), 2);
      }
    }
  });

  it('carry every point of a turning or tilting solid along with it', () => {
    const h = 1e-4;
    for (const solid of level.solids.filter((s) => s.motion && (s.motion.kind === 'spin' || s.motion.kind === 'swing'))) {
      for (const t of [0.3, 1.1, 2.4]) {
        // A point on the solid, 2 units off its centre in its own frame.
        const at = (time: number): Vec3 => {
          const pose = poseAt(solid, time);
          const off = rotate([2, 0.5, 1], pose.rotation);
          return [pose.position[0] + off[0], pose.position[1] + off[1], pose.position[2] + off[2]];
        };
        const v = pointVelocity(solid, at(t), t), a = at(t - h), b = at(t + h);
        for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo((b[i] - a[i]) / (2 * h), 2);
      }
    }
  });

  it('rest at each end of a held slide, and start a phase ahead', () => {
    const key = level.solids.find((s) => s.skin === 'key')!;
    // Phase 0.4 of a 3 s cycle resting 30% at each end: at the top from t = -0.4 to 0.5.
    expect(poseAt(key, 0).position[1]).toBeCloseTo(-0.5, 6);
    expect(poseAt(key, 0.45).position[1]).toBeCloseTo(-0.5, 6);
    expect(poseAt(key, 1.6).position[1]).toBeCloseTo(-8.5, 6); // resting at the bottom
    expect(poseAt(key, 1.6).velocity.every((v) => v === 0)).toBe(true);
  });

  it('let a star ride any moving piece', () => {
    const lv = resolveLevel(course(
      { type: 'pendulum', pivot: [-20, 9, -10], length: 8, swing: 50, period: 2.6 },
      { type: 'roller', from: [-10, 0, -40], to: [10, 0, -40], period: 2.5 },
      { type: 'star', position: [-20, 1, -10], ride: 2 },
      { type: 'star', position: [-10, 3.5, -40], ride: 3 },
    ));
    const bob = lv.solids.find((s) => s.skin === 'bob')!, log = lv.solids.find((s) => s.skin === 'roller')!;
    for (const t of [0, 0.7, 1.9]) {
      const local = rotate(sub(starAt(lv.stars[0], t), poseAt(bob, t).position), conjugate(poseAt(bob, t).rotation));
      expect(local[0]).toBeCloseTo(0, 6);
      expect(local[1]).toBeCloseTo(0, 6); // stays at the bob's centre as it swings
      expect(local[2]).toBeCloseTo(0, 6);
      expect(starAt(lv.stars[1], t)[0]).toBeCloseTo(poseAt(log, t).position[0], 6);
    }
    expect(() => course({ type: 'star', position: [0, 1, 0], ride: 0 })).toThrow(/moving piece/);
  });
});

describe('moving pieces', () => {
  it('a turntable carries a resting ball round with it', async () => {
    const sim = await makeSim(course({ type: 'turntable', center: [0, 0.5, -20], radius: 8, speed: 0.8 }));
    skipCountdown(sim);
    teleport(sim, [5, 1.6, -20]); // 5 out along +x
    run(sim, 1.5);
    const p = sim.position();
    const angle = Math.atan2(-(p[2] + 20), p[0]); // counter-clockwise from +x, seen from above
    expect(angle).toBeGreaterThan(0.8 * 1.5 * 0.7);
    expect(Math.hypot(p[0], p[2] + 20)).toBeLessThan(7); // still on the disc
  });

  it('the rim keeps you on except at its gaps', async () => {
    const level = resolveLevel(course({ type: 'turntable', center: [0, 0.5, -20], radius: 8, speed: 0.5, gaps: [90] }));
    const rim = level.solids.filter((s) => s.skin === 'rim');
    expect(rim.length).toBeGreaterThan(10);
    // Nothing near the gap (straight "up" the screen, toward -z) at t = 0.
    expect(rim.every((s) => Math.hypot(s.position[0], s.position[2] + 28.15) > 2.4)).toBe(true);
  });

  it('a piano key that sinks drops the ball waiting on it', async () => {
    const sim = await makeSim(parseLevel({
      format: 1, name: 'Key', start: { position: [0, 1, 0] },
      pieces: [
        { type: 'pad', center: [0, 0, 0], w: 10, d: 10 },
        { type: 'mover', from: [0, 0, -7], to: [0, -22, -7], w: 6, d: 4, period: 3.6, hold: 0.3 },
        { type: 'pad', center: [0, 0, -14], w: 10, d: 10 },
        { type: 'goal', position: [0, 0, -14] },
      ],
    }));
    skipCountdown(sim);
    run(sim, 3.6 - (sim.time % 3.6)); // the start of a cycle: up, resting
    teleport(sim, [0, 1.1, -7]);
    expect(run(sim, 3.6).some((e) => e.type === 'fall')).toBe(true);
  });

  it('a pendulum knocks a ball sitting under it', async () => {
    const sim = await makeSim(course({ type: 'pendulum', pivot: [0, 10, -10], length: 8.7, swing: 50, period: 2.4, yaw: 0 }));
    skipCountdown(sim);
    teleport(sim, [0, 1, -10]);
    let fastest = 0;
    run(sim, 2.4, () => { fastest = Math.max(fastest, horizSpeed(sim.velocity())); return { x: 0, z: 0 }; });
    expect(fastest).toBeGreaterThan(6);
  });

  it('a rocker tilts the ball off toward its low side', async () => {
    const sim = await makeSim(parseLevel({
      format: 1, name: 'Rocker', start: { position: [0, 1, 0] },
      pieces: [
        { type: 'pad', center: [0, 0, 0], w: 10, d: 10 },
        { type: 'rocker', center: [0, 0, -14], w: 5, d: 16, tilt: 12, period: 4 },
        { type: 'goal', position: [0, 0, 0] },
      ],
    }));
    skipCountdown(sim);
    run(sim, 4 - (sim.time % 4)); // level, about to tilt
    teleport(sim, [0, 1.1, -14]);
    run(sim, 1.2);
    // Swinging about +z with a positive angle first lowers the -x side.
    expect(sim.position()[0]).toBeLessThan(-1);
  });

  it('a roller shoves a ball in its way', async () => {
    const sim = await makeSim(course({ type: 'roller', from: [-12, 0, -10], to: [12, 0, -10], period: 3 }));
    skipCountdown(sim);
    run(sim, 3 - (sim.time % 3)); // at the start of its run
    teleport(sim, [0, 1, -10]);
    run(sim, 1.5);
    expect(sim.position()[0]).toBeGreaterThan(2); // pushed along the way it rolls
  });

  it('a sliding bumper kicks you away from where it is now', async () => {
    const sim = await makeSim(course({ type: 'bumper', position: [-10, 0, -10], to: [10, 0, -10], period: 20 }));
    skipCountdown(sim);
    run(sim, 10 - (sim.time % 20)); // over at +10
    teleport(sim, [5, 1, -10]);
    const events = run(sim, 1, toward(sim, 12, -10));
    expect(events.some((e) => e.type === 'bump')).toBe(true);
    expect(sim.velocity()[0]).toBeLessThan(-5); // thrown back toward -x, away from the bumper at +10
  });

  it('paper stops a slow ball, tears for a fast one, and is whole again after a respawn', async () => {
    const paper: Piece = { type: 'paper', position: [0, 0, -10], w: 8, speed: 15 };
    const slow = await makeSim(course(paper));
    skipCountdown(slow);
    teleport(slow, [0, 1, -4]);
    const slowEvents = run(slow, 2, () => (horizSpeed(slow.velocity()) < 8 ? { x: 0, z: -1 } : { x: 0, z: 0 }));
    expect(slowEvents.some((e) => e.type === 'smash')).toBe(false);
    expect(slow.position()[2]).toBeGreaterThan(-10); // still on the near side

    const fast = await makeSim(course(paper, { type: 'boost', position: [0, 0, -2], w: 6, d: 3 }));
    skipCountdown(fast);
    const events = run(fast, 1.5, { x: 0, z: -1 });
    const smash = events.find((e) => e.type === 'smash');
    expect(smash).toBeTruthy();
    expect(fast.position()[2]).toBeLessThan(-14); // straight through, still moving
    expect(fast.isTorn(smash!.type === 'smash' ? smash!.solidId : -1)).toBe(true);
    fast.respawn();
    expect(fast.isTorn(smash!.type === 'smash' ? smash!.solidId : -1)).toBe(false);
  });
});

describe('batch 2 pieces', () => {
  it('an iron ball waits until you land on it, rolls the way you push, and goes back on a respawn', async () => {
    const sim = await makeSim(course({ type: 'ironball', position: [0, 0, -10], radius: 3 }));
    skipCountdown(sim);
    const iron = sim.level.solids.find((x) => x.role === 'carrier')!;
    run(sim, 1, { x: 0, z: 0 });
    sim.solidPose(iron.id).position.forEach((n, i) => expect(n).toBeCloseTo(iron.position[i], 4)); // untouched: held still
    teleport(sim, [0, 7.05, -10]);
    run(sim, 0.3);
    expect(sim.carrier()).not.toBeNull();
    run(sim, 1, { x: 0, z: -0.3 });
    expect(sim.solidPose(iron.id).position[2]).toBeLessThan(-10.3); // pushed along -z
    expect(sim.carrierOut()).not.toBeNull();
    sim.respawn();
    sim.solidPose(iron.id).position.forEach((n, i) => expect(n).toBeCloseTo(iron.position[i], 4));
    expect(sim.carrierOut()).toBeNull();
  });

  it('a rolling iron ball carries you on by itself, keeps you on top, and steers where you push sideways', async () => {
    const sim = await makeSim(course({ type: 'ironball', position: [0, 0, 0], radius: 3, roll: 3, yaw: 0 }));
    skipCountdown(sim);
    const iron = sim.level.solids.find((x) => x.role === 'carrier')!;
    teleport(sim, [0, 7.05, 0]);
    run(sim, 3); // no input at all
    expect(sim.carrier()).not.toBeNull(); // still on top
    expect(sim.solidPose(iron.id).position[2]).toBeLessThan(-6); // rolled on toward -z by itself
    const x = sim.solidPose(iron.id).position[0];
    run(sim, 1, { x: 0.6, z: 0 });
    expect(sim.solidPose(iron.id).position[0]).toBeGreaterThan(x + 0.5); // steered toward +x
    expect(sim.carrier()).not.toBeNull();
  });

  it('spikes send your ball back, but an iron ball can roll over them', async () => {
    const sim = await makeSim(course({ type: 'spikes', center: [0, 0.1, -10], w: 10, d: 10 }, { type: 'ironball', position: [0, 0.1, -10] }));
    skipCountdown(sim);
    let hit = false;
    for (let i = 0; i < 240 && !hit; i++) {
      sim.step(toward(sim, 0, -10)());
      const events = sim.drainEvents();
      hit = events.some((e) => e.type === 'hazard');
      if (hit) expect(events.some((e) => e.type === 'fall')).toBe(true);
    }
    expect(hit).toBe(true);
    expect(sim.position()[2]).toBeGreaterThan(-1); // straight back to the start
    const iron = sim.level.solids.find((x) => x.role === 'carrier')!;
    sim.solidPose(iron.id).position.forEach((n, i) => expect(n).toBeCloseTo(iron.position[i], 4)); // the iron ball sits on them happily
  });

  it('a wheel step carries a waiting ball up and over, staying level', async () => {
    const level = course({ type: 'wheel', center: [0, 7, -12], radius: 7, speed: 0.5, steps: 6 });
    const resolved = resolveLevel(level), step = resolved.solids.find((x) => x.skin === 'step')!;
    for (const t of [0, 1.3, 4.4]) expect(poseAt(step, t).rotation).toEqual(step.rotation);
    const sim = await makeSim(level);
    skipCountdown(sim);
    const period = (Math.PI * 2) / 0.5;
    run(sim, period - (sim.time % period)); // step 0 is at the bottom
    teleport(sim, [0, 1.2, -12]);
    let top = 0;
    run(sim, period / 2, () => { top = Math.max(top, sim.position()[1]); return { x: 0, z: 0 }; });
    expect(top).toBeGreaterThan(12); // carried most of the way to the top (14)
  });

  it('a gate stops you while it is up and lets you through while it is down', async () => {
    const gate: Piece = { type: 'gate', position: [0, 0, -8], w: 20, period: 6, open: 0.5 };
    const level = resolveLevel(course(gate)), solid = level.solids.find((x) => x.skin === 'gate')!;
    expect(poseAt(solid, 0.5).position[1]).toBeCloseTo(1.3, 3); // closed: standing up
    expect(poseAt(solid, 4.5).position[1]).toBeLessThan(-1.5);  // open: sunk into the floor
    const shut = await makeSim(course(gate));
    skipCountdown(shut);
    run(shut, 6 - (shut.time % 6)); // the start of a cycle: shut for the first half
    run(shut, 2, toward(shut, 0, -14));
    expect(shut.position()[2]).toBeGreaterThan(-8);
    run(shut, 6 - (shut.time % 6) + 3.4); // well into the open half
    run(shut, 1.4, toward(shut, 0, -14));
    expect(shut.position()[2]).toBeLessThan(-9);
  });

  it('a log on a slope sits on it', () => {
    const level = resolveLevel(course({ type: 'roller', from: [0, 6, -30], to: [0, 0, 0], period: 3 }));
    const log = level.solids.find((x) => x.skin === 'roller')!;
    // The slope's surface through the two floor points; the log's centre is its radius above it.
    const [dz, dy] = [30, -6], len = Math.hypot(dz, dy);
    const off = ((log.position[1] - 6) * dz - (log.position[2] + 30) * dy) / len;
    expect(Math.abs(off)).toBeCloseTo(1.2, 3);
  });

  it('an iron ball only reaches the others when it is near the ball riding it', () => {
    expect(carrierOf({ t: 0, p: [0, 7, 0], v: [0, 0, 0], c: [0, 3, 0] })).toEqual([0, 3, 0]);
    expect(carrierOf({ t: 0, p: [0, 7, 0], v: [0, 0, 0], c: [0, 3, 50] })).toBeNull();
    expect(carrierOf({ t: 0, p: [0, 7, 0], v: [0, 0, 0], c: [0, Number.NaN, 0] as unknown as [number, number, number] })).toBeNull();
    expect(carrierOf({ t: 0, p: [0, 7, 0], v: [0, 0, 0] })).toBeNull();
  });
});

describe('timed waypoints', () => {
  it('bots wait for a gap in a pendulum swinging across a bridge, whenever they arrive', async () => {
    const level = parseLevel({
      format: 1, name: 'Swing', start: { position: [0, 1, 0] },
      pieces: [
        { type: 'pad', center: [0, 0, 0], w: 10, d: 10 },
        { type: 'path', from: [0, 0, -5], to: [0, 0, -25], width: 4, open: true },
        { type: 'pendulum', pivot: [0, 10, -15], length: 8.6, swing: 55, period: 3.2, yaw: 0 },
        { type: 'pad', center: [0, 0, -30], w: 10, d: 10 },
        { type: 'goal', position: [0, 0, -30] },
      ],
      route: [{ p: [0, 0, -6], speed: 6, timed: true }, { p: [0, 0, -25], speed: 9 }, { p: [0, 0, -30], speed: 6 }],
    });
    for (const wait of [0, 0.4, 0.9, 1.3, 1.8, 2.2]) {
      const sim = await makeSim(level);
      skipCountdown(sim);
      run(sim, wait); // arrive at a different moment of the swing each time
      const pilot = new Autopilot(sim);
      let falls = 0;
      for (let i = 0; i < 20 * 120 && sim.phase !== 'finished'; i++) {
        sim.step(pilot.input());
        falls += sim.drainEvents().filter((e) => e.type === 'fall').length;
      }
      expect({ wait, finished: sim.phase === 'finished', falls }).toEqual({ wait, finished: true, falls: 0 });
    }
  });
});
