import { describe, expect, it } from 'vitest';
import type { LevelData, Piece } from '../src/levels/schema';
import { parseLevel } from '../src/levels/schema';
import { poseAt, resolveLevel, starAt } from '../src/sim/geometry';
import { rotate } from '../src/sim/math';
import { horizSpeed, makeSim, run, skipCountdown, teleport, toward } from './helpers';

// Boost pads, springs, conveyors, crumbling tiles, wind and low gravity, each on a small
// test course: a big flat floor with the mechanic in the middle.

function course(...extra: Piece[]): LevelData {
  return parseLevel({
    format: 1,
    name: 'Mechanics',
    start: { position: [0, 1, 0] },
    pieces: [
      { type: 'pad', center: [0, 0, -20], w: 60, d: 60 },
      { type: 'goal', position: [0, 0, -45] },
      ...extra,
    ],
  });
}

describe('mechanics', () => {
  it('boost pads shoot you along their direction', async () => {
    const sim = await makeSim(course({ type: 'boost', position: [0, 0, -4], w: 6, d: 3 }));
    skipCountdown(sim);
    const events = run(sim, 0.6, { x: 0, z: -1 });
    expect(events.filter((e) => e.type === 'boost')).toHaveLength(1);
    expect(sim.velocity()[2]).toBeLessThan(-25); // way past the 22 rolling top speed
  });

  it('springs launch you up (and forward with push)', async () => {
    const sim = await makeSim(course({ type: 'spring', position: [0, 0, -3], power: 16, push: 8, yaw: 90 }));
    skipCountdown(sim);
    let maxY = 0, launched = false;
    run(sim, 1.2, () => {
      maxY = Math.max(maxY, sim.position()[1]);
      launched ||= sim.velocity()[1] > 10;
      return launched ? { x: 0, z: 0 } : { x: 0, z: -1 };
    });
    expect(maxY).toBeGreaterThan(5); // 16²/(2·25) ≈ 5 above the pad
    expect(sim.position()[0]).toBeLessThan(-4); // yaw 90 points toward -x
  });

  it('conveyors carry a resting ball, and push back against you the other way', async () => {
    const sim = await makeSim(course({ type: 'conveyor', from: [0, 0.1, 5], to: [0, 0.1, -25], width: 8, speed: 10 }));
    skipCountdown(sim);
    teleport(sim, [0, 1.2, -2]);
    run(sim, 1.5);
    expect(sim.velocity()[2]).toBeLessThan(-8); // carried along at nearly belt speed

    const against = await makeSim(course({ type: 'conveyor', from: [0, 0.1, -25], to: [0, 0.1, 5], width: 8, speed: 10 }));
    skipCountdown(against);
    run(against, 1.5, { x: 0, z: -1 });
    const fighting = horizSpeed(against.velocity());
    const free = await makeSim(course());
    skipCountdown(free);
    run(free, 1.5, { x: 0, z: -1 });
    expect(fighting).toBeLessThan(horizSpeed(free.velocity()) * 0.7);
  });

  it('crumbling tiles drop you, then come back; a respawn restores them at once', async () => {
    const level = course();
    level.pieces[0] = { type: 'pad', center: [0, 0, 10], w: 20, d: 20 }; // floor only behind the start
    level.pieces.push({ type: 'crumble', center: [0, 0, -3], w: 6, d: 6, delay: 0.5, respawn: 2 });
    const sim = await makeSim(level);
    skipCountdown(sim);
    teleport(sim, [0, 1.2, -3]);
    run(sim, 0.4);
    expect(sim.crumbleState(1).shake).toBeGreaterThan(0.5);
    let events = run(sim, 0.3);
    expect(events.some((e) => e.type === 'crumble')).toBe(true);
    expect(sim.crumbleState(1).gone).toBe(true);
    expect(sim.floorAt([0, 0, -3])).toBe(false); // bots see the hole too
    events = run(sim, 1.5);
    expect(events.some((e) => e.type === 'fall')).toBe(true);
    expect(sim.crumbleState(1).gone).toBe(false); // restored on respawn
    expect(sim.floorAt([0, 0, -3])).toBe(true);
  });

  it('updrafts lift a ball, crosswinds push it sideways', async () => {
    const up = await makeSim(course({ type: 'wind', center: [0, 5, -3], size: [6, 12, 6], dir: [0, 1, 0], speed: 8 }));
    skipCountdown(up);
    teleport(up, [0, 1.2, -3]);
    run(up, 1.5);
    expect(up.position()[1]).toBeGreaterThan(8);

    const side = await makeSim(course({ type: 'wind', center: [0, 2, -10], size: [20, 6, 30], dir: [1, 0, 0], speed: 6, strength: 12 }));
    skipCountdown(side);
    teleport(side, [0, 1.2, -3]);
    run(side, 1);
    expect(side.position()[0]).toBeGreaterThan(1.5);
  });

  it('low gravity makes a spring launch go much higher', async () => {
    const spring: Piece = { type: 'spring', position: [0, 0, -3], power: 12 };
    const apex = async (level: LevelData) => {
      const sim = await makeSim(level);
      skipCountdown(sim);
      let maxY = 0;
      run(sim, 3, () => { maxY = Math.max(maxY, sim.position()[1]); return sim.velocity()[1] > 5 ? { x: 0, z: 0 } : toward(sim, 0, -3)(); });
      return maxY;
    };
    const normal = await apex(course(spring));
    const moon = await apex(course(spring, { type: 'lowgrav', center: [0, 10, -3], size: [20, 20, 20], scale: 0.3 }));
    expect(moon - 1).toBeGreaterThan((normal - 1) * 2.5);
  });

  it('lifts carry a waiting ball up', async () => {
    const sim = await makeSim(course({ type: 'mover', from: [0, 0.2, -3], to: [0, 8, -3], w: 6, d: 6, period: 6 }));
    skipCountdown(sim);
    run(sim, 6 - (sim.time % 6)); // the lift is back at the bottom
    teleport(sim, [0, 1.4, -3]);
    let maxY = 0;
    run(sim, 3, () => { maxY = Math.max(maxY, sim.position()[1]); return { x: 0, z: 0 }; });
    expect(maxY).toBeGreaterThan(8);
  });

  it('validates the new pieces', () => {
    expect(() => course({ type: 'wind', center: [0, 0, 0], size: [1, 1, 1], dir: [0, 0, 0] })).toThrow(/dir/);
    expect(() => course({ type: 'lowgrav', center: [0, 0, 0], size: [1, 1, 1], scale: 1.5 })).toThrow(/scale/);
    expect(() => course({ type: 'star', position: [0, 1] as unknown as [number, number, number] })).toThrow(/position/);
  });

  it('stars are collected once, stay collected after a fall, and come back on restart', async () => {
    const sim = await makeSim(course({ type: 'star', position: [0, 1.4, -6] }, { type: 'star', position: [8, 1.4, -6] }));
    skipCountdown(sim);
    const events = run(sim, 2, toward(sim, 0, -10));
    expect(events.filter((e) => e.type === 'star')).toEqual([{ type: 'star', index: 0 }]);
    expect(sim.stars).toEqual([true, false]);
    sim.respawn();
    expect(sim.stars).toEqual([true, false]); // a fall doesn't take it back
    expect(run(sim, 2, toward(sim, 0, -10)).filter((e) => e.type === 'star')).toHaveLength(0); // already have it
    sim.restart();
    expect(sim.stars).toEqual([false, false]);
  });

  it('validates riding and switch stars', () => {
    const star = (extra: object) => course({ type: 'star', position: [0, 1.4, -6], ...extra } as Piece);
    expect(star({ to: [0, 1.4, -10], period: 4 })).toBeTruthy();
    expect(star({ center: [0, 0, -10], speed: 1 })).toBeTruthy();
    expect(star({ button: [0, 0, -2], time: 5 })).toBeTruthy();
    expect(() => star({ to: [0, 1.4, -10] })).toThrow(/needs both "to" and "period"/);
    expect(() => star({ speed: 1 })).toThrow(/needs both "center" and "speed"/);
    expect(() => star({ to: [0, 1.4, -10], period: 4, center: [0, 0, -10], speed: 1 })).toThrow(/slide or circle/);
    expect(() => star({ time: 5 })).toThrow(/time: needs a "button"/);
    expect(() => course({ type: 'star', position: [0, 1.4, -6], button: [0, 0] } as unknown as Piece)).toThrow(/button/);
  });

  it('riding stars move in step with the platform or arm they copy', () => {
    const level = resolveLevel(course(
      { type: 'mover', from: [10, 0, -10], to: [20, 0, -10], w: 4, d: 4, period: 4 },
      { type: 'sweeper', position: [-10, 0, -10], length: 10, speed: 1.5 },
      { type: 'star', position: [10, 1.4, -10], to: [20, 1.4, -10], period: 4 },
      { type: 'star', position: [-5.5, 2, -10], center: [-10, 0, -10], speed: 1.5 },
    ));
    const platform = level.solids.find((s) => s.role === 'platform')!, arm = level.solids.find((s) => s.role === 'arm')!;
    for (const t of [0, 0.7, 1.9, 3.3, 10.25]) {
      const slide = starAt(level.stars[0], t), ride = poseAt(platform, t).position;
      expect(slide[0]).toBeCloseTo(ride[0], 6);
      expect(slide[2]).toBeCloseTo(ride[2], 6);
      const circle = starAt(level.stars[1], t), tip = rotate([4.5, 0, 0], poseAt(arm, t).rotation);
      expect(circle[0]).toBeCloseTo(-10 + tip[0], 6);
      expect(circle[2]).toBeCloseTo(-10 + tip[2], 6);
      expect(circle[1]).toBe(2);
    }
  });

  it('a riding star is collected when it comes to you', async () => {
    const sim = await makeSim(course({ type: 'star', position: [0, 1.4, -6], to: [0, 1.4, -26], period: 6 }));
    skipCountdown(sim);
    teleport(sim, [0, 1, -16]);
    const t0 = sim.time;
    const events = run(sim, 3);
    expect(events.filter((e) => e.type === 'star')).toHaveLength(1);
    expect(sim.time - t0).toBeGreaterThan(1); // it had to come over first
  });

  it('switch stars show only while their timer runs; the timer survives a fall and resets on restart', async () => {
    const sim = await makeSim(course({ type: 'star', position: [0, 1.4, -6], button: [8, 0, 0], time: 3 }));
    skipCountdown(sim);
    run(sim, 1.5, toward(sim, 0, -8)); // roll through it: still locked
    expect(sim.stars).toEqual([false]);
    teleport(sim, [8, 1, 0]); // onto the button
    expect(run(sim, 0.2).filter((e) => e.type === 'switch')).toEqual([{ type: 'switch', index: 0, time: 3 }]);
    expect(run(sim, 0.5).filter((e) => e.type === 'switch')).toHaveLength(0); // no restarting it while it runs
    sim.restart();
    expect(sim.switchUntil).toEqual([0]);
    skipCountdown(sim);
    teleport(sim, [8, 1, 0]);
    run(sim, 0.2);
    teleport(sim, [0, 1, -12]); // a respawn doesn't stop the clock
    expect(run(sim, 2, toward(sim, 0, -4)).filter((e) => e.type === 'star')).toHaveLength(1);

    // Too slow: the timer runs out first.
    const late = await makeSim(course({ type: 'star', position: [0, 1.4, -6], button: [8, 0, 0], time: 1 }));
    skipCountdown(late);
    teleport(late, [8, 1, 0]);
    run(late, 1.5);
    teleport(late, [0, 1, -12]);
    expect(run(late, 2, toward(late, 0, -4)).filter((e) => e.type === 'star')).toHaveLength(0);
  });

  it('stars wait for GO', async () => {
    const sim = await makeSim(course({ type: 'star', position: [0, 1.4, 0] })); // right on the start
    expect(sim.phase).toBe('countdown');
    sim.step({ x: 0, z: 0 });
    expect(sim.drainEvents().some((e) => e.type === 'star')).toBe(false);
    expect(sim.stars).toEqual([false]);
    while (sim.phase === 'countdown') sim.step({ x: 0, z: 0 });
    expect(sim.drainEvents().filter((e) => e.type === 'star')).toHaveLength(1); // on GO
    expect(sim.stars).toEqual([true]);
  });
});

