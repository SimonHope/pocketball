import { describe, expect, it } from 'vitest';
import { ARENAS, courseDrop, LEVELS } from '../src/levels';
import { parseLevel, LevelError } from '../src/levels/schema';
import { formatLevel } from '../src/levels/format';
import { generateLevel, type Act, type GenOptions, type Segment, type StarKind } from '../src/levels/generator';
import { generateMaze } from '../src/levels/maze';
import { resolveLevel } from '../src/sim/geometry';
import { add, rotate, scale, type Vec3 } from '../src/sim/math';
import warmUp from '../src/levels/warm-up.json';

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe('level files', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s is valid and has a route and medals', (_name, level) => {
    expect(level.route?.length ?? 0).toBeGreaterThan(0);
    expect(level.medals).toBeDefined();
    expect(() => resolveLevel(level)).not.toThrow();
  });

  it('rejects bad data with a readable path', () => {
    const bad = structuredClone(warmUp) as Record<string, unknown>;
    (bad.pieces as Record<string, unknown>[])[1].palette = 'pink';
    expect(() => parseLevel(bad)).toThrow(LevelError);
    expect(() => parseLevel(bad)).toThrow('level.pieces[1].palette');
  });

  it('requires exactly one goal', () => {
    const bad = structuredClone(warmUp);
    bad.pieces = bad.pieces.filter((p) => p.type !== 'goal');
    expect(() => parseLevel(bad)).toThrow('expected exactly 1 goal');
  });

  it('rejects medals in the wrong order', () => {
    const bad = { ...structuredClone(warmUp), medals: { gold: 30, silver: 20, bronze: 40 } };
    expect(() => parseLevel(bad)).toThrow('gold <= silver <= bronze');
  });

  it('rejects unknown piece types', () => {
    const bad = structuredClone(warmUp) as { pieces: unknown[] };
    bad.pieces.push({ type: 'lava' });
    expect(() => parseLevel(bad)).toThrow('unknown piece type "lava"');
  });
});

describe('path geometry', () => {
  it('puts the top surface exactly on from/to, including ramps', () => {
    const from: Vec3 = [0, 0, -37], to: Vec3 = [4, -6, -55];
    const level = resolveLevel(parseLevel({
      format: 1, name: 't', start: { position: [0, 1, 0] },
      pieces: [{ type: 'path', from, to, width: 8 }, { type: 'goal', position: [0, 0, 0] }],
    }));
    const floor = level.solids[0];
    if (floor.shape.kind !== 'box') throw new Error('expected box');
    const [, t, len] = floor.shape.size;
    const up = rotate([0, 1, 0], floor.rotation);
    const fwd = rotate([0, 0, 1], floor.rotation);
    const topCenter = add(floor.position, scale(up, t / 2));
    close(add(topCenter, scale(fwd, -len / 2)), from);
    close(add(topCenter, scale(fwd, len / 2)), to);
  });
});

describe('formatLevel', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s round-trips through the saved format', (_name, level) => {
    expect(parseLevel(JSON.parse(formatLevel(level)))).toEqual(level);
  });

  it('puts one piece per line', () => {
    const text = formatLevel(LEVELS[0]);
    const bumpers = LEVELS[0].pieces.filter((p) => p.type === 'bumper').length;
    expect(bumpers).toBeGreaterThan(0);
    expect(text.split('\n').filter((l) => l.includes('"type": "bumper"'))).toHaveLength(bumpers);
  });
});

describe('multiplayer starting grid', () => {
  it.each(LEVELS.map((l) => [l.name, l]))('%s: all 16 grid spots are on the floor and apart', async (_name, data) => {
    const { gridSpot } = await import('../src/sim/geometry');
    const { makeSim } = await import('./helpers');
    const level = resolveLevel(data);
    const spots = Array.from({ length: 16 }, (_, i) => gridSpot(level, i));
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][2] - spots[j][2])).toBeGreaterThan(2.1);
      }
    }
    const sim = await makeSim(data);
    try {
      sim.step({ x: 0, z: 0 }); // collision queries are ready after the first step
      for (const s of spots) expect(sim.floorAt([s[0], s[1] - 1, s[2]]), `spot ${s}`).toBe(true);
    } finally {
      sim.dispose();
    }
  });
});

