import type { LevelData, LevelKind, Medals, Palette, RoutePoint } from '../levels/schema';
import type { ThemeName } from '../levels/themes';
import { IDENTITY, add, degToRad, length, lerp, mulQuat, rotate, scale, sub, yawPitch, type Quat, type Vec3 } from './math';

// Turns level pieces into a flat list of solids (boxes/cylinders with a pose and optional motion).
// Both the physics world and the renderer are built from this, and a Roblox importer can map
// each solid straight to a Part.

export type Shape =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'cylinder'; radius: number; height: number };

export type Role = 'floor' | 'rail' | 'wall' | 'bumper' | 'arm' | 'platform';

export type Motion =
  | { kind: 'oscillate'; from: Vec3; to: Vec3; period: number } // body-center positions
  | { kind: 'spin'; speed: number };                           // about +Y, radians/second

/** What touching a solid does (floors only: the ball must be resting on it). */
export type SolidEffect =
  | { kind: 'boost'; dir: Vec3; speed: number }
  | { kind: 'spring'; power: number; push: number | null; dir: Vec3 }
  | { kind: 'conveyor'; dir: Vec3; speed: number }
  | { kind: 'crumble'; delay: number; respawn: number };

/** A box of space that changes how the ball moves while it's inside (no collision). */
export type Volume = { piece: number; min: Vec3; max: Vec3 } & (
  | { kind: 'wind'; dir: Vec3; speed: number; strength: number }
  | { kind: 'lowgrav'; scale: number }
);

export interface Solid {
  id: number;
  piece: number; // index of the level piece this came from (for the editor)
  shape: Shape;
  position: Vec3; // center at t = 0
  rotation: Quat;
  role: Role;
  palette?: Palette;
  color?: string;
  motion?: Motion;
  effect?: SolidEffect;
}

export interface Marker {
  piece: number;
  position: Vec3;
  yaw?: number; // radians
}

/** A collectible star: where it is at t = 0, how it moves, and its switch if it has one. */
export interface StarMarker extends Marker {
  motion?: { kind: 'oscillate'; to: Vec3; period: number } | { kind: 'spin'; center: Vec3; speed: number };
  /** Switch stars: the button's floor point and how long the star stays after it's pressed. */
  button?: { position: Vec3; time: number };
}

export interface ResolvedLevel {
  name: string;
  start: { position: Vec3; yaw: number };
  solids: Solid[];
  volumes: Volume[];
  checkpoints: Marker[];
  kind: LevelKind;
  /** Race courses only. */
  goal: { piece: number; position: Vec3; radius: number } | null;
  /** Arenas only: hill zones for King of the Hill. */
  zones: { piece: number; position: Vec3; radius: number }[];
  /** Collectible stars (centre points at t = 0). */
  stars: StarMarker[];
  route: RoutePoint[];
  /** Route that collects every star (empty if the level has none). */
  starRoute: RoutePoint[];
  medals?: Medals;
  theme: ThemeName;
}

export interface Pose {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
}

const RAIL_COLOR = '#f4f4f4';

