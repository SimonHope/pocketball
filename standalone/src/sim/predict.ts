import { SIM } from '../config';
import { poseAt, type ResolvedLevel, type Solid } from './geometry';
import { conjugate, length, rotate, sub, type Vec3 } from './math';

// Bots can see ahead: every moving piece is a function of the sim clock, so before a `timed`
// stretch a bot checks that nothing will be in its way while it crosses, and that the floor
// will still be there under it (piano keys, turntables, rockers). Pure maths, no physics world.

const R = SIM.ball.radius;
const CLEARANCE = 0.4; // room to spare around the ball
const EDGE = 0;        // how far inside a moving floor's edge the ball's contact point must be
const SEAM = 0.6;      // a ball bridges this much between floors (where a pad meets a disc or key)

interface Leg { points: Vec3[]; along: number[]; staticFloor: boolean[]; obstacles: Solid[]; floors: Solid[] }
const legs = new WeakMap<ResolvedLevel, Map<string, Leg>>();

/** Centre and radius of a sphere holding everywhere a solid can be. */
function reach(solid: Solid): { c: Vec3; r: number } {
  const s = solid.shape;
  const ext = s.kind === 'box' ? length(s.size) / 2 : s.kind === 'sphere' ? s.radius : Math.hypot(s.radius, s.height / 2);
  const m = solid.motion;
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  if (!m) return { c: solid.position, r: ext };
  if (m.kind === 'oscillate') return { c: mid(m.from, m.to), r: length(sub(m.to, m.from)) / 2 + ext };
  if (m.kind === 'travel') {
    const c = mid(m.from, m.to);
    return { c, r: Math.max(length(sub(m.to, m.from)) / 2, m.park ? length(sub(m.park, c)) : 0) + ext };
  }
  if (m.kind === 'spin') return m.center ? { c: m.center, r: length(sub(solid.position, m.center)) + ext } : { c: solid.position, r: ext };
  const c = m.kind === 'orbit' ? m.center : m.pivot;
  return { c, r: length(sub(solid.position, c)) + ext };
}

/** Distance from point `p` to the segment a→b. */
function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), ap = sub(p, a);
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = len2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0;
  return length(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

/** `p` in the solid's own frame at time `t`. */
function local(solid: Solid, p: Vec3, t: number): Vec3 {
  const pose = poseAt(solid, t);
  return rotate(sub(p, pose.position), conjugate(pose.rotation));
}

/** Does a ball centred at `c` (with room to spare) touch the solid at time `t`? */
function touches(solid: Solid, c: Vec3, t: number): boolean {
  const q = local(solid, c, t), s = solid.shape, r = R + CLEARANCE;
  if (s.kind === 'box') {
    const dx = Math.max(Math.abs(q[0]) - s.size[0] / 2, 0), dy = Math.max(Math.abs(q[1]) - s.size[1] / 2, 0), dz = Math.max(Math.abs(q[2]) - s.size[2] / 2, 0);
    return Math.hypot(dx, dy, dz) < r;
  }
  if (s.kind === 'sphere') return length(q) < s.radius + r;
  return Math.hypot(Math.max(Math.hypot(q[0], q[2]) - s.radius, 0), Math.max(Math.abs(q[1]) - s.height / 2, 0)) < r;
}

/** Is the top of the solid under floor point `p` (and about level with it) at time `t`? */
function floorUnder(solid: Solid, p: Vec3, t: number, edge = EDGE): boolean {
  const q = local(solid, p, t), s = solid.shape;
  if (s.kind === 'sphere') return false;
  const top = (s.kind === 'box' ? s.size[1] : s.height) / 2;
  if (q[1] < top - 0.8 || q[1] > top + 0.6) return false;
  return s.kind === 'box'
    ? Math.abs(q[0]) <= s.size[0] / 2 - edge && Math.abs(q[2]) <= s.size[2] / 2 - edge
    : Math.hypot(q[0], q[2]) <= s.radius - edge;
}

function legOf(level: ResolvedLevel, from: Vec3, to: Vec3): Leg {
  let cache = legs.get(level);
  if (!cache) legs.set(level, (cache = new Map()));
  const key = `${from.join()}>${to.join()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dist = length(sub(to, from)), n = Math.max(1, Math.ceil(dist));
  const points: Vec3[] = [], along: number[] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    points.push([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f]);
    along.push(dist * f);
  }
  // Iron balls are each player's own and move by physics, not the clock: no telling where they'll be.
  const near = level.solids.filter((s) => { const { c, r } = reach(s); return s.role !== 'carrier' && toSegment(c, from, to) < r + R + 2; });
  const isFloor = (s: Solid) => (s.role === 'floor' || s.role === 'platform') && s.effect?.kind !== 'hazard';
  const staticFloors = near.filter((s) => !s.motion && isFloor(s));
  const leg: Leg = {
    points, along,
    staticFloor: points.map((p) => staticFloors.some((s) => floorUnder(s, p, 0, -SEAM))), // a ball rolls over the seams between floors
    obstacles: near.filter((s) => s.motion && !isFloor(s)),
    floors: near.filter((s) => s.motion && isFloor(s)),
  };
  cache.set(key, leg);
  return leg;
}

/** Floor point `p` is on solid ground out of reach of every moving piece: a bot looking ahead can stop there. */
export function safeSpot(level: ResolvedLevel, p: Vec3): boolean {
  let cache = safe.get(level);
  if (!cache) safe.set(level, (cache = new Map()));
  const key = p.join();
  let known = cache.get(key);
  if (known === undefined) cache.set(key, (known = isSafe(level, p)));
  return known;
}
const safe = new WeakMap<ResolvedLevel, Map<string, boolean>>();

function isSafe(level: ResolvedLevel, p: Vec3): boolean {
  const ball: Vec3 = [p[0], p[1] + R, p[2]];
  return level.solids.some((s) => !s.motion && (s.role === 'floor' || s.role === 'platform') && s.effect?.kind !== 'hazard' && floorUnder(s, p, 0, -SEAM))
    && level.solids.every((s) => { if (!s.motion) return true; const { c, r } = reach(s); return length(sub(ball, c)) > r + R + CLEARANCE; });
}

/**
 * Will a ball setting off from the first floor point at time `t0` and following the rest,
 * rolling at about `speeds[i]` toward point i + 1, meet no moving piece and have floor under it
 * all the way? Each point is checked over a window around when the ball should be there, since
 * bots don't keep exact time.
 */
export function legClear(level: ResolvedLevel, points: Vec3[], speeds: number[], t0: number): boolean {
  let eta = 0.2; // a moment to get going from a standstill
  for (let i = 0; i + 1 < points.length; i++) {
    const leg = legOf(level, points[i], points[i + 1]);
    const speed = Math.max(1, speeds[i]);
    const start = eta;
    eta += leg.along[leg.along.length - 1] / speed;
    if (!leg.obstacles.length && !leg.floors.length) continue;
    for (let k = 0; k < leg.points.length; k++) {
      const p = leg.points[k], ball: Vec3 = [p[0], p[1] + R, p[2]];
      const at = start + leg.along[k] / speed, slack = 0.1 + at * 0.04;
      for (let t = t0 + at - slack; t <= t0 + at + slack; t += 0.1) {
        if (leg.obstacles.some((s) => touches(s, ball, t))) return false;
        if (!leg.staticFloor[k] && !leg.floors.some((s) => floorUnder(s, p, t))) return false;
      }
    }
  }
  return true;
}
