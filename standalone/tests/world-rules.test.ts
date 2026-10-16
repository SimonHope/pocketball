import { describe, expect, it } from 'vitest';
import { parseLevel, type LevelData } from '../src/levels/schema';
import { gravityOf, gustAt, THEMES, type ThemeName } from '../src/levels/themes';
import { SIM } from '../src/config';
import { makeSim, run, skipCountdown, teleport } from './helpers';

// Each world's one physics rule (DESIGN.md → Worlds): meadow gusts, candy bounce, ice grip,
// night's lighter gravity. A flat floor in each theme, and a ball dropped onto it.

function floor(theme: ThemeName, ...extra: LevelData['pieces']): LevelData {
  return parseLevel({
    format: 1,
    name: 'World rules',
    theme,
    start: { position: [0, 1, 0] },
    pieces: [{ type: 'pad', center: [0, 0, -20], w: 60, d: 60 }, { type: 'goal', position: [0, 0, -45] }, ...extra],
  });
}

/** Drops the ball from `height` above the floor: how long it takes to land, and how high it bounces back. */
async function drop(theme: ThemeName, height: number) {
  const sim = await makeSim(floor(theme));
  skipCountdown(sim);
  teleport(sim, [0, 1 + height, -10]);
  let landed = 0, bounce = 0;
  for (let t = 0; t < 3; t += SIM.dt) {
    sim.step({ x: 0, z: 0 });
    const y = sim.position()[1] - 1;
    if (!landed && y < 0.05) landed = t;
    if (landed) bounce = Math.max(bounce, y);
  }
  sim.dispose();
  return { landed, bounce };
}

describe('world rules', () => {
  it('only meadow gusts: its wind swells and eases on the clock, between `low` and full', () => {
    const { period, low } = THEMES.meadow.gust!;
    const samples = Array.from({ length: 81 }, (_, i) => gustAt('meadow', (i / 80) * period));
    expect(Math.min(...samples)).toBeCloseTo(low, 5);
    expect(Math.max(...samples)).toBeCloseTo(1, 5);
    expect(gustAt('meadow', 1.3)).toBeCloseTo(gustAt('meadow', 1.3 + period), 9); // the same for everyone, every cycle
    for (const theme of ['candy', 'ice', 'night'] as const) expect(gustAt(theme, 1.3)).toBe(1);
  });

  it('meadow crosswinds push harder at the height of a gust than in a lull', async () => {
    const { period } = THEMES.meadow.gust!;
    const pushed = async (from: number) => {
      const sim = await makeSim(floor('meadow', { type: 'wind', center: [0, 2, -10], size: [40, 6, 40], dir: [1, 0, 0], speed: 30, strength: 12 }));
      skipCountdown(sim);
      run(sim, from - (sim.time % period) + (sim.time % period > from ? period : 0)); // to that point in the cycle
      teleport(sim, [0, 1.2, -10]);
      run(sim, 0.4);
      const x = sim.position()[0];
      sim.dispose();
      return x;
    };
    expect(await pushed(period / 2 - 0.2)).toBeGreaterThan((await pushed(period - 0.2)) * 1.3);
  });

  it('candy floors bounce a dropped ball back up higher', async () => {
    const meadow = await drop('meadow', 6), candy = await drop('candy', 6);
    expect(candy.bounce).toBeGreaterThan(meadow.bounce * 2);
    expect(candy.bounce).toBeLessThan(2); // a hop, not a trampoline
  });

  it('night has lighter gravity: a drop takes longer', async () => {
    expect(gravityOf('night')).toBeCloseTo(SIM.gravity * 0.85, 5);
    expect(gravityOf('meadow')).toBe(SIM.gravity);
    const meadow = await drop('meadow', 6), night = await drop('night', 6);
    expect(night.landed / meadow.landed).toBeCloseTo(Math.sqrt(1 / 0.85), 1);
  });

  it('every world has a tagline for the level select', () => {
    for (const theme of Object.values(THEMES)) expect(theme.tagline.length).toBeGreaterThan(0);
  });
});
