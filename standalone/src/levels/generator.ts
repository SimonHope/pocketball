import type { Vec3 } from '../sim/math';
import { GUARD_COLOR, type LevelData, type Palette, type Piece, type RoutePoint } from './schema';
import type { ThemeName } from './themes';

// Builds race courses by chaining segments (straights, ramps, turns, curves, bridges,
// moving-platform gaps, sweeper pads, zig-zags, jumps, and for downhill courses steep plunges,
// corkscrews, cliff drops and cascades) and writes the bot route as it goes. Generated courses are
// starting points: scripts/generate-levels.ts keeps only ones the autopilot can finish,
// and designers refine them in the editor.

export type Segment =
  | 'straight' | 'slalom' | 'rampDown' | 'rampUp' | 'turn' | 'bridge' | 'mover' | 'sideMover' | 'sweeper' | 'zigzag'
  | 'curve' | 'hairpin' | 'jump' | 'split' | 'stairs' | 'gauntlet'
  | 'steep' | 'spiral' | 'drop' | 'cascade'
  | 'boostRamp' | 'boostJump' | 'springUp' | 'lift' | 'updraft' | 'crumbleBridge' | 'conveyor' | 'treadmill' | 'windBridge' | 'moonJump';

export interface GenOptions {
  seed: number;
  name: string;
  theme: ThemeName;
  /** How many segments between start and goal. */
  length: number;
  /** Relative chance of each segment type. */
  weights: Partial<Record<Segment, number>>;
  /** Narrowest bridge (4 is comfortable, 3.5 is hard). */
  bridgeWidth?: number;
  /** Cap on bot speeds (lower on ice). */
  maxSpeed?: number;
  /** Mountain descent: every curve and switchback drops. */
  downhill?: boolean;
}

/** Small seeded RNG (mulberry32) so a seed always gives the same course. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; yMin: number; yMax: number }

/** Vertical room needed where the course passes over itself. */
const HEADROOM = 7.5;

const RAIL_COLOR = '#f4f4f4'; // matches path rails (sim/geometry.ts)
const PALETTE_CYCLE = ['blue', 'green', 'orange', 'purple'] as const;
const r2 = (n: number) => Math.round(n * 2) / 2;

class CourseBuilder {
  pieces: Piece[] = [];
  route: RoutePoint[] = [];
  cur: Vec3 = [0, 0, -6];   // floor point at the open edge where the next segment attaches
  dir: [number, number] = [0, -1];
  rects: Rect[] = [];
  private paletteIndex = 0;
  checkpointsSince = 0;

  constructor(private maxSpeed: number) {}

  get right(): [number, number] { return [-this.dir[1], this.dir[0]]; }
  at(ahead: number, side = 0, dy = 0): Vec3 {
    const [dx, dz] = this.dir, [rx, rz] = this.right;
    return [r2(this.cur[0] + dx * ahead + rx * side), this.cur[1] + dy, r2(this.cur[2] + dz * ahead + rz * side)];
  }
  palette() { return PALETTE_CYCLE[this.paletteIndex++ % PALETTE_CYCLE.length]; }
  speed(s: number) { return Math.min(s, this.maxSpeed); }
  wp(p: Vec3, extra: Omit<RoutePoint, 'p'> = {}) {
    if (extra.speed) extra.speed = this.speed(extra.speed);
    this.route.push({ p, ...extra });
  }

  /** Marks space as taken without checking (existing pieces of a course being extended). */
  occupy(a: Vec3, b: Vec3, halfWidth: number) {
    this.rects.push({
      minX: Math.min(a[0], b[0]) - halfWidth, maxX: Math.max(a[0], b[0]) + halfWidth,
      minZ: Math.min(a[2], b[2]) - halfWidth, maxZ: Math.max(a[2], b[2]) + halfWidth,
      yMin: Math.min(a[1], b[1]), yMax: Math.max(a[1], b[1]),
    });
  }

  /** Footprint check so the course never runs into itself. Returns false (and adds nothing) on overlap. */
  claim(a: Vec3, b: Vec3, halfWidth: number, extraHeight = 0): boolean {
    const r: Rect = {
      minX: Math.min(a[0], b[0]) - halfWidth, maxX: Math.max(a[0], b[0]) + halfWidth,
      minZ: Math.min(a[2], b[2]) - halfWidth, maxZ: Math.max(a[2], b[2]) + halfWidth,
      yMin: Math.min(a[1], b[1]), yMax: Math.max(a[1], b[1]) + extraHeight,
    };
    // Ignore the last few pieces we're attached to; everything else must be clear by 3 units
    // sideways, or pass over or under with headroom.
    const older = this.rects.slice(0, -2);
    const hit = older.some((o) => r.minX < o.maxX + 3 && r.maxX > o.minX - 3 && r.minZ < o.maxZ + 3 && r.maxZ > o.minZ - 3
      && Math.max(r.yMin - o.yMax, o.yMin - r.yMax) < HEADROOM);
    if (hit) return false;
    this.rects.push(r);
    return true;
  }

