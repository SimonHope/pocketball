import { schema, t, type SchemaType } from '@colyseus/schema';

// Everything client and server agree on: room state (synced automatically by Colyseus),
// message names and payloads, and timing constants.

export const ROOM_NAME = 'race';         // private rooms, joined by code
export const QUICK_ROOM = 'quick';       // public Quick Play rooms, joined by matchmaking
export const QUICK_LOBBY_MS = 15_000;    // Quick Play: race starts this long after the first player joins
export const QUICK_FULL_HUMANS = 8;      // …or 3 s after this many humans are in
export const QUICK_FILL = 8;             // bots fill the grid up to this many racers
export const QUICK_RESULTS_MS = 8_000;   // results stay up this long before the next lobby
export const MAX_PLAYERS = 16;
export const SEND_HZ = 20;                 // client → server ball updates per second
export const PATCH_MS = 50;                // server → clients state patches (20 Hz)
export const COUNTDOWN_MS = 4000;          // host presses Start → GO
export const FINISH_GRACE_MS = 45_000;     // after the first finisher, others have this long
export const MAX_RACE_MS = 5 * 60_000;     // hard cap on a race
export const RECONNECT_SECONDS = 20;       // a dropped player keeps their seat this long
export const INTERP_DELAY_MS = 100;        // other balls are drawn this far in the past
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export const CODE_LENGTH = 6;

export type Phase = 'lobby' | 'countdown' | 'racing' | 'results';

export const PlayerState = schema({
  name: t.string().default(''),
  color: t.uint8().default(0),         // slot index into PLAYER_COLORS
  ready: t.boolean().default(false),
  connected: t.boolean().default(true),
  spectator: t.boolean().default(false), // joined mid-race; races next time
  slot: t.uint8().default(0),          // starting-grid spot for the current race
  bot: t.boolean().default(false),     // server-run bot (Quick Play)
  // Cosmetics: indices into src/cosmetics.ts
  skin: t.uint8().default(0),
  hat: t.uint8().default(0),
  fur: t.uint8().default(0),
  trail: t.uint8().default(0),
  score: t.float32().default(0),       // King of the Hill: seconds alone in the zone
  out: t.boolean().default(false),     // Elimination / Bumper Arena: out of this game
  outOrder: t.uint8().default(0),      // when they went out (higher = later)
  outRound: t.uint8().default(0),      // Elimination: the round they went out in
  // Ball, as last reported by the player (t = server clock ms when sampled).
  t: t.float64().default(0),
  x: t.float32().default(0), y: t.float32().default(0), z: t.float32().default(0),
  vx: t.float32().default(0), vy: t.float32().default(0), vz: t.float32().default(0),
  progress: t.float32().default(0),    // distance along the level route (for live placing)
  place: t.uint8().default(0),
  finishTime: t.float32().default(-1), // seconds, -1 = not finished
  dnf: t.boolean().default(false),
  strikes: t.uint8().default(0),       // rejected (implausible) updates
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

export const RaceState = schema({
  phase: t.string().default('lobby'),
  code: t.string().default(''),
  hostId: t.string().default(''),
  level: t.uint8().default(0),
  startAt: t.float64().default(0),     // server clock ms of GO
  endAt: t.float64().default(0),       // server clock ms when the race will be cut off
  quick: t.boolean().default(false),   // Quick Play room (no host; starts by itself)
  mode: t.string().default('race'),    // GameMode (src/net/modes.ts)
  round: t.uint8().default(0),         // Elimination round (1-based)
  final: t.boolean().default(true),    // results are final (Elimination shows between-round results too)
  modeEndAt: t.float64().default(0),   // King of the Hill / Bumper Arena: server clock ms the game ends
  activeZone: t.int8().default(-1),    // King of the Hill: index into the arena's zones
  zoneMoveAt: t.float64().default(0),  // King of the Hill: when the zone moves next
  autoStartAt: t.float64().default(0), // Quick Play: server clock ms the next race starts (0 = waiting)
  players: t.map(PlayerState),
}, 'RaceState');
export type RaceState = SchemaType<typeof RaceState>;

// ---------- Messages ----------

/** Client → server, SEND_HZ times a second while racing. */
export interface BallUpdate {
  t: number;   // server-clock ms when sampled
  p: [number, number, number];
  v: [number, number, number];
}

export interface Ping { id: number }
export interface Pong { id: number; now: number }

export const MSG = {
  state: 'state',       // BallUpdate
  ready: 'ready',       // { ready: boolean }
  level: 'level',       // { index: number } (host, lobby)
  mode: 'mode',         // { mode: GameMode } (host, lobby)
  start: 'start',       // (host, lobby, everyone ready)
  toLobby: 'toLobby',   // (host, results)
  rename: 'rename',     // { name } — must be a generated name
  look: 'look',         // Look (src/cosmetics.ts), validated by the server
  rewards: 'rewards',   // server → signed-in player at game end: MatchRewards (src/meta/api.ts)
  notice: 'notice',     // server → everyone: { text } (e.g. restarting after this game)
  ping: 'ping',         // Ping → 'pong' Pong
  pong: 'pong',
} as const;

export const PLAYER_COLORS = [
  '#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#20c997', '#f06595',
  '#94d82d', '#339af0', '#e8590c', '#845ef7', '#22b8cf', '#fab005', '#e64980', '#adb5bd',
];
