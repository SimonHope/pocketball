import type { Vec3 } from '../sim/math';
import { GUARD_COLOR, type LevelData, type Palette, type Piece, type RoutePoint, type StarPiece } from './schema';
import { gravityOf, type ThemeName } from './themes';
import { SIM } from '../config';

// Builds race courses by chaining segments (straights, ramps, turns, curves, bridges,
// moving-platform gaps, sweeper pads, zig-zags, jumps, and for downhill courses steep plunges,
// corkscrews, cliff drops and cascades) and writes the bot route as it goes. Generated courses are
// starting points: scripts/generate-levels.ts keeps only ones the autopilot can finish,
// and designers refine them in the editor.
//
// With `acts`, a course is paced like a story instead of a random mix: an intro shows the
// course's signature mechanic in its easiest form, the build-up mixes it with other segments
// as they get harder, the twist brings combos (two mechanics at once) and a risk/reward fork,
// and the finale is the signature mechanic at its hardest, right before the goal. Each segment
// gets a difficulty `d` (0 = gentle, 1 = as hard as the bots can reliably manage) that sets its
// gaps, widths and speeds.
//
// Stars: each course hides `stars` collectibles, and each one asks you to use the segment's own
// mechanic harder or differently than the safe line does: a super spring beside the normal one,
// the edge line of a jump, a swerve in low gravity, a crumbling side tile, a ledge downwind, a
// star riding a sweeper's tip or its own lift, or a switch star that shows for a few seconds
// (beat the timer: take the shortcut, don't brake). A course never repeats a kind of star; a
// dead-end spur is the last resort. The bot `route` stays on the safe line; `starRoute` takes
// the risky lines and collects every star.

export type Segment =
  | 'straight' | 'slalom' | 'rampDown' | 'rampUp' | 'turn' | 'bridge' | 'mover' | 'sideMover' | 'sweeper' | 'zigzag'
  | 'curve' | 'hairpin' | 'jump' | 'split' | 'stairs' | 'gauntlet'
  | 'steep' | 'spiral' | 'drop' | 'cascade'
  | 'boostRamp' | 'boostJump' | 'springUp' | 'lift' | 'updraft' | 'crumbleBridge' | 'conveyor' | 'treadmill' | 'windBridge' | 'moonJump'
  // Risk/reward: a railed detour beside a faster narrow line. A dead-end spur with a star.
  | 'fork' | 'starSpur'
  // Combos: two mechanics at once.
  | 'sweeperBelt' | 'windCrumble' | 'boostSpring' | 'liftWind' | 'bumperTreadmill' | 'crumbleJump'
  // Moving floors and obstacles on the clock (see MECHANICS.md).
  | 'brakePad' | 'pinball' | 'keys' | 'turntable' | 'pendulum' | 'rocker' | 'rollers' | 'paperWall'
  | 'ironBall' | 'wheel' | 'trickGates' | 'logSlope';

/** How a course is paced (see the top of this file). */
export interface Acts {
  /** The signature mechanic(s), shown first in their easiest form. */
  intro: Segment[];
  /** Combos for the twist; a fork is always the twist's first segment. */
  twist: Segment[];
  /** The signature mechanic at its hardest, just before the goal. */
  finale: Segment[];
  /** The risk/reward choice the twist opens with (one is picked; default: a fork). */
  risk?: Segment[];
}

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
  /** Hard sections in a row before a breather (default 2; ice runs 3, because its feeling is endurance). */
  hardRun?: number;
  /** Cap on bot speeds (lower on ice). */
  maxSpeed?: number;
  /** Mountain descent: every curve and switchback drops. */
  downhill?: boolean;
  /** Pacing: intro → build-up (`weights`) → twist → finale. Without it, every segment is drawn from `weights` at full difficulty. */
  acts?: Acts;
  /** How many stars to hide (default 0). */
  stars?: number;
  /** Without acts: every segment at this difficulty (0..1, default 1). The mechanic sandbox uses it. */
  difficulty?: number;
  /** Mechanics switched off (MECHANICS.md's "On" column): never placed, even if a course asks for them. */
  off?: { segments?: Segment[]; stars?: StarKind[] };
  /** Called for each segment placed, in order, with the kind of star it hid if any (for tools and tests). */
  onSegment?: (segment: Segment, act: Act, difficulty: number, star?: StarKind) => void;
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
const q4 = (n: number) => Math.round(n * 4) / 4;
/** `a` at difficulty 0, `b` at difficulty 1. */
const mix = (a: number, b: number, d: number) => a + (b - a) * d;
/** Height of a star's centre above the floor it sits on. */
const STAR_HEIGHT = 1.4;
/** Checkpoints closer than this to the previous one are left out. */
const CHECKPOINT_GAP = 20;
/** Seconds a switch star shows before generate-levels tunes it from the bot's run. */
const SWITCH_TIME = 8;

/** The kinds of star challenge (a course uses each at most once). */
export type StarKind =
  | 'super'     // springUp: a stronger spring beside the normal one, the star at its apex
  | 'edge'      // jumps: the star over the gap off the edge line of the kicker
  | 'moon'      // moonJump: swerve in low gravity to a star beside the arc
  | 'column'    // updraft: stay in the column to a star near its top
  | 'fall'      // drop: roll off the edge at the side to fall through it
  | 'detour'    // crumble bridges: an extra crumbling tile sticking out to the side
  | 'downwind'  // windBridge: an open ledge the wind blows you toward
  | 'tightrope' // bridge: a thin open beam alongside
  | 'fastLane'  // conveyor: a narrow, faster, open belt alongside
  | 'crest'     // boostRamp: the crest's edge, at boost speed
  | 'lane'      // split: the narrow open lane
  | 'corner'    // zigzag: the corner's outer tip
  | 'gap'       // gauntlet: between the arms at the open edge
  | 'tip'       // sweeper: rides the arm's tip; catch it from a corner
  | 'elevator'  // lift: rides its own lift beside the tower; catch it at the top edge
  | 'firstRide' // mover: switch star on the far pad, time for one platform trip
  | 'shortcut'  // fork: on the risky line
  | 'race'      // fork: switch star at the exit only the risky line beats
  | 'noBrake'   // downhill: switch star at the bottom, don't brake
  | 'lip'       // brakePad: just past the pad's far edge; stop at the brink
  | 'pocket'    // pinball: in a pocket a sliding toadstool slides into
  | 'beat'      // keys: over a side key in time with its neighbour
  | 'rim'       // turntable: rides the disc near its rim
  | 'arc'       // pendulum: at the edge of the swing, where the bob comes low
  | 'tilt'      // rocker: just off the edge that dips
  | 'pinch'     // rollers: out in a row, between the logs
  | 'smash'     // paperWall: switch star; only tearing straight through beats it
  | 'steer'     // ironBall: over the spike field, off the straight line
  | 'climb'     // wheel: switch star; only the very next step beats it
  | 'peek'      // trickGates: behind a narrow door that opens half as often
  | 'dodge'     // logSlope: out in a lane between two bays
  | 'spur';     // a dead-end spur (fallback)

/** Every star kind, at run time (MECHANICS.md lists each one; the record makes sure none is missed here). */
const STAR_KIND_SET: Record<StarKind, true> = {
  super: true, edge: true, moon: true, column: true, fall: true, detour: true, downwind: true, tightrope: true, fastLane: true,
  crest: true, lane: true, corner: true, gap: true, tip: true, elevator: true, firstRide: true, shortcut: true, race: true,
  noBrake: true, lip: true, pocket: true, beat: true, rim: true, arc: true, tilt: true, pinch: true, smash: true, steer: true, climb: true, peek: true, dodge: true, spur: true,
};
export const STAR_KINDS = Object.keys(STAR_KIND_SET) as StarKind[];

class CourseBuilder {
  pieces: Piece[] = [];
  /** The safe line (bots, tests, live placings). */
  route: RoutePoint[] = [];
  /** The risky line: like `route`, but through forks' fast sides and past every star. */
  alt: RoutePoint[] = [];
  /** Set while the course still needs a star here: segments that can hide one then do. */
  wantStar = false;
  starCount = 0;
  /** Kinds of star already on the course, in order (one of each). */
  starKinds: StarKind[] = [];
  /** Kinds switched off in MECHANICS.md. */
  offKinds = new Set<StarKind>();
  cur: Vec3 = [0, 0, -6];   // floor point at the open edge where the next segment attaches
  dir: [number, number] = [0, -1];
  rects: Rect[] = [];
  private paletteIndex = 0;
  checkpointsSince = 0;
  /** The last checkpoint placed (so two never end up a few units apart). */
  lastCheckpoint: Vec3 | null = null;

  /** This world's gravity (night's rule lightens it), for jump and spring arcs. */
  constructor(private maxSpeed: number, readonly gravity = SIM.gravity) {}

  get right(): [number, number] { return [-this.dir[1], this.dir[0]]; }
  at(ahead: number, side = 0, dy = 0): Vec3 {
    const [dx, dz] = this.dir, [rx, rz] = this.right;
    return [r2(this.cur[0] + dx * ahead + rx * side), this.cur[1] + dy, r2(this.cur[2] + dz * ahead + rz * side)];
  }
  palette() { return PALETTE_CYCLE[this.paletteIndex++ % PALETTE_CYCLE.length]; }
  speed(s: number) { return Math.min(s, this.maxSpeed); }
  private point(p: Vec3, extra: Omit<RoutePoint, 'p'>): RoutePoint {
    return { p, ...extra, ...(extra.speed ? { speed: this.speed(extra.speed) } : {}) };
  }
  /** A waypoint on both routes. */
  wp(p: Vec3, extra: Omit<RoutePoint, 'p'> = {}) {
    this.route.push(this.point(p, extra));
    this.alt.push(this.point(p, extra));
  }
  /** A waypoint on the safe line only. */
  safeWp(p: Vec3, extra: Omit<RoutePoint, 'p'> = {}) { this.route.push(this.point(p, extra)); }
  /** A waypoint on the risky line only. */
  riskyWp(p: Vec3, extra: Omit<RoutePoint, 'p'> = {}) { this.alt.push(this.point(p, extra)); }
  /** Whether the course wants a star of `kind` here (check before building extra pieces for it). */
  offers(kind: StarKind): boolean {
    return this.wantStar && !this.offKinds.has(kind) && (kind === 'spur' || !this.starKinds.includes(kind));
  }
  /**
   * Puts a star of `kind` `lift` above point `p` if the course wants one here. `extra` makes it
   * ride (`to`/`period`, `center`/`speed`, in absolute coordinates) or a switch star (`button`).
   */
  star(p: Vec3, kind: StarKind, extra: Partial<Omit<StarPiece, 'type' | 'position'>> = {}, lift = STAR_HEIGHT): boolean {
    if (!this.offers(kind)) return false;
    this.pieces.push({ type: 'star', position: [p[0], p[1] + lift, p[2]], ...extra });
    this.starCount++;
    this.starKinds.push(kind);
    this.wantStar = false;
    return true;
  }

  /** Marks space as taken without checking (existing pieces of a course being extended). */
  occupy(a: Vec3, b: Vec3, halfWidth: number) {
    this.rects.push({
      minX: Math.min(a[0], b[0]) - halfWidth, maxX: Math.max(a[0], b[0]) + halfWidth,
      minZ: Math.min(a[2], b[2]) - halfWidth, maxZ: Math.max(a[2], b[2]) + halfWidth,
      yMin: Math.min(a[1], b[1]), yMax: Math.max(a[1], b[1]),
    });
  }

  /**
   * A checkpoint at floor point `p`, unless the last one is close by. That happens when a
   * segment starts with its own checkpoint right after the regular checkpoint pad.
   */
  checkpoint(p: Vec3) {
    const l = this.lastCheckpoint;
    if (l && Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]) < CHECKPOINT_GAP) return;
    this.pieces.push({ type: 'checkpoint', position: p });
    this.lastCheckpoint = p;
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
  /** A waypoint at `side` 0 on the safe line and at side `e` on the risky line (one shared waypoint if `e` is 0). */
  lineWp(e: number, at: (side: number) => Vec3, extra: Omit<RoutePoint, 'p'> = {}) {
    if (!e) return this.wp(at(0), extra);
    this.safeWp(at(0), extra);
    this.riskyWp(at(e), extra);
  }
  /** A waypoint whose speed isn't capped (boosted sections), on both routes or just one. */
  fast(p: Vec3, speed: number, line: 'both' | 'safe' | 'risky' = 'both') {
    if (line !== 'risky') this.route.push({ p, speed, lane: 0 });
    if (line !== 'safe') this.alt.push({ p, speed, lane: 0 });
  }
}

