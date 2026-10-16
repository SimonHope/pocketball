import type { RoutePoint } from '../levels/schema';
import type { Vec3 } from './math';
import { legClear, safeSpot } from './predict';
import type { Input, Simulation } from './simulation';

// Follows a level's `route` of waypoints. Used by automated tests to prove a level can be
// finished, and (with a style) as the Quick Play bots.

const ARRIVE_RADIUS = 2;
const ARRIVE_ABOVE = 2;   // ...and no higher above it than this
const EDGE_MARGIN = 1.3; // keep this much floor beyond the ball's side when taking a lane
const SIDE_MARGIN = 1.1; // floor needed either side of a lane path
const CATCH_PATIENCE = 12; // seconds to hold at a `catch` point before giving up on its star
const LOOK_AHEAD = 6;      // waypoints a `timed` point checks at most
const RIDE_REACH = 1.6;    // a `ride` point is reached once the platform you're on is this close
/** Balancing on an iron ball: steer it toward the waypoint while keeping over its top. */
const BALANCE = { drive: 0.25, lean: 0.9, damp: 0.45 };
/** On an iron ball that rolls on by itself: steering it, and staying over the top. */
const ROLLING = { steer: 1, lean: 0.6, damp: 0.4 };

/** How a bot drives. The default (no style) is the careful test pilot. */
export interface PilotStyle {
  /** Sideways offset from the route line in units (+ = right). Shrinks where the floor is narrow. */
  lane?: number;
  /** Speed multiplier (skill): 0.8 = relaxed, 1.05 = fast. */
  pace?: number;
  /** Steer around other balls ahead. */
  avoid?: boolean;
  /** Which route to follow: the safe main line (default) or the one that collects every star. */
  route?: 'main' | 'stars';
}

export class Autopilot {
  index = 0;
  private sawGap = false; // for `wait` points: has the floor been missing since we started waiting?
  private lastPos: [number, number, number] | null = null;
  private target: { index: number; p: Vec3 } | null = null; // current waypoint, shifted into our lane
  private holding: { index: number; stars: number; since: number } | null = null; // at a `catch` point
  private looked: { index: number; at: number; clear: boolean } | null = null;    // at a `timed` point

  constructor(private sim: Simulation, private cruiseSpeed = 16, private style: PilotStyle = {}) {}

  private get route(): RoutePoint[] {
    return this.style.route === 'stars' ? this.sim.level.starRoute : this.sim.level.route;
  }

  get done() {
    return this.index >= this.route.length;
  }