describe('safety walls', () => {
  it('guard open edges, leave gaps where the route crosses, and rebuild cleanly', async () => {
    const { addSafetyWalls, GUARD_COLOR } = await import('../src/levels/guard');
    const { initPhysics } = await import('../src/sim/simulation');
    await initPhysics();
    const level = parseLevel({
      format: 1, name: 'Gap', start: { position: [0, 1, 0] },
      pieces: [
        { type: 'pad', center: [0, 0, 0], w: 12, d: 12 },
        { type: 'pad', center: [0, -3, -20], w: 12, d: 12 },
        { type: 'goal', position: [0, -3, -20] },
      ],
      route: [{ p: [0, -3, -20] }],
    });
    const walled = addSafetyWalls(level);
    const walls = walled.pieces.filter((p) => p.type === 'block' && p.color === GUARD_COLOR);
    // Both pads: 3 full sides each, and their facing edges (the drop the route crosses) stay open.
    expect(walls.length).toBe(6);
    expect(walls.every((w) => w.type === 'block' && Math.abs(w.position[2] + 6) > 0.5 && Math.abs(w.position[2] + 14) > 0.5)).toBe(true);
    expect(addSafetyWalls(walled)).toEqual(walled); // idempotent
  });

  it('leave open pieces bare, and leave gaps where the star route crosses too', async () => {
    const { addSafetyWalls, GUARD_COLOR } = await import('../src/levels/guard');
    const { initPhysics } = await import('../src/sim/simulation');
    await initPhysics();
    const level = parseLevel({
      format: 1, name: 'Fork', start: { position: [0, 1, 0] },
      pieces: [
        { type: 'pad', center: [0, 0, 0], w: 12, d: 12 },
        { type: 'path', from: [0, 0, -6], to: [0, 0, -20], width: 3, open: true }, // risky beam
        { type: 'pad', center: [0, -3, -32], w: 12, d: 12 },                       // reached only by the star route
        { type: 'goal', position: [0, 0, 0] },
      ],
      route: [{ p: [0, 0, 0] }],
      starRoute: [{ p: [0, 0, -20] }, { p: [0, -3, -32] }],
    });
    const walls = addSafetyWalls(level).pieces.filter((p) => p.type === 'block' && p.color === GUARD_COLOR);
    const near = (z: number) => walls.filter((w) => w.type === 'block' && Math.abs(w.position[2] - z) < 0.5);
    expect(walls.some((w) => w.type === 'block' && w.position[2] < -7 && w.position[2] > -19)).toBe(false); // nothing along the beam
    expect(near(-26).length).toBe(0); // the drop onto the far pad, crossed by the star route, stays open
  });
});