  pad(center: Vec3, w: number, d: number, palette: Palette = 'grey', thickness?: number) {
    // Pads are axis-aligned: swap w/d when travelling along x.
    const [pw, pd] = this.dir[0] !== 0 ? [d, w] : [w, d];
    this.pieces.push({ type: 'pad', center, w: pw, d: pd, palette, ...(thickness ? { thickness } : {}) });
  }
  /** Width × depth × height as world x/y/z for a box lined up with the course. */
  size(w: number, h: number, d: number): Vec3 { return this.dir[0] !== 0 ? [d, h, w] : [w, h, d]; }
  /** Degrees for pieces that face along the course (boost pads, springs). */
  get yaw(): number { return Math.round((Math.atan2(-this.dir[0], -this.dir[1]) * 180) / Math.PI); }
  /** Walls either side of a stretch (so bouncy landings stay on). */
  sideWalls(from: number, to: number, halfWidth: number, dy = 0) {
    const mid = this.at((from + to) / 2, 0, dy);
    const [rx, rz] = this.right;
    for (const s of [-1, 1]) {
      const pos: Vec3 = [r2(mid[0] + rx * s * (halfWidth + 0.25)), mid[1] + 0.6, r2(mid[2] + rz * s * (halfWidth + 0.25))];
      this.pieces.push({ type: 'block', position: pos, size: this.size(0.5, 1.2, to - from), color: '#f4f4f4' });
    }
  }
  /** A waypoint whose speed isn't capped (boosted sections). */
  fast(p: Vec3, speed: number) { this.route.push({ p, speed, lane: 0 }); }
}

type Build = (b: CourseBuilder, rand: () => number, opts: GenOptions) => boolean;

/**
 * A smooth 90° turn (s = +1 right, -1 left) of radius `radius`, dropping `drop` on the way,
 * built from short angled path pieces that overlap slightly so the outside edge has no gaps,
 * with rails as thin blocks along the inner and outer edges (clean joints, unlike path rails).
 */
function arc(b: CourseBuilder, s: number, radius: number, drop: number, width: number, palette: Palette): boolean {
  const [dx, dz] = b.dir;
  const [rx, rz] = b.right;
  const c: Vec3 = [b.cur[0] + rx * s * radius, b.cur[1], b.cur[2] + rz * s * radius];
  const u = [-rx * s, -rz * s]; // centre → start
  const steps = 6;
  const point = (k: number): Vec3 => {
    const t = (k / steps) * (Math.PI / 2);
    return [c[0] + radius * (Math.cos(t) * u[0] + Math.sin(t) * dx), b.cur[1] - (drop * k) / steps, c[2] + radius * (Math.cos(t) * u[1] + Math.sin(t) * dz)];
  };
  const end: Vec3 = [r2(point(steps)[0]), point(steps)[1], r2(point(steps)[2])];
  if (!b.claim(b.cur, end, width / 2 + 1)) return false;
  const c2 = (n: number) => Math.round(n * 100) / 100;
  const edge = (k: number, off: number): Vec3 => {
    const p = point(k);
    const t = (k / steps) * (Math.PI / 2);
    // Outward from the centre at this angle.
    const ox = Math.cos(t) * u[0] + Math.sin(t) * dx, oz = Math.cos(t) * u[1] + Math.sin(t) * dz;
    return [p[0] + ox * off, p[1], p[2] + oz * off];
  };
  for (let k = 0; k < steps; k++) {
    const a = point(k), e = point(k + 1);
    const len = Math.hypot(e[0] - a[0], e[2] - a[2]);
    const ex = (e[0] - a[0]) / len, ez = (e[2] - a[2]) / len;
    const grow = 0.6; // overlap into the neighbouring pieces so the outside edge has no gaps
    const slope = (e[1] - a[1]) / len;
    b.pieces.push({
      type: 'path',
      from: [c2(a[0] - ex * grow), c2(a[1] - slope * grow), c2(a[2] - ez * grow)],
      to: [c2(e[0] + ex * grow), c2(e[1] + slope * grow), c2(e[2] + ez * grow)],
      width, palette,
    });
    for (const off of [-(width / 2 + 0.15), width / 2 + 0.15]) {
      const ra = edge(k, off), rb = edge(k + 1, off);
      const hi = Math.max(ra[1], rb[1]), lo = Math.min(ra[1], rb[1]);
      b.pieces.push({
        type: 'block',
        position: [c2((ra[0] + rb[0]) / 2), c2((lo - 0.05 + hi + 1.2) / 2), c2((ra[2] + rb[2]) / 2)],
        size: [0.3, c2(hi - lo + 1.25), c2(Math.hypot(rb[0] - ra[0], rb[2] - ra[2]) + 0.1)],
        yaw: c2((Math.atan2(rb[0] - ra[0], rb[2] - ra[2]) * 180) / Math.PI),
        color: RAIL_COLOR,
      });
    }
    b.wp(k === steps - 1 ? end : [c2(e[0]), e[1], c2(e[2])], { speed: 11, lane: 1.5 });
  }
  b.dir = [rx * s, rz * s];
  b.cur = end;
  return true;
}

