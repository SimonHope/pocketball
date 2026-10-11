import type { LevelData, LevelKind, Medals, Palette, RoutePoint } from '../levels/schema';
import type { ThemeName } from '../levels/themes';
import { IDENTITY, add, axisAngle, conjugate, degToRad, length, lerp, mulQuat, rotate, scale, sub, yawPitch, type Quat, type Vec3 } from './math';

// Turns level pieces into a flat list of solids (boxes/cylinders with a pose and optional motion).
// Both the physics world and the renderer are built from this, and a Roblox importer can map
// each solid straight to a Part.

export type Shape =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'sphere'; radius: number }; // a Roblox Ball part; only the iron ball so far

/** `carrier`: a ball you ride on top of and push along (the iron ball); real physics, one per player. */
export type Role = 'floor' | 'rail' | 'wall' | 'bumper' | 'arm' | 'platform' | 'carrier';

// Every motion is a pure function of the sim clock, so all players (and the server's replays)
// see a moving piece in the same place at the same time.
export type Motion =
  // Body-centre positions; `hold` = fraction of the period resting at each end.
  | { kind: 'oscillate'; from: Vec3; to: Vec3; period: number; phase?: number; hold?: number; holdTo?: number }
  // About +Y, radians/second, through the body's centre or `center` (a turntable's rim).
  | { kind: 'spin'; speed: number; center?: Vec3 }
  // To and fro about a horizontal `axis` through `pivot`, `amplitude` radians either side.
  | { kind: 'swing'; pivot: Vec3; axis: Vec3; amplitude: number; period: number; phase?: number }
  // One way from `from` to `to` (body centres), then straight back to the start, once per period.
  // With `wait`, it first sits at `park` that many seconds of each period (a log waiting in its launcher).
  | { kind: 'travel'; from: Vec3; to: Vec3; period: number; phase?: number; wait?: number; park?: Vec3 }
  // Round `axis` through `center` at `speed` rad/s, staying level (a Ferris wheel's steps).
  | { kind: 'orbit'; center: Vec3; axis: Vec3; speed: number };

/** How a solid is drawn when it isn't a plain floor or wall (the renderer's hint; no effect on physics). */
export type Skin = 'key' | 'disc' | 'rim' | 'rod' | 'bob' | 'ruler' | 'roller' | 'log' | 'paper' | 'iron' | 'spikes' | 'step' | 'gate';

/** What touching a solid does (floors only: the ball must be resting on it). */
export type SolidEffect =
  | { kind: 'boost'; dir: Vec3; speed: number }
  | { kind: 'spring'; power: number; push: number | null; dir: Vec3 }
  | { kind: 'conveyor'; dir: Vec3; speed: number }
  | { kind: 'crumble'; delay: number; respawn: number }
  // Walls: torn through (for this player) by a ball hitting it at `speed` or faster.
  | { kind: 'breakable'; speed: number }
  // Spikes: touching it puts you back at your last checkpoint.
  | { kind: 'hazard' }
  // Iron balls: while you ride it, it rolls on along `dir` at `speed` by itself; you steer and balance.
  | { kind: 'roll'; dir: Vec3; speed: number };

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
  skin?: Skin;
}

export interface Marker {
  piece: number;
  position: Vec3;
  yaw?: number; // radians
}

