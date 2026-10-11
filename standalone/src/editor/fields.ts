import type { LevelData, Piece, RoutePoint } from '../levels/schema';
import type { Vec3 } from '../sim/math';

// What the property panel shows for each piece type, and templates for new pieces.
// Keep in sync with src/levels/schema.ts (the validator catches any mismatch).

export type FieldKind = 'vec3' | 'number' | 'numbers' | 'bool' | 'palette' | 'color' | 'text' | 'theme' | 'kind';

export interface Field {
  key: string;
  kind: FieldKind;
  label?: string;
  optional?: boolean;
  step?: number;
}

export const PIECE_FIELDS: Record<Piece['type'], Field[]> = {
  pad: [
    { key: 'center', kind: 'vec3', label: 'Top center' },
    { key: 'w', kind: 'number', label: 'Width (x)' },
    { key: 'd', kind: 'number', label: 'Depth (z)' },
    { key: 'thickness', kind: 'number', optional: true },
    { key: 'palette', kind: 'palette', optional: true },
    { key: 'open', kind: 'bool', label: 'No safety walls', optional: true },
  ],
  path: [
    { key: 'from', kind: 'vec3' },
    { key: 'to', kind: 'vec3' },
    { key: 'width', kind: 'number' },
    { key: 'thickness', kind: 'number', optional: true },
    { key: 'rails', kind: 'bool', optional: true },
    { key: 'palette', kind: 'palette', optional: true },
    { key: 'open', kind: 'bool', label: 'No safety walls', optional: true },
  ],
  block: [
    { key: 'position', kind: 'vec3', label: 'Center' },
    { key: 'size', kind: 'vec3' },
    { key: 'yaw', kind: 'number', label: 'Yaw (°)', optional: true, step: 15 },
    { key: 'color', kind: 'color', optional: true },
  ],
  bumper: [
    { key: 'position', kind: 'vec3', label: 'Base' },
    { key: 'radius', kind: 'number', optional: true, step: 0.1 },
    { key: 'height', kind: 'number', optional: true, step: 0.1 },
    { key: 'to', kind: 'vec3', label: 'Slides to', optional: true },
    { key: 'period', kind: 'number', label: 'Slide period (s)', optional: true, step: 0.5 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
  ],
  sweeper: [
    { key: 'position', kind: 'vec3', label: 'Pivot (floor)' },
    { key: 'length', kind: 'number' },
    { key: 'speed', kind: 'number', label: 'Speed (rad/s)', step: 0.1 },
  ],
  mover: [
    { key: 'from', kind: 'vec3', label: 'From (top)' },
    { key: 'to', kind: 'vec3', label: 'To (top)' },
    { key: 'w', kind: 'number', label: 'Width (x)' },
    { key: 'd', kind: 'number', label: 'Depth (z)' },
    { key: 'period', kind: 'number', label: 'Period (s)', step: 0.5 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
    { key: 'hold', kind: 'number', label: 'Rests at each end (0–0.5)', optional: true, step: 0.05 },
    { key: 'palette', kind: 'palette', optional: true },
  ],
  checkpoint: [
    { key: 'position', kind: 'vec3' },
    { key: 'yaw', kind: 'number', label: 'Respawn yaw (°)', optional: true, step: 15 },
  ],
  goal: [
    { key: 'position', kind: 'vec3' },
    { key: 'radius', kind: 'number', optional: true, step: 0.1 },
  ],
  zone: [
    { key: 'position', kind: 'vec3' },
    { key: 'radius', kind: 'number', optional: true, step: 0.5 },
  ],
  boost: [
    { key: 'position', kind: 'vec3', label: 'Center (floor)' },
    { key: 'yaw', kind: 'number', label: 'Direction (°)', optional: true, step: 15 },
    { key: 'w', kind: 'number', label: 'Width', optional: true },
    { key: 'd', kind: 'number', label: 'Length', optional: true },
    { key: 'speed', kind: 'number', optional: true, step: 1 },
  ],
  spring: [
    { key: 'position', kind: 'vec3', label: 'Base (floor)' },
    { key: 'radius', kind: 'number', optional: true, step: 0.1 },
    { key: 'power', kind: 'number', label: 'Up speed', optional: true, step: 1 },
    { key: 'yaw', kind: 'number', label: 'Direction (°)', optional: true, step: 15 },
    { key: 'push', kind: 'number', label: 'Forward speed', optional: true, step: 1 },
  ],
  conveyor: [
    { key: 'from', kind: 'vec3' },
    { key: 'to', kind: 'vec3', label: 'To (belt runs this way)' },
    { key: 'width', kind: 'number' },
    { key: 'speed', kind: 'number', optional: true, step: 1 },
    { key: 'rails', kind: 'bool', optional: true },
    { key: 'open', kind: 'bool', label: 'No safety walls', optional: true },
  ],
  crumble: [
    { key: 'center', kind: 'vec3', label: 'Top center' },
    { key: 'w', kind: 'number', label: 'Width (x)' },
    { key: 'd', kind: 'number', label: 'Depth (z)' },
    { key: 'delay', kind: 'number', label: 'Falls after (s)', optional: true, step: 0.1 },
    { key: 'respawn', kind: 'number', label: 'Back after (s)', optional: true, step: 0.5 },
    { key: 'open', kind: 'bool', label: 'No safety walls', optional: true },
  ],
  wind: [
    { key: 'center', kind: 'vec3', label: 'Box center' },
    { key: 'size', kind: 'vec3' },
    { key: 'dir', kind: 'vec3', label: 'Direction' },
    { key: 'speed', kind: 'number', optional: true, step: 1 },
    { key: 'strength', kind: 'number', optional: true, step: 5 },
  ],
  lowgrav: [
    { key: 'center', kind: 'vec3', label: 'Box center' },
    { key: 'size', kind: 'vec3' },
    { key: 'scale', kind: 'number', label: 'Gravity ×', optional: true, step: 0.05 },
  ],
  turntable: [
    { key: 'center', kind: 'vec3', label: 'Top center' },
    { key: 'radius', kind: 'number' },
    { key: 'speed', kind: 'number', label: 'Speed (rad/s)', step: 0.1 },
    { key: 'gaps', kind: 'numbers', label: 'Rim gaps (°)', optional: true },
  ],
  pendulum: [
    { key: 'pivot', kind: 'vec3' },
    { key: 'length', kind: 'number' },
    { key: 'swing', kind: 'number', label: 'Swing (°)', step: 5 },
    { key: 'period', kind: 'number', label: 'Period (s)', step: 0.25 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
    { key: 'yaw', kind: 'number', label: 'Swings across (°)', optional: true, step: 15 },
    { key: 'radius', kind: 'number', label: 'Bob radius', optional: true, step: 0.1 },
  ],
  rocker: [
    { key: 'center', kind: 'vec3', label: 'Top center' },
    { key: 'w', kind: 'number', label: 'Width (x)' },
    { key: 'd', kind: 'number', label: 'Depth (z)' },
    { key: 'tilt', kind: 'number', label: 'Tilt (°)', step: 1 },
    { key: 'period', kind: 'number', label: 'Period (s)', step: 0.25 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
  ],
  roller: [
    { key: 'from', kind: 'vec3', label: 'From (floor)' },
    { key: 'to', kind: 'vec3', label: 'To (floor)' },
    { key: 'period', kind: 'number', label: 'Period (s)', step: 0.25 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
    { key: 'radius', kind: 'number', optional: true, step: 0.1 },
    { key: 'length', kind: 'number', optional: true, step: 0.5 },
    { key: 'launcher', kind: 'bool', label: 'From a launcher', optional: true },
    { key: 'wait', kind: 'number', label: 'Waits between runs (s)', optional: true, step: 0.25 },
  ],
  paper: [
    { key: 'position', kind: 'vec3', label: 'Base (floor)' },
    { key: 'w', kind: 'number', label: 'Width' },
    { key: 'h', kind: 'number', label: 'Height', optional: true },
    { key: 'yaw', kind: 'number', label: 'Yaw (°)', optional: true, step: 15 },
    { key: 'speed', kind: 'number', label: 'Breaks at speed', optional: true, step: 1 },
  ],
  ironball: [
    { key: 'position', kind: 'vec3', label: 'Resting on (floor)' },
    { key: 'radius', kind: 'number', optional: true, step: 0.5 },
    { key: 'roll', kind: 'number', label: 'Rolls on by itself (speed)', optional: true, step: 0.5 },
    { key: 'yaw', kind: 'number', label: 'Rolls toward (°)', optional: true, step: 15 },
  ],
  spikes: [
    { key: 'center', kind: 'vec3', label: 'Top center' },
    { key: 'w', kind: 'number', label: 'Width (x)' },
    { key: 'd', kind: 'number', label: 'Depth (z)' },
  ],
  wheel: [
    { key: 'center', kind: 'vec3', label: 'Hub' },
    { key: 'radius', kind: 'number', label: 'Radius (to step tops)' },
    { key: 'speed', kind: 'number', label: 'Speed (rad/s)', step: 0.05 },
    { key: 'steps', kind: 'number', optional: true, step: 1 },
    { key: 'w', kind: 'number', label: 'Step width', optional: true },
    { key: 'd', kind: 'number', label: 'Step depth', optional: true },
    { key: 'yaw', kind: 'number', label: 'Turns across (°)', optional: true, step: 15 },
  ],
  gate: [
    { key: 'position', kind: 'vec3', label: 'Base (floor)' },
    { key: 'w', kind: 'number', label: 'Width' },
    { key: 'h', kind: 'number', label: 'Height', optional: true },
    { key: 'yaw', kind: 'number', label: 'Yaw (°)', optional: true, step: 15 },
    { key: 'period', kind: 'number', label: 'Period (s)', step: 0.25 },
    { key: 'phase', kind: 'number', label: 'Phase (s)', optional: true, step: 0.25 },
    { key: 'open', kind: 'number', label: 'Open (fraction)', optional: true, step: 0.05 },
  ],
  star: [
    { key: 'position', kind: 'vec3', label: 'Center' },
    { key: 'to', kind: 'vec3', label: 'Slides to', optional: true },
    { key: 'period', kind: 'number', label: 'Slide period (s)', optional: true, step: 0.5 },
    { key: 'center', kind: 'vec3', label: 'Circles around', optional: true },
    { key: 'speed', kind: 'number', label: 'Circle speed (rad/s)', optional: true, step: 0.1 },
    { key: 'button', kind: 'vec3', label: 'Switch button', optional: true },
    { key: 'time', kind: 'number', label: 'Shows for (s)', optional: true, step: 0.5 },
    { key: 'ride', kind: 'number', label: 'Rides piece #', optional: true, step: 1 },
  ],
};

export const ROUTE_FIELDS: Field[] = [
  { key: 'p', kind: 'vec3', label: 'Point' },
  { key: 'speed', kind: 'number', optional: true, step: 1 },
  { key: 'wait', kind: 'bool', label: 'Wait for platform', optional: true },
  { key: 'catch', kind: 'bool', label: 'Wait for a star', optional: true },
  { key: 'lane', kind: 'number', label: 'Max bot lane', optional: true, step: 0.5 },
  { key: 'timed', kind: 'bool', label: 'Wait until clear', optional: true },
  { key: 'ride', kind: 'bool', label: 'Ride here', optional: true },
];

const off = (p: Vec3, dx: number, dy: number, dz: number): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];

/** A new piece of `type` placed at floor point `at`. */
export function pieceTemplate(type: Piece['type'], at: Vec3): Piece {
  switch (type) {
    case 'pad': return { type, center: at, w: 8, d: 8, palette: 'grey' };
    case 'path': return { type, from: at, to: off(at, 0, 0, -10), width: 6, palette: 'blue' };
    case 'block': return { type, position: off(at, 0, 1, 0), size: [4, 2, 1], color: '#b8bfcc' };
    case 'bumper': return { type, position: at };
    case 'sweeper': return { type, position: at, length: 10, speed: 1.2 };
    case 'mover': return { type, from: at, to: off(at, 0, 0, -10), w: 6, d: 6, period: 6, palette: 'orange' };
    case 'checkpoint': return { type, position: at };
    case 'goal': return { type, position: at };
    case 'zone': return { type, position: at, radius: 4 };
    case 'boost': return { type, position: at, yaw: 0 };
    case 'spring': return { type, position: at, power: 16 };
    case 'conveyor': return { type, from: at, to: off(at, 0, 0, -10), width: 6, speed: 12 };
    case 'crumble': return { type, center: at, w: 4, d: 4 };
    case 'wind': return { type, center: off(at, 0, 4, 0), size: [6, 8, 6], dir: [0, 1, 0] };
    case 'lowgrav': return { type, center: off(at, 0, 5, 0), size: [10, 10, 10] };
    case 'turntable': return { type, center: at, radius: 8, speed: 0.6, gaps: [0, 180] };
    case 'pendulum': return { type, pivot: off(at, 0, 9, 0), length: 8, swing: 45, period: 3 };
    case 'rocker': return { type, center: at, w: 5, d: 16, tilt: 8, period: 4 };
    case 'roller': return { type, from: off(at, -8, 0, 0), to: off(at, 8, 0, 0), period: 3 };
    case 'paper': return { type, position: at, w: 6 };
    case 'ironball': return { type, position: at, radius: 3 };
    case 'spikes': return { type, center: at, w: 10, d: 10 };
    case 'wheel': return { type, center: off(at, 0, 7, 0), radius: 7, speed: 0.5 };
    case 'gate': return { type, position: at, w: 4, period: 4 };
    case 'star': return { type, position: off(at, 0, 1.5, 0) };
  }
}

export function routeTemplate(at: Vec3): RoutePoint {
  return { p: at };
}

export function blankLevel(): LevelData {
  return {
    format: 1,
    name: 'New Course',
    medals: { gold: 20, silver: 26, bronze: 35 },
    start: { position: [0, 1, 2], yaw: 0 },
    pieces: [
      { type: 'pad', center: [0, 0, 0], w: 12, d: 12, palette: 'grey' },
      { type: 'path', from: [0, 0, -6], to: [0, 0, -26], width: 8, palette: 'blue', rails: true },
      { type: 'pad', center: [0, 0, -31], w: 10, d: 10, palette: 'green' },
      { type: 'goal', position: [0, 0, -32] },
    ],
    route: [{ p: [0, 0, -20] }, { p: [0, 0, -32], speed: 6 }],
  };
}

/** Every [x, y, z] field of a piece (moving a piece moves all of them together). */
export function vecKeys(obj: object): string[] {
  return Object.entries(obj)
    .filter(([, v]) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number'))
    .map(([k]) => k)
    .filter((k) => k !== 'size');
}