const SEGMENTS: Record<Segment, Build> = {
  straight(b, rand) {
    const len = 14 + Math.floor(rand() * 3) * 4, width = 8 + Math.floor(rand() * 2) * 2;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, rails: true, palette: b.palette() });
    b.wp(to);
    b.cur = to;
    return true;
  },
  slalom(b, rand) {
    const len = 24, width = 10;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, rails: true, palette: b.palette() });
    let side = rand() < 0.5 ? 1 : -1;
    for (const ahead of [7, 14, 21]) {
      b.pieces.push({ type: 'bumper', position: b.at(ahead, side * 2.5) });
      b.wp(b.at(ahead, -side * 1.5), { speed: 12, lane: 0 });
      side = -side;
    }
    b.wp(to);
    b.cur = to;
    return true;
  },
  rampDown(b, rand) {
    const len = 16 + Math.floor(rand() * 2) * 4, drop = 4 + Math.floor(rand() * 3) * 2;
    const to = b.at(len, 0, -drop);
    if (!b.claim(b.cur, to, 4)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width: 8, rails: true, palette: b.palette() });
    b.wp(to, { speed: 10 });
    b.cur = to;
    return true;
  },
  rampUp(b, rand) {
    const len = 18, rise = 3 + Math.floor(rand() * 2);
    const to = b.at(len, 0, rise);
    if (!b.claim(b.cur, to, 4)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width: 8, rails: true, palette: b.palette() });
    // A short landing so the crest hop doesn't launch off the next piece.
    const land = b.at(len + 8, 0, rise);
    b.pieces.push({ type: 'path', from: to, to: land, width: 8, rails: true, palette: b.palette() });
    b.wp(to);
    b.wp(land, { speed: 10 });
    b.cur = land;
    return true;
  },
  turn(b, rand) {
    const size = 12, center = b.at(size / 2);
    if (!b.claim(b.at(0, -size / 2), b.at(size, size / 2), 0)) return false;
    b.pad(center, size, size, 'grey');
    const turn = rand() < 0.5 ? 1 : -1; // +1 = right
    b.pieces.push({ type: 'checkpoint', position: center });
    b.wp(center, { speed: 7 });
    b.checkpointsSince = 0;
    const [rx, rz] = b.right;
    b.dir = [rx * turn, rz * turn];
    b.cur = [r2(center[0] + b.dir[0] * size / 2), center[1], r2(center[2] + b.dir[1] * size / 2)];
    return true;
  },
  bridge(b, rand, opts) {
    const len = 14 + Math.floor(rand() * 3) * 3;
    const width = (opts.bridgeWidth ?? 4) + Math.floor(rand() * 2) * 0.5;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: 'orange' });
    b.wp(b.at(1), { speed: 8, lane: 0 });
    b.wp(to, { speed: 9, lane: 0 });
    b.cur = to;
    return true;
  },
  mover(b, rand) {
    // Pad, a gap crossed by a platform sliding back and forth along the course, pad.
    const gap = 12 + Math.floor(rand() * 3) * 2;
    if (!b.claim(b.cur, b.at(8 + gap + 10), 5)) return false;
    const near = b.at(4);
    b.pad(near, 8, 8, 'grey');
    b.pieces.push({ type: 'checkpoint', position: near });
    const edge = b.at(8);
    const from = b.at(8 + 3), to = b.at(8 + gap - 3);
    b.pieces.push({ type: 'mover', from, to, w: 6, d: 6, period: r2(Math.max(5, gap / 2.2)) });
    const far = b.at(8 + gap + 5);
    b.pad(far, 10, 10, 'grey');
    b.wp(b.at(6), { speed: 5, lane: 0 });
    b.wp(from, { wait: true, speed: 6 });
    b.wp(to, { wait: true, speed: 6 });
    b.wp(far, { speed: 8 });
    b.checkpointsSince = 0;
    void edge;
    b.cur = b.at(8 + gap + 10);
    return true;
  },
  sideMover(b, rand) {
    // A platform sliding sideways across a gap: roll over it while it lines up.
    const gap = 6;
    if (!b.claim(b.cur, b.at(8 + gap + 10), 10)) return false; // room for the platform's swing
    const near = b.at(4);
    b.pad(near, 8, 8, 'grey');
    const mid = 8 + gap / 2;
    const swing = 5 + Math.floor(rand() * 2);
    b.pieces.push({ type: 'mover', from: b.at(mid, -swing), to: b.at(mid, swing), w: 6, d: 6, period: 8, palette: 'purple' });
    const far = b.at(8 + gap + 5);
    b.pad(far, 12, 10, 'grey');
    b.pieces.push({ type: 'checkpoint', position: near });
    b.wp(b.at(6), { speed: 5, lane: 0 });
    b.wp(b.at(mid), { wait: true, speed: 9 });
    b.wp(b.at(8 + gap + 3), { speed: 7, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(8 + gap + 10);
    return true;
  },
  sweeper(b, rand) {
    const size = 16, center = b.at(size / 2);
    if (!b.claim(b.at(0, -size / 2), b.at(size, size / 2), 0)) return false;
    b.pad(center, size, size, 'purple');
    const [rx, rz] = b.right;
    for (const s of [-1, 1]) {
      // Low walls on both sides keep knocked balls in the arena.
      const pos: Vec3 = [r2(center[0] + rx * s * (size / 2 + 0.25)), center[1] + 0.5, r2(center[2] + rz * s * (size / 2 + 0.25))];
      const size3: Vec3 = b.dir[0] !== 0 ? [size, 1, 0.5] : [0.5, 1, size];
      b.pieces.push({ type: 'block', position: pos, size: size3, color: '#f4f4f4' });
    }
    b.pieces.push({ type: 'sweeper', position: center, length: 13, speed: r2((1 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1) * 10) / 10 });
    b.wp(b.at(size), { speed: 12 });
    b.cur = b.at(size);
    return true;
  },
  curve(b, rand, opts) {
    const s = rand() < 0.5 ? 1 : -1, radius = 12 + Math.floor(rand() * 2) * 4, drops = rand() < 0.4;
    return arc(b, s, radius, opts.downhill ? 4 : drops ? 3 : 0, 8, b.palette());
  },
  hairpin(b, rand, opts) {
    // A descending switchback: two curves the same way, dropping as it turns back.
    const s = rand() < 0.5 ? 1 : -1, palette = b.palette(), drop = opts.downhill ? 4 : 3;
    return arc(b, s, 12, drop, 8, palette) && arc(b, s, 12, drop, 8, palette);
  },
  steep(b, rand) {
    // A long railed plunge, then a flat runout to scrub off speed before whatever comes next.
    const len = 26 + Math.floor(rand() * 3) * 4, drop = 9 + Math.floor(rand() * 3) * 2;
    const bottom = b.at(len, 0, -drop), end = b.at(len + 12, 0, -drop);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: bottom, width: 9, rails: true, palette: b.palette() });
    b.pieces.push({ type: 'path', from: bottom, to: end, width: 9, rails: true, palette: 'grey' });
    b.wp(bottom, { speed: 12 });
    b.wp(end, { speed: 9 });
    b.cur = end;
    return true;
  },
  spiral(b, rand) {
    // A full corkscrew: four curves the same way, passing 16 units under its own entrance.
    const s = rand() < 0.5 ? 1 : -1, palette = b.palette();
    for (let i = 0; i < 4; i++) if (!arc(b, s, 12, 4, 8, palette)) return false;
    return true;
  },
  drop(b, rand) {
    // Roll off a cliff edge onto a walled landing pad far below.
    const fall = 5 + Math.floor(rand() * 2) * 2, land = 20;
    if (!b.claim(b.cur, b.at(8 + land, 0, -fall), 8)) return false;
    const runup = b.at(4);
    b.pad(runup, 10, 8, 'grey');
    b.pieces.push({ type: 'checkpoint', position: runup });
    const centre = b.at(8 + land / 2, 0, -fall);
    b.pad(centre, 14, land, b.palette());
    const [rx, rz] = b.right;
    for (const side of [-1, 1]) {
      // Low walls so a bouncy landing stays on the pad.
      const pos: Vec3 = [r2(centre[0] + rx * side * 7.25), centre[1] + 0.6, r2(centre[2] + rz * side * 7.25)];
      b.pieces.push({ type: 'block', position: pos, size: b.dir[0] !== 0 ? [land, 1.2, 0.5] : [0.5, 1.2, land], color: '#f4f4f4' });
    }
    b.wp(b.at(7), { speed: 8, lane: 0 });
    b.wp(b.at(8 + land - 2, 0, -fall), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(8 + land, 0, -fall);
    return true;
  },
  cascade(b, rand) {
    // Waterfall steps: big drops from one wide ledge to the next.
    const steps = 3 + Math.floor(rand() * 2), depth = 9, rise = 2.5;
    const end = b.at(steps * depth, 0, -steps * rise);
    if (!b.claim(b.cur, end, 7)) return false;
    for (let i = 0; i < steps; i++) {
      const c = b.at(i * depth + depth / 2, 0, -(i + 1) * rise);
      b.pad(c, 12, depth, i % 2 ? 'grey' : b.palette());
      const [rx, rz] = b.right;
      for (const side of [-1, 1]) {
        const pos: Vec3 = [r2(c[0] + rx * side * 6.25), c[1] + 0.6, r2(c[2] + rz * side * 6.25)];
        b.pieces.push({ type: 'block', position: pos, size: b.dir[0] !== 0 ? [depth, 1.2, 0.5] : [0.5, 1.2, depth], color: '#f4f4f4' });
      }
    }
    b.wp(end, { speed: 8 });
    b.cur = end;
    return true;
  },
  jump(b, rand) {
    // Run-up pad with a checkpoint, a kicker ramp, an open gap, and a landing a little lower.
    const gap = 4 + Math.floor(rand() * 3);
    const total = 10 + 12 + gap + 16;
    if (!b.claim(b.cur, b.at(total, 0, -1), 6)) return false;
    const runup = b.at(5);
    b.pad(runup, 10, 10, 'grey');
    b.pieces.push({ type: 'checkpoint', position: runup });
    const lip = b.at(22, 0, 2);
    b.pieces.push({ type: 'path', from: b.at(10), to: lip, width: 8, rails: true, palette: 'orange' });
    const landStart = b.at(22 + gap, 0, -1), landEnd = b.at(total, 0, -1);
    b.pieces.push({ type: 'path', from: landStart, to: landEnd, width: 12, palette: b.palette() });
    b.wp(b.at(8), { speed: 16, lane: 0 });
    b.wp(b.at(22 + gap + 12, 0, -1), { speed: 16, lane: 0 }); // aim far past the lip so the bot keeps its speed
    b.wp(landEnd, { speed: 9 });
    b.checkpointsSince = 0;
    b.cur = landEnd;
    return true;
  },
  split(b, rand) {
    // Two lanes around a hole in the floor: pick a side.
    const len = 16, lane = 4 + Math.floor(rand() * 2) * 0.5, hole = 5;
    const half = hole / 2 + lane / 2;
    if (!b.claim(b.cur, b.at(4 + len + 4), half + lane / 2 + 1)) return false;
    b.pad(b.at(2), 2 * half + lane, 4, 'grey');
    for (const s of [-1, 1]) {
      b.pieces.push({ type: 'path', from: b.at(4, s * half), to: b.at(4 + len, s * half), width: lane, palette: 'orange' });
    }
    b.pad(b.at(4 + len + 2), 2 * half + lane, 4, 'grey');
    const side = rand() < 0.5 ? 1 : -1;
    b.wp(b.at(3, side * half), { speed: 8, lane: 0 });
    b.wp(b.at(4 + len, side * half), { speed: 10, lane: 0 });
    b.wp(b.at(4 + len + 3), { speed: 8, lane: 0 });
    b.cur = b.at(4 + len + 4);
    return true;
  },
  stairs(b, rand) {
    // Steps down: the ball drops from one to the next.
    const steps = 3 + Math.floor(rand() * 2), depth = 7, rise = 1.2;
    if (!b.claim(b.cur, b.at(steps * depth, 0, -steps * rise), 6)) return false;
    for (let i = 0; i < steps; i++) b.pad(b.at(i * depth + depth / 2, 0, -(i + 1) * rise), 10, depth, i % 2 ? 'grey' : b.palette());
    const end = b.at(steps * depth, 0, -steps * rise);
    b.wp(end, { speed: 9 });
    b.cur = end;
    return true;
  },
  gauntlet(b, rand) {
    // A wide path with no rails and spinning arms along it.
    const len = 30, width = 12;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2 + 1)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: b.palette() });
    for (const [i, ahead] of [9, 21].entries()) {
      const spin = (0.7 + rand() * 0.4) * (i % 2 ? 1 : -1);
      b.pieces.push({ type: 'sweeper', position: b.at(ahead), length: 9, speed: r2(spin * 10) / 10 });
    }
    b.wp(b.at(len - 1), { speed: 12 });
    b.cur = to;
    return true;
  },
  boostRamp(b, rand) {
    // A speed strip, then a climb the boost carries you up.
    const rise = 5 + Math.floor(rand() * 2) * 2, flat = 10, ramp = 24, top = 12;
    const crest = b.at(flat + ramp, 0, rise), end = b.at(flat + ramp + top, 0, rise);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: b.at(flat), width: 9, rails: true, palette: b.palette() });
    b.pieces.push({ type: 'boost', position: b.at(5), yaw: b.yaw, w: 6, d: 3 });
    b.pieces.push({ type: 'path', from: b.at(flat), to: crest, width: 9, rails: true, palette: b.palette() });
    b.pieces.push({ type: 'path', from: crest, to: end, width: 9, rails: true, palette: 'grey' });
    b.wp(b.at(3), { speed: 12, lane: 0.5 });
    b.fast(b.at(flat + 2), 30);
    b.wp(end, { speed: 10 });
    b.cur = end;
    return true;
  },
  boostJump(b, rand) {
    // Run-up, boost strip, kicker, a long gap, and a walled landing below.
    const gap = 13 + Math.floor(rand() * 3), land = 24, total = 22 + gap + land;
    if (!b.claim(b.cur, b.at(total, 0, -2), 7, 2)) return false;
    const runup = b.at(6);
    b.pad(runup, 10, 12, 'grey');
    b.pieces.push({ type: 'checkpoint', position: runup });
    b.pieces.push({ type: 'boost', position: b.at(9), yaw: b.yaw, w: 6, d: 3 });
    b.pieces.push({ type: 'path', from: b.at(12), to: b.at(22, 0, 2), width: 8, rails: true, palette: 'orange' });
    b.pad(b.at(22 + gap + land / 2, 0, -2), 12, land, b.palette());
    b.sideWalls(22 + gap, total, 6, -2);
    b.wp(b.at(7), { speed: 12, lane: 0 });
    b.fast(b.at(22 + gap + 8, 0, -2), 30);
    b.wp(b.at(total - 2, 0, -2), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(total, 0, -2);
    return true;
  },
  springUp(b, rand) {
    // Bounce off a spring onto a ledge above: 18 up and 8 forward lands about 9 ahead.
    const rise = 4 + Math.floor(rand() * 2), end = 29;
    if (!b.claim(b.cur, b.at(end, 0, rise), 6)) return false;
    b.pad(b.at(6.5), 10, 13, 'grey');
    b.pieces.push({ type: 'checkpoint', position: b.at(3) });
    b.pieces.push({ type: 'spring', position: b.at(8), power: 18, push: 8, yaw: b.yaw });
    b.pad(b.at(21, 0, rise), 10, 16, b.palette(), rise + 1); // a solid ledge: its face is a wall
    b.wp(b.at(8), { speed: 6, lane: 0 });
    b.wp(b.at(22, 0, rise), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, rise);
    return true;
  },
  lift(b, rand) {
    // Ride an elevator up to a tower top.
    const rise = 7 + Math.floor(rand() * 3), end = 30;
    if (!b.claim(b.cur, b.at(end, 0, rise), 5)) return false;
    b.pad(b.at(5), 10, 10, 'grey');
    b.pieces.push({ type: 'checkpoint', position: b.at(5) });
    b.pieces.push({ type: 'mover', from: b.at(13), to: b.at(13, 0, rise), w: 6, d: 6, period: r2(rise * 0.8 + 1), palette: 'purple' });
    b.pad(b.at(23, 0, rise), 10, 14, b.palette(), rise + 1);
    b.wp(b.at(8), { speed: 5, lane: 0 });
    b.route.push({ p: b.at(13), wait: true, speed: 5 });
    b.route.push({ p: b.at(13, 0, rise), wait: true, speed: 3 });
    b.wp(b.at(24, 0, rise), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, rise);
    return true;
  },
  updraft(b, rand) {
    // Roll off an edge into a column of rising air that lifts you onto a ledge above.
    const rise = 4 + Math.floor(rand() * 2), gap = 12, end = 8 + gap + 16;
    if (!b.claim(b.cur, b.at(end, 0, rise), 6, 4)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.pieces.push({ type: 'checkpoint', position: b.at(4) });
    const top = rise + 2, bottom = -12;
    const c = b.at(8 + gap / 2, 0, (top + bottom) / 2);
    const [dx, dz] = b.dir;
    b.pieces.push({ type: 'wind', center: c, size: b.size(9, top - bottom, gap), dir: [dx * 0.2, 1, dz * 0.2], speed: 10, strength: 60 });
    b.pad(b.at(8 + gap + 8, 0, rise), 10, 16, b.palette(), rise + 1);
    b.wp(b.at(6), { speed: 8, lane: 0 });
    b.wp(b.at(8 + gap + 6, 0, rise), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, rise);
    return true;
  },
  crumbleBridge(b, rand) {
    // A bridge of tiles that fall away just after you touch them: don't stop.
    const tiles = 4 + Math.floor(rand() * 2), tileD = 4, span = tiles * tileD, end = 8 + span + 8;
    if (!b.claim(b.cur, b.at(end), 5)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.pieces.push({ type: 'checkpoint', position: b.at(4) });
    for (let i = 0; i < tiles; i++) {
      const c = b.at(8 + tileD * (i + 0.5));
      const [w, , d] = b.size(5, 1, tileD);
      b.pieces.push({ type: 'crumble', center: c, w, d, delay: 0.5, respawn: 3 });
    }
    b.pad(b.at(8 + span + 4), 10, 8, 'grey');
    b.wp(b.at(6), { speed: 10, lane: 0 });
    b.wp(b.at(8 + span + 4), { speed: 11, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  conveyor(b) {
    // A belt that carries you forward (faster than you can roll), then a runout.
    const len = 26, run = 12, end = b.at(len + run);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'conveyor', from: b.cur, to: b.at(len), width: 8, speed: 9, rails: true });
    b.pieces.push({ type: 'path', from: b.at(len), to: end, width: 8, rails: true, palette: 'grey' });
    b.wp(b.at(len), { speed: 14 });
    b.wp(end, { speed: 9 });
    b.cur = end;
    return true;
  },
  treadmill(b, rand) {
    // Climb a belt that runs down toward you.
    const len = 26, rise = 3 + Math.floor(rand() * 2), top = b.at(len, 0, rise), end = b.at(len + 10, 0, rise);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'conveyor', from: top, to: b.cur, width: 8, speed: 7, rails: true });
    b.pieces.push({ type: 'path', from: top, to: end, width: 8, rails: true, palette: 'grey' });
    // Bots ease off near a waypoint (relative to the belt), so aim past the top, not at it.
    b.wp(end, { speed: 16 });
    b.cur = end;
    return true;
  },
  windBridge(b, rand, opts) {
    // A narrow bridge in a crosswind: lean into it.
    const len = 22, width = Math.max(4.5, opts.bridgeWidth ?? 5), side = rand() < 0.5 ? 1 : -1;
    const to = b.at(len);
    if (!b.claim(b.cur, to, 7)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: 'orange' });
    const [rx, rz] = b.right;
    b.pieces.push({ type: 'wind', center: b.at(len / 2, 0, 2), size: b.size(16, 6, len), dir: [rx * side, 0, rz * side], speed: 4, strength: 10 });
    b.wp(b.at(1), { speed: 8, lane: 0 });
    b.wp(to, { speed: 8, lane: 0 });
    b.cur = to;
    return true;
  },
  moonJump(b, rand) {
    // Low gravity: a kicker sends you floating over a gap you could never clear normally.
    const gap = 18 + Math.floor(rand() * 3) * 2, land = 20, total = 18 + gap + land;
    if (!b.claim(b.cur, b.at(total, 0, -1), 7, 3)) return false;
    const runup = b.at(5);
    b.pad(runup, 10, 10, 'grey');
    b.pieces.push({ type: 'checkpoint', position: runup });
    b.pieces.push({ type: 'path', from: b.at(10), to: b.at(18, 0, 3), width: 8, rails: true, palette: 'purple' });
    b.pad(b.at(18 + gap + land / 2, 0, -1), 12, land, b.palette());
    b.sideWalls(18 + gap, total, 6, -1);
    b.pieces.push({ type: 'lowgrav', center: b.at(10 + (total - 10) / 2, 0, 1.5), size: b.size(18, 33, total - 10), scale: 0.3 });
    b.wp(b.at(8), { speed: 14, lane: 0 });
    b.wp(b.at(18 + gap + 8, 0, -1), { speed: 14, lane: 0 });
    b.wp(b.at(total - 2, 0, -1), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(total, 0, -1);
    return true;
  },
  zigzag(b, rand) {
    const side = rand() < 0.5 ? 1 : -1;
    const c1 = b.at(14, side * 7), c2 = b.at(28, 0);
    if (!b.claim(b.cur, c1, 4) || !b.claim(c1, c2, 4)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: c1, width: 5, palette: 'orange' });
    b.pieces.push({ type: 'pad', center: c1, w: 7, d: 7, palette: 'grey' });
    b.pieces.push({ type: 'path', from: c1, to: c2, width: 5, palette: 'orange' });
    b.wp(b.at(12.5, side * 6.25), { speed: 9, lane: 0 });
    b.wp(c1, { speed: 6, lane: 0 });
    b.wp(c2, { speed: 9, lane: 0 });
    b.cur = c2;
    return true;
  },
};