export function resolveLevel(level: LevelData): ResolvedLevel {
  const solids: Solid[] = [];
  const checkpoints: Marker[] = [];
  let goal: ResolvedLevel['goal'] = null;
  const zones: ResolvedLevel['zones'] = [];
  const stars: StarMarker[] = [];
  const volumes: Volume[] = [];
  let pieceIndex = 0;
  const addSolid = (s: Omit<Solid, 'id' | 'piece'>) => { solids.push({ ...s, id: solids.length, piece: pieceIndex }); };

  for (const [i, piece] of level.pieces.entries()) {
    pieceIndex = i;
    switch (piece.type) {
      case 'pad': {
        const t = piece.thickness ?? 1;
        addSolid({
          shape: { kind: 'box', size: [piece.w, t, piece.d] },
          position: add(piece.center, [0, -t / 2, 0]),
          rotation: IDENTITY,
          role: 'floor',
          palette: piece.palette ?? 'grey',
        });
        break;
      }
      case 'path':
      case 'conveyor': {
        const t = piece.type === 'path' ? piece.thickness ?? 1 : 1;
        const d = sub(piece.to, piece.from);
        const len = length(d);
        const yaw = Math.atan2(d[0], d[2]);
        const pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
        const rotation = yawPitch(yaw, pitch);
        const normal = rotate([0, 1, 0], rotation);
        const right = rotate([1, 0, 0], rotation);
        const mid = lerp(piece.from, piece.to, 0.5);
        addSolid({
          shape: { kind: 'box', size: [piece.width, t, len] },
          position: add(mid, scale(normal, -t / 2)),
          rotation,
          role: 'floor',
          ...(piece.type === 'path'
            ? { palette: piece.palette ?? 'blue' }
            : { color: '#3d4150', effect: { kind: 'conveyor' as const, dir: scale(d, 1 / len), speed: piece.speed ?? 12 } }),
        });
        if (piece.rails) {
          const railT = 0.3, railH = 1.2; // taller than the ball radius, so a knocked ball can't roll over
          for (const side of [-1, 1]) {
            addSolid({
              shape: { kind: 'box', size: [railT, railH, len] },
              position: add(add(mid, scale(right, side * (piece.width / 2 + railT / 2))), scale(normal, railH / 2 - 0.05)),
              rotation,
              role: 'rail',
              color: RAIL_COLOR,
            });
          }
        }
        break;
      }
      case 'block':
        addSolid({
          shape: { kind: 'box', size: piece.size },
          position: piece.position,
          rotation: yawPitch(degToRad(piece.yaw ?? 0)),
          role: 'wall',
          color: piece.color ?? '#b8bfcc',
        });
        break;
      case 'bumper': {
        const height = piece.height ?? 1.6;
        addSolid({
          shape: { kind: 'cylinder', radius: piece.radius ?? 1.2, height },
          position: add(piece.position, [0, height / 2, 0]),
          rotation: IDENTITY,
          role: 'bumper',
        });
        break;
      }
      case 'sweeper': {
        const armH = 1;
        addSolid({
          shape: { kind: 'box', size: [1, 2, 1] },
          position: add(piece.position, [0, 1, 0]),
          rotation: IDENTITY,
          role: 'wall',
          color: '#444a55',
        });
        addSolid({
          shape: { kind: 'box', size: [piece.length, armH, 0.6] },
          position: add(piece.position, [0, armH / 2 + 0.1, 0]),
          rotation: IDENTITY,
          role: 'arm',
          color: '#ffd23f',
          motion: { kind: 'spin', speed: piece.speed },
        });
        break;
      }
      case 'mover': {
        const t = 1;
        const from = add(piece.from, [0, -t / 2, 0]);
        const to = add(piece.to, [0, -t / 2, 0]);
        addSolid({
          shape: { kind: 'box', size: [piece.w, t, piece.d] },
          position: from,
          rotation: IDENTITY,
          role: 'platform',
          palette: piece.palette ?? 'orange',
          motion: { kind: 'oscillate', from, to, period: piece.period },
        });
        break;
      }
      case 'boost': {
        // A thin strip just proud of the floor; the ball rolling over it stands on it.
        const yaw = degToRad(piece.yaw ?? 0);
        addSolid({
          shape: { kind: 'box', size: [piece.w ?? 4, 0.1, piece.d ?? 3] },
          position: add(piece.position, [0, -0.03, 0]),
          rotation: yawPitch(yaw),
          role: 'floor',
          color: '#ffb703',
          effect: { kind: 'boost', dir: [-Math.sin(yaw), 0, -Math.cos(yaw)], speed: piece.speed ?? 30 },
        });
        break;
      }
      case 'spring': {
        const yaw = degToRad(piece.yaw ?? 0);
        addSolid({
          shape: { kind: 'cylinder', radius: piece.radius ?? 1.6, height: 0.4 },
          position: piece.position, // top 0.2 above the floor
          rotation: IDENTITY,
          role: 'floor',
          color: '#ff4d6d',
          effect: { kind: 'spring', power: piece.power ?? 16, push: piece.push ?? null, dir: [-Math.sin(yaw), 0, -Math.cos(yaw)] },
        });
        break;
      }
      case 'crumble':
        addSolid({
          shape: { kind: 'box', size: [piece.w, 1, piece.d] },
          position: add(piece.center, [0, -0.5, 0]),
          rotation: IDENTITY,
          role: 'floor',
          color: '#c9a27a',
          effect: { kind: 'crumble', delay: piece.delay ?? 0.6, respawn: piece.respawn ?? 4 },
        });
        break;
      case 'wind':
      case 'lowgrav': {
        const half = scale(piece.size, 0.5);
        const box = { piece: i, min: sub(piece.center, half), max: add(piece.center, half) };
        if (piece.type === 'wind') {
          volumes.push({ ...box, kind: 'wind', dir: scale(piece.dir, 1 / length(piece.dir)), speed: piece.speed ?? 9, strength: piece.strength ?? 50 });
        } else {
          volumes.push({ ...box, kind: 'lowgrav', scale: piece.scale ?? 0.35 });
        }
        break;
      }
      case 'checkpoint':
        checkpoints.push({ piece: i, position: piece.position, yaw: piece.yaw === undefined ? undefined : degToRad(piece.yaw) });
        break;
      case 'goal':
        goal = { piece: i, position: piece.position, radius: piece.radius ?? 2.6 };
        break;
      case 'zone':
        zones.push({ piece: i, position: piece.position, radius: piece.radius ?? 4 });
        break;
      case 'star':
        stars.push({
          piece: i,
          position: piece.position,
          ...(piece.to && piece.period ? { motion: { kind: 'oscillate' as const, to: piece.to, period: piece.period } } : {}),
          ...(piece.center && piece.speed !== undefined ? { motion: { kind: 'spin' as const, center: piece.center, speed: piece.speed } } : {}),
          ...(piece.button ? { button: { position: piece.button, time: piece.time ?? 6 } } : {}),
        });
        break;
    }
  }

  const kind = level.kind ?? 'race';
  if (kind === 'race' && !goal) throw new Error(`Level "${level.name}" has no goal`);
  return {
    name: level.name,
    kind,
    zones,
    start: { position: level.start.position, yaw: degToRad(level.start.yaw ?? 0) },
    solids,
    volumes,
    checkpoints,
    goal,
    stars,
    route: level.route ?? [],
    starRoute: level.starRoute ?? [],
    medals: level.medals,
    theme: level.theme ?? 'meadow',
  };
}

