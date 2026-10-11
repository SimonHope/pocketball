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
  /** A sliding bumper: moves to `to` and back every `period` seconds, `phase` seconds ahead. */
  to?: Vec3;
  period?: number;
  phase?: number;
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
  /** Seconds ahead in its cycle (platforms side by side moving out of step). */
  phase?: number;
  /** Fraction of the period spent resting at each end (0 = always moving; piano keys use ~0.35). */
  hold?: number;
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

/** A spinning disc (a lazy Susan) with a low rim, open at `gaps` (degrees round from +x at t = 0). */
export interface TurntablePiece {
  type: 'turntable';
  center: Vec3;   // middle of the top surface
  radius: number;
  speed: number;  // radians/second, positive = counter-clockwise seen from above
  gaps?: number[];
}

/** A weight on a rod swinging from `pivot` across the direction `yaw` (0 = the course running toward -z). */
export interface PendulumPiece {
  type: 'pendulum';
  pivot: Vec3;
  length: number;  // pivot to the bob's centre
  swing: number;   // degrees either side of straight down
  period: number;
  phase?: number;
  yaw?: number;
  radius?: number; // the bob (default 1.3)
}

/** A plank that tilts from side to side on a clock about its long middle line (a ruler on an eraser). */
export interface RockerPiece {
  type: 'rocker';
  center: Vec3;   // middle of the top surface (the line it tilts about)
  w: number;
  d: number;
  tilt: number;   // degrees either side of level
  period: number;
  phase?: number;
}

/** A log that rolls from `from` to `to` (floor points) every `period` seconds, then starts again. */
export interface RollerPiece {
  type: 'roller';
  from: Vec3;
  to: Vec3;
  period: number;
  phase?: number;
  radius?: number; // default 1.2
  length?: number; // default 3
  /** Launched from a hopper with a warning lamp, and breaks apart at `to` (the log slope). */
  launcher?: boolean;
  /** Seconds of each period it waits up in its launcher before setting off. */
  wait?: number;
}

/** A paper wall: solid to a slow ball, torn through by one going `speed` or faster. */
export interface PaperPiece {
  type: 'paper';
  position: Vec3; // floor point under its middle
  w: number;
  h?: number;     // default 3
  yaw?: number;   // degrees; 0 = facing along z (a wall across a course running toward -z)
  speed?: number; // default 15
}

/** A giant iron ball resting on `position` (a floor point): roll onto it and push it along. One per player. */
export interface IronBallPiece {
  type: 'ironball';
  position: Vec3;
  radius?: number; // default 3
  /** Rolls on by itself at this speed while you ride it, along `yaw`: you steer and keep your balance. */
  roll?: number;
  yaw?: number;    // degrees; 0 = the course running toward -z
}

/** A floor of spikes: touching it sends you back to your last checkpoint. */
export interface SpikesPiece {
  type: 'spikes';
  center: Vec3; // middle of the top surface
  w: number;
  d: number;
}

/** A Ferris wheel of level steps turning about `center` across the direction `yaw` (0 = the course running toward -z). */
export interface WheelPiece {
  type: 'wheel';
  center: Vec3;    // the hub
  radius: number;  // hub to the top of each step
  speed: number;   // radians/second
  steps?: number;  // default 6
  w?: number;      // step size across (default 4)
  d?: number;      // and along (default 4)
  yaw?: number;
}

/** A door that sinks into the floor to open and rises to shut, on the clock. */
export interface GatePiece {
  type: 'gate';
  position: Vec3; // floor point under its middle
  w: number;
  h?: number;     // default 2.6
  yaw?: number;   // degrees; 0 = across a course running toward -z
  period: number;
  phase?: number;
  open?: number;  // fraction of each period it's open (default 0.5)
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
  /** Rides with a moving piece (its index in `pieces`), keeping where it is relative to that piece at rest. */
  ride?: number;
}

export type Piece =
  | PadPiece | PathPiece | BlockPiece | BumperPiece | SweeperPiece | MoverPiece | CheckpointPiece | GoalPiece | ZonePiece
  | BoostPiece | SpringPiece | ConveyorPiece | CrumblePiece | WindPiece | LowGravPiece | StarPiece
  | TurntablePiece | PendulumPiece | RockerPiece | RollerPiece | PaperPiece
  | IronBallPiece | SpikesPiece | WheelPiece | GatePiece;