/** Chains `opts.length` segments onto the builder, then a goal pad. False if it can't fit them. */
function buildCourse(b: CourseBuilder, rand: () => number, opts: GenOptions): boolean {
  const entries = Object.entries(opts.weights).filter(([, w]) => (w ?? 0) > 0) as [Segment, number][];
  const total = entries.reduce((n, [, w]) => n + w, 0);
  const pick = (): Segment => {
    let r = rand() * total;
    for (const [s, w] of entries) if ((r -= w) <= 0) return s;
    return entries[0][0];
  };

  let placed = 0, prev: Segment | null = null;
  for (let tries = 0; placed < opts.length && tries < opts.length * 8; tries++) {
    const seg = pick();
    if (seg === prev && seg !== 'straight') continue; // variety
    const snapshot = { pieces: b.pieces.length, route: b.route.length, cur: b.cur, dir: b.dir, rects: b.rects.length };
    if (SEGMENTS[seg](b, rand, opts)) {
      placed++;
      prev = seg;
      b.checkpointsSince++;
      if (b.checkpointsSince >= 3 && seg !== 'turn') {
        // Keep checkpoints regular: a small pad after every few segments.
        const c = b.at(5);
        if (b.claim(b.at(0, -5), b.at(10, 5), 0)) {
          b.pad(c, 10, 10, 'grey');
          b.pieces.push({ type: 'checkpoint', position: c });
          b.wp(c, { speed: 10 });
          b.cur = b.at(10);
          b.checkpointsSince = 0;
        }
      }
    } else {
      b.pieces.length = snapshot.pieces;
      b.route.length = snapshot.route;
      b.cur = snapshot.cur;
      b.dir = snapshot.dir;
      b.rects.length = snapshot.rects; // release the space a failed segment had claimed
    }
  }
  if (placed < opts.length) return false;

  // Goal pad with a back wall.
  const goal = b.at(7);
  if (!b.claim(b.at(0, -6), b.at(12, 6), 0)) return false;
  b.pad(goal, 12, 12, 'green');
  const wall = b.at(12.25, 0, 1.5);
  b.pieces.push({ type: 'block', position: wall, size: b.dir[0] !== 0 ? [0.5, 3, 12] : [12, 3, 0.5], color: '#f4f4f4' });
  b.pieces.push({ type: 'goal', position: goal });
  b.wp(goal, { speed: 6 });
  return true;
}

