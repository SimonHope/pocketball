import type { Medals } from '../levels/schema';
import { load, save } from './storage';

// Best times per level, persisted in localStorage. (Moves to cloud saves in M4.)

export type Medal = 'gold' | 'silver' | 'bronze';

export function medalFor(time: number | null, medals?: Medals): Medal | null {
  if (time === null || !medals) return null;
  if (time <= medals.gold) return 'gold';
  if (time <= medals.silver) return 'silver';
  if (time <= medals.bronze) return 'bronze';
  return null;
}

const key = (levelName: string) => `hamball.best.${levelName}`;

export function bestTime(levelName: string): number | null {
  const v = Number(load(key(levelName)));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Saves `time` if it beats the stored best. Returns whether it did. */
export function recordTime(levelName: string, time: number): boolean {
  const best = bestTime(levelName);
  if (best !== null && best <= time) return false;
  save(key(levelName), String(time));
  return true;
}

// Stars found on each course: the indices of the level's stars collected in finished runs,
// added up across runs.
const starKey = (levelName: string) => `hamball.stars.${levelName}`;

export function starsFound(levelName: string): Set<number> {
  try {
    const v: unknown = JSON.parse(load(starKey(levelName)) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);
  } catch {
    return new Set();
  }
}

/** Adds the stars collected in a finished run. Returns the ones that are new. */
export function recordStars(levelName: string, collected: boolean[]): number[] {
  const found = starsFound(levelName);
  const fresh = collected.flatMap((got, i) => (got && !found.has(i) ? [i] : []));
  if (fresh.length) save(starKey(levelName), JSON.stringify([...found, ...fresh].sort((a, b) => a - b)));
  return fresh;
}
