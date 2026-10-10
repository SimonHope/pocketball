import type { Vec3 } from '../sim/math';
import { THEME_NAMES, type ThemeName } from './themes';

// Level file format (JSON). Pieces are simple primitives so they map 1:1 to Roblox Parts later.
// All positions are [x, y, z]; the course conventionally runs toward -z; the ball radius is 1.

/** Safety walls (guard.ts) use this exact colour, so they can be found and rebuilt. */
export const GUARD_COLOR = '#eef1f6';

export const PALETTES = ['blue', 'green', 'orange', 'purple', 'grey'] as const;
export type Palette = (typeof PALETTES)[number];

export interface PadPiece {
  type: 'pad';
  center: Vec3; // middle of the top surface
  w: number;
  d: number;
  thickness?: number;
  palette?: Palette;
  /** No safety walls (guard.ts): a risky line, meant to be fallen off. */
  open?: boolean;
}

export interface PathPiece {
  type: 'path';
  from: Vec3; // top-surface centerline start
  to: Vec3;   // top-surface centerline end
  width: number;
  thickness?: number;
  palette?: Palette;
  rails?: boolean;
  /** No safety walls (guard.ts): a risky line, meant to be fallen off. */
  open?: boolean;
}

export interface BlockPiece {
  type: 'block';
  position: Vec3; // box center
  size: Vec3;
  yaw?: number;   // degrees
  color?: string;
}

export interface BumperPiece {
  type: 'bumper';
  position: Vec3; // base center (on the floor)
  radius?: number;
  height?: number;
}

export interface SweeperPiece {
  type: 'sweeper';
  position: Vec3; // floor point under the pivot
  length: number;
  speed: number;  // radians/second, positive = counter-clockwise seen from above
}

export interface MoverPiece {
  type: 'mover';
  from: Vec3;     // top-surface center at one end
  to: Vec3;       // top-surface center at the other end
  w: number;
  d: number;
  period: number; // seconds for a full back-and-forth
  palette?: Palette;
}

export interface CheckpointPiece {
  type: 'checkpoint';
  position: Vec3; // floor point
  yaw?: number;   // camera yaw (degrees) after respawning here
}

export interface GoalPiece {
  type: 'goal';
  position: Vec3; // floor point
  radius?: number;
}

/** Arena hill zone (King of the Hill). The active zone moves between a level's zones. */
export interface ZonePiece {
  type: 'zone';
  position: Vec3; // floor point
  radius?: number;
}

/** Speed strip on the floor: rolling over it shoots you along `yaw` (0 = toward -z). */
export interface BoostPiece {
  type: 'boost';
  position: Vec3; // floor point at its center
  yaw?: number;   // degrees
  w?: number;     // across (default 4)
  d?: number;     // along (default 3)
  speed?: number; // default 30
}

/** Launch pad: rolling onto it throws you up at `power`, and forward along `yaw` at `push` if set. */
export interface SpringPiece {
  type: 'spring';
  position: Vec3; // floor point
  radius?: number; // default 1.6
  power?: number;  // upward speed (default 16)
  yaw?: number;    // degrees
  push?: number;   // forward speed along yaw; unset keeps your own
}

/** A moving belt floor that carries you from `from` toward `to` (or fights you, the other way). */
export interface ConveyorPiece {
  type: 'conveyor';
  from: Vec3;
  to: Vec3;
  width: number;
  speed?: number; // default 12
  rails?: boolean;
  /** No safety walls (a risky line). */
  open?: boolean;
}

/** A floor tile that gives way `delay` s after you touch it, and comes back `respawn` s later. */
export interface CrumblePiece {
  type: 'crumble';
  center: Vec3; // middle of the top surface
  w: number;
  d: number;
  delay?: number;   // default 0.6
  respawn?: number; // default 4
  /** No safety walls (guard.ts). */
  open?: boolean;
}

/** Wind inside a box: pushes balls along `dir` up to `speed` (updrafts, crosswinds). */
export interface WindPiece {
  type: 'wind';
  center: Vec3; // box center
  size: Vec3;
  dir: Vec3;
  speed?: number;    // default 9
  strength?: number; // acceleration, default 50 (gravity is 25)
}

/** Low gravity inside a box. */
export interface LowGravPiece {
  type: 'lowgrav';
  center: Vec3; // box center
  size: Vec3;
  scale?: number; // fraction of normal gravity, default 0.35
}

/**
 * A collectible star (race courses: 3, off the safe line). Not solid; touching it collects it.
 * A star can ride a mechanism (slide like a mover, or circle like a sweeper arm's tip), or be a
 * switch star: hidden until you roll over its button, then there for `time` seconds.
 */