export function generateLevel(opts: GenOptions): LevelData | null {
  const rand = rng(opts.seed);
  const b = new CourseBuilder(opts.maxSpeed ?? 16);
  b.pieces.push({ type: 'pad', center: [0, 0, 0], w: 12, d: 12, palette: 'grey' });
  b.claim([0, 0, -6], [0, 0, 6], 6);
  if (!buildCourse(b, rand, opts)) return null;
  return {
    format: 1,
    name: opts.name,
    theme: opts.theme,
    start: { position: [0, 1, 2], yaw: 0 },
    pieces: b.pieces,
    route: b.route,
  };
}

/**
 * Continues a hand-made course past its finish: the old goal pad becomes a checkpoint and
 * `opts.length` new segments lead to a new goal. The course must end heading along an axis.
 * Safety walls (see guard.ts) are dropped; re-add them afterwards.
 */
export function extendLevel(base: LevelData, opts: GenOptions): LevelData | null {
  const rand = rng(opts.seed);
  const b = new CourseBuilder(opts.maxSpeed ?? 16);
  const goal = base.pieces.find((p) => p.type === 'goal');
  const route = base.route ?? [];
  if (!goal || goal.type !== 'goal' || route.length < 2) return null;
  const pad = base.pieces.find((p) => p.type === 'pad' && Math.abs(p.center[1] - goal.position[1]) < 0.5
    && Math.abs(p.center[0] - goal.position[0]) <= p.w / 2 && Math.abs(p.center[2] - goal.position[2]) <= p.d / 2);
  if (!pad || pad.type !== 'pad') return null;

  // Heading: the last leg of the route, snapped to an axis.
  const [a, z] = [route[route.length - 2].p, route[route.length - 1].p];
  const dx = z[0] - a[0], dz = z[2] - a[2];
  b.dir = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
  const half = b.dir[0] !== 0 ? pad.w / 2 : pad.d / 2;
  const c = pad.center;
  const farEdge: Vec3 = [c[0] + b.dir[0] * half, c[1], c[2] + b.dir[1] * half];

  // Keep everything except the goal, safety walls and the back wall at the pad's far edge.
  const isBackWall = (p: LevelData['pieces'][number]) => p.type === 'block' && p.position[1] >= c[1] && p.position[1] < c[1] + 3
    && Math.abs((p.position[0] - farEdge[0]) * b.dir[0] + (p.position[2] - farEdge[2]) * b.dir[1]) < 1
    && Math.abs((p.position[0] - c[0]) * -b.dir[1] + (p.position[2] - c[2]) * b.dir[0]) < (b.dir[0] !== 0 ? pad.d : pad.w) / 2 + 1;
  b.pieces = base.pieces.filter((p) => p.type !== 'goal' && !(p.type === 'block' && p.color === GUARD_COLOR) && !isBackWall(p));
  b.pieces.push({ type: 'checkpoint', position: goal.position });
  b.route = route.map((r, i) => (i === route.length - 1 ? { ...r, speed: 10 } : r));

  // Existing floors take up space, the old goal pad last (the new course attaches to it).
  for (const p of b.pieces) {
    if (p === pad) continue;
    if (p.type === 'pad' || p.type === 'crumble') b.occupy([p.center[0] - p.w / 2, p.center[1], p.center[2] - p.d / 2], [p.center[0] + p.w / 2, p.center[1], p.center[2] + p.d / 2], 0);
    if (p.type === 'path' || p.type === 'conveyor') b.occupy(p.from, p.to, p.width / 2);
  }
  b.occupy([c[0] - pad.w / 2, c[1], c[2] - pad.d / 2], [c[0] + pad.w / 2, c[1], c[2] + pad.d / 2], 0);
  b.cur = farEdge;
  b.checkpointsSince = 0;
  if (!buildCourse(b, rand, opts)) return null;
  return { ...base, medals: undefined, pieces: b.pieces, route: b.route };
}