/**
 * A jump's edge-line star: over the gap at `ahead`, `lift` above the segment's start floor and
 * `edge` off to one side, so only a ball that took the kicker on its edge flies through it.
 * Returns the side offset of that line (0 if the course doesn't want the star here).
 */
function edgeStar(b: CourseBuilder, rand: () => number, ahead: number, lift: number, edge: number): number {
  const e = (rand() < 0.5 ? 1 : -1) * edge;
  return b.star(b.at(ahead, e), 'edge', {}, lift) ? e : 0;
}

/**
 * A risky way past a wait: springs floating in a row, each on a small open block, from
 * `springs[0]` (on the floor) to a landing on floor point `land`. Each spring throws you onto
 * the next: it sets your speed outright (up `power`, along `push`), so every hop flies the same
 * arc, peaking 1.5 above where it lands. Miss one and you fall.
 */
const HOP_RADIUS = 1.6;
const HOP_PUSH = 9;
const HOP_RIM = 1.5; // a ball touches a spring (and is thrown) about this far before its middle
const HOP_LAND = 0.6; // aim each hop this far short of the next spring's middle: well on it, clear of its pad's edge
function springHops(b: CourseBuilder, springs: Vec3[], land: Vec3) {
  const g = b.gravity;
  // Where you leave from: the near rim of the first spring as you roll onto it.
  const toward = (from: Vec3, to: Vec3) => { const l = Math.hypot(to[0] - from[0], to[2] - from[2]); return [(to[0] - from[0]) / l, (to[2] - from[2]) / l]; };
  let [ux, uz] = toward(springs[0], springs[1] ?? land);
  let off: Vec3 = [springs[0][0] - ux * HOP_RIM, springs[0][1], springs[0][2] - uz * HOP_RIM];
  b.riskyWp([r2(springs[0][0] - ux * 4), springs[0][1], r2(springs[0][2] - uz * 4)], { speed: 4, lane: 0 }); // line up behind it
  springs.forEach((spring, i) => {
    const next = springs[i + 1], target = next ?? land;
    [ux, uz] = toward(off, target);
    const along = Math.hypot(target[0] - off[0], target[2] - off[2]) - (next ? HOP_LAND : 0);
    const rise = target[1] - spring[1] - (next ? 0 : 0.2);
    // Peak 1.5 above the landing, or higher for a long flat hop so the throw along stays gentle.
    // Aim for 2: the ball's drag takes some height off, and a peak that only just clears the
    // landing comes down short of it (it did under night's lighter gravity).
    const airtime = (power: number) => (power + Math.sqrt(power * power - 2 * g * rise)) / g; // up and back down to the landing
    let power = Math.ceil(Math.sqrt(2 * g * (Math.max(rise, 0) + 2)));
    while (along / airtime(power) > HOP_PUSH) power++;
    const air = airtime(power);
    const yaw = Math.round((Math.atan2(-ux, -uz) * 180) / Math.PI);
    if (i > 0) b.pieces.push({ type: 'pad', center: spring, w: HOP_RADIUS * 2 + 0.4, d: HOP_RADIUS * 2 + 0.4, palette: 'orange', open: true });
    // Drag slows the throw along too: over `air` seconds it covers (1 - e^(-k air)) / k of its speed, not `air`.
    const k = SIM.ball.linearDamping, push = r2((along * k) / (1 - Math.exp(-k * air)));
    b.pieces.push({ type: 'spring', position: spring, radius: HOP_RADIUS, power, push, yaw });
    // Aim at where this hop lands, at the speed it throws you (a slower aim would brake in the air).
    // Not at the first spring's middle: it throws you before you get there.
    b.fast(next ?? land, push, 'risky');
    if (next) off = [next[0] - ux * HOP_LAND, next[1], next[2] - uz * HOP_LAND];
  });
}

/** An extra open crumbling tile (two tiles long) beside a bridge's tiles `k` and `k + 1`, with a star on it. */
function crumbleDetour(b: CourseBuilder, s: number, k: number, tileW: number, tileD: number, delay: number) {
  if (!b.offers('detour')) return;
  const c = b.at(8 + tileD * (k + 1), s * (tileW / 2 + 2));
  const [w, , depth] = b.size(4, 1, tileD * 2);
  b.pieces.push({ type: 'crumble', center: c, w, d: depth, delay, respawn: 3, open: true });
  b.star(c, 'detour');
  // Step out from the middle of tile k and back onto tile k + 2 (or the pad after it): both
  // crossings are where the side tile runs alongside, so no safety wall is in the way.
  b.riskyWp(b.at(8 + tileD * (k + 0.5)), { speed: 8, lane: 0 });
  b.riskyWp(c, { speed: 7, lane: 0 });
  b.riskyWp(b.at(8 + tileD * (k + 2.25)), { speed: 8, lane: 0 });
}

/**
 * Downhill switch star: a button where the segment starts (everyone rolls over it), the star
 * where it ends. Don't brake: the star route runs it flat out, and the timer is set from that.
 */
function noBrake(b: CourseBuilder, button: Vec3, build: () => boolean): boolean {
  const offer = b.offers('noBrake'), from = b.alt.length;
  if (!build()) return false;
  if (offer && b.star(b.at(-3), 'noBrake', { button, time: SWITCH_TIME })) {
    for (const wp of b.alt.slice(from)) wp.speed = b.speed((wp.speed ?? 16) * 1.4);
  }
  return true;
}