/** Pieces that move on the clock (bots and safety walls treat them as moving, not as floor). */
export const MOVING_PIECES = new Set<Piece['type']>(['mover', 'sweeper', 'turntable', 'pendulum', 'rocker', 'roller', 'wheel', 'gate']);

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
  /** Hold here until the way to the next point is predicted clear of moving pieces, with floor all along it. */
  timed?: boolean;
  /** Stay on the moving platform you're on until it brings you to this point (a wheel's step). */
  ride?: boolean;
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
  bumper(o, p) {
    vec3(o, 'position', p); positive(o, 'radius', p, true); positive(o, 'height', p, true);
    if (o.to !== undefined) vec3(o, 'to', p);
    positive(o, 'period', p, true); num(o, 'phase', p, true);
    if ((o.to === undefined) !== (o.period === undefined)) fail(p, 'a sliding bumper needs both "to" and "period"');
  },
  sweeper(o, p) { vec3(o, 'position', p); positive(o, 'length', p); num(o, 'speed', p); },
  mover(o, p) {
    vec3(o, 'from', p); vec3(o, 'to', p); positive(o, 'w', p); positive(o, 'd', p); positive(o, 'period', p);
    palette(o, p); num(o, 'phase', p, true); num(o, 'hold', p, true);
    const h = o.hold as number | undefined;
    if (h !== undefined && (h < 0 || h >= 0.5)) fail(`${p}.hold`, 'expected 0 ≤ hold < 0.5');
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
  turntable(o, p) {
    vec3(o, 'center', p); positive(o, 'radius', p); num(o, 'speed', p);
    if (o.gaps !== undefined && (!Array.isArray(o.gaps) || !o.gaps.every((g) => typeof g === 'number' && Number.isFinite(g)))) {
      fail(`${p}.gaps`, 'expected a list of angles');
    }
  },
  pendulum(o, p) {
    vec3(o, 'pivot', p); positive(o, 'length', p); positive(o, 'swing', p); positive(o, 'period', p);
    num(o, 'phase', p, true); num(o, 'yaw', p, true); positive(o, 'radius', p, true);
    if ((o.swing as number) >= 90) fail(`${p}.swing`, 'expected less than 90 degrees');
  },
  rocker(o, p) {
    vec3(o, 'center', p); positive(o, 'w', p); positive(o, 'd', p); positive(o, 'tilt', p); positive(o, 'period', p); num(o, 'phase', p, true);
    if ((o.tilt as number) >= 45) fail(`${p}.tilt`, 'expected less than 45 degrees');
  },
  roller(o, p) {
    vec3(o, 'from', p); vec3(o, 'to', p); positive(o, 'period', p); num(o, 'phase', p, true);
    positive(o, 'radius', p, true); positive(o, 'length', p, true); bool(o, 'launcher', p); positive(o, 'wait', p, true);
    if ((o.wait as number | undefined) !== undefined && (o.wait as number) >= (o.period as number)) fail(`${p}.wait`, 'must be shorter than the period');
  },
  ironball(o, p) { vec3(o, 'position', p); positive(o, 'radius', p, true); positive(o, 'roll', p, true); num(o, 'yaw', p, true); },
  spikes(o, p) { vec3(o, 'center', p); positive(o, 'w', p); positive(o, 'd', p); },
  wheel(o, p) {
    vec3(o, 'center', p); positive(o, 'radius', p); num(o, 'speed', p); positive(o, 'steps', p, true);
    positive(o, 'w', p, true); positive(o, 'd', p, true); num(o, 'yaw', p, true);
  },
  gate(o, p) {
    vec3(o, 'position', p); positive(o, 'w', p); positive(o, 'h', p, true); num(o, 'yaw', p, true);
    positive(o, 'period', p); num(o, 'phase', p, true); num(o, 'open', p, true);
    const f = o.open as number | undefined;
    if (f !== undefined && (f <= 0 || f >= 1)) fail(`${p}.open`, 'expected 0 < open < 1');
  },
  paper(o, p) { vec3(o, 'position', p); positive(o, 'w', p); positive(o, 'h', p, true); num(o, 'yaw', p, true); positive(o, 'speed', p, true); },
  star(o, p) {
    vec3(o, 'position', p);
    const has = (k: string) => o[k] !== undefined;
    for (const k of ['to', 'center', 'button']) if (has(k)) vec3(o, k, p);
    positive(o, 'period', p, true); num(o, 'speed', p, true); positive(o, 'time', p, true);
    if (has('to') !== has('period')) fail(p, 'a sliding star needs both "to" and "period"');
    if (has('center') !== has('speed')) fail(p, 'a circling star needs both "center" and "speed"');
    if (has('to') && has('center')) fail(p, 'a star can slide or circle, not both');
    if (has('time') && !has('button')) fail(`${p}.time`, 'needs a "button"');
    if (has('ride')) {
      num(o, 'ride', p);
      if (has('to') || has('center')) fail(p, 'a star rides a piece, or slides or circles on its own, not both');
    }
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
    bool(o, 'timed', path);
    bool(o, 'ride', path);
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
  (root.pieces as Obj[]).forEach((o, i) => {
    if (o.type !== 'star' || o.ride === undefined) return;
    const ridden = (root.pieces as Obj[])[o.ride as number];
    const moves = ridden && (MOVING_PIECES.has(ridden.type as Piece['type']) || (ridden.type === 'bumper' && ridden.to !== undefined));
    if (!moves) fail(`level.pieces[${i}].ride`, 'expected the index of a moving piece');
  });

  route(root, 'route');
  route(root, 'starRoute');
  return root as unknown as LevelData;
}