describe('arenas', () => {
  it.each(ARENAS.map((l) => [l.name, l]))('%s: valid, 16 grid spots and every zone on the floor', async (_name, data) => {
    const { gridSpot } = await import('../src/sim/geometry');
    const { makeSim } = await import('./helpers');
    const level = resolveLevel(data);
    expect(level.kind).toBe('arena');
    expect(level.goal).toBeNull();
    expect(level.zones.length).toBeGreaterThan(0);
    const sim = await makeSim(data);
    try {
      sim.step({ x: 0, z: 0 });
      for (let i = 0; i < 16; i++) {
        const s = gridSpot(level, i);
        expect(sim.floorAt([s[0], s[1] - 1, s[2]]), `grid ${i}`).toBe(true);
        expect(sim.clearAt([s[0], s[1] - 1, s[2]]), `grid ${i} clear of obstacles`).toBe(true);
      }
      for (const z of level.zones) expect(sim.floorAt(z.position), `zone ${z.position}`).toBe(true);
    } finally {
      sim.dispose();
    }
  });

  it('rejects goals in arenas and zones in races', () => {
    expect(() => parseLevel({ format: 1, name: 'x', kind: 'arena', start: { position: [0, 1, 0] }, pieces: [{ type: 'goal', position: [0, 0, 0] }] }))
      .toThrow('an arena has no goal');
    expect(() => parseLevel({ ...structuredClone(warmUp), pieces: [...warmUp.pieces, { type: 'zone', position: [0, 0, 0] }] }))
      .toThrow('zones are for arenas');
  });
});

describe('complex courses and mazes', () => {
  it('has 7 courses per theme, ending with a top-down maze and a downhill course', () => {
    const themes = ['meadow', 'candy', 'ice', 'night'];
    expect(LEVELS).toHaveLength(28);
    themes.forEach((theme, t) => {
      const group = LEVELS.slice(t * 7, t * 7 + 7);
      expect(group.every((l) => (l.theme ?? 'meadow') === theme)).toBe(true);
      expect(group.map((l) => l.camera ?? 'chase')).toEqual(['chase', 'chase', 'chase', 'chase', 'chase', 'topdown', 'chase']);
      expect(courseDrop(group[6])).toBeGreaterThanOrEqual(50); // summit to valley
    });
  });

  it('rejects an unknown camera', () => {
    expect(() => parseLevel({ ...warmUp, camera: 'sideways' })).toThrow(LevelError);
  });

  it('mazes are deterministic, valid, and walled in', () => {
    const opts = { seed: 7, name: 'T', theme: 'night' as const, cols: 6, rows: 7, loops: 3, rooms: 1, bumpers: 2, bridges: 1, holes: 2 };
    let level = null;
    for (let seed = 1; !level && seed < 50; seed++) level = generateMaze({ ...opts, seed });
    if (!level) throw new Error('no maze in 50 seeds');
    expect(parseLevel(JSON.parse(JSON.stringify(level)))).toBeTruthy();
    expect(level.camera).toBe('topdown');
    // Same seed, same maze.
    const seedOf = (s: number) => JSON.stringify(generateMaze({ ...opts, seed: s }));
    expect(seedOf(3)).toBe(seedOf(3));
    // The route stays inside the maze footprint and ends at the goal.
    const goal = level.pieces.find((p) => p.type === 'goal')!;
    expect(level.route!.at(-1)!.p).toEqual(goal.position);
    const blocks = level.pieces.filter((p) => p.type === 'block');
    expect(blocks.length).toBeGreaterThan(10);
  });

  it('generated courses use the new pieces (old flat draw, no acts or stars)', () => {
    const opts = { name: 'T', theme: 'meadow' as const, length: 8, weights: { curve: 1, hairpin: 1, jump: 1, split: 1, stairs: 1, gauntlet: 1 } };
    let level = null;
    for (let seed = 1; !level && seed < 50; seed++) level = generateLevel({ ...opts, seed });
    expect(level).not.toBeNull();
    expect(parseLevel(JSON.parse(JSON.stringify(level)))).toBeTruthy();
    // Curves are angled paths: some path isn't axis-aligned.
    const angled = level!.pieces.some((p) => p.type === 'path' && p.from[0] !== p.to[0] && p.from[2] !== p.to[2]);
    expect(angled).toBe(true);
  });
});

