import type { GameMode } from '../net/modes';

// XP, levels and rewards. Pure functions shared by the server (which grants rewards) and
// the client (which shows them). Tuning lives here.

/** XP needed to go from level n to n+1. */
export const xpForLevel = (n: number) => 100 + 50 * (n - 1);

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1, left = Math.max(0, Math.floor(xp));
  while (left >= xpForLevel(level)) { left -= xpForLevel(level); level++; }
  return { level, into: left, needed: xpForLevel(level) };
}

export type Medal = 'gold' | 'silver' | 'bronze';
const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };
const MEDAL_XP: Record<Medal, number> = { bronze: 25, silver: 40, gold: 60 };

export interface Reward { xp: number; coins: number; reasons: string[] }

/** A validated solo finish. Medal bonuses pay once per tier per course. */
export function soloReward(opts: { firstFinish: boolean; medal: Medal | null; previousMedal: Medal | null }): Reward {
  const r: Reward = { xp: 5, coins: 3, reasons: ['Finished'] };
  if (opts.firstFinish) { r.xp += 50; r.coins += 20; r.reasons.push('First finish on this course'); }
  const before = opts.previousMedal ? MEDAL_RANK[opts.previousMedal] : 0;
  const now = opts.medal ? MEDAL_RANK[opts.medal] : 0;
  for (const m of ['bronze', 'silver', 'gold'] as Medal[]) {
    if (MEDAL_RANK[m] > before && MEDAL_RANK[m] <= now) {
      r.xp += MEDAL_XP[m];
      r.coins += Math.round(MEDAL_XP[m] / 2);
      r.reasons.push(`New ${m} medal`);
    }
  }
  return r;
}

/** A finished multiplayer game: showing up pays, placing well pays more. */
export function matchReward(opts: { mode: GameMode; place: number; players: number }): Reward {
  const { place, players } = opts;
  const beaten = Math.max(0, players - place);
  const r: Reward = { xp: 15 + beaten * 5, coins: 5 + beaten * 2, reasons: [`Placed ${place} of ${players}`] };
  if (place === 1 && players > 1) { r.xp += 20; r.coins += 10; r.reasons.push('Win!'); }
  return r;
}

export const CHALLENGE_REWARD: Reward = { xp: 30, coins: 40, reasons: ['Daily challenge'] };
export const AD_DOUBLES_PER_DAY = 5;