/** A collectible star: where it is at t = 0, how it moves, and its switch if it has one. */
export interface StarMarker extends Marker {
  motion?: { kind: 'oscillate'; to: Vec3; period: number } | { kind: 'spin'; center: Vec3; speed: number };
  /** Rides with this moving solid, keeping where it is relative to the solid at rest. */
  ride?: Solid;
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
/** Seconds a gate takes to rise or sink. */
const GATE_MOVE = 0.35;
/** Width of each opening in a turntable's rim. */
export const TURNTABLE_GAP = 6;

export function resolveLevel(level: LevelData): ResolvedLevel {
  const solids: Solid[] = [];
  const checkpoints: Marker[] = [];
  let goal: ResolvedLevel['goal'] = null;
  const zones: ResolvedLevel['zones'] = [];
  const stars: StarMarker[] = [];
  const volumes: Volume[] = [];
  let pieceIndex = 0;
  const rides: [number, number][] = []; // [star, piece it rides]
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
        const from = add(piece.position, [0, height / 2, 0]);
        addSolid({
          shape: { kind: 'cylinder', radius: piece.radius ?? 1.2, height },
          position: from,
          rotation: IDENTITY,
          role: 'bumper',
          ...(piece.to && piece.period
            ? { motion: { kind: 'oscillate' as const, from, to: add(piece.to, [0, height / 2, 0]), period: piece.period, ...(piece.phase ? { phase: piece.phase } : {}) } }
            : {}),
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
          motion: {
            kind: 'oscillate', from, to, period: piece.period,
            ...(piece.phase ? { phase: piece.phase } : {}), ...(piece.hold ? { hold: piece.hold } : {}),
          },
          ...(piece.hold ? { skin: 'key' as const } : {}),
        });
        break;
      }
      case 'turntable': {
        // The disc, and a low rim in short straight pieces between the gaps, all turning together.
        const t = 1, c = piece.center, r = piece.radius;
        addSolid({
          shape: { kind: 'cylinder', radius: r, height: t },
          position: add(c, [0, -t / 2, 0]),
          rotation: IDENTITY,
          role: 'platform',
          color: '#d8c3a5',
          skin: 'disc',
          motion: { kind: 'spin', speed: piece.speed },
        });
        const gap = TURNTABLE_GAP / r; // radians
        const gaps = (piece.gaps ?? []).map(degToRad).sort((a, b) => a - b);
        const arcs: [number, number][] = gaps.length
          ? gaps.map((g, i) => [g + gap / 2, (gaps[i + 1] ?? gaps[0] + Math.PI * 2) - gap / 2])
          : [[0, Math.PI * 2]];
        const rimR = r + 0.15;
        for (const [a0, a1] of arcs) {
          const n = Math.max(1, Math.ceil(((a1 - a0) * rimR) / 3));
          for (let k = 0; k < n; k++) {
            const a = a0 + ((k + 0.5) * (a1 - a0)) / n, len = 2 * rimR * Math.sin((a1 - a0) / n / 2) + 0.2;
            addSolid({
              shape: { kind: 'box', size: [0.3, 1.2, len] },
              position: [c[0] + rimR * Math.cos(a), c[1] + 0.55, c[2] - rimR * Math.sin(a)],
              rotation: yawPitch(a + Math.PI),
              role: 'wall',
              color: '#b08968',
              skin: 'rim',
              motion: { kind: 'spin', speed: piece.speed, center: c },
            });
          }
        }
        break;
      }
      case 'pendulum': {
        // A rod and a heavy bob swinging across the direction `yaw` points.
        const yaw = degToRad(piece.yaw ?? 0), r = piece.radius ?? 1.3, rod = piece.length - r;
        const motion: Motion = {
          kind: 'swing', pivot: piece.pivot, axis: [-Math.sin(yaw), 0, -Math.cos(yaw)], amplitude: degToRad(piece.swing),
          period: piece.period, ...(piece.phase ? { phase: piece.phase } : {}),
        };
        addSolid({
          shape: { kind: 'box', size: [0.25, rod, 0.25] },
          position: add(piece.pivot, [0, -rod / 2, 0]),
          rotation: yawPitch(yaw),
          role: 'arm',
          color: '#8d6e63',
          skin: 'rod',
          motion,
        });
        addSolid({
          shape: { kind: 'cylinder', radius: r, height: r * 1.6 },
          position: add(piece.pivot, [0, -piece.length, 0]),
          rotation: yawPitch(yaw),
          role: 'arm',
          color: '#8b4a2b',
          skin: 'bob',
          motion,
        });
        break;
      }
      case 'rocker': {
        // Tilts about the line along its longer side, through the middle of its top surface.
        const t = 0.8, axis: Vec3 = piece.d >= piece.w ? [0, 0, 1] : [1, 0, 0];
        addSolid({
          shape: { kind: 'box', size: [piece.w, t, piece.d] },
          position: add(piece.center, [0, -t / 2, 0]),
          rotation: IDENTITY,
          role: 'platform',
          color: '#e9d8a6',
          skin: 'ruler',
          motion: { kind: 'swing', pivot: piece.center, axis, amplitude: degToRad(piece.tilt), period: piece.period, ...(piece.phase ? { phase: piece.phase } : {}) },
        });
        break;
      }
      case 'roller': {
        // A log lying across its way, rolling along the floor from `from` to `to`.
        const r = piece.radius ?? 1.2, d = sub(piece.to, piece.from), len = Math.hypot(d[0], d[2]) || 1;
        // Sitting on its floor: straight up from it, or out along the slope's normal (logs rolling downhill).
        const up: Vec3 = d[1] === 0 ? [0, r, 0] : scale([-d[0] * d[1], len * len, -d[2] * d[1]], r / (len * Math.hypot(len, d[1])));
        const from = add(piece.from, up), to = add(piece.to, up);
        addSolid({
          shape: { kind: 'cylinder', radius: r, height: piece.length ?? 3 },
          position: from,
          rotation: axisAngle([d[0] / len, 0, d[2] / len], Math.PI / 2), // its axis across the way it rolls
          role: 'arm',
          color: '#9c6b3f',
          skin: piece.launcher ? 'log' : 'roller', // a log from a launcher breaks up at the end
          motion: {
            kind: 'travel', from, to, period: piece.period, ...(piece.phase ? { phase: piece.phase } : {}),
            // Waiting up in its launcher's roof, clear of anyone rolling underneath.
            ...(piece.wait ? { wait: piece.wait, park: add(from, [0, 2 * r + 0.5, 0]) } : {}),
          },
        });
        break;
      }
      case 'ironball': {
        const r = piece.radius ?? 3;
        const yaw = degToRad(piece.yaw ?? 0);
        addSolid({
          shape: { kind: 'sphere', radius: r }, position: add(piece.position, [0, r, 0]), rotation: IDENTITY, role: 'carrier', color: '#4a4f57', skin: 'iron',
          ...(piece.roll ? { effect: { kind: 'roll' as const, dir: [-Math.sin(yaw), 0, -Math.cos(yaw)] as Vec3, speed: piece.roll } } : {}),
        });
        break;
      }
      case 'spikes':
        addSolid({
          shape: { kind: 'box', size: [piece.w, 1, piece.d] },
          position: add(piece.center, [0, -0.5, 0]),
          rotation: IDENTITY,
          role: 'floor',
          color: '#5b5f66',
          skin: 'spikes',
          effect: { kind: 'hazard' },
        });
        break;
      case 'wheel': {
        // Steps spaced evenly round the hub, all staying level as the wheel turns across `yaw`.
        const yaw = degToRad(piece.yaw ?? 0), axis: Vec3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
        const t = 0.6, n = piece.steps ?? 6;
        for (let k = 0; k < n; k++) {
          const at = add(piece.center, rotate([0, -piece.radius, 0], axisAngle(axis, (k / n) * Math.PI * 2)));
          addSolid({
            shape: { kind: 'box', size: [piece.w ?? 4, t, piece.d ?? 4] },
            position: add(at, [0, -t / 2, 0]), // `radius` reaches the top of each step
            rotation: yawPitch(yaw),
            role: 'platform',
            color: '#c9a66b',
            skin: 'step',
            motion: { kind: 'orbit', center: add(piece.center, [0, -t / 2, 0]), axis, speed: piece.speed },
          });
        }
        break;
      }
      case 'gate': {
        // A door that sinks into the floor to open and rises to shut. Closed for the rest of each
        // period after `open`, moving in GATE_MOVE seconds each way.
        const h = piece.h ?? 2.6, open = piece.open ?? 0.5, move = Math.min(0.2, GATE_MOVE / piece.period);
        const up = add(piece.position, [0, h / 2, 0]), down = add(piece.position, [0, -h / 2 - 0.8, 0]);
        addSolid({
          shape: { kind: 'box', size: [piece.w, h, 0.5] },
          position: up,
          rotation: yawPitch(degToRad(piece.yaw ?? 0)),
          role: 'wall',
          color: '#f4f1e8',
          skin: 'gate',
          motion: {
            kind: 'oscillate', from: up, to: down, period: piece.period, ...(piece.phase ? { phase: piece.phase } : {}),
            hold: Math.max(0, 1 - open - move), holdTo: Math.max(0, open - move),
          },
        });
        break;
      }
      case 'paper': {
        const h = piece.h ?? 3;
        addSolid({
          shape: { kind: 'box', size: [piece.w, h, 0.3] },
          position: add(piece.position, [0, h / 2, 0]),
          rotation: yawPitch(degToRad(piece.yaw ?? 0)),
          role: 'wall',
          color: '#f3ead8',
          skin: 'paper',
          effect: { kind: 'breakable', speed: piece.speed ?? 15 },
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
        if (piece.ride !== undefined) rides.push([stars.length, piece.ride]);
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

  // Riding stars follow the first moving solid of their piece.
  for (const [star, piece] of rides) {
    const solid = solids.find((s) => s.piece === piece && s.motion);
    if (solid) stars[star].ride = solid;
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

/** Oscillating motion: starts at `from`, eases to `to` and back once per period (resting `hold` of it at each end). */
function oscillate(from: Vec3, to: Vec3, period: number, t: number, phase = 0, hold = 0, holdTo?: number): { position: Vec3; velocity: Vec3 } {
  if (holdTo !== undefined) return restEnds(from, to, period, t + phase, hold, holdTo);
  if (!hold) {
    const omega = (Math.PI * 2) / period;
    const mid = lerp(from, to, 0.5);
    const amp = scale(sub(to, from), 0.5);
    return { position: add(mid, scale(amp, -Math.cos(omega * (t + phase)))), velocity: scale(amp, Math.sin(omega * (t + phase)) * omega) };
  }
  const u = (((t + phase) / period) % 1 + 1) % 1, move = 0.5 - hold;
  let s = 0, ds = 0; // 0..1 from `from` to `to`, and its rate per second
  if (u >= 0.5 + hold) {
    const x = (u - 0.5 - hold) / move;
    s = (1 + Math.cos(Math.PI * x)) / 2;
    ds = -(Math.PI / 2) * Math.sin(Math.PI * x) / (move * period);
  } else if (u >= 0.5) s = 1;
  else if (u >= hold) {
    const x = (u - hold) / move;
    s = (1 - Math.cos(Math.PI * x)) / 2;
    ds = (Math.PI / 2) * Math.sin(Math.PI * x) / (move * period);
  }
  return { position: lerp(from, to, s), velocity: scale(sub(to, from), ds) };
}

/** Rests `h0` of the period at `from`, eases over, rests `h1` at `to`, eases back (gates). */
function restEnds(from: Vec3, to: Vec3, period: number, t: number, h0: number, h1: number): { position: Vec3; velocity: Vec3 } {
  const u = frac(t / period), move = (1 - h0 - h1) / 2;
  if (u < h0) return { position: from, velocity: [0, 0, 0] }; // resting at `from`
  let s: number, ds = 0;
  if (u < h0 + move) {
    const x = (u - h0) / move;
    s = (1 - Math.cos(Math.PI * x)) / 2;
    ds = (Math.PI / 2) * Math.sin(Math.PI * x) / (move * period);
  } else if (u < h0 + move + h1) s = 1;
  else {
    const x = (u - h0 - move - h1) / move;
    s = (1 + Math.cos(Math.PI * x)) / 2;
    ds = -(Math.PI / 2) * Math.sin(Math.PI * x) / (move * period);
  }
  return { position: lerp(from, to, s), velocity: scale(sub(to, from), ds) };
}

const frac = (x: number) => ((x % 1) + 1) % 1;

/**
 * Where a travelling piece is in its cycle at time `t`: `run` from 0 to 1 along its way (null
 * while it waits to set off), and `left`, the seconds until it next sets off.
 */
export function travelAt(m: Extract<Motion, { kind: 'travel' }>, t: number): { run: number | null; left: number } {
  const wait = m.wait ?? 0, at = frac((t + (m.phase ?? 0)) / m.period) * m.period;
  if (at < wait) return { run: null, left: wait - at };
  return { run: (at - wait) / (m.period - wait), left: m.period - at + wait };
}
const swingAngle = (m: Extract<Motion, { kind: 'swing' }>, t: number) => m.amplitude * Math.sin((Math.PI * 2 * (t + (m.phase ?? 0))) / m.period);

/** Pose of a solid at time `t` (seconds). Static solids return their initial pose. */
export function poseAt(solid: Solid, t: number): Pose {
  const m = solid.motion;
  if (!m) return { position: solid.position, rotation: solid.rotation, velocity: [0, 0, 0] };
  switch (m.kind) {
    case 'spin': {
      const turn = yawPitch(m.speed * t);
      if (!m.center) return { position: solid.position, rotation: mulQuat(turn, solid.rotation), velocity: [0, 0, 0] };
      const position = add(m.center, rotate(sub(solid.position, m.center), turn));
      return { position, rotation: mulQuat(turn, solid.rotation), velocity: pointVelocity(solid, position, t) };
    }
    case 'swing': {
      const turn = axisAngle(m.axis, swingAngle(m, t));
      const position = add(m.pivot, rotate(sub(solid.position, m.pivot), turn));
      return { position, rotation: mulQuat(turn, solid.rotation), velocity: pointVelocity(solid, position, t) };
    }
    case 'travel': {
      const { run } = travelAt(m, t);
      if (run === null) return { position: m.park ?? m.from, rotation: solid.rotation, velocity: [0, 0, 0] };
      return { position: lerp(m.from, m.to, run), rotation: solid.rotation, velocity: scale(sub(m.to, m.from), 1 / (m.period - (m.wait ?? 0))) };
    }
    case 'orbit': {
      const position = add(m.center, rotate(sub(solid.position, m.center), axisAngle(m.axis, m.speed * t)));
      return { position, rotation: solid.rotation, velocity: pointVelocity(solid, position, t) };
    }
    default:
      return { ...oscillate(m.from, m.to, m.period, t, m.phase, m.hold, m.holdTo), rotation: solid.rotation };
  }
}

/** Velocity at time `t` of the point `p` (where it is at `t`) carried by a solid: what a ball resting there rides along with. */
export function pointVelocity(solid: Solid, p: Vec3, t: number): Vec3 {
  const m = solid.motion;
  if (!m) return [0, 0, 0];
  if (m.kind === 'spin') {
    // ω × r for ω = (0, speed, 0).
    const c = m.center ?? solid.position;
    return [m.speed * (p[2] - c[2]), 0, -m.speed * (p[0] - c[0])];
  }
  if (m.kind === 'swing' || m.kind === 'orbit') {
    // ω × r. An orbiting step doesn't turn, so every point of it moves like its centre.
    const rate = m.kind === 'orbit' ? m.speed : m.amplitude * ((Math.PI * 2) / m.period) * Math.cos((Math.PI * 2 * (t + (m.phase ?? 0))) / m.period);
    const w = scale(m.axis, rate);
    const r = m.kind === 'orbit' ? sub(add(m.center, rotate(sub(solid.position, m.center), axisAngle(m.axis, m.speed * t))), m.center) : sub(p, m.pivot);
    return [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
  }
  return poseAt(solid, t).velocity;
}

/** Where a star is at time `t`: riding stars move exactly in step with the mover or arm they copy. */
export function starAt(star: StarMarker, t: number): Vec3 {
  if (star.ride) {
    // Placed relative to the piece at rest (where its level data puts it), whatever its phase.
    const base = star.ride, now = poseAt(base, t);
    const local = rotate(sub(star.position, base.position), conjugate(base.rotation));
    return add(now.position, rotate(local, now.rotation));
  }
  const m = star.motion;
  if (!m) return star.position;
  if (m.kind === 'oscillate') return oscillate(star.position, m.to, m.period, t).position;
  return add(m.center, rotate(sub(star.position, m.center), yawPitch(m.speed * t)));
}