describe('stars', () => {
  it('every race course hides 3 stars, with a star route to collect them', () => {
    for (const level of LEVELS) {
      const stars = level.pieces.filter((p) => p.type === 'star');
      expect(stars, level.name).toHaveLength(3);
      expect(level.starRoute, level.name).toBeDefined();
      expect(JSON.stringify(level.starRoute), level.name).not.toBe(JSON.stringify(level.route)); // it takes other lines
      expect(resolveLevel(level).stars).toHaveLength(3);
    }
  });

  it('validates stars and the star route', () => {
    const base = { format: 1, name: 'S', start: { position: [0, 1, 0] }, pieces: [{ type: 'goal', position: [0, 0, -5] }] };
    expect(parseLevel({ ...base, pieces: [...base.pieces, { type: 'star', position: [0, 1.4, -2] }], starRoute: [{ p: [0, 0, -2] }] })).toBeTruthy();
    expect(() => parseLevel({ ...base, starRoute: [{ p: [0, 0] }] })).toThrow(/starRoute\[0\]\.p/);
    expect(() => parseLevel({ ...base, starRoute: {} })).toThrow(/starRoute/);
    expect(() => parseLevel({ ...ARENAS[0], pieces: [...ARENAS[0].pieces, { type: 'star', position: [0, 1, 0] }] })).toThrow(/stars are for race courses/);
  });

  it('stars come in kinds: some ride a mechanism, some are switch stars', () => {
    const stars = LEVELS.flatMap((l) => l.pieces).filter((p) => p.type === 'star');
    expect(stars.some((p) => p.type === 'star' && (p.to || p.center))).toBe(true);
    expect(stars.some((p) => p.type === 'star' && p.button && p.time)).toBe(true);
    // Riding stars are caught at `catch` points on the star route.
    expect(LEVELS.some((l) => l.starRoute?.some((wp) => wp.catch))).toBe(true);
  });

  it('stars can be left out (multiplayer)', async () => {
    const { withoutStars } = await import('../src/levels');
    const plain = withoutStars(LEVELS[0]);
    expect(plain.pieces.some((p) => p.type === 'star')).toBe(false);
    expect(plain.starRoute).toBeUndefined();
    expect(LEVELS[0].pieces.some((p) => p.type === 'star')).toBe(true); // the original is untouched
  });
});