  /** Continue from the waypoint nearest the ball (e.g. after respawning). */
  resync() {
    const pos = this.sim.position();
    let best = 0, bestDist = Infinity;
    this.route.forEach((wp, i) => {
      const d = Math.hypot(wp.p[0] - pos[0], wp.p[1] + 1 - pos[1], wp.p[2] - pos[2]);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    this.index = best;
    this.sawGap = false;
    this.target = null;
  }

  /**
   * Waypoint `i` moved sideways into our lane, as far as the floor and obstacles allow. The
   * route threads between obstacles, so the lane must be clear at the point and on the way there.
   */
  private lanePoint(i: number): Vec3 {
    const route = this.route;
    const wp = route[i];
    const limit = wp.lane ?? Infinity;
    const lane = Math.max(-limit, Math.min(limit, this.style.lane ?? 0));
    // No lanes at platforms or at the final waypoint (the goal: everyone must get into it).
    if (!lane || wp.wait || route[i - 1]?.wait || wp.timed || route[i - 1]?.timed || wp.ride || i === route.length - 1) return wp.p;
    const prev = i > 0 ? route[i - 1].p : this.sim.level.start.position;
    const dx = wp.p[0] - prev[0], dz = wp.p[2] - prev[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return wp.p;
    const rx = -dz / len, rz = dx / len; // right of travel
    // Floor point we're coming from: the previous lane point, or the spot under the ball.
    const ball = this.sim.position();
    const from: Vec3 = this.target?.p ?? [ball[0], ball[1] - 1, ball[2]];
    for (const f of [1, 0.5]) {
      const o = lane * f;
      const edge = o + Math.sign(o) * EDGE_MARGIN;
      const p: Vec3 = [wp.p[0] + rx * o, wp.p[1], wp.p[2] + rz * o];
      if (!this.sim.floorAt([wp.p[0] + rx * edge, wp.p[1], wp.p[2] + rz * edge]) || !this.sim.floorAt(p)) continue;
      if (!this.pathIsSafe(from, p)) continue;
      // Before a tight spot, the way on from this lane must be clear too (don't clip the
      // corner of a narrow entrance).
      const next = route[i + 1];
      if (next && (next.lane === 0 || next.wait) && !this.pathIsSafe(p, next.p)) continue;
      return p;
    }
    return wp.p;
  }

  /** Has the platform we're riding brought us to `p`? */
  private carried(p: Vec3): boolean {
    const c = this.sim.platformCenter;
    return !!c && Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < RIDE_REACH;
  }

  /** At a `catch` point: has a star been collected since we got here (or have we waited long enough)? */
  private caught(): boolean {
    const count = this.sim.stars.filter(Boolean).length;
    if (this.holding?.index !== this.index) this.holding = { index: this.index, stars: count, since: this.sim.time };
    return count > this.holding.stars || this.sim.time - this.holding.since > CATCH_PATIENCE;
  }

  /**
   * At a `timed` point: will the way on be clear if we go now? It looks along the route until the
   * next timed point, or somewhere safe from every moving piece. (Ten times a second.)
   */
  private clearAhead(): boolean {
    if (this.looked?.index === this.index && this.sim.time - this.looked.at < 0.1) return this.looked.clear;
    // From where the ball is (to half a unit, so the look-ahead's per-leg work is shared).
    const ball = this.sim.position(), half = (n: number) => Math.round(n * 2) / 2;
    const route = this.route, points: Vec3[] = [[half(ball[0]), half(ball[1] - 1), half(ball[2])]], speeds: number[] = [];
    for (let j = this.index + 1; j < route.length && j <= this.index + LOOK_AHEAD; j++) {
      points.push(route[j].p);
      speeds.push((route[j].speed ?? this.cruiseSpeed) * (this.style.pace ?? 1));
      if (route[j].timed || route[j].wait || route[j].ride || route[j].catch || safeSpot(this.sim.level, route[j].p)) break; // the bot stops there anyway
    }
    const clear = legClear(this.sim.level, points, speeds, this.sim.time);
    this.looked = { index: this.index, at: this.sim.time, clear };
    return clear;
  }

  input(): Input {
    const route = this.route;
    const pos = this.sim.position();
    const vel = this.sim.velocity();
    const ground = this.sim.groundVelocity;

    // After a fall the ball reappears at a checkpoint: carry on from the nearest waypoint.
    if (this.lastPos && Math.hypot(pos[0] - this.lastPos[0], pos[1] - this.lastPos[1], pos[2] - this.lastPos[2]) > 5) {
      this.resync();
    }
    this.lastPos = pos;

    while (this.index < route.length) {
      if (this.target?.index !== this.index) this.target = { index: this.index, p: this.lanePoint(this.index) };
      const wp = this.target.p;
      const dist = Math.hypot(wp[0] - pos[0], wp[2] - pos[2]);
      // High above a point (at the top of a hop) isn't there yet: steering on early drifts you off the arc.
      const above = pos[1] - 1 - wp[1];
      if (dist < ARRIVE_RADIUS && above > -3 && above < ARRIVE_ABOVE) {
        if (route[this.index].catch && !this.caught()) break; // hold until the riding star comes by
        if (route[this.index].timed && !this.clearAhead()) break; // hold until the way on is clear
        if (route[this.index].ride && !this.carried(route[this.index].p)) break; // not up there yet
        this.index++;
        this.sawGap = false;
      } else break;
    }

    // On an iron ball: balance on top and push it along.
    // (Once the waypoint is on solid ground off the ball, just roll off onto it.)
    const carrier = this.sim.carrier(), tp = this.target?.p;
    const offBall = tp && carrier && this.sim.floorAt(tp) && Math.hypot(tp[0] - carrier.position[0], tp[2] - carrier.position[2]) > 4;
    if (carrier && tp && !offBall && route[this.index]) return this.balance(carrier, pos, vel, tp, route[this.index].speed ?? 3);

    // Desired velocity, relative to whatever the ball is standing on. While waiting on a
    // moving platform, drift toward its middle so the ride doesn't end at an edge.
    let want: [number, number] = [ground[0], ground[2]];
    const center = this.sim.platformCenter;
    if (center) {
      want[0] += (center[0] - pos[0]) * 1.5;
      want[1] += (center[2] - pos[2]) * 1.5;
    }
    // `wait` points: go only once the platform *arrives* (floor appears after a gap), so we
    // never jump on just as it is leaving.
    const wp = route[this.index];
    let go = !!wp;
    if (wp?.ride && center) {
      go = this.carried(wp.p); // riding a step: stay on until it has carried you there
    } else if (wp?.wait) {
      const floor = this.sim.floorAt(wp.p);
      if (!floor) this.sawGap = true;
      go = floor && this.sawGap;
    }
    if (go && wp && this.target) {
      const tp = this.target.p;
      const dx = tp[0] - pos[0], dz = tp[2] - pos[2];
      const dist = Math.hypot(dx, dz) || 1e-6;
      const pace = this.style.pace ?? 1;
      const speed = Math.min((wp.speed ?? this.cruiseSpeed) * pace, 3 + dist * 1.2);
      want = [ground[0] + (dx / dist) * speed, ground[2] + (dz / dist) * speed];
      if (this.style.avoid && !center) this.avoid(want, pos, dx / dist, dz / dist);
    }

    const sx = want[0] - vel[0], sz = want[1] - vel[2];
    const m = Math.hypot(sx, sz);
    if (m < 0.3) return { x: 0, z: 0 };
    const k = Math.min(1, m / 2) / m;
    return { x: sx * k, z: sz * k };
  }

  /**
   * Your push moves both you and the iron ball, you a little more, and gravity tips you off the
   * top. It's an upside-down pendulum: to roll the ball forward you sit a little behind the top
   * and push, so the speed term works through where you sit (its sign looks backwards, but a
   * steady push forward only holds while you lean back).
   */
  private balance(c: { position: Vec3; velocity: Vec3; dir?: Vec3 }, pos: Vec3, vel: Vec3, target: Vec3, speed: number): Input {
    const ox = pos[0] - c.position[0], oz = pos[2] - c.position[2];
    const rx = vel[0] - c.velocity[0], rz = vel[2] - c.velocity[2];
    if (c.dir) {
      // It rolls on by itself: steer it sideways toward the waypoint's line, and keep over the top.
      const [fx, , fz] = c.dir, sx = -fz, sz = fx;
      const side = (target[0] - c.position[0]) * sx + (target[2] - c.position[2]) * sz;
      const wantSide = Math.max(-4, Math.min(4, side * 1.5)), haveSide = c.velocity[0] * sx + c.velocity[2] * sz;
      const steer = ROLLING.steer * (wantSide - haveSide); // sideways pushes go to the ball, which carries you
      const fwd = -ROLLING.lean * (ox * fx + oz * fz) - ROLLING.damp * (rx * fx + rz * fz);
      const x = sx * steer + fx * fwd, z = sz * steer + fz * fwd, m = Math.hypot(x, z);
      return m > 1 ? { x: x / m, z: z / m } : { x, z };
    }
    const dx = target[0] - c.position[0], dz = target[2] - c.position[2], dist = Math.hypot(dx, dz) || 1;
    const want = Math.min(speed * (this.style.pace ?? 1), dist * 0.6);
    const ex = (dx / dist) * want - c.velocity[0], ez = (dz / dist) * want - c.velocity[2];
    const x = -BALANCE.drive * ex - BALANCE.lean * ox - BALANCE.damp * rx;
    const z = -BALANCE.drive * ez - BALANCE.lean * oz - BALANCE.damp * rz;
    const m = Math.hypot(x, z);
    return m > 1 ? { x: x / m, z: z / m } : { x, z };
  }

  /** Floor under the whole path (with room for the ball's width) and no obstacles on it. */
  private pathIsSafe(from: Vec3, to: Vec3): boolean {
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const len = Math.hypot(dx, dz) || 1;
    const sx = (-dz / len) * SIDE_MARGIN, sz = (dx / len) * SIDE_MARGIN; // sideways, ball width + a bit
    for (let s = 1; s <= 8; s++) {
      const t = s / 8;
      const p: Vec3 = [from[0] + dx * t, from[1] + (to[1] - from[1]) * t, from[2] + dz * t];
      if (!this.sim.clearAt(p) || !this.sim.floorAt(p)) return false;
      if (!this.sim.floorAt([p[0] + sx, p[1], p[2] + sz]) || !this.sim.floorAt([p[0] - sx, p[1], p[2] - sz])) return false;
    }
    return true;
  }

  /** Nudge `want` sideways around balls just ahead of us. */
  private avoid(want: [number, number], pos: Vec3, fx: number, fz: number) {
    const rx = -fz, rz = fx;
    for (const o of this.sim.otherBalls) {
      const ox = o.position[0] - pos[0], oz = o.position[2] - pos[2];
      if (Math.abs(o.position[1] - pos[1]) > 2) continue;
      const ahead = ox * fx + oz * fz;
      const side = ox * rx + oz * rz;
      if (ahead <= 0 || ahead > 5 || Math.abs(side) > 2.4) continue;
      const away = side > 0 ? -1 : 1; // go around on the side with more room
      const strength = (2.4 - Math.abs(side)) * 2.5;
      want[0] += rx * away * strength;
      want[1] += rz * away * strength;
    }
  }
}
