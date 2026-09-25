import { rng } from '../levels/generator';
import type { ThemeName } from '../levels/themes';
import type { GameMode } from '../net/modes';
import type { Medal } from './progression';

// Daily challenges: 3 a day, the same for everyone (picked from the UTC date), tracked on the server.

export type GameEvent =
  | { type: 'solo'; medal: Medal | null; theme: ThemeName; falls: number }
  | { type: 'match'; mode: GameMode; quick: boolean; place: number; players: number; finished: boolean; survived: boolean; reachedFinal: boolean };

export interface ChallengeDef {
  id: string;
  label: string;
  target: number;
  /** How much this event advances the challenge (0 = not at all). */
  count(e: GameEvent): number;
}

const finishedRace = (e: GameEvent) => e.type === 'solo' || (e.type === 'match' && (e.mode === 'race' || e.mode === 'elimination') && e.finished);

export const CHALLENGES: ChallengeDef[] = [
  { id: 'finish3', label: 'Finish 3 races', target: 3, count: (e) => (finishedRace(e) ? 1 : 0) },
  { id: 'gold', label: 'Win a gold medal', target: 1, count: (e) => (e.type === 'solo' && e.medal === 'gold' ? 1 : 0) },
  { id: 'medals3', label: 'Earn 3 medals (any)', target: 3, count: (e) => (e.type === 'solo' && e.medal ? 1 : 0) },
  { id: 'quick2', label: 'Play 2 Quick Play games', target: 2, count: (e) => (e.type === 'match' && e.quick ? 1 : 0) },
  { id: 'podium', label: 'Finish top 3 in a multiplayer game', target: 1, count: (e) => (e.type === 'match' && e.players > 1 && e.place <= 3 ? 1 : 0) },
  { id: 'hill', label: 'Win King of the Hill', target: 1, count: (e) => (e.type === 'match' && e.mode === 'hill' && e.place === 1 && e.players > 1 ? 1 : 0) },
  { id: 'arena', label: 'Survive a Bumper Arena', target: 1, count: (e) => (e.type === 'match' && e.mode === 'arena' && e.survived ? 1 : 0) },
  { id: 'final', label: 'Reach the final round of Elimination', target: 1, count: (e) => (e.type === 'match' && e.mode === 'elimination' && e.reachedFinal ? 1 : 0) },
  { id: 'ice', label: 'Finish an Ice course', target: 1, count: (e) => (e.type === 'solo' && e.theme === 'ice' ? 1 : 0) },
  { id: 'clean', label: 'Finish a course without falling', target: 1, count: (e) => (e.type === 'solo' && e.falls === 0 ? 1 : 0) },
];

/** 'YYYY-MM-DD' in UTC. */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's three challenges (same for every player). */
export function dailyChallenges(day: string): ChallengeDef[] {
  const rand = rng(Number(day.replaceAll('-', '')));
  const pool = [...CHALLENGES];
  const picked: ChallengeDef[] = [];
  while (picked.length < 3) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return picked;
}