export interface StarPiece {
  type: 'star';
  position: Vec3; // the star's centre at t = 0 (floor + about 1.5 for one sitting on the floor)
  /** Slides to `to` and back every `period` seconds, eased exactly like a mover. */
  to?: Vec3;
  period?: number;
  /** Circles `center` about +Y at `speed` rad/s, like a sweeper arm. */
  center?: Vec3;
  speed?: number;
  /** A floor switch (floor point): the star shows for `time` seconds (default 6) after it's pressed. */
  button?: Vec3;
  time?: number;
}

export type Piece =
  | PadPiece | PathPiece | BlockPiece | BumperPiece | SweeperPiece | MoverPiece | CheckpointPiece | GoalPiece | ZonePiece
  | BoostPiece | SpringPiece | ConveyorPiece | CrumblePiece | WindPiece | LowGravPiece | StarPiece;

/** Race courses have a goal and a route; arenas (party modes) have hill zones instead. */
export type LevelKind = 'race' | 'arena';

/** A waypoint for bots and automated tests. `wait` = hold until there is floor under `p`. */
export interface RoutePoint {
  p: Vec3;
  wait?: boolean;
  /** Hold here until a star is collected (riding stars come to you). */
  catch?: boolean;
  speed?: number;
  /** Max sideways offset bots may take here (0 = tight spot: racing line only). */
  lane?: number;
}

/** Target times in seconds; beating a time earns that medal. */
export interface Medals {
  gold: number;
  silver: number;
  bronze: number;
}

/** Camera a course starts in. Mazes are built to be seen from above. */
export type LevelCamera = 'chase' | 'topdown';

export interface LevelData {
  format: 1;
  name: string;
  /** Default: chase (the player's own camera setting). */
  camera?: LevelCamera;
  /** World look and floor grip (see themes.ts). Default: meadow. */
  theme?: ThemeName;
  /** Default: race. */
  kind?: LevelKind;
  medals?: Medals;
  start: { position: Vec3; yaw?: number };
  pieces: Piece[];
  route?: RoutePoint[];
  /** A second bot route that collects every star (taking the risky lines). For tests and the editor. */
  starRoute?: RoutePoint[];
}

// ---------- Validation ----------

export class LevelError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new LevelError(`${path}: ${msg}`);
}
function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Obj;
}
function num(o: Obj, key: string, path: string, optional = false): number | undefined {
  const v = o[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'expected a number');
  return v;
}
function positive(o: Obj, key: string, path: string, optional = false) {
  const v = num(o, key, path, optional);
  if (v !== undefined && v <= 0) fail(`${path}.${key}`, 'must be > 0');
}
function vec3(o: Obj, key: string, path: string) {
  const v = o[key];
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail(`${path}.${key}`, 'expected [x, y, z]');
  }
}
function palette(o: Obj, path: string) {
  if (o.palette !== undefined && !PALETTES.includes(o.palette as Palette)) {
    fail(`${path}.palette`, `expected one of ${PALETTES.join(', ')}`);
  }
}
function bool(o: Obj, key: string, path: string) {
  if (o[key] !== undefined && typeof o[key] !== 'boolean') fail(`${path}.${key}`, 'expected true/false');
}