describe('paced courses', () => {
  const generate = (opts: Omit<GenOptions, 'seed'>) => {
    for (let seed = 1; seed < 60; seed++) {
      const plan: { seg: Segment; act: Act; d: number; star?: StarKind }[] = [];
      const level = generateLevel({ ...opts, seed, onSegment: (seg, act, d, star) => plan.push({ seg, act, d, star }) });
      if (level) return { level, plan };
    }
    throw new Error('no course in 60 seeds');
  };
  const paced: Omit<GenOptions, 'seed'> = {
    name: 'T', theme: 'meadow', length: 12, stars: 3,
    weights: { bridge: 2, curve: 1, straight: 1 },
    acts: { intro: ['bridge'], twist: ['windCrumble'], finale: ['bridge'] },
  };

  it('runs intro → build-up → twist → finale, getting harder', () => {
    const { plan } = generate(paced);
    const acts = plan.filter((p) => p.seg !== 'starSpur').map((p) => p.act);
    expect(acts[0]).toBe('intro');
    expect(acts.at(-1)).toBe('finale');
    expect(acts).toEqual([...acts].sort((a, b) => ['intro', 'build', 'twist', 'finale'].indexOf(a) - ['intro', 'build', 'twist', 'finale'].indexOf(b)));
    expect(plan[0]).toMatchObject({ seg: 'bridge', d: 0 }); // the signature mechanic, gently
    expect(plan.at(-1)).toMatchObject({ seg: 'bridge', d: 1 }); // and at its hardest
    expect(plan.find((p) => p.act === 'twist')!.seg).toBe('fork');
    // Breathers: never three hard segments in a row before the finale.
    const calm = new Set(['straight', 'curve', 'turn']);
    const beforeFinale = plan.filter((p) => p.act !== 'finale' && p.seg !== 'starSpur');
    for (let i = 2; i < beforeFinale.length; i++) {
      expect(calm.has(beforeFinale[i].seg) || calm.has(beforeFinale[i - 1].seg) || calm.has(beforeFinale[i - 2].seg)).toBe(true);
    }
  });

  it('narrows bridges as the course goes on', () => {
    const { level } = generate(paced);
    // Plain bridges: orange paths with no rails that aren't a fork's risky beam.
    const bridges = level.pieces.filter((p) => p.type === 'path' && p.palette === 'orange' && !p.rails && !p.open);
    expect(bridges.length).toBeGreaterThanOrEqual(2);
    const width = (p: (typeof bridges)[number]) => (p.type === 'path' ? p.width : 0);
    expect(width(bridges[0])).toBeGreaterThan(width(bridges.at(-1)!));
  });

  it('forks give a risky line with no safety walls and a star; the star route takes it', () => {
    const { level } = generate(paced);
    expect(level.pieces.filter((p) => p.type === 'star')).toHaveLength(3);
    expect(level.pieces.some((p) => (p.type === 'path' || p.type === 'crumble') && p.open)).toBe(true);
    expect(level.starRoute).toBeDefined();
    expect(JSON.stringify(level.starRoute)).not.toBe(JSON.stringify(level.route));
    expect(parseLevel(JSON.parse(JSON.stringify(level)))).toBeTruthy();
    // Same seed, same course.
    const again = generateLevel({ ...paced, seed: 1 }), once = generateLevel({ ...paced, seed: 1 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
  });

  it('stars use the course\'s mechanics first, and never the same kind twice', () => {
    for (const opts of [paced, { ...paced, weights: { springUp: 2, lift: 2, curve: 1 }, acts: { intro: ['springUp'], twist: ['liftWind'], finale: ['springUp'] } } as typeof paced]) {
      const { plan } = generate(opts);
      const kinds = plan.flatMap((p) => (p.star ? [p.star] : []));
      expect(kinds).toHaveLength(3);
      const special = kinds.filter((k) => k !== 'spur');
      expect(new Set(special).size).toBe(special.length);
      // The first star is on the signature mechanic, in the intro.
      expect(plan.find((p) => p.star)).toMatchObject({ act: 'intro', seg: opts.acts!.intro[0] });
    }
  });

  it('mazes hide stars at the ends of side branches', () => {
    const opts = { name: 'T', theme: 'meadow' as const, cols: 7, rows: 8, loops: 3, stars: 3 };
    let level = null;
    for (let seed = 1; !level && seed < 80; seed++) level = generateMaze({ ...opts, seed });
    if (!level) throw new Error('no maze in 80 seeds');
    expect(level.pieces.filter((p) => p.type === 'star')).toHaveLength(3);
    expect(level.starRoute!.length).toBeGreaterThan(level.route!.length);
    expect(level.starRoute!.at(-1)).toEqual(level.route!.at(-1)); // both end at the goal
    // The farthest one is a switch star, its button at the junction on the way through.
    const timed = level.pieces.filter((p) => p.type === 'star' && p.button);
    expect(timed).toHaveLength(1);
  });
});
