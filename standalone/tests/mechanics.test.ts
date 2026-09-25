import { describe, expect, it } from 'vitest';
import type { LevelData, Piece } from '../src/levels/schema';
import { parseLevel } from '../src/levels/schema';
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
});
