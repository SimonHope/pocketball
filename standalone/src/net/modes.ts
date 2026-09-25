import type { LevelKind } from '../levels/schema';
import type { Vec3 } from '../sim/math';

// Party-mode rules as pure functions (the room calls these; tests check them directly).

export const GAME_MODES = ['race', 'elimination', 'hill', 'arena'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const MODE_INFO: Record<GameMode, { label: string; kind: LevelKind; blurb: string }> = {
  race: { label: 'Race', kind: 'race', blurb: 'First to the goal wins.' },
  elimination: { label: 'Elimination', kind: 'race', blurb: 'Back-to-back races — the slowest drop out each round.' },
  hill: { label: 'King of the Hill', kind: 'arena', blurb: 'Score while you\'re alone in the glowing zone. Bump others out!' },
  arena: { label: 'Bumper Arena', kind: 'arena', blurb: 'Knock everyone off. Last hamster standing wins.' },
};

export const HILL_MS = 90_000;        // King of the Hill round length
export const HILL_ZONE_MS = 20_000;   // the zone moves this often
export const ARENA_MS = 90_000;       // Bumper Arena time limit
export const ROUND_BREAK_MS = 5_000;  // Elimination: pause between rounds
export const ARENA_OUT_DEPTH = 6;     // below the arena floor by this much = out

export function isGameMode(v: unknown): v is GameMode {
  return typeof v === 'string' && (GAME_MODES as readonly string[]).includes(v);
}

/** Elimination: how many drop out this round (a quarter, at least 1, never everyone). */
export function eliminationCount(active: number): number {
  if (active <= 1) return 0;
  return Math.min(active - 1, Math.max(1, Math.ceil(active * 0.25)));
}

/** King of the Hill: who scores this tick — the only racer inside the zone, or nobody if it's contested. */
export function hillScorer(zone: { position: Vec3; radius: number }, players: { id: string; position: Vec3 }[]): string | null {
  const inside = players.filter((p) =>
    Math.hypot(p.position[0] - zone.position[0], p.position[2] - zone.position[2]) < zone.radius
    && Math.abs(p.position[1] - 1 - zone.position[1]) < 2.5);
  return inside.length === 1 ? inside[0].id : null;
}

export interface Standing {
  id: string;
  finishTime: number;  // race-type modes
  progress: number;
  dnf: boolean;
  score: number;       // King of the Hill seconds
  out: boolean;        // eliminated / knocked out
  outOrder: number;    // when they went out (higher = later = better)
}

/** Final (or live) placing order for a mode. */
export function rankForMode(mode: GameMode, s: Standing[]): string[] {
  const byRace = (a: Standing, b: Standing) => {
    const af = a.finishTime >= 0, bf = b.finishTime >= 0;
    if (af !== bf) return af ? -1 : 1;
    if (af && bf) return a.finishTime - b.finishTime;
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    return b.progress - a.progress;
  };
  const byOut = (a: Standing, b: Standing) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    return b.outOrder - a.outOrder;
  };
  const sorted = [...s].sort((a, b) => {
    switch (mode) {
      case 'race': return byRace(a, b);
      case 'elimination': return byOut(a, b) || byRace(a, b);
      case 'hill': return b.score - a.score;
      case 'arena': return byOut(a, b);
    }
  });
  return sorted.map((p) => p.id);
}
