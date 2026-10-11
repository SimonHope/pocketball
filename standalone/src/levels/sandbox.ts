import { generateLevel, SEGMENT_NAMES, type Segment } from './generator';
import { addSafetyWalls } from './guard';
import type { LevelData } from './schema';
import { THEME_NAMES, type ThemeName } from './themes';

// The mechanic sandbox: `?sandbox=<segment>` plays a short course of just that segment, so a new
// mechanic can be tried on its own before it goes into any course (see MECHANICS.md).
// Options: `d` difficulty 0–1 (default 0.5), `seed`, `star` (hide its star), `theme`.
// Needs initPhysics() first (safety walls ask the physics world about edges).

export interface SandboxOptions {
  segment: Segment;
  d: number;
  seed: number;
  star: boolean;
  theme: ThemeName;
}

export function parseSandbox(search: string): SandboxOptions | null {
  const q = new URLSearchParams(search);
  const segment = q.get('sandbox') as Segment | null;
  if (!segment) return null;
  if (!SEGMENT_NAMES.includes(segment)) throw new Error(`Unknown segment "${segment}". Try one of: ${SEGMENT_NAMES.join(', ')}`);
  const d = Number(q.get('d') ?? 0.5), seed = Math.floor(Number(q.get('seed') ?? 1));
  const theme = (q.get('theme') ?? 'meadow') as ThemeName;
  return {
    segment,
    d: Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0.5,
    seed: Number.isFinite(seed) ? seed : 1,
    star: q.has('star'),
    theme: THEME_NAMES.includes(theme) ? theme : 'meadow',
  };
}

/** The sandbox's URL query for `o` (for the reroll and difficulty links). */
export function sandboxQuery(o: SandboxOptions): string {
  const q = new URLSearchParams({ sandbox: o.segment, d: String(Math.round(o.d * 100) / 100), seed: String(o.seed) });
  if (o.star) q.set('star', '');
  if (o.theme !== 'meadow') q.set('theme', o.theme);
  return `?${q.toString().replace('star=', 'star')}`;
}

/** Three of the segment with straights between, from the first seed (at or after `o.seed`) that fits. */
export function sandboxLevel(o: SandboxOptions): { level: LevelData; seed: number } {
  for (let seed = o.seed; seed < o.seed + 50; seed++) {
    const raw = generateLevel({
      seed, name: `Sandbox: ${o.segment}`, theme: o.theme, length: 3, difficulty: o.d,
      weights: { [o.segment]: 3, straight: 1 }, stars: o.star ? 1 : 0,
    });
    if (raw) return { level: addSafetyWalls(raw), seed };
  }
  throw new Error(`Couldn't fit "${o.segment}" into a sandbox course`);
}