/**
 * Multiplayer starting grid: up to 5 across and 4 rows, centered on the level's start and
 * turned to face along the start yaw. Slot 0 is the front-center spot (the level start itself).
 * A 12×12 start pad fits 16 players.
 */
export function gridSpot(level: ResolvedLevel, slot: number): Vec3 {
  const COLS = [0, -1, 1, -2, 2];     // lateral order: center first, then alternating
  const ROWS = [0, 1, -1, -2];        // front row at the start, then behind, then ahead
  const col = COLS[slot % COLS.length];
  const row = ROWS[Math.floor(slot / COLS.length) % ROWS.length];
  const yaw = level.start.yaw;
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const back: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  return add(level.start.position, add(scale(right, col * 2.3), scale(back, row * 2.4)));
}

/** Oscillating motion: starts at `from`, eases to `to` and back once per period. */
function oscillate(from: Vec3, to: Vec3, period: number, t: number): { position: Vec3; velocity: Vec3 } {
  const omega = (Math.PI * 2) / period;
  const mid = lerp(from, to, 0.5);
  const amp = scale(sub(to, from), 0.5);
  return { position: add(mid, scale(amp, -Math.cos(omega * t))), velocity: scale(amp, Math.sin(omega * t) * omega) };
}

/** Pose of a solid at time `t` (seconds). Static solids return their initial pose. */
export function poseAt(solid: Solid, t: number): Pose {
  const m = solid.motion;
  if (!m) return { position: solid.position, rotation: solid.rotation, velocity: [0, 0, 0] };
  if (m.kind === 'spin') {
    return { position: solid.position, rotation: mulQuat(yawPitch(m.speed * t), solid.rotation), velocity: [0, 0, 0] };
  }
  return { ...oscillate(m.from, m.to, m.period, t), rotation: solid.rotation };
}

/** Where a star is at time `t`: riding stars move exactly in step with the mover or arm they copy. */
export function starAt(star: StarMarker, t: number): Vec3 {
  const m = star.motion;
  if (!m) return star.position;
  if (m.kind === 'oscillate') return oscillate(star.position, m.to, m.period, t).position;
  return add(m.center, rotate(sub(star.position, m.center), yawPitch(m.speed * t)));
}