const pieceValidators: Record<Piece['type'], (o: Obj, path: string) => void> = {
  pad(o, p) { vec3(o, 'center', p); positive(o, 'w', p); positive(o, 'd', p); positive(o, 'thickness', p, true); palette(o, p); bool(o, 'open', p); },
  path(o, p) {
    vec3(o, 'from', p); vec3(o, 'to', p); positive(o, 'width', p); positive(o, 'thickness', p, true);
    palette(o, p); bool(o, 'rails', p); bool(o, 'open', p);
  },
  block(o, p) {
    vec3(o, 'position', p); vec3(o, 'size', p); num(o, 'yaw', p, true);
    if (o.color !== undefined && typeof o.color !== 'string') fail(`${p}.color`, 'expected a string');
  },
  bumper(o, p) { vec3(o, 'position', p); positive(o, 'radius', p, true); positive(o, 'height', p, true); },
  sweeper(o, p) { vec3(o, 'position', p); positive(o, 'length', p); num(o, 'speed', p); },
  mover(o, p) {
    vec3(o, 'from', p); vec3(o, 'to', p); positive(o, 'w', p); positive(o, 'd', p); positive(o, 'period', p);
    palette(o, p);
  },
  checkpoint(o, p) { vec3(o, 'position', p); num(o, 'yaw', p, true); },
  goal(o, p) { vec3(o, 'position', p); positive(o, 'radius', p, true); },
  zone(o, p) { vec3(o, 'position', p); positive(o, 'radius', p, true); },
  boost(o, p) { vec3(o, 'position', p); num(o, 'yaw', p, true); positive(o, 'w', p, true); positive(o, 'd', p, true); positive(o, 'speed', p, true); },
  spring(o, p) {
    vec3(o, 'position', p); positive(o, 'radius', p, true); positive(o, 'power', p, true); num(o, 'yaw', p, true); num(o, 'push', p, true);
  },
  conveyor(o, p) { vec3(o, 'from', p); vec3(o, 'to', p); positive(o, 'width', p); num(o, 'speed', p, true); bool(o, 'rails', p); bool(o, 'open', p); },
  crumble(o, p) { vec3(o, 'center', p); positive(o, 'w', p); positive(o, 'd', p); positive(o, 'delay', p, true); positive(o, 'respawn', p, true); bool(o, 'open', p); },
  wind(o, p) {
    vec3(o, 'center', p); vec3(o, 'size', p); vec3(o, 'dir', p); positive(o, 'speed', p, true); positive(o, 'strength', p, true);
    const d = o.dir as number[];
    if (!Math.hypot(d[0], d[1], d[2])) fail(`${p}.dir`, 'must not be zero');
  },
  lowgrav(o, p) {
    vec3(o, 'center', p); vec3(o, 'size', p); num(o, 'scale', p, true);
    const s = o.scale as number | undefined;
    if (s !== undefined && (s < 0 || s >= 1)) fail(`${p}.scale`, 'expected 0 ≤ scale < 1');
  },
  star(o, p) {
    vec3(o, 'position', p);
    const has = (k: string) => o[k] !== undefined;
    for (const k of ['to', 'center', 'button']) if (has(k)) vec3(o, k, p);
    positive(o, 'period', p, true); num(o, 'speed', p, true); positive(o, 'time', p, true);
    if (has('to') !== has('period')) fail(p, 'a sliding star needs both "to" and "period"');
    if (has('center') !== has('speed')) fail(p, 'a circling star needs both "center" and "speed"');
    if (has('to') && has('center')) fail(p, 'a star can slide or circle, not both');
    if (has('time') && !has('button')) fail(`${p}.time`, 'needs a "button"');
  },
};

function route(root: Obj, key: 'route' | 'starRoute') {
  const list = root[key];
  if (list === undefined) return;
  if (!Array.isArray(list)) fail(`level.${key}`, 'expected an array');
  list.forEach((raw, i) => {
    const path = `level.${key}[${i}]`;
    const o = obj(raw, path);
    vec3(o, 'p', path);
    bool(o, 'wait', path);
    bool(o, 'catch', path);
    positive(o, 'speed', path, true);
    num(o, 'lane', path, true);
  });
}

/** Validates untrusted JSON (e.g. from the editor or a file) and returns it typed. */
export function parseLevel(json: unknown): LevelData {
  const root = obj(json, 'level');
  if (root.format !== 1) fail('level.format', 'expected 1');
  if (typeof root.name !== 'string' || !root.name) fail('level.name', 'expected a non-empty string');
  if (root.theme !== undefined && !THEME_NAMES.includes(root.theme as ThemeName)) {
    fail('level.theme', `expected one of ${THEME_NAMES.join(', ')}`);
  }
  const start = obj(root.start, 'level.start');
  vec3(start, 'position', 'level.start');
  num(start, 'yaw', 'level.start', true);

  if (root.medals !== undefined) {
    const m = obj(root.medals, 'level.medals');
    for (const k of ['gold', 'silver', 'bronze']) positive(m, k, 'level.medals');
    if (!((m.gold as number) <= (m.silver as number) && (m.silver as number) <= (m.bronze as number))) {
      fail('level.medals', 'expected gold <= silver <= bronze');
    }
  }

  if (!Array.isArray(root.pieces)) fail('level.pieces', 'expected an array');
  root.pieces.forEach((raw, i) => {
    const path = `level.pieces[${i}]`;
    const o = obj(raw, path);
    const validate = pieceValidators[o.type as Piece['type']];
    if (!validate) fail(`${path}.type`, `unknown piece type "${String(o.type)}"`);
    validate(o, path);
  });
  if (root.camera !== undefined && root.camera !== 'chase' && root.camera !== 'topdown') fail('level.camera', 'expected chase or topdown');
  if (root.kind !== undefined && root.kind !== 'race' && root.kind !== 'arena') fail('level.kind', 'expected race or arena');
  const count = (type: string) => (root.pieces as Obj[]).filter((p) => p.type === type).length;
  if (root.kind === 'arena') {
    if (count('goal') !== 0) fail('level.pieces', 'an arena has no goal');
    if (count('zone') < 1) fail('level.pieces', 'an arena needs at least 1 zone');
  } else {
    if (count('goal') !== 1) fail('level.pieces', `expected exactly 1 goal, found ${count('goal')}`);
    if (count('zone') !== 0) fail('level.pieces', 'zones are for arenas (set "kind": "arena")');
  }
  if (root.kind === 'arena' && count('star') !== 0) fail('level.pieces', 'stars are for race courses');

  route(root, 'route');
  route(root, 'starRoute');
  return root as unknown as LevelData;
}
