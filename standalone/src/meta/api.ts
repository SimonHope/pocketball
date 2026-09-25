import type { Look } from '../cosmetics';
import type { Medal, Reward } from './progression';

// Shapes exchanged between the game and the account API (/api/...).

export interface Profile {
  id: string;
  name: string;
  xp: number;
  level: number;
  levelXp: number;        // XP into the current level
  levelXpNeeded: number;  // XP needed for the next level
  coins: number;
  bought: string[];       // 'hat:cap', ...
  look: Look;             // equipped (always owned)
  bests: Record<string, { time: number; medal: Medal | null }>;
  challenges: { id: string; label: string; target: number; progress: number; done: boolean }[];
  adDoublesLeft: number;
}

/** A reward that was actually paid out. */
export interface Granted extends Reward {
  claimId: string;
  levelUp: { from: number; to: number; unlocked: string[] } | null;
}

export interface SoloResult {
  time: number;           // as worked out by the server
  medal: Medal | null;
  isBest: boolean;
  rank: number | null;    // on this course's leaderboard
  granted: Granted;
  challenges: Granted[];
}

export interface LeaderboardEntry { rank: number; name: string; time: number; me: boolean }
export interface Leaderboard { top: LeaderboardEntry[]; me: { rank: number; time: number } | null }

/** Sent by the room to each signed-in player when a game ends. */
export interface MatchRewards { granted: Granted | null; challenges: Granted[] }