/** Builds one segment at difficulty `d` (0..1). False (with nothing to undo yet) if it doesn't fit. */
type Build = (b: CourseBuilder, rand: () => number, opts: GenOptions, d: number) => boolean;

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
  slalom(b, rand, _opts, d) {
    const len = 24, width = 10;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, rails: true, palette: b.palette() });
    let side = rand() < 0.5 ? 1 : -1;
    for (const ahead of d < 0.35 ? [8, 16] : [7, 14, 21]) {
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
    b.checkpoint(center);
    b.wp(center, { speed: 7 });
    b.checkpointsSince = 0;
    const [rx, rz] = b.right;
    b.dir = [rx * turn, rz * turn];
    b.cur = [r2(center[0] + b.dir[0] * size / 2), center[1], r2(center[2] + b.dir[1] * size / 2)];
    return true;
  },
  bridge(b, rand, opts, d) {
    const len = 14 + Math.floor(rand() * 3) * 3;
    const width = r2(mix(5.5, opts.bridgeWidth ?? 4, d)) + Math.floor(rand() * 2) * 0.5;
    const to = b.at(len);
    // With a star: a thin open beam alongside (a tightrope), joined at each end by a small pad.
    const rope = b.offers('tightrope'), s = rand() < 0.5 ? 1 : -1, beam = r2(mix(3, 2.5, d)), off = width / 2 + 1.5 + beam / 2;
    if (!b.claim(b.cur, to, rope ? off + beam / 2 : width / 2)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: 'orange' });
    b.wp(b.at(1), { speed: 8, lane: 0 });
    if (rope) {
      const across = off + beam / 2 + width / 2, mid = (s * (off + beam / 2 - width / 2)) / 2;
      b.pad(b.at(1.5, mid), across, 3, 'grey');
      b.pad(b.at(len - 1.5, mid), across, 3, 'grey');
      b.pieces.push({ type: 'path', from: b.at(3, s * off), to: b.at(len - 3, s * off), width: beam, palette: 'orange', open: true });
      b.star(b.at(len / 2, s * off), 'tightrope');
      b.riskyWp(b.at(2, s * off), { speed: 6, lane: 0 });
      b.riskyWp(b.at(len - 2, s * off), { speed: 8, lane: 0 });
    }
    b.wp(to, { speed: 9, lane: 0 });
    b.cur = to;
    return true;
  },
  mover(b, rand, _opts, d) {
    // Pad, a gap crossed by a platform sliding back and forth along the course, pad.
    // Or skip the wait: a spring at the near pad's side throws you onto one floating in the gap,
    // and that one onto the far pad.
    const gap = 10 + Math.round(d * 2) * 2 + Math.floor(rand() * 2) * 2;
    if (!b.claim(b.cur, b.at(8 + gap + 10), 8.5)) return false;
    const near = b.at(4);
    b.pad(near, 12, 8, 'grey');
    b.checkpoint(near);
    const edge = b.at(8);
    const from = b.at(8 + 3), to = b.at(8 + gap - 3);
    b.pieces.push({ type: 'mover', from, to, w: 6, d: 6, period: r2(Math.max(5, gap / 2.2)) });
    const far = b.at(8 + gap + 5);
    b.pad(far, 10, 10, 'grey');
    // A switch star: its button is on the near pad and the star on the far one, with time for
    // one platform trip. Press it as the platform comes, not as it leaves.
    const q = rand() < 0.5 ? 1 : -1, button = b.at(2, -q * 2.5);
    if (b.star(far, 'firstRide', { button, time: SWITCH_TIME })) b.riskyWp(button, { speed: 5, lane: 0 });
    b.safeWp(b.at(6), { speed: 5, lane: 0 });
    b.safeWp(from, { wait: true, speed: 6 });
    b.safeWp(to, { wait: true, speed: 6 });
    springHops(b, [b.at(4, q * 3.8), b.at(8 + gap / 2, q * 6.5)], b.at(8 + gap + 3, q * 2));
    b.wp(far, { speed: 8 });
    b.checkpointsSince = 0;
    void edge;
    b.cur = b.at(8 + gap + 10);
    return true;
  },
  sideMover(b, rand, _opts, d) {
    // A platform sliding sideways across a gap: roll over it while it lines up.
    const gap = 6, period = r2(mix(9, 7.5, d));
    if (!b.claim(b.cur, b.at(8 + gap + 10), 10)) return false; // room for the platform's swing
    const near = b.at(4);
    b.pad(near, 12, 8, 'grey');
    const mid = 8 + gap / 2;
    const swing = 5 + Math.floor(rand() * 2);
    b.pieces.push({ type: 'mover', from: b.at(mid, -swing), to: b.at(mid, swing), w: 6, d: 6, period, palette: 'purple' });
    const far = b.at(8 + gap + 5);
    b.pad(far, 12, 10, 'grey');
    b.checkpoint(near);
    b.safeWp(b.at(6), { speed: 5, lane: 0 });
    b.safeWp(b.at(mid), { wait: true, speed: 9 });
    // Or don't wait: a spring at the pad's side throws you over the gap (and maybe into the platform).
    const q = rand() < 0.5 ? 1 : -1;
    springHops(b, [b.at(4, q * 3.8)], b.at(8 + gap + 4, q * 2));
    b.wp(b.at(8 + gap + 3), { speed: 7, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(8 + gap + 10);
    return true;
  },
  sweeper(b, rand, _opts, d) {
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
    const speed = r2((mix(0.8, 1.3, d) + rand() * 0.3) * (rand() < 0.5 ? -1 : 1) * 10) / 10;
    b.pieces.push({ type: 'sweeper', position: center, length: 13, speed });
    // A star riding just above the arm's tip (the arm lies along x at t = 0): wait in a far
    // corner, just out of the arm's reach, and snatch it as the tip swings past.
    const corner = b.at(size / 2 + 5.5, (rand() < 0.5 ? 1 : -1) * 5.5);
    if (b.star([center[0] + 6.3, center[1], center[2]], 'tip', { center, speed }, 2.2)) b.riskyWp(corner, { speed: 6, lane: 0, catch: true });
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
    return noBrake(b, b.at(1.5), () => arc(b, s, 12, drop, 8, palette) && arc(b, s, 12, drop, 8, palette));
  },
  steep(b, rand) {
    // A long railed plunge, then a flat runout to scrub off speed before whatever comes next.
    const len = 26 + Math.floor(rand() * 3) * 4, drop = 9 + Math.floor(rand() * 3) * 2;
    const bottom = b.at(len, 0, -drop), end = b.at(len + 12, 0, -drop);
    return noBrake(b, b.at(1.5, 0, -drop * 1.5 / len), () => {
      if (!b.claim(b.cur, end, 5)) return false;
      b.pieces.push({ type: 'path', from: b.cur, to: bottom, width: 9, rails: true, palette: b.palette() });
      b.pieces.push({ type: 'path', from: bottom, to: end, width: 9, rails: true, palette: 'grey' });
      b.wp(bottom, { speed: 12 });
      b.wp(end, { speed: 9 });
      b.cur = end;
      return true;
    });
  },
  spiral(b, rand) {
    // A full corkscrew: four curves the same way, passing 16 units under its own entrance.
    const s = rand() < 0.5 ? 1 : -1, palette = b.palette();
    return noBrake(b, b.at(1.5), () => {
      for (let i = 0; i < 4; i++) if (!arc(b, s, 12, 4, 8, palette)) return false;
      return true;
    });
  },
  drop(b, rand) {
    // Roll off a cliff edge onto a walled landing pad far below.
    const fall = 5 + Math.floor(rand() * 2) * 2, land = 20;
    if (!b.claim(b.cur, b.at(8 + land, 0, -fall), 8)) return false;
    const runup = b.at(4);
    b.pad(runup, 10, 8, 'grey');
    b.checkpoint(runup);
    const centre = b.at(8 + land / 2, 0, -fall);
    b.pad(centre, 14, land, b.palette());
    const [rx, rz] = b.right;
    for (const side of [-1, 1]) {
      // Low walls so a bouncy landing stays on the pad.
      const pos: Vec3 = [r2(centre[0] + rx * side * 7.25), centre[1] + 0.6, r2(centre[2] + rz * side * 7.25)];
      b.pieces.push({ type: 'block', position: pos, size: b.dir[0] !== 0 ? [land, 1.2, 0.5] : [0.5, 1.2, land], color: '#f4f4f4' });
    }
    // A star hanging just past the edge, off to one side: roll off there to fall through it.
    const f = (rand() < 0.5 ? 1 : -1) * 3;
    if (b.star(b.at(10.5, f), 'fall', {}, -0.2)) {
      b.safeWp(b.at(7), { speed: 8, lane: 0 });
      b.riskyWp(b.at(7, f), { speed: 8, lane: 0 });
    } else b.wp(b.at(7), { speed: 8, lane: 0 });
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
    // A switch star: the button just before the top step, the star at the bottom. Don't brake.
    const timed = b.star(b.at(steps * depth - 3, 0, -steps * rise), 'noBrake', { button: b.at(-1.5), time: SWITCH_TIME });
    for (let i = 0; i < steps; i++) {
      const c = b.at(i * depth + depth / 2, 0, -(i + 1) * rise);
      b.pad(c, 12, depth, i % 2 ? 'grey' : b.palette());
      const [rx, rz] = b.right;
      for (const side of [-1, 1]) {
        const pos: Vec3 = [r2(c[0] + rx * side * 6.25), c[1] + 0.6, r2(c[2] + rz * side * 6.25)];
        b.pieces.push({ type: 'block', position: pos, size: b.dir[0] !== 0 ? [depth, 1.2, 0.5] : [0.5, 1.2, depth], color: '#f4f4f4' });
      }
    }
    if (timed) {
      b.safeWp(end, { speed: 8 });
      b.riskyWp(end, { speed: 12 });
    } else b.wp(end, { speed: 8 });
    b.cur = end;
    return true;
  },
  jump(b, rand, _opts, d) {
    // Run-up pad with a checkpoint, a kicker ramp, an open gap, and a landing a little lower.
    const gap = 4 + Math.round(d) + Math.floor(rand() * 2);
    const total = 10 + 12 + gap + 16;
    if (!b.claim(b.cur, b.at(total, 0, -1), 6)) return false;
    const runup = b.at(5);
    b.pad(runup, 10, 10, 'grey');
    b.checkpoint(runup);
    const lip = b.at(22, 0, 2);
    b.pieces.push({ type: 'path', from: b.at(10), to: lip, width: 8, rails: true, palette: 'orange' });
    const landStart = b.at(22 + gap, 0, -1), landEnd = b.at(total, 0, -1);
    b.pieces.push({ type: 'path', from: landStart, to: landEnd, width: 12, palette: b.palette() });
    const e = edgeStar(b, rand, 22 + 3, 3, 2.75);
    b.lineWp(e, (side) => b.at(8, side), { speed: 16, lane: 0 });
    b.lineWp(e, (side) => b.at(22 + gap + 12, side, -1), { speed: 16, lane: 0 }); // aim far past the lip so the bot keeps its speed
    b.wp(landEnd, { speed: 9 });
    b.checkpointsSince = 0;
    b.cur = landEnd;
    return true;
  },
  split(b, rand, _opts, d) {
    // Two lanes around a hole in the floor: pick a side.
    const len = 16, lane = r2(mix(5, 4, d)) + Math.floor(rand() * 2) * 0.5, hole = 5;
    const half = hole / 2 + lane / 2;
    if (!b.claim(b.cur, b.at(4 + len + 4), half + lane / 2 + 1)) return false;
    b.pad(b.at(2), 2 * half + lane, 4, 'grey');
    const side = rand() < 0.5 ? 1 : -1, star = b.offers('lane');
    for (const s of [-1, 1]) {
      // With a star, its lane is narrower and has no safety walls.
      const risky = star && s === -side;
      b.pieces.push({
        type: 'path', from: b.at(4, s * half), to: b.at(4 + len, s * half), width: risky ? r2(mix(3.5, 3, d)) : lane, palette: 'orange',
        ...(risky ? { open: true } : {}),
      });
    }
    b.pad(b.at(4 + len + 2), 2 * half + lane, 4, 'grey');
    if (b.star(b.at(4 + len / 2, -side * half), 'lane')) {
      // The star is on the other lane: the risky route takes that one.
      b.safeWp(b.at(3, side * half), { speed: 8, lane: 0 });
      b.safeWp(b.at(4 + len, side * half), { speed: 10, lane: 0 });
      b.riskyWp(b.at(3, -side * half), { speed: 8, lane: 0 });
      b.riskyWp(b.at(4 + len, -side * half), { speed: 10, lane: 0 });
    } else {
      b.wp(b.at(3, side * half), { speed: 8, lane: 0 });
      b.wp(b.at(4 + len, side * half), { speed: 10, lane: 0 });
    }
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
  gauntlet(b, rand, _opts, d) {
    // A wide path with no rails and spinning arms along it.
    const len = 30, width = 12;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2 + 1)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: b.palette() });
    for (const [i, ahead] of [9, 21].entries()) {
      const spin = (mix(0.5, 0.8, d) + rand() * 0.4) * (i % 2 ? 1 : -1);
      b.pieces.push({ type: 'sweeper', position: b.at(ahead), length: 9, speed: r2(spin * 10) / 10 });
    }
    // A star at the edge between the two arms.
    const spot = b.at(15, (rand() < 0.5 ? 1 : -1) * 4.5);
    if (b.star(spot, 'gap')) b.riskyWp(spot, { speed: 9, lane: 0 });
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
    // A star on the crest, near one rail: steer to the edge at full boost.
    const e = (rand() < 0.5 ? 1 : -1) * 3;
    const star = b.star(b.at(flat + ramp, e, rise), 'crest') ? e : 0;
    b.lineWp(star, (side) => b.at(3, side), { speed: 12, lane: star ? 0 : 0.5 });
    if (star) {
      b.fast(b.at(flat + 2), 30, 'safe');
      b.fast(b.at(flat + 2, e), 30, 'risky');
      b.riskyWp(b.at(flat + ramp, e, rise), { speed: 16, lane: 0 });
    } else b.fast(b.at(flat + 2), 30);
    b.wp(end, { speed: 10 });
    b.cur = end;
    return true;
  },
  boostJump(b, rand, _opts, d) {
    // Run-up, boost strip, kicker, a long gap, and a walled landing below.
    const gap = 12 + Math.round(d * 2) + Math.floor(rand() * 2), land = 24, total = 22 + gap + land;
    if (!b.claim(b.cur, b.at(total, 0, -2), 7, 2)) return false;
    const runup = b.at(6);
    b.pad(runup, 10, 12, 'grey');
    b.checkpoint(runup);
    b.pieces.push({ type: 'boost', position: b.at(9), yaw: b.yaw, w: 6, d: 3 });
    b.pieces.push({ type: 'path', from: b.at(12), to: b.at(22, 0, 2), width: 8, rails: true, palette: 'orange' });
    b.pad(b.at(22 + gap + land / 2, 0, -2), 12, land, b.palette());
    b.sideWalls(22 + gap, total, 6, -2);
    // The strip is 6 wide, so the edge line is a little tighter than a plain jump's.
    const e = edgeStar(b, rand, 22 + 6, 3.6, 2.5);
    b.lineWp(e, (side) => b.at(7, side), { speed: 12, lane: 0 });
    if (e) {
      b.fast(b.at(22 + gap + 8, 0, -2), 30, 'safe');
      b.fast(b.at(22 + gap + 8, e, -2), 30, 'risky');
    } else b.fast(b.at(22 + gap + 8, 0, -2), 30);
    b.wp(b.at(total - 2, 0, -2), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(total, 0, -2);
    return true;
  },
  springUp(b, rand, _opts, d) {
    // Bounce off a spring onto a ledge above: 18 up and 8 forward lands about 9 ahead.
    const rise = 3 + Math.round(d) + Math.floor(rand() * 2), end = 29;
    if (!b.claim(b.cur, b.at(end, 0, rise), 6)) return false;
    b.pad(b.at(6.5), 10, 13, 'grey');
    b.checkpoint(b.at(3));
    b.pieces.push({ type: 'spring', position: b.at(8), power: 18, push: 8, yaw: b.yaw });
    b.pad(b.at(21, 0, rise), 10, 16, b.palette(), rise + 1); // a solid ledge: its face is a wall
    const s = rand() < 0.5 ? 1 : -1, power = Math.round(mix(21, 24, d));
    if (b.offers('super')) {
      // A smaller, stronger spring beside the normal one: the star waits at the top of its bounce.
      const up = power / b.gravity; // seconds to the top
      b.pieces.push({ type: 'spring', position: b.at(8, s * 3.5), radius: 1.3, power, push: 8, yaw: b.yaw });
      const top = (power * power) / (2 * b.gravity); // how high the ball's centre rises
      b.star(b.at(8 + 8 * up, s * 3.5), 'super', {}, 1 + top - 0.5);
      b.safeWp(b.at(8), { speed: 6, lane: 0 });
      b.riskyWp(b.at(8, s * 3.5), { speed: 6, lane: 0 });
      b.riskyWp(b.at(8 + 8 * up, s * 3.5, top - 0.5), { speed: 8, lane: 0 }); // hold the line in the air
    } else b.wp(b.at(8), { speed: 6, lane: 0 });
    b.wp(b.at(22, 0, rise), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, rise);
    return true;
  },
  lift(b, rand) {
    // Ride an elevator up to a tower top, or skip the wait: two springs beside the shaft throw
    // you up onto the tower, if you land on the second one.
    const rise = 7 + Math.floor(rand() * 3), end = 30;
    if (!b.claim(b.cur, b.at(end, 0, rise), 8.5)) return false;
    b.pad(b.at(5), 10, 10, 'grey');
    b.checkpoint(b.at(5));
    const period = r2(rise * 0.8 + 1);
    b.pieces.push({ type: 'mover', from: b.at(13), to: b.at(13, 0, rise), w: 6, d: 6, period, palette: 'purple' });
    b.pad(b.at(23, 0, rise), 10, 14, b.palette(), rise + 1);
    // A star riding its own lift just outside the tower's side, in step with yours: wait at the
    // edge of the top and catch it as it comes up. The springs go on the other side.
    const s = rand() < 0.5 ? 1 : -1;
    b.wp(b.at(4), { speed: 5, lane: 0 });
    b.safeWp(b.at(8), { speed: 5, lane: 0 });
    b.safeWp(b.at(13), { wait: true, speed: 5 });
    b.safeWp(b.at(13, 0, rise), { wait: true, speed: 3 });
    springHops(b, [b.at(7, -s * 3.4), b.at(13, -s * 6.5, Math.round(rise / 2))], b.at(21, -s * 2, rise));
    if (b.star(b.at(20, s * 5.4), 'elevator', { to: b.at(20, s * 5.4, rise + STAR_HEIGHT), period }, STAR_HEIGHT)) {
      b.riskyWp(b.at(20, s * 3.8, rise), { speed: 4, lane: 0, catch: true });
    }
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
    b.checkpoint(b.at(4));
    const top = rise + 2, bottom = -12;
    const c = b.at(8 + gap / 2, 0, (top + bottom) / 2);
    const [dx, dz] = b.dir;
    b.pieces.push({ type: 'wind', center: c, size: b.size(9, top - bottom, gap), dir: [dx * 0.2, 1, dz * 0.2], speed: 10, strength: 60 });
    b.pad(b.at(8 + gap + 8, 0, rise), 10, 16, b.palette(), rise + 1);
    b.wp(b.at(6), { speed: 8, lane: 0 });
    // A star near the top of the column, off to one side: ride the draft instead of drifting out.
    const s = rand() < 0.5 ? 1 : -1, star = b.at(8 + gap / 2 + 1, s * 3, rise + 1);
    if (b.star(star, 'column')) b.riskyWp(star, { speed: 6, lane: 0 });
    b.wp(b.at(8 + gap + 6, 0, rise), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, rise);
    return true;
  },
  crumbleBridge(b, rand, _opts, d) {
    // A bridge of tiles that fall away just after you touch them: don't stop.
    const tiles = 3 + Math.round(d) + Math.floor(rand() * 2), tileD = 4, span = tiles * tileD, end = 8 + span + 8;
    const tileW = r2(mix(6, 5, d)), delay = Math.round(mix(0.7, 0.45, d) * 20) / 20;
    if (!b.claim(b.cur, b.at(end), 5)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    for (let i = 0; i < tiles; i++) {
      const c = b.at(8 + tileD * (i + 0.5));
      const [w, , depth] = b.size(tileW, 1, tileD);
      b.pieces.push({ type: 'crumble', center: c, w, d: depth, delay, respawn: 3 });
    }
    b.pad(b.at(8 + span + 4), 10, 8, 'grey');
    b.wp(b.at(6), { speed: 10, lane: 0 });
    crumbleDetour(b, rand() < 0.5 ? 1 : -1, Math.floor(tiles / 2), tileW, tileD, delay);
    b.wp(b.at(8 + span + 4), { speed: 11, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  conveyor(b, rand) {
    // A belt that carries you forward (faster than you can roll), then a runout.
    const len = 26, run = 12, end = b.at(len + run);
    // With a star: a narrow, faster belt with no walls beside the main one (which loses its rail
    // on that side), the star near its end; hop back onto the main belt before it runs out.
    const s = rand() < 0.5 ? 1 : -1, lane = b.offers('fastLane');
    if (!b.claim(b.cur, end, lane ? 8 : 5)) return false;
    b.pieces.push({ type: 'conveyor', from: b.cur, to: b.at(len), width: 8, speed: 9, rails: !lane });
    b.pieces.push({ type: 'path', from: b.at(len), to: end, width: 8, rails: true, palette: 'grey' });
    if (lane) {
      b.pieces.push({ type: 'conveyor', from: b.at(2, s * 5.5), to: b.at(len - 4, s * 5.5), width: 3, speed: 13, open: true });
      b.star(b.at(len - 13, s * 5.5), 'fastLane');
      b.riskyWp(b.at(4, s * 5.5), { speed: 12, lane: 0 });
      b.riskyWp(b.at(len - 13, s * 5.5), { speed: 12, lane: 0 });
      b.riskyWp(b.at(len - 5, s * 1), { speed: 12, lane: 0 });
    }
    b.wp(b.at(len), { speed: 14 });
    b.wp(end, { speed: 9 });
    b.cur = end;
    return true;
  },
  treadmill(b, rand, _opts, d) {
    // Climb a belt that runs down toward you.
    const len = 26, rise = 3 + Math.floor(rand() * 2), top = b.at(len, 0, rise), end = b.at(len + 10, 0, rise);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'conveyor', from: top, to: b.cur, width: 8, speed: Math.round(mix(5, 7, d)), rails: true });
    b.pieces.push({ type: 'path', from: top, to: end, width: 8, rails: true, palette: 'grey' });
    // Bots ease off near a waypoint (relative to the belt), so aim past the top, not at it.
    b.wp(end, { speed: 16 });
    b.cur = end;
    return true;
  },
  windBridge(b, rand, opts, d) {
    // A narrow bridge in a crosswind: lean into it.
    const len = 22, width = Math.max(4.5, r2(mix(6, opts.bridgeWidth ?? 5, d))), side = rand() < 0.5 ? 1 : -1;
    const to = b.at(len);
    if (!b.claim(b.cur, to, 7)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: 'orange' });
    const [rx, rz] = b.right;
    b.pieces.push({ type: 'wind', center: b.at(len / 2, 0, 2), size: b.size(16, 6, len), dir: [rx * side, 0, rz * side], speed: 4, strength: Math.round(mix(6, 10, d)) });
    b.wp(b.at(1), { speed: 8, lane: 0 });
    if (b.offers('downwind')) {
      // An open ledge on the downwind side: let the wind take you there, then fight your way back.
      const ledge = b.at(len / 2, side * (width / 2 + 2));
      const [w, depth] = b.dir[0] !== 0 ? [8, 4] : [4, 8];
      b.pieces.push({ type: 'pad', center: ledge, w, d: depth, palette: 'orange', open: true });
      b.star(ledge, 'downwind');
      b.riskyWp(b.at(len / 2 - 3), { speed: 6, lane: 0 });
      b.riskyWp(ledge, { speed: 5, lane: 0 });
      b.riskyWp(b.at(len / 2 + 4), { speed: 6, lane: 0 });
    }
    b.wp(to, { speed: 8, lane: 0 });
    b.cur = to;
    return true;
  },
  moonJump(b, rand, _opts, d) {
    // Low gravity: a kicker sends you floating over a gap you could never clear normally.
    const gap = 16 + Math.round(d * 2) * 2 + Math.floor(rand() * 2) * 2, land = 20, total = 18 + gap + land;
    if (!b.claim(b.cur, b.at(total, 0, -1), 7, 3)) return false;
    const runup = b.at(5);
    b.pad(runup, 10, 10, 'grey');
    b.checkpoint(runup);
    b.pieces.push({ type: 'path', from: b.at(10), to: b.at(18, 0, 3), width: 8, rails: true, palette: 'purple' });
    b.pad(b.at(18 + gap + land / 2, 0, -1), 12, land, b.palette());
    b.sideWalls(18 + gap, total, 6, -1);
    b.pieces.push({ type: 'lowgrav', center: b.at(10 + (total - 10) / 2, 0, 1.5), size: b.size(18, 33, total - 10), scale: 0.3 });
    b.wp(b.at(8), { speed: 14, lane: 0 });
    // A star floating beside the arc: steer in the air (low gravity gives you time) to reach it.
    const m = (rand() < 0.5 ? 1 : -1) * r2(mix(2.5, 3.5, d)), star = b.at(27, m, 4.1);
    if (b.star(star, 'moon')) {
      b.riskyWp(star, { speed: 14, lane: 0 });
      b.safeWp(b.at(18 + gap + 8, 0, -1), { speed: 14, lane: 0 });
      b.riskyWp(b.at(18 + gap + 8, m / 2, -1), { speed: 14, lane: 0 });
    } else b.wp(b.at(18 + gap + 8, 0, -1), { speed: 14, lane: 0 });
    b.wp(b.at(total - 2, 0, -1), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(total, 0, -1);
    return true;
  },
  zigzag(b, rand, _opts, d) {
    const side = rand() < 0.5 ? 1 : -1, width = r2(mix(6, 5, d));
    const c1 = b.at(14, side * 7), c2 = b.at(28, 0);
    if (!b.claim(b.cur, c1, 4) || !b.claim(c1, c2, 4)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: c1, width, palette: 'orange' });
    b.pieces.push({ type: 'pad', center: c1, w: 7, d: 7, palette: 'grey' });
    b.pieces.push({ type: 'path', from: c1, to: c2, width, palette: 'orange' });
    b.wp(b.at(12.5, side * 6.25), { speed: 9, lane: 0 });
    b.wp(c1, { speed: 6, lane: 0 });
    const corner = b.at(14, side * 9.2);
    if (b.star(corner, 'corner')) b.riskyWp(corner, { speed: 4, lane: 0 });
    b.wp(c2, { speed: 9, lane: 0 });
    b.cur = c2;
    return true;
  },

  // ---------- Moving floors and obstacles on the clock ----------

  brakePad(b, rand, _opts, d) {
    // A steep slope down onto a small pad with no walls, the way on leaving from its side: brake
    // in time, or roll straight off the far edge.
    const top = 8, len = 14, drop = r2(mix(4, 6, d)), size = r2(mix(9, 6.5, d)), s = rand() < 0.5 ? 1 : -1, exit = 12;
    const foot = top + len, mid = foot + size / 2;
    if (!b.claim(b.cur, b.at(foot + size, 0, -drop), Math.max(5, size / 2 + 1))) return false;
    if (!b.claim(b.at(mid, s * size / 2, -drop), b.at(mid, s * (size / 2 + exit), -drop), 4)) return false;
    b.pad(b.at(top / 2), 10, top, 'grey');
    b.checkpoint(b.at(top / 2));
    b.pieces.push({ type: 'path', from: b.at(top), to: b.at(foot, 0, -drop), width: 7, rails: true, palette: b.palette() });
    const [w, , depth] = b.size(size, 1, size), centre = b.at(mid, 0, -drop);
    b.pieces.push({ type: 'pad', center: centre, w, d: depth, palette: 'orange', open: true });
    const out = b.at(mid, s * (size / 2 + exit), -drop);
    b.pieces.push({ type: 'path', from: b.at(mid, s * size / 2, -drop), to: out, width: 6, rails: true, palette: b.palette() });
    b.wp(b.at(top - 1), { speed: 6, lane: 0 });
    b.wp(b.at(foot - 3, 0, -drop * (len - 3) / len), { speed: 4, lane: 0 });
    b.wp(centre, { speed: 2.5, lane: 0 });
    // A star just past the far edge: stop right at the brink to reach it.
    if (b.star(b.at(mid + size / 2 + 0.6, 0, -drop), 'lip')) b.riskyWp(b.at(mid + size / 2 - 0.7, 0, -drop), { speed: 2, lane: 0, catch: true });
    b.wp(b.at(mid, s * (size / 2 + 3), -drop), { speed: 6, lane: 0 });
    b.wp(out, { speed: 9 });
    b.checkpointsSince = 0;
    const [rx, rz] = b.right;
    b.dir = [rx * s, rz * s];
    b.cur = out;
    return true;
  },
  pinball(b, rand, _opts, d) {
    // Toadstools sliding to and fro across a lane: slip past each row while it's over to one side.
    // The hardest has no walls, so a knock sends you off.
    const len = 30, width = 12, rows = d < 0.5 ? [9, 19] : [8, 15, 22], open = d >= 0.6;
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2 + 5)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, palette: b.palette(), ...(open ? { open: true } : {}) });
    b.wp(b.at(2), { speed: 8, lane: 0 });
    const s0 = rand() < 0.5 ? 1 : -1, pocket = b.offers('pocket') ? Math.floor(rand() * rows.length) : -1;
    rows.forEach((ahead, i) => {
      const side = i % 2 ? -s0 : s0, period = q4(mix(4, 2.8, d) + rand() * 0.4), phase = q4(rand() * period);
      b.wp(b.at(ahead - 4), { speed: 9, lane: 0, timed: true });
      if (i !== pocket) {
        b.pieces.push({ type: 'bumper', position: b.at(ahead, side * 4.2), to: b.at(ahead, -side * 4.2), period, phase });
        return;
      }
      // A pocket off the lane that this toadstool slides right into, with a star in it: dart in
      // while it's over at the far side, and out before it comes back.
      b.pieces.push({ type: 'bumper', position: b.at(ahead, side * 4.2), to: b.at(ahead, -side * 7.6), period: q4(period * 1.6), phase });
      const [w, , depth] = b.size(4, 1, 4);
      b.pieces.push({ type: 'pad', center: b.at(ahead, -side * 8), w, d: depth, palette: 'grey' });
      b.star(b.at(ahead, -side * 8.2), 'pocket');
      b.riskyWp(b.at(ahead, -side * 8.6), { speed: 7, lane: 0 }); // bots turn back 2 short of a waypoint: aim past the star
    });
    b.wp(b.at(len - 1), { speed: 10 });
    b.cur = to;
    return true;
  },
  keys(b, rand, _opts, d) {
    // Piano keys that sink away and come back up one after another, so a wave runs along them:
    // keep pace with the beat.
    const n = Math.round(mix(4, 6, d)), key = 4, span = n * key, end = 8 + span + 8;
    const period = q4(mix(5.2, 4.2, d)), hold = Math.round(mix(0.38, 0.32, d) * 100) / 100, beat = 0.6; // the wave runs at about 6.5 units/s
    if (!b.claim(b.cur, b.at(end), 8)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    const [w, , depth] = b.size(6, 1, key);
    const star = b.offers('beat') ? n - 1 : -1, s = rand() < 0.5 ? 1 : -1; // beside the last key: step out, then on to solid ground
    const keyAt = (i: number, side = 0) => b.at(8 + key * (i + 0.5), side);
    b.wp(b.at(6.5), { speed: 6.5, lane: 0, timed: true });
    for (let i = 0; i < n; i++) {
      const top = keyAt(i), phase = q4((((-i * beat) % period) + period) % period);
      b.pieces.push({ type: 'mover', from: top, to: [top[0], top[1] - 22, top[2]], w, d: depth, period, phase, hold, palette: 'grey' });
      if (i !== star) continue;
      // A key off to one side with the star over it. It keeps time with this one but stays up
      // a little longer, so there's time to step out to the star and on to the pad.
      const side = keyAt(i, s * 5.5), [sw, , sd] = b.size(5, 1, key);
      const sideHold = Math.round((hold + 0.08) * 100) / 100, sidePhase = q4((((phase - 0.3) % period) + period) % period);
      b.pieces.push({ type: 'mover', from: side, to: [side[0], side[1] - 22, side[2]], w: sw, d: sd, period, phase: sidePhase, hold: sideHold, palette: 'grey' });
      b.star(keyAt(i, s * 4.8), 'beat', { ride: b.pieces.length - 1 }); // on its inner half: one step out
      b.riskyWp(keyAt(i - 1), { speed: 6.5, lane: 0 });
      b.riskyWp(keyAt(i, s * 5.6), { speed: 6.5, lane: 0 }); // bots turn back 2 short of a waypoint
      b.riskyWp(b.at(8 + span + 2, s * 2.5), { speed: 6.5, lane: 0 });
    }
    b.pad(b.at(8 + span + 4), 10, 8, 'grey');
    b.wp(b.at(8 + span + 3), { speed: 6.5, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  turntable(b, rand, _opts, d) {
    // A turning disc with a low rim, open at two opposite gaps: roll on as a gap comes round,
    // ride it a quarter turn, and roll off to the side when a gap lines up with the way out.
    const r = r2(mix(8.5, 7, d)), speed = (Math.round(mix(0.5, 0.8, d) * 10) / 10) * (rand() < 0.5 ? 1 : -1), s = rand() < 0.5 ? 1 : -1;
    const c = 8 + r + 0.4, out = r + 0.4;
    if (!b.claim(b.cur, b.at(c + r + 1), r + 1)) return false;
    if (!b.claim(b.at(c, s * out), b.at(c, s * (out + 10)), 5)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    const centre = b.at(c), gap = Math.round(rand() * 36) * 10;
    b.pieces.push({ type: 'turntable', center: centre, radius: r, speed, gaps: [gap, gap + 180] });
    const disc = b.pieces.length - 1, exit = b.at(c, s * (out + 5)), next = b.at(c, s * (out + 10));
    b.pad(exit, 10, 10, 'grey');
    b.wp(b.at(6), { speed: 8, lane: 0, timed: true });
    b.wp(centre, { speed: 5, lane: 0, timed: true });
    // A star riding the disc near its rim, halfway between the gaps: wait out there for it.
    const a = ((gap + 90) * Math.PI) / 180;
    if (b.star([centre[0] + (r - 1.6) * Math.cos(a), centre[1], centre[2] - (r - 1.6) * Math.sin(a)], 'rim', { ride: disc })) {
      b.riskyWp(b.at(c + r - 2.2), { speed: 4, lane: 0, catch: true });
      b.riskyWp(centre, { speed: 5, lane: 0, timed: true });
    }
    b.wp(exit, { speed: 7, lane: 0 });
    b.checkpointsSince = 0;
    const [rx, rz] = b.right;
    b.dir = [rx * s, rz * s];
    b.cur = next;
    return true;
  },
  pendulum(b, rand, _opts, d) {
    // Conkers on strings swinging across a bridge: time each one. Under each swing the bridge
    // widens into a pad with no walls.
    const count = d < 0.5 ? 1 : 2, len = 10 + count * 10, width = r2(mix(5, 4, d));
    const period = q4(mix(3.4, 2.8, d)), swing = 50, rod = 7.5, bob = 1.3, low = 0.6 + bob * 0.8; // the bob's centre at the bottom of its swing
    const out = rod * Math.sin((swing * Math.PI) / 180) + bob + 1; // the gantry posts, clear of the swing
    if (!b.claim(b.cur, b.at(len), out + 1)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: b.at(len), width, palette: 'orange' });
    b.wp(b.at(1), { speed: 8, lane: 0 });
    const s = rand() < 0.5 ? 1 : -1, star = b.offers('arc') ? Math.floor(rand() * count) : -1;
    for (let i = 0; i < count; i++) {
      const at = 10 + i * 10, floor = b.at(at), [w, , depth] = b.size(8, 1, 6);
      b.pieces.push({ type: 'pad', center: floor, w, d: depth, palette: 'orange', open: true });
      const pivot: Vec3 = [floor[0], floor[1] + low + rod, floor[2]];
      b.pieces.push({ type: 'pendulum', pivot, length: rod, swing, period, phase: q4((i * period) / 2 + rand() * 0.5), yaw: b.yaw, radius: bob });
      // Hung from a line between two garden canes (thin, so the camera sees past them).
      const h = low + rod + 6; // the canes reach down out of sight
      for (const side of [-1, 1]) b.pieces.push({ type: 'block', position: b.at(at, side * out, low + rod - h / 2 + 0.2), size: b.size(0.3, h, 0.3), color: '#c9a66b' });
      b.pieces.push({ type: 'block', position: b.at(at, 0, low + rod + 0.1), size: b.size(2 * out + 0.3, 0.12, 0.12), color: '#efe3c8' });
      b.wp(b.at(at - 4.5), { speed: 9, lane: 0, timed: true });
      // A star out at the pad's edge, right where the bob comes low.
      if (i === star && b.star(b.at(at, s * 3), 'arc')) b.riskyWp(b.at(at, s * 2.6), { speed: 7, lane: 0 });
    }
    b.wp(b.at(len), { speed: 9, lane: 0 });
    b.cur = b.at(len);
    return true;
  },
  rocker(b, rand, _opts, d) {
    // A ruler balanced on an eraser, tipping from side to side: cross while it's level, or hug
    // the high side.
    const len = 16, width = r2(mix(5, 4, d)), tilt = Math.round(mix(6, 12, d)), period = q4(mix(5, 3.5, d)), end = 8 + len + 8;
    if (!b.claim(b.cur, b.at(end), 6)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    const [w, , depth] = b.size(width, 1, len);
    b.pieces.push({ type: 'rocker', center: b.at(8 + len / 2), w, d: depth, tilt, period, phase: q4(rand() * period) });
    b.pieces.push({ type: 'block', position: b.at(8 + len / 2, 0, -1.75), size: b.size(1.4, 1.4, len - 2), color: '#f28482' }); // the eraser
    b.pad(b.at(8 + len + 4), 10, 8, 'grey');
    b.wp(b.at(6.5), { speed: 7, lane: 0, timed: true });
    // A star just off one edge, low: go out to the side that dips.
    const s = rand() < 0.5 ? 1 : -1;
    if (b.star(b.at(8 + len / 2, s * (width / 2 + 0.6)), 'tilt', {}, 1)) {
      b.riskyWp(b.at(8 + len / 2 - 4, s * (width / 2 - 1.1)), { speed: 5, lane: 0 });
      b.riskyWp(b.at(8 + len / 2 + 1, s * (width / 2 - 1.1)), { speed: 5, lane: 0 });
    }
    b.wp(b.at(8 + len + 3), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  rollers(b, rand, _opts, d) {
    // Logs rolling across the way, row after row, out of a pipe on one side and off the far
    // edge: cross each row in a gap. No walls: a log shoves you off.
    const rows = d < 0.5 ? 2 : 3, width = 14, row = 4, strip = 3, speed = mix(7, 12, d);
    const span = strip + rows * (row + strip), end = 6 + span + 6;
    if (!b.claim(b.cur, b.at(end), width / 2 + 5)) return false;
    b.pad(b.at(3), 10, 6, 'grey');
    b.checkpoint(b.at(3));
    const [w, , depth] = b.size(width, 1, span);
    b.pieces.push({ type: 'pad', center: b.at(6 + span / 2), w, d: depth, palette: b.palette(), open: true });
    b.pad(b.at(6 + span + 3), 10, 6, 'grey');
    b.wp(b.at(4.5), { speed: 7, lane: 0 });
    const a0 = rand() < 0.5 ? 1 : -1, star = b.offers('pinch') ? Math.floor(rand() * rows) : -1, s = rand() < 0.5 ? 1 : -1;
    const period = q4((width + 6.6) / speed);
    for (let k = 0; k < rows; k++) {
      const a = k % 2 ? -a0 : a0, ahead = 6 + strip + k * (row + strip) + row / 2;
      b.wp(b.at(ahead - row / 2 - strip / 2), { speed: 8, lane: 0, timed: true });
      b.pieces.push({ type: 'roller', from: b.at(ahead, -a * (width / 2 + 1.6)), to: b.at(ahead, a * (width / 2 + 5)), period, phase: q4(rand() * period), length: 3 });
      b.pieces.push({ type: 'block', position: b.at(ahead, -a * (width / 2 + 2.4), 1.4), size: b.size(3.6, 2.8, row + 0.4), color: '#6c757d' }); // the pipe they come out of
      // A star out in the row, off the straight line: wait for a gap long enough to get there.
      if (k === star && b.star(b.at(ahead, s * 3.5), 'pinch')) b.riskyWp(b.at(ahead, s * 3), { speed: 8, lane: 0 });
    }
    b.wp(b.at(6 + span - strip / 2), { speed: 8, lane: 0 });
    b.wp(b.at(6 + span + 3), { speed: 8 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  paperWall(b, rand, _opts, d) {
    // Paper walls across a lane, each with a narrow gap at one side: weave through the gaps, or
    // take the boost and tear straight through.
    const len = 40, width = 10, g = rand() < 0.5 ? 1 : -1, tear = Math.round(mix(14, 18, d)), walls = [12, 20];
    const to = b.at(len);
    if (!b.claim(b.cur, to, width / 2 + 1)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to, width, rails: true, palette: b.palette() });
    b.pieces.push({ type: 'boost', position: b.at(5), yaw: b.yaw, w: 3, d: 3 });
    // A switch star past the second wall: only tearing straight through beats its timer.
    const smash = b.star(b.at(32), 'smash', { button: b.at(1.5), time: SWITCH_TIME });
    const weave = (p: Vec3, speed: number) => (smash ? b.safeWp(p, { speed, lane: 0 }) : b.wp(p, { speed, lane: 0 })); // without the star, both lines weave
    weave(b.at(3, g * 3.5), 7);
    if (smash) {
      b.riskyWp(b.at(2.5), { speed: 12, lane: 0 });
      b.fast(b.at(7), 30, 'risky');
    }
    walls.forEach((ahead, i) => {
      const gap = i % 2 ? -g : g; // a 3-wide gap at the rail on this side; the paper fills the rest
      b.pieces.push({ type: 'paper', position: b.at(ahead, -gap * 1.5), w: width - 3, yaw: b.yaw, speed: tear });
      weave(b.at(ahead - 1.5, gap * 3.5), 6);
      weave(b.at(ahead + 1.5, gap * 3.5), 6);
    });
    // Aim well past the walls: bots ease off as they near a waypoint.
    if (smash) b.fast(b.at(len - 1), 30, 'risky');
    b.wp(b.at(len - 1), { speed: 8 });
    b.cur = to;
    return true;
  },

  ironBall(b, rand, _opts, d) {
    // A giant iron ball sitting just past the end of the start pad, its top a little above the
    // pad: roll onto it, push it across a pit of spikes keeping your balance on top, and roll off
    // onto the landing. Fall off: spikes.
    const R = 3, len = Math.round(mix(18, 26, d)), width = 12, low = 0.5, floorY = low - 2 * R;
    const C = 8 + 2.4, back = C - R, far = back + len, end = far + 10; // the pad stops 2.4 short of its middle: clear of it
    if (!b.claim(b.cur, b.at(end, 0, low), width / 2 + 1)) return false;
    b.pad(b.at(4), 10, 8, 'grey', 0.5); // thin, so its edge clears the ball's curve underneath
    b.checkpoint(b.at(4));
    // The pit: a wall under the pad end for the ball to rest against, spikes, and walls up to the ball's middle.
    b.pieces.push({ type: 'block', position: b.at(back - 0.3, 0, (floorY - 0.6) / 2), size: b.size(width, -0.6 - floorY, 0.5), color: '#6c757d' });
    const [w, , depth] = b.size(width, 1, len);
    b.pieces.push({ type: 'spikes', center: b.at(back + len / 2, 0, floorY), w, d: depth });
    for (const side of [-1, 1]) {
      b.pieces.push({ type: 'block', position: b.at(back + len / 2, side * (width / 2 + 0.25), floorY + 1.5), size: b.size(0.5, 3, len), color: '#6c757d' });
    }
    // It rolls on by itself while you ride it, faster when harder: you steer and keep your balance.
    b.pieces.push({ type: 'ironball', position: b.at(C, 0, floorY), radius: R, roll: Math.round(mix(2.5, 4, d) * 10) / 10, yaw: b.yaw });
    // The landing: a lip over the pit at the height of the ball's top; the ball stops under it.
    b.pieces.push({ type: 'path', from: b.at(far - 2.4, 0, low), to: b.at(far, 0, low), width: 6, thickness: 0.4, palette: 'orange' });
    b.pad(b.at(far + 5, 0, low), 10, 10, 'grey', 2 * R + 1.4);
    b.wp(b.at(6), { speed: 4, lane: 0 });
    b.wp(b.at(C, 0, low), { speed: 1.5, lane: 0 }); // onto the top, and find your balance before setting off
    // A star over the field, off to one side: steer the ball over there.
    const s = rand() < 0.5 ? 1 : -1, mid = back + Math.max(len / 2, 12); // far enough along to drift over to it, not turn hard
    if (b.star(b.at(mid, s * 3, low), 'steer')) b.riskyWp(b.at(mid + 2, s * 2.5, low), { speed: 3, lane: 0 }); // just past it (bots turn 2 short); clear of the wall
    b.wp(b.at(far - R - 1, 0, low), { speed: 3, lane: 0 });
    b.wp(b.at(far + 3, 0, low), { speed: 5, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, low);
    return true;
  },
  wheel(b, rand, _opts, d) {
    // A Ferris wheel of level steps turning across the course: roll onto a step at the bottom,
    // ride it up, and roll off onto the high ledge ahead when it gets to the top.
    // The steps move at about 3 units/s whatever the size, so getting on is the same timing.
    const R = r2(mix(6, 8, d)), steps = d < 0.5 ? 6 : 5, speed = (Math.round((mix(2.7, 3.2, d) / R) * 100) / 100) * (rand() < 0.5 ? 1 : -1);
    const A = 8 + 2 + 0.3, top = 2 * R, ledge = A + 2.3, end = ledge + 12;
    if (!b.claim(b.cur, b.at(end, 0, top), R + 7, top)) return false; // the wheel, and the springs beyond its reach
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    b.pieces.push({ type: 'wheel', center: b.at(A, 0, R), radius: R, speed, steps, w: 4, d: 4, yaw: b.yaw });
    b.pad(b.at(ledge + 6, 0, top), 10, 12, 'grey'); // a ledge, not a tower, so you can see the wheel turning under it
    // A switch star: its button off to the side of the start pad, the star on the ledge. Only
    // boarding the very next step beats the timer.
    const q = rand() < 0.5 ? 1 : -1, button = b.at(3, -q * 3);
    // Its timer starts long enough to wait for a step and ride it up (generate-levels then sets it from the bot's run).
    const ride = Math.PI / Math.abs(speed) + (Math.PI * 2) / (Math.abs(speed) * steps) + 4;
    if (b.star(b.at(ledge + 4, 0, top), 'climb', { button, time: Math.ceil(ride) })) b.riskyWp(button, { speed: 5, lane: 0 });
    b.safeWp(b.at(7.2), { speed: 4, lane: 0 });
    b.safeWp(b.at(A - 1), { speed: 5, lane: 0, wait: true });      // a step coming past: on
    b.safeWp(b.at(A, 0, top), { speed: 3, lane: 0, ride: true });  // ride it to the top
    // Or skip the ride: three springs up beside the wheel (clear of its swinging steps), the last
    // throwing you across over it onto the ledge.
    const side = q * (R + 4.5);
    springHops(b, [b.at(5, q * 3.4), b.at(6, side, Math.round((top - 1) / 2)), b.at(9, side, top - 1)], b.at(ledge + 4, q * 2, top));
    b.wp(b.at(ledge + 3, 0, top), { speed: 6, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end, 0, top);
    return true;
  },
  trickGates(b, rand, _opts, d) {
    // Doors across the way, only one open at a time and all switching at once: pick the open one
    // and get through before it shuts. The hardest has a second row, out of step with the first.
    const doors = d < 0.5 ? 2 : 3, lane = 4.5, wall = 0.6, w = Math.round(mix(1.8, 1.2, d) * 4) / 4; // seconds each door is open
    const period = doors * w, rows = d < 0.6 ? [12] : [12, 22], peek = b.offers('peek');
    const width = doors * lane + (doors + 1) * wall + (peek ? 3.2 + wall : 0), len = rows[rows.length - 1] + 8;
    const s = rand() < 0.5 ? 1 : -1; // the side the peek lane is on
    if (!b.claim(b.cur, b.at(len), width / 2 + 1)) return false;
    b.pieces.push({ type: 'path', from: b.cur, to: b.at(len), width, palette: b.palette() });
    const left = -width / 2;
    const laneAt = (k: number) => s * (left + wall + k * (lane + wall) + lane / 2); // door lanes from the side away from the peek lane
    b.wp(b.at(4), { speed: 7, lane: 0 });
    rows.forEach((ahead, r) => {
      const shift = r * (w / 2), pick = Math.floor(rand() * doors);
      for (let k = 0; k <= doors; k++) {
        // Walls between the doors, so the only way through is a door.
        const x = s * (left + k * (lane + wall) + wall / 2);
        b.pieces.push({ type: 'block', position: b.at(ahead, x, 1.3), size: b.size(wall, 2.6, 3), color: '#d9cbb0' });
      }
      for (let k = 0; k < doors; k++) {
        const order = r % 2 ? doors - 1 - k : k; // the second row opens the other way along
        const phase = q4((((period - w - 0.35 - order * w + shift) % period) + period) % period);
        b.pieces.push({ type: 'gate', position: b.at(ahead, laneAt(k)), w: lane, yaw: b.yaw, period, phase, open: 1 / doors });
      }
      b.safeWp(b.at(ahead - 3.5, laneAt(pick)), { speed: 7, lane: 0, timed: true });
      b.safeWp(b.at(ahead + 3.5, laneAt(pick)), { speed: 7, lane: 0 });
      if (!peek) {
        b.riskyWp(b.at(ahead - 3.5, laneAt(pick)), { speed: 7, lane: 0, timed: true });
        b.riskyWp(b.at(ahead + 3.5, laneAt(pick)), { speed: 7, lane: 0 });
      }
    });
    if (peek) {
      // A narrow lane at the side with its own door that opens only briefly, and the star past it.
      const x = s * (width / 2 - 1.6), ahead = rows[0];
      b.pieces.push({ type: 'gate', position: b.at(ahead, x), w: 3.2, yaw: b.yaw, period: period * 2, phase: q4(rand() * period), open: w / (period * 2) }); // open as long as the others, half as often
      b.star(b.at(ahead + 4, x), 'peek');
      b.riskyWp(b.at(ahead - 3.5, x), { speed: 7, lane: 0, timed: true });
      b.riskyWp(b.at(ahead + 4, x), { speed: 7, lane: 0 });
      b.riskyWp(b.at(len - 3, x), { speed: 7, lane: 0 }); // on along the narrow lane: it has no door after this

    }
    b.wp(b.at(len - 1), { speed: 8 });
    b.cur = b.at(len);
    return true;
  },
  logSlope(b, rand, _opts, d) {
    // Climb a slope while logs roll down it at you. Two bays at one side let you wait out of the
    // way; dash up the outer lane from bay to bay when its log has gone by. At the top the way on
    // turns off to the other side.
    const lanes = d < 0.5 ? 2 : 3, laneW = 4, width = lanes * laneW + 2, len = 30, rise = r2(mix(4, 6, d)), speed = mix(7, 9, d);
    const s = rand() < 0.5 ? 1 : -1, bay = width / 2 + 2.5, exit = 12;
    const outer = -s * (width / 2 - 1 - laneW / 2); // the lane the bays open onto
    const at = (along: number, side = 0) => b.at(8 + along, side, (rise * Math.max(0, Math.min(len, along))) / len);
    if (!b.claim(b.cur, b.at(8 + len + 8, 0, rise), bay + 3, rise)) return false;
    if (!b.claim(b.at(8 + len + 4, s * width / 2, rise), b.at(8 + len + 4, s * (width / 2 + exit), rise), 4)) return false;
    b.pad(b.at(4), width, 8, 'grey');
    b.checkpoint(b.at(4, outer)); // where the climb starts
    b.pieces.push({ type: 'path', from: b.at(8), to: b.at(8 + len, 0, rise), width, palette: b.palette() });
    const [tw, , td] = b.size(width, 1, 8);
    b.pieces.push({ type: 'pad', center: b.at(8 + len + 4, 0, rise), w: tw, d: td, palette: 'grey' });
    const out = b.at(8 + len + 4, s * (width / 2 + exit), rise);
    b.pieces.push({ type: 'path', from: b.at(8 + len + 4, s * width / 2, rise), to: out, width: 6, rails: true, palette: b.palette() });
    // Logs: one per lane, rolling from the crest to just above the foot again and again. The lane
    // next to the outer one runs a moment ahead of it (so there's a gap to dodge into); any third
    // lane runs half a cycle off.
    // Each launcher holds its next log a while between runs, leaving room to dodge between them.
    const wait = q4(mix(2.2, 1.4, d)), period = q4(Math.hypot(len, rise) / speed + wait), base = rand() * period, kOuter = s > 0 ? 0 : lanes - 1;
    for (let k = 0; k < lanes; k++) {
      const x = -width / 2 + 1 + laneW * (k + 0.5), apart = Math.abs(k - kOuter);
      const phase = base + (apart === 0 ? 0 : apart === 1 ? 0.4 : period / 2);
      b.pieces.push({ type: 'roller', from: at(len, x), to: at(1.5, x), period, phase: q4(phase % period), length: laneW - 0.6, launcher: true, wait });
    }
    // The bays: ledges alongside the slope, long enough to step into on the way up.
    const bays = [len * 0.28, len * 0.68];
    for (const along of bays) b.pieces.push({ type: 'path', from: at(along - 4, -s * bay), to: at(along + 4, -s * bay), width: 5, palette: 'grey' });
    b.wp(b.at(6.5, outer), { speed: 7, lane: 0, timed: true }); // at the foot of the outer lane (the logs are gone by here)
    b.wp(at(bays[0] - 1.5, outer), { speed: 7, lane: 0 });         // up it, then sideways into the bay
    b.wp(at(bays[0], -s * bay), { speed: 6, lane: 0, timed: true });
    b.wp(at(len / 2, outer), { speed: 7, lane: 0 });
    b.wp(at(bays[1], -s * bay), { speed: 6, lane: 0, timed: true });
    // Up the outer lane onto the top, then across it (logs start at the crest, not up there). A
    // star over the edge of the next lane in, just above the bay: dodge two logs, not one.
    if (b.star(at(bays[1] + 3, outer + s * 2.2), 'dodge')) b.riskyWp(at(bays[1] + 3, outer + s * 1.6), { speed: 7, lane: 0 });
    b.wp(at(len - 1, outer), { speed: 7, lane: 0 });
    b.wp(at(len + 2.5, outer), { speed: 7, lane: 0 });
    b.wp(at(len + 4, s * 2), { speed: 7, lane: 0 });
    b.wp(out, { speed: 8 });
    b.checkpointsSince = 0;
    const [rx, rz] = b.right;
    b.dir = [rx * s, rz * s];
    b.cur = out;
    return true;
  },

  // ---------- Risk/reward ----------

  fork(b, rand, _opts, d) {
    // Two ways from one pad to the next: a railed detour out to the side (safe, ~60 units), or
    // straight across with no walls (fast, 22 units). The straight line is one of: a beam,
    // crumbling tiles, stepping stones, piano keys in a wave, or a beam with toadstools sliding across.
    const s = rand() < 0.5 ? 1 : -1, out = 14, far = 34, from = 8, to = far - 4;
    const line = (['beam', 'beam', 'tiles', 'stones', 'keys', 'toadstools'] as const)[Math.floor(rand() * 6)], timed = rand() < 0.5;
    if (!b.claim(b.at(0, -5), b.at(far + 4, s * (out + 4.5)), 0)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    // Safe: out, along, and back, with corner pads.
    b.pieces.push({ type: 'path', from: b.at(4, s * 5), to: b.at(4, s * (out - 4)), width: 7, rails: true, palette: b.palette() });
    b.pad(b.at(4, s * out), 8, 8, 'grey');
    b.pieces.push({ type: 'path', from: b.at(8, s * out), to: b.at(far - 4, s * out), width: 7, rails: true, palette: b.palette() });
    b.pad(b.at(far, s * out), 8, 8, 'grey');
    b.pieces.push({ type: 'path', from: b.at(far, s * (out - 4)), to: b.at(far, s * 5), width: 7, rails: true, palette: b.palette() });
    b.pad(b.at(far), 10, 8, 'grey');
    // Risky: straight through the middle, no safety walls.
    let speed = 7, wait = false;
    if (line === 'tiles') {
      const n = 5, tileD = (to - from) / n;
      const [w, , depth] = b.size(r2(mix(4.5, 4, d)), 1, tileD);
      for (let i = 0; i < n; i++) b.pieces.push({ type: 'crumble', center: b.at(from + tileD * (i + 0.5)), w, d: depth, delay: 0.45, respawn: 3, open: true });
      speed = 10;
    } else if (line === 'stones') {
      // Stepping stones with small gaps: roll steadily across.
      const n = 5, step = (to - from) / n, [w, , depth] = b.size(r2(mix(3.5, 3, d)), 1, step - 1.2);
      for (let i = 0; i < n; i++) b.pieces.push({ type: 'pad', center: b.at(from + step * (i + 0.5)), w, d: depth, palette: 'orange', open: true });
      speed = 8;
    } else if (line === 'keys') {
      // Piano keys sinking in a wave (like the `keys` segment): keep pace with it.
      const n = 5, key = 4, period = q4(mix(5.2, 4.2, d)), hold = Math.round(mix(0.38, 0.32, d) * 100) / 100, beat = 0.6;
      const [w, , depth] = b.size(4.5, 1, key);
      for (let i = 0; i < n; i++) {
        const top = b.at(from + key * (i + 0.5)), phase = q4((((-i * beat) % period) + period) % period);
        b.pieces.push({ type: 'mover', from: top, to: [top[0], top[1] - 22, top[2]], w, d: depth, period, phase, hold, palette: 'grey' });
      }
      const [lw, , ld] = b.size(4.5, 1, to - from - n * key);
      b.pieces.push({ type: 'pad', center: b.at((from + n * key + to) / 2), w: lw, d: ld, palette: 'grey', open: true });
      speed = 6.5;
      wait = true;
    } else if (line === 'toadstools') {
      // A beam with toadstools sliding across it: wait for a gap, or get knocked off.
      b.pieces.push({ type: 'path', from: b.at(from), to: b.at(to), width: r2(mix(4.5, 4, d)), palette: 'orange', open: true });
      const period = q4(mix(3.6, 2.8, d));
      for (const at of [13, 22]) b.pieces.push({ type: 'bumper', position: b.at(at, -3.5), to: b.at(at, 3.5), period, phase: q4(rand() * period) });
      wait = true;
    } else {
      b.pieces.push({ type: 'path', from: b.at(from), to: b.at(to), width: r2(mix(3.5, 3, d)), palette: 'orange', open: true });
    }
    // The star: on the risky line, or a switch star on the exit pad whose button everyone rolls
    // over on the way in. Only the risky line beats its timer.
    const race = timed && b.star(b.at(far), 'race', { button: b.at(2.5), time: SWITCH_TIME });
    b.wp(b.at(4), { speed: 7, lane: 0 });
    b.safeWp(b.at(4, s * out), { speed: 7, lane: 1 });
    b.safeWp(b.at(far, s * out), { speed: 10, lane: 1.5 });
    b.riskyWp(b.at(wait ? 7 : 9), { speed, lane: 0, ...(wait ? { timed: true } : {}) });
    if (!race) b.star(b.at((from + to) / 2), 'shortcut');
    b.riskyWp(b.at(to), { speed: line === 'tiles' ? 10 : Math.max(speed, 8), lane: 0 });
    b.wp(b.at(far + 2), { speed: 8, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(far + 4);
    return true;
  },
  starSpur(b, rand) {
    // A pad with a side trip for a star, used only when nothing else on the course offered one:
    // a dead-end plank, a perch a spring throws you up onto, or stepping stones.
    const s = rand() < 0.5 ? 1 : -1, len = 9, kind = Math.floor(rand() * 3);
    if (!b.claim(b.at(0, -5), b.at(12, s * (5 + len + 1)), 0)) return false;
    b.pad(b.at(6), 10, 12, 'grey');
    b.wp(b.at(6), { speed: 8 });
    if (kind === 0) {
      b.pieces.push({ type: 'path', from: b.at(6, s * 5), to: b.at(6, s * (5 + len)), width: 3.5, palette: 'orange', open: true });
      // A low end wall to brake into (the theme's wall, not a rail).
      b.pieces.push({ type: 'block', position: b.at(6, s * (5 + len + 0.25), 0.5), size: b.size(0.5, 1, 3.5), color: '#e8d5b0' });
      const tip = b.at(6, s * (5 + len - 2));
      if (b.star(tip, 'spur')) {
        b.riskyWp(b.at(6, s * 6), { speed: 5, lane: 0 });
        b.riskyWp(tip, { speed: 4, lane: 0 });
        b.riskyWp(b.at(6, s * 3), { speed: 5, lane: 0 });
      }
    } else if (kind === 1) {
      // A perch beside the pad, 3 up: a spring throws you onto it, then roll back off.
      b.pad(b.at(6, s * 7.5, 3), 5, 6, 'orange', 4); // solid: its face is a wall
      const [rx, rz] = b.right, yaw = Math.round((Math.atan2(-s * rx, -s * rz) * 180) / Math.PI);
      b.pieces.push({ type: 'spring', position: b.at(6, s * 1.5), power: 16, push: 4, yaw });
      if (b.star(b.at(6, s * 7.5, 3), 'spur')) {
        b.riskyWp(b.at(6, s * 1.5), { speed: 4, lane: 0 });
        b.riskyWp(b.at(6, s * 7.5, 3), { speed: 4, lane: 0 });
        b.riskyWp(b.at(6, s * 2), { speed: 4, lane: 0 });
      }
    } else {
      // Two small stepping stones out to the side, the star on the far one.
      const [w, , depth] = b.size(3, 1, 3);
      for (const at of [7.2, 11.1]) b.pieces.push({ type: 'pad', center: b.at(6, s * at), w, d: depth, palette: 'orange', open: true });
      if (b.star(b.at(6, s * 11.1), 'spur')) {
        b.riskyWp(b.at(6, s * 7.2), { speed: 4, lane: 0 });
        b.riskyWp(b.at(6, s * 11.6), { speed: 3, lane: 0 });
        b.riskyWp(b.at(6, s * 7.2), { speed: 4, lane: 0 });
        b.riskyWp(b.at(6, s * 2), { speed: 4, lane: 0 });
      }
    }
    b.wp(b.at(11), { speed: 9 });
    b.cur = b.at(12);
    return true;
  },

  // ---------- Combos ----------

  sweeperBelt(b, rand, _opts, d) {
    // A belt carrying you forward under a sweeping arm: time it, you can't stop.
    const len = 26, run = 10, end = b.at(len + run);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'conveyor', from: b.cur, to: b.at(len), width: 8, speed: Math.round(mix(8, 10, d)), rails: true });
    const spin = (mix(0.9, 1.4, d) + rand() * 0.2) * (rand() < 0.5 ? -1 : 1);
    b.pieces.push({ type: 'sweeper', position: b.at(len / 2), length: 7.5, speed: r2(spin * 10) / 10 });
    const side = rand() < 0.5 ? 1 : -1;
    b.wp(b.at(len / 2 - 4, side * 2), { speed: 14, lane: 0 });
    b.wp(b.at(len / 2 + 2, side * 2.5), { speed: 14, lane: 0 }); // past the pivot post
    b.wp(b.at(len), { speed: 14 });
    b.pieces.push({ type: 'path', from: b.at(len), to: end, width: 8, rails: true, palette: 'grey' });
    b.wp(end, { speed: 9 });
    b.cur = end;
    return true;
  },
  windCrumble(b, rand, _opts, d) {
    // Crumbling tiles in a crosswind: lean into the wind without slowing down.
    const tiles = 4 + Math.floor(rand() * 2), tileD = 4, span = tiles * tileD, end = 8 + span + 8, side = rand() < 0.5 ? 1 : -1;
    if (!b.claim(b.cur, b.at(end), 7)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    const [w, , depth] = b.size(6, 1, tileD);
    for (let i = 0; i < tiles; i++) b.pieces.push({ type: 'crumble', center: b.at(8 + tileD * (i + 0.5)), w, d: depth, delay: 0.55, respawn: 3 });
    const [rx, rz] = b.right;
    b.pieces.push({ type: 'wind', center: b.at(8 + span / 2, 0, 2), size: b.size(14, 6, span), dir: [rx * side, 0, rz * side], speed: 4, strength: Math.round(mix(5, 8, d)) });
    b.pad(b.at(8 + span + 4), 10, 8, 'grey');
    b.wp(b.at(6), { speed: 10, lane: 0 });
    crumbleDetour(b, side, Math.floor(tiles / 2), 6, tileD, 0.55); // downwind
    b.wp(b.at(8 + span + 4), { speed: 11, lane: 0 });
    b.checkpointsSince = 0;
    b.cur = b.at(end);
    return true;
  },
  boostSpring(b, rand, opts, d) {
    // Spring up onto a ledge that's a launch strip: boost straight up the next climb.
    return SEGMENTS.springUp(b, rand, opts, d) && SEGMENTS.boostRamp(b, rand, opts, d);
  },
  liftWind(b, rand, opts, d) {
    // Ride the lift up, then cross a narrow bridge in a crosswind at the top.
    return SEGMENTS.lift(b, rand, opts, d) && SEGMENTS.windBridge(b, rand, opts, d);
  },
  bumperTreadmill(b, rand, _opts, d) {
    // Climb a down-running belt between bumpers: hold a straight line, because a knock (or
    // slowing down) and the belt carries you back. Like the treadmill, bots aim past the top.
    const len = 26, rise = 3 + Math.floor(rand() * 2), top = b.at(len, 0, rise), end = b.at(len + 10, 0, rise);
    if (!b.claim(b.cur, end, 5)) return false;
    b.pieces.push({ type: 'conveyor', from: top, to: b.cur, width: 8, speed: Math.round(mix(4, 6, d)), rails: true });
    let side = rand() < 0.5 ? 1 : -1;
    for (const ahead of d < 0.5 ? [10, 18] : [8, 14, 20]) {
      b.pieces.push({ type: 'bumper', position: b.at(ahead, side * 2.6, (rise * ahead) / len) });
      side = -side;
    }
    b.pieces.push({ type: 'path', from: top, to: end, width: 8, rails: true, palette: 'grey' });
    b.wp(end, { speed: 16, lane: 0 });
    b.cur = end;
    return true;
  },
  crumbleJump(b, rand, _opts, d) {
    // The run-up to a jump crumbles behind you: commit, or fall.
    const gap = 4 + Math.round(d) + Math.floor(rand() * 2), tiles = 3, tileD = 4;
    const lipAt = 8 + tiles * tileD + 10, total = lipAt + gap + 16;
    if (!b.claim(b.cur, b.at(total, 0, -1), 6)) return false;
    b.pad(b.at(4), 10, 8, 'grey');
    b.checkpoint(b.at(4));
    const [w, , depth] = b.size(8, 1, tileD);
    for (let i = 0; i < tiles; i++) b.pieces.push({ type: 'crumble', center: b.at(8 + tileD * (i + 0.5)), w, d: depth, delay: 0.5, respawn: 3 });
    const lip = b.at(lipAt, 0, 2);
    b.pieces.push({ type: 'path', from: b.at(8 + tiles * tileD), to: lip, width: 8, rails: true, palette: 'orange' });
    const landStart = b.at(lipAt + gap, 0, -1), landEnd = b.at(total, 0, -1);
    b.pieces.push({ type: 'path', from: landStart, to: landEnd, width: 12, palette: b.palette() });
    const e = edgeStar(b, rand, lipAt + 3, 3, 2.75);
    b.lineWp(e, (side) => b.at(6, side), { speed: 16, lane: 0 });
    b.lineWp(e, (side) => b.at(lipAt + gap + 12, side, -1), { speed: 16, lane: 0 });
    b.wp(landEnd, { speed: 9 });
    b.checkpointsSince = 0;
    b.cur = landEnd;
    return true;
  },
};

/** Every segment, at run time (MECHANICS.md lists each one). */
export const SEGMENT_NAMES = Object.keys(SEGMENTS) as Segment[];

/** Segments that give you a breather: no gap, hazard or timing to get right. */
const BREATHERS = new Set<Segment>(['straight', 'rampDown', 'rampUp', 'turn', 'curve', 'hairpin', 'stairs', 'steep', 'spiral', 'cascade', 'conveyor', 'boostRamp', 'split']);
/** Segments that can hide a star (each in its own way; see StarKind). Treadmills can't: stop on one to reach a star and you never get going again. */
const STAR_SEGMENTS = new Set<Segment>([
  'springUp', 'boostSpring', 'jump', 'crumbleJump', 'boostJump', 'moonJump', 'updraft', 'drop', 'crumbleBridge', 'windCrumble',
  'windBridge', 'liftWind', 'bridge', 'split', 'zigzag', 'gauntlet', 'sweeper', 'lift', 'mover', 'fork', 'hairpin', 'spiral',
  'steep', 'cascade', 'boostRamp', 'conveyor', 'starSpur',
  'brakePad', 'pinball', 'keys', 'turntable', 'pendulum', 'rocker', 'rollers', 'paperWall',
  'ironBall', 'wheel', 'trickGates', 'logSlope',
]);
/** The kinds of star each segment can hide (for judging how many kinds a course's mechanics offer). */
const STAR_KINDS_OF: Partial<Record<Segment, StarKind[]>> = {
  springUp: ['super'], boostSpring: ['super', 'crest'], jump: ['edge'], boostJump: ['edge'], crumbleJump: ['edge'], moonJump: ['moon'],
  updraft: ['column'], drop: ['fall'], crumbleBridge: ['detour'], windCrumble: ['detour'], windBridge: ['downwind'], liftWind: ['elevator', 'downwind'],
  bridge: ['tightrope'], split: ['lane'], zigzag: ['corner'], gauntlet: ['gap'], sweeper: ['tip'], lift: ['elevator'], mover: ['firstRide'],
  fork: ['shortcut', 'race'], hairpin: ['noBrake'], spiral: ['noBrake'], steep: ['noBrake'], cascade: ['noBrake'], boostRamp: ['crest'],
  conveyor: ['fastLane'], brakePad: ['lip'], pinball: ['pocket'], keys: ['beat'], turntable: ['rim'], pendulum: ['arc'], rocker: ['tilt'],
  rollers: ['pinch'], paperWall: ['smash'], ironBall: ['steer'], wheel: ['climb'], trickGates: ['peek'], logSlope: ['dodge'],
};

export type Act = 'intro' | 'build' | 'twist' | 'finale';
interface Slot { act: Act; d: number; forced?: Segment[] }

/** The course's segments in order: which act each belongs to and how hard it is. */
function planSlots(opts: GenOptions): Slot[] {
  const n = opts.length;
  if (!opts.acts) return Array.from({ length: n }, () => ({ act: 'build', d: opts.difficulty ?? 1 })); // the old flat draw
  const finale = n >= 10 ? 2 : 1;
  const intro = Math.max(1, Math.round(n * 0.2)), twist = Math.max(1, Math.round(n * 0.2));
  const build = Math.max(1, n - intro - twist - finale);
  const ramp = (count: number, from: number, to: number, act: Act): Slot[] =>
    Array.from({ length: count }, (_, i) => ({ act, d: count > 1 ? mix(from, to, i / (count - 1)) : to }));
  const twistSlots = ramp(twist, 0.6, 0.85, 'twist');
  twistSlots[0].forced = opts.acts.risk ?? ['fork'];
  return [...ramp(intro, 0, 0.2, 'intro'), ...ramp(build, 0.25, 0.7, 'build'), ...twistSlots, ...ramp(finale, 0.9, 1, 'finale')];
}

/** Weighted random pick. */
function picker(rand: () => number, weights: Partial<Record<Segment, number>>): () => Segment {
  const entries = Object.entries(weights).filter(([, w]) => (w ?? 0) > 0) as [Segment, number][];
  if (!entries.length) throw new Error('no segments to pick from');
  const total = entries.reduce((n, [, w]) => n + w, 0);
  return () => {
    let r = rand() * total;
    for (const [s, w] of entries) if ((r -= w) <= 0) return s;
    return entries[0][0];
  };
}
const even = (list: Segment[]) => Object.fromEntries(list.map((s) => [s, 1])) as Partial<Record<Segment, number>>;

/** Builds `seg`; on success adds a checkpoint pad if one is due, on failure undoes everything it added. */
function place(b: CourseBuilder, seg: Segment, rand: () => number, opts: GenOptions, d: number): boolean {
  const snapshot = {
    pieces: b.pieces.length, route: b.route.length, alt: b.alt.length, cur: b.cur, dir: b.dir, rects: b.rects.length,
    stars: b.starCount, kinds: b.starKinds.length, wantStar: b.wantStar, checkpointsSince: b.checkpointsSince,
    lastCheckpoint: b.lastCheckpoint,
  };
  if (!SEGMENTS[seg](b, rand, opts, d)) {
    b.pieces.length = snapshot.pieces;
    b.route.length = snapshot.route;
    b.alt.length = snapshot.alt;
    b.cur = snapshot.cur;
    b.dir = snapshot.dir;
    b.rects.length = snapshot.rects; // release the space a failed segment had claimed
    b.starCount = snapshot.stars;
    b.starKinds.length = snapshot.kinds;
    b.wantStar = snapshot.wantStar;
    b.checkpointsSince = snapshot.checkpointsSince;
    b.lastCheckpoint = snapshot.lastCheckpoint;
    return false;
  }
  b.checkpointsSince++;
  if (b.checkpointsSince >= 3 && seg !== 'turn') {
    // Keep checkpoints regular: a small pad after every few segments.
    const c = b.at(5);
    if (b.claim(b.at(0, -5), b.at(10, 5), 0)) {
      b.pad(c, 10, 10, 'grey');
      b.checkpoint(c);
      b.wp(c, { speed: 10 });
      b.cur = b.at(10);
      b.checkpointsSince = 0;
    }
  }
  return true;
}

/** Chains the planned segments onto the builder, then a goal pad. False if they don't fit. */
function buildCourse(b: CourseBuilder, rand: () => number, opts: GenOptions): boolean {
  const slots = planSlots(opts);
  // Leave out whatever MECHANICS.md switches off; an act left empty draws from the build-up instead.
  const off = new Set(opts.off?.segments ?? []);
  b.offKinds = new Set(opts.off?.stars ?? []);
  const on = (list: Segment[]) => list.filter((seg) => !off.has(seg));
  const weights = Object.fromEntries(Object.entries(opts.weights).filter(([seg]) => !off.has(seg as Segment))) as GenOptions['weights'];
  if (!Object.keys(weights).length) throw new Error(`${opts.name}: every segment it uses is switched off in MECHANICS.md`);
  const acts = opts.acts && { intro: on(opts.acts.intro), twist: on(opts.acts.twist), finale: on(opts.acts.finale) };
  const build = picker(rand, weights);
  const actPool = (list: Segment[]) => (list.length ? picker(rand, even(list)) : build);
  const pools: Record<Act, () => Segment> = acts
    ? { intro: actPool(acts.intro), build, twist: actPool(acts.twist.length ? acts.twist : on(['fork'])), finale: actPool(acts.finale) }
    : { intro: build, build, twist: build, finale: build };
  const calm = Object.fromEntries(Object.entries(weights).filter(([seg]) => BREATHERS.has(seg as Segment)));
  const fallbackCalm = even(on(['curve', 'straight']));
  const breather = picker(rand, Object.keys(calm).length ? calm : Object.keys(fallbackCalm).length ? fallbackCalm : weights);
  const poolSize: Record<Act, number> = {
    intro: acts?.intro.length || Object.keys(weights).length, build: Object.keys(weights).length,
    twist: acts?.twist.length || Object.keys(weights).length, finale: acts?.finale.length || Object.keys(weights).length,
  };

  // Stars: one per window of the course before the finale. The course's own mechanics (its
  // acts) get the first half of each window to hide it; then any segment that can may; a window
  // that ends without one gets a dead-end spur with a star.
  const wanted = opts.stars ?? 0;
  const before = slots.filter((s) => s.act !== 'finale').length;
  const windowOf = (i: number) => Math.min(wanted - 1, Math.floor((i * wanted) / before));
  const windowStart = (w: number) => slots.findIndex((_, j) => windowOf(j) === w);
  const windowLength = (w: number) => slots.filter((s, j) => s.act !== 'finale' && windowOf(j) === w).length;
  // The twist's risk/reward piece joins them only on courses whose own mechanics offer fewer
  // than three kinds of star (a course never repeats a kind); otherwise it would hold one on
  // nearly every course, so it may hide a star only late in a window, like any other segment.
  const signature = acts ? new Set<Segment>([...acts.intro, ...acts.twist, ...acts.finale]) : null;
  if (signature) {
    const own = new Set([...Object.keys(weights), ...signature].flatMap((seg) => STAR_KINDS_OF[seg as Segment] ?? []));
    if (own.size < 4) for (const seg of opts.acts?.risk ?? ['fork']) signature.add(seg); // a little slack: not every kind turns up
  }

  let prev: Segment | null = null, hardRun = 0;
  for (const [i, slot] of slots.entries()) {
    const starWindow = wanted && slot.act !== 'finale' ? windowOf(i) : -1;
    const needStar = b.starCount <= starWindow;
    const late = starWindow >= 0 && i - windowStart(starWindow) >= windowLength(starWindow) / 2;
    const mayHold = (seg: Segment) => STAR_SEGMENTS.has(seg) && (!signature || signature.has(seg) || late);
    let placed: Segment | null = null, kind: StarKind | undefined;
    // The twist's risk/reward choice: one of the course's (no draw when there's only one to pick).
    const forcedList = slot.forced?.filter((seg) => !off.has(seg)) ?? [];
    const forced = forcedList.length > 1 ? forcedList[Math.floor(rand() * forcedList.length)] : forcedList[0];
    for (let tries = 0; !placed && tries < 16; tries++) {
      let seg: Segment;
      if (forced && tries < 4) seg = forced;
      else if (acts && slot.act === 'intro' && i % 2 === 1) seg = breather(); // intro: show it, then a breather
      else if (acts && slot.act !== 'finale' && slot.act !== 'intro' && hardRun >= (opts.hardRun ?? 2)) seg = breather(); // two hard ones (or `hardRun`), then a breather
      else seg = pools[slot.act]();
      // Variety: no segment twice in a row (unless the act only has one to offer, or it's the finale).
      if (seg === prev && seg !== 'straight' && slot.act !== 'finale' && (poolSize[slot.act] > 1 || !acts)) continue;
      b.wantStar = needStar && mayHold(seg);
      const stars = b.starCount;
      if (place(b, seg, rand, opts, slot.d)) {
        placed = seg;
        if (b.starCount > stars) kind = b.starKinds[b.starKinds.length - 1];
      }
    }
    if (!placed) return false;
    opts.onSegment?.(placed, slot.act, slot.d, kind);
    hardRun = BREATHERS.has(placed) ? 0 : hardRun + 1;
    prev = placed;

    const windowEnds = starWindow >= 0 && (i === before - 1 || windowOf(i + 1) !== starWindow);
    if (windowEnds && b.starCount <= starWindow) {
      if (off.has('starSpur')) return false; // no fallback left: try another seed
      b.wantStar = true;
      if (!place(b, 'starSpur', rand, opts, slot.d)) return false;
      opts.onSegment?.('starSpur', slot.act, slot.d, 'spur');
    }
  }
  b.wantStar = false;
  if (b.starCount !== wanted) return false;

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
  const b = new CourseBuilder(opts.maxSpeed ?? 16, gravityOf(opts.theme));
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
    ...(b.starCount ? { starRoute: b.alt } : {}),
  };
}

/**
 * Continues a hand-made course past its finish: the old goal pad becomes a checkpoint and
 * `opts.length` new segments lead to a new goal. The course must end heading along an axis.
 * Safety walls (see guard.ts) are dropped; re-add them afterwards.
 */
export function extendLevel(base: LevelData, opts: GenOptions): LevelData | null {
  const rand = rng(opts.seed);
  const b = new CourseBuilder(opts.maxSpeed ?? 16, gravityOf(opts.theme));
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
  b.checkpoint(goal.position);
  b.route = route.map((r, i) => (i === route.length - 1 ? { ...r, speed: 10 } : r));
  b.alt = b.route.map((r) => ({ ...r }));

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
  return { ...base, medals: undefined, pieces: b.pieces, route: b.route, ...(b.starCount ? { starRoute: b.alt } : {}) };
}
