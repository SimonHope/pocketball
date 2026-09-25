import { SIM } from '../config';
import type { ResolvedLevel } from '../sim/geometry';
import { add, length, sub, type Vec3 } from '../sim/math';
import type { BallUpdate } from './protocol';

// Server-side race rules, shared as pure functions so they're unit-testable.
// Clients simulate their own balls; the server only accepts updates that could
// really have happened, and works out checkpoints, finishes, and placings itself.

export const LIMITS = {
  maxSpeed: 60,          // units/s; top rolling speed is 22, bumpers and falls add more
  slack: 3,              // units of leeway per update
  maxGapSeconds: 0.5,    // movement allowed per update is capped at this much time, so a
                         // cheater can't "save up" distance by sending rejected updates
  minFinishOfGold: 0.5,  // finishing faster than half the gold time is not believable
  clockAhead: 300,       // ms an update's timestamp may be ahead of the server clock
  clockBehind: 2000,     // ms it may lag behind (slow connections)
  strikesToDnf: 10,      // rejected updates before a player is disqualified
};

// ---------- Progress along the route ----------

/** The route as a polyline of ball-center points, starting at the spawn. */
function routeLine(level: ResolvedLevel): Vec3[] {
  return [level.start.position, ...level.route.map((r) => add(r.p, [0, SIM.ball.radius, 0]))];
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { t: number; dist: number } {
  const ab = sub(b, a);
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const ap = sub(p, a);
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2));
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { t, dist: length(sub(p, q)) };
}

/** Distance travelled along the level's route to the point nearest `pos`. Used for live placings. */
export function routeProgress(level: ResolvedLevel, pos: Vec3): number {
  const line = routeLine(level);
  let best = { dist: Infinity, progress: 0 };
  let walked = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = length(sub(line[i + 1], line[i]));
    const c = closestOnSegment(pos, line[i], line[i + 1]);
    if (c.dist < best.dist) best = { dist: c.dist, progress: walked + c.t * segLen };
    walked += segLen;
  }
  return best.progress;
}

/** Ranks racers: finishers by time, then everyone else by progress. Returns ids in order. */
export function rankPlayers(players: { id: string; finishTime: number; progress: number; dnf: boolean }[]): string[] {
  return [...players]
    .sort((a, b) => {
      const af = a.finishTime >= 0, bf = b.finishTime >= 0;
      if (af !== bf) return af ? -1 : 1;
      if (af && bf) return a.finishTime - b.finishTime;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.progress - a.progress;
    })
    .map((p) => p.id);
}

// ---------- Movement checks ----------

export type CheckResult =
  | { ok: true; checkpoint?: number; finishTime?: number }
  | { ok: false; reason: string; strike: boolean };

const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Fraction (0..1) along segment a→b where it first comes within `radius` (horizontally) of
 * `center` with a height difference under 3, or null. Catches fast balls passing through.
 */
function entersCircle(a: Vec3, b: Vec3, center: Vec3, radius: number): number | null {
  const steps = Math.max(1, Math.ceil(length(sub(b, a)) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
    if (Math.hypot(x - center[0], z - center[2]) < radius && Math.abs(y - center[1]) < 3) return f;
  }
  return null;
}

/** Validates one player's stream of ball updates during a race. One instance per player per race. */
export class MoveChecker {
  readonly reached: boolean[];
  /** Respawns seen (falls or back-to-checkpoint); solo times add a penalty for each. */
  respawns = 0;
  private last: { p: Vec3; t: number } | null = null;
  private bounds: { min: Vec3; max: Vec3 };

  constructor(private level: ResolvedLevel, private startAt: number, private start: Vec3 = level.start.position) {
    this.reached = level.checkpoints.map(() => false);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const s of level.solids) {
      const points = s.motion?.kind === 'oscillate' ? [s.motion.from, s.motion.to] : [s.position];
      for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
    }
    this.bounds = {
      min: [min[0] - 40, min[1] - SIM.fallDepth - 20, min[2] - 40],
      max: [max[0] + 40, max[1] + 40, max[2] + 40],
    };
  }

  /** Legal places to reappear after a fall: the start and any checkpoint already reached. */
  private spawnPoints(): Vec3[] {
    const points = [this.start];
    this.level.checkpoints.forEach((cp, i) => { if (this.reached[i]) points.push(add(cp.position, [0, 1.2, 0])); });
    return points;
  }

  check(u: BallUpdate, serverNow: number): CheckResult {
    if (!u || typeof u.t !== 'number' || !Number.isFinite(u.t) || !isVec(u.p) || !isVec(u.v)) {
      return { ok: false, reason: 'malformed', strike: true };
    }
    if (u.t > serverNow + LIMITS.clockAhead) return { ok: false, reason: 'from the future', strike: true };
    if (u.t < serverNow - LIMITS.clockBehind) return { ok: false, reason: 'too old', strike: false };
    if (this.last && u.t <= this.last.t) return { ok: false, reason: 'out of order', strike: false };
    if (length(u.v) > LIMITS.maxSpeed) return { ok: false, reason: 'too fast', strike: true };
    for (let i = 0; i < 3; i++) {
      if (u.p[i] < this.bounds.min[i] || u.p[i] > this.bounds.max[i]) return { ok: false, reason: 'out of bounds', strike: true };
    }

    const from = this.last ?? { p: this.start, t: Math.max(this.startAt, u.t - 50) };
    const dt = Math.min(LIMITS.maxGapSeconds, Math.max(0, u.t - Math.max(from.t, this.startAt)) / 1000);
    const reach = LIMITS.maxSpeed * dt + LIMITS.slack;
    const moved = length(sub(u.p, from.p));
    let respawned = false;
    if (moved > reach) {
      respawned = this.spawnPoints().some((s) => length(sub(u.p, s)) <= reach);
      if (!respawned) return { ok: false, reason: `moved ${moved.toFixed(1)} in ${dt.toFixed(2)}s`, strike: true };
    }
    if (u.t < this.startAt && moved > LIMITS.slack) return { ok: false, reason: 'moved before GO', strike: true };

    if (respawned) this.respawns++;
    // Accepted. Work out checkpoints and the finish along the path travelled.
    const a = respawned ? u.p : from.p;
    const result: CheckResult = { ok: true };
    this.level.checkpoints.forEach((cp, i) => {
      if (!this.reached[i] && entersCircle(a, u.p, cp.position, SIM.checkpointRadius) !== null) {
        this.reached[i] = true;
        result.checkpoint = i;
      }
    });
    const goal = this.level.goal;
    if (goal && u.t >= this.startAt) {
      const f = entersCircle(a, u.p, goal.position, goal.radius);
      if (f !== null) {
        const tFrom = respawned ? u.t : from.t;
        const finishTime = (tFrom + (u.t - tFrom) * f - this.startAt) / 1000;
        const gold = this.level.medals?.gold;
        if (gold && finishTime < gold * LIMITS.minFinishOfGold) return { ok: false, reason: 'impossibly fast finish', strike: true };
        result.finishTime = finishTime;
      }
    }
    this.last = { p: u.p, t: u.t };
    return result;
  }
}
