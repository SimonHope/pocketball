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
