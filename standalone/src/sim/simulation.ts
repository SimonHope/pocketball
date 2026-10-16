import RAPIER from '@dimforge/rapier3d-compat';
import { SIM } from '../config';
import { THEMES, gravityOf, gustAt } from '../levels/themes';
import { pointVelocity, poseAt, starAt, type ResolvedLevel, type Solid } from './geometry';
import type { Quat, Vec3 } from './math';

// The authoritative game simulation: physics world, the ball, and race rules.
// It has no rendering or DOM dependencies, runs on a fixed step, and reports what
// happened through events, so the same code drives the browser client, headless
// tests, bots, and (later) server-side validation.

let ready: Promise<void> | null = null;
/** Must be awaited once before creating a Simulation. */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

export type Phase = 'countdown' | 'playing' | 'finished';

export type SimEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'checkpoint'; index: number }
  | { type: 'star'; index: number }
  | { type: 'switch'; index: number; time: number } // a switch star's button: it shows for `time` seconds
  | { type: 'fall'; penalty: number }
  | { type: 'out' }
  | { type: 'finish'; time: number }
  | { type: 'bump'; solidId: number }
  | { type: 'ballBump'; otherId: string; strength: number }
  | { type: 'impact'; strength: number }
  | { type: 'boost'; solidId: number }
  | { type: 'spring'; solidId: number }
  | { type: 'crumble'; solidId: number }
  | { type: 'smash'; solidId: number; strength: number } // tore through a paper wall
  | { type: 'hazard' };                                   // touched spikes (a `fall` follows)

/** Another player's ball, as currently displayed. Each client resolves bumps for its own ball only. */
export interface OtherBall {
  id: string;
  position: Vec3;
  velocity: Vec3;
}

/** World-space horizontal push direction; length <= 1 (analog sticks may be < 1). */
export interface Input {
  x: number;
  z: number;
}

const toVec = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const scaleVec = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const toQuat = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

export class Simulation {
  readonly level: ResolvedLevel;
  /** Clock that drives moving pieces. Keeps running across restarts, like a real course. */
  time = 0;

  phase: Phase = 'countdown';
  /** Bumper Arena: falling off knocks you out instead of respawning. */
  respawnOnFall = true;
  /** Knocked out (only when respawnOnFall is false). */
  out = false;
  countdownLeft = 0;
  elapsed = 0;
  reached: boolean[] = [];
  /** Stars collected this run (they stay collected after a fall; a restart resets them). */
  stars: boolean[] = [];
  /** Switch stars: `time` (the sim clock) until which each one shows; 0 = not pressed. */
  switchUntil: number[] = [];
  spawn: { position: Vec3; yaw: number };
  grounded = false;
  groundVelocity: Vec3 = [0, 0, 0];
  /** Center of the moving platform under the ball, if any. */
  platformCenter: Vec3 | null = null;
  lastGroundY = 0;

  private world: RAPIER.World;
  private eventQueue = new RAPIER.EventQueue(true);
  private ball: RAPIER.RigidBody;
  private ballCollider: RAPIER.Collider;
  private bodies: RAPIER.RigidBody[] = [];                 // indexed by solid id
  private colliderSolid = new Map<number, Solid>();
  private moving: Solid[] = [];
  private platform: Solid | null = null;
  private platformVel: Vec3 = [0, 0, 0];
  /** Turntables and rockers: the floor velocity already given to the ball (kept through small hops). */
  private carried: Vec3 = [0, 0, 0];
  private events: SimEvent[] = [];
  private others: OtherBall[] = [];
  private touching = new Set<string>();
  private crumbles = new Map<number, { touchedAt: number | null; goneUntil: number | null }>();
  /** Paper walls this player has torn through (until a respawn or restart). */
  private torn = new Set<number>();
  /** Iron balls: held still until you first land on one; back to the start when you respawn. */
  private carriers = new Map<number, { live: boolean }>();
  private ground: Solid | null = null;
  private lastEffect: Solid | null = null; // for one-shot effects (boost/spring events)
  private springReadyAt = 0;

  constructor(level: ResolvedLevel) {
    this.level = level;
    this.spawn = { position: level.start.position, yaw: level.start.yaw };
    this.world = new RAPIER.World(toVec([0, -gravityOf(level.theme), 0]));
    this.world.timestep = SIM.dt;

    for (const solid of level.solids) {
      const start = poseAt(solid, 0); // pieces with a phase don't start at their base pose
      const carrier = solid.role === 'carrier';
      const bodyDesc = (carrier ? RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(SIM.carrier.damping).setAngularDamping(SIM.carrier.damping)
        : solid.motion ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed())
        .setTranslation(...start.position)
        .setRotation(toQuat(start.rotation));
      const body = this.world.createRigidBody(bodyDesc);
      const s = solid.shape;
      const colliderDesc = (s.kind === 'box'
        ? RAPIER.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)
        : s.kind === 'sphere' ? RAPIER.ColliderDesc.ball(s.radius).setMass(SIM.carrier.mass)
        : RAPIER.ColliderDesc.cylinder(s.height / 2, s.radius))
        .setFriction(solid.role === 'floor' || solid.role === 'platform' || carrier ? SIM.friction * THEMES[level.theme].grip : SIM.wallFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(solid.role === 'bumper' ? SIM.bumperRestitution
          : solid.role === 'floor' || solid.role === 'platform' ? THEMES[level.theme].bounce ?? SIM.restitution : SIM.restitution);
      if (solid.role === 'bumper' || solid.effect?.kind === 'breakable') colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(colliderDesc, body);
      this.bodies[solid.id] = body;
      this.colliderSolid.set(collider.handle, solid);
      if (solid.motion) this.moving.push(solid);
      if (solid.effect?.kind === 'crumble') this.crumbles.set(solid.id, { touchedAt: null, goneUntil: null });
      if (carrier) {
        this.carriers.set(solid.id, { live: false });
        body.lockTranslations(true, false);
        body.lockRotations(true, false);
      }
    }

    const b = SIM.ball;
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(b.linearDamping)
        .setAngularDamping(b.angularDamping)
        .setCcdEnabled(true),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(b.radius).setMass(b.mass).setFriction(SIM.friction).setRestitution(SIM.restitution),
      this.ball,
    );

    this.restart();
  }

  // ---------- Queries ----------

  /** The iron ball the ball is resting on, if any: where it is and how it's moving (bots balance with this). */
  carrier(): { position: Vec3; velocity: Vec3; dir?: Vec3 } | null {
    if (this.ground?.role !== 'carrier') return null;
    const body = this.bodies[this.ground.id], t = body.translation(), v = body.linvel();
    const roll = this.ground.effect?.kind === 'roll' ? this.ground.effect : null;
    return { position: [t.x, t.y, t.z], velocity: [v.x, v.y, v.z], ...(roll ? { dir: roll.dir } : {}) };
  }

  /** This player's iron ball while it's out of its starting place (sent to the others). */
  carrierOut(): Vec3 | null {
    for (const [id, c] of this.carriers) {
      if (!c.live) continue;
      const t = this.bodies[id].translation();
      return [t.x, t.y, t.z];
    }
    return null;
  }

  /** Whether this player has torn through a paper wall (for rendering). */
  isTorn(id: number): boolean {
    return this.torn.has(id);
  }

  /** Crumbling tile state for rendering: shaking (0..1 until it drops) or gone. */
  crumbleState(id: number): { shake: number; gone: boolean } {
    const c = this.crumbles.get(id);
    const solid = this.level.solids[id];
    if (!c || solid.effect?.kind !== 'crumble') return { shake: 0, gone: false };
    if (c.goneUntil !== null) return { shake: 0, gone: true };
    if (c.touchedAt === null) return { shake: 0, gone: false };
    return { shake: Math.min(1, (this.time - c.touchedAt) / solid.effect.delay), gone: false };
  }

  position(): Vec3 { const t = this.ball.translation(); return [t.x, t.y, t.z]; }
  velocity(): Vec3 { const v = this.ball.linvel(); return [v.x, v.y, v.z]; }
  rotation(): Quat { const r = this.ball.rotation(); return [r.x, r.y, r.z, r.w]; }

  solidPose(id: number): { position: Vec3; rotation: Quat } {
    const body = this.bodies[id];
    const t = body.translation(), r = body.rotation();
    return { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
  }

  /** True if there is a floor directly under point `p` (within a few units). Ignores the ball. */
  floorAt(p: Vec3): boolean {
    const ray = new RAPIER.Ray(toVec([p[0], p[1] + 3, p[2]]), { x: 0, y: -1, z: 0 });
    return this.world.castRay(ray, 5, true, undefined, undefined, this.ballCollider) !== null;
  }

  /**
   * True if a ball resting on the floor at `p` (a floor point) wouldn't touch any obstacle
   * (bumper, wall, rail, sweeper arm). Floors don't count. Bots use this to pick lanes.
   */
  clearAt(p: Vec3, radius = SIM.ball.radius + 0.3): boolean {
    const center = toVec([p[0], p[1] + SIM.ball.radius + 0.05, p[2]]);
    const hit = this.world.intersectionWithShape(
      center, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), undefined, undefined, this.ballCollider, undefined,
      (c) => {
        const role = this.colliderSolid.get(c.handle)?.role;
        return role !== 'floor' && role !== 'platform';
      },
    );
    return hit === null;
  }

  /** Returns and clears everything that happened since the last call. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------- Control ----------

  /**
   * Back to the start with a countdown. Multiplayer passes the time left until the server's
   * GO and the player's spot on the starting grid.
   */
  restart(countdown: number = SIM.countdown, start: Vec3 = this.level.start.position) {
    this.reached = this.level.checkpoints.map(() => false);
    this.stars = this.level.stars.map(() => false);
    this.switchUntil = this.level.stars.map(() => 0);
    this.spawn = { position: start, yaw: this.level.start.yaw };
    this.elapsed = 0;
    this.phase = 'countdown';
    this.out = false;
    this.countdownLeft = countdown;
    this.placeBallAtSpawn();
    this.restoreCrumbles();
    this.events.push({ type: 'countdown', n: Math.ceil(this.countdownLeft) });
  }

  /** Back to the last checkpoint (player request or fall). */
  respawn() {
    const penalty = this.phase === 'playing' ? SIM.fallPenalty : 0;
    this.elapsed += penalty;
    this.placeBallAtSpawn();
    this.restoreCrumbles(); // a fresh try at the tiles you just fell through
    this.events.push({ type: 'fall', penalty });
  }

  /** Other players' balls to bump into this step (multiplayer). */
  setOthers(others: OtherBall[]) {
    this.others = others;
  }

  /** The other balls given to the latest `setOthers` call (bots use this to steer around them). */
  get otherBalls(): readonly OtherBall[] {
    return this.others;
  }

  dispose() {
    this.world.free();
    this.eventQueue.free();
  }

  // ---------- Stepping ----------

  step(input: Input) {
    const dt = SIM.dt;

    for (const solid of this.moving) {
      const pose = poseAt(solid, this.time + dt);
      const body = this.bodies[solid.id];
      body.setNextKinematicTranslation(toVec(pose.position));
      body.setNextKinematicRotation(toQuat(pose.rotation));
    }

    const ground = this.groundSolid();
    this.ground = ground;
    this.grounded = ground !== null;
    if (ground?.role === 'carrier') this.boardCarrier(ground);
    this.rideMovingPlatform(ground);
    if (ground?.effect?.kind === 'conveyor') this.groundVelocity = scaleVec(ground.effect.dir, ground.effect.speed);
    if (this.phase === 'playing' && !this.out) this.push(input, dt);
    this.driveCarrier(dt);
    this.applyEffects(ground, dt);

    const before = this.ball.linvel();
    this.world.step(this.eventQueue);
    this.time += dt;

    let bumped = false;
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ballHandle = this.ballCollider.handle;
      const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
      const solid = other === null ? undefined : this.colliderSolid.get(other);
      if (solid?.role === 'bumper') {
        this.kick(solid);
        bumped = true;
      } else if (solid?.effect?.kind === 'breakable' && !this.torn.has(solid.id)) {
        // Fast enough: tear through, keeping the speed from before the hit (no bounce).
        const speed = Math.hypot(before.x, before.z);
        if (speed >= solid.effect.speed) {
          this.torn.add(solid.id);
          this.setSolidEnabled(solid.id, false);
          this.setVelocityAndSpin(before);
          this.events.push({ type: 'smash', solidId: solid.id, strength: speed });
          bumped = true; // not a hard impact
        }
      }
    });
    if (!bumped) {
      const after = this.ball.linvel();
      const dv = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      if (dv > 7) this.events.push({ type: 'impact', strength: dv });
    }

    this.bumpOthers();
    this.updateRace(dt);
  }

  // ---------- Internals ----------

  private placeBallAtSpawn() {
    this.ball.setTranslation(toVec(this.spawn.position), true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.lastGroundY = this.spawn.position[1] - SIM.ball.radius;
    this.platform = null;
    this.carried = [0, 0, 0];
  }

  private groundSolid(): Solid | null {
    const p = this.ball.translation();
    const ray = new RAPIER.Ray(p, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, SIM.ball.radius + 0.25, true, undefined, undefined, this.ballCollider);
    return hit ? this.colliderSolid.get(hit.collider.handle) ?? null : null;
  }

  // A rolling ball barely gets dragged along by a moving floor, so while standing on a
  // moving platform, pass its velocity changes straight to the ball.
  private rideMovingPlatform(ground: Solid | null) {
    if (ground?.role === 'carrier' && ground.effect?.kind === 'roll') {
      // A rolling iron ball carries you along with it (its centre's speed, not its surface's).
      const c = this.bodies[ground.id].linvel(), u: Vec3 = [c.x, 0, c.z], v = this.ball.linvel();
      this.ball.setLinvel({ x: v.x + u[0] - this.carried[0], y: v.y, z: v.z + u[2] - this.carried[2] }, true);
      this.carried = u;
      this.platform = null;
      this.platformVel = u;
      this.groundVelocity = u;
      this.platformCenter = null;
      return;
    }
    // Sliding platforms, turntables and rockers (floors that move; not a sweeper arm you land on).
    const moving = ground?.motion && (ground.role === 'platform' || ground.role === 'floor') ? ground : null;
    const pose = moving ? poseAt(moving, this.time) : null;
    if (moving && pose && moving.motion!.kind !== 'oscillate') {
      // A turntable or rocker moves each point differently: the ball goes along with the point
      // under it, from the moment it lands (friction alone would barely turn a rolling ball).
      const u = pointVelocity(moving, this.contactPoint(), this.time);
      const v = this.ball.linvel();
      this.ball.setLinvel({ x: v.x + u[0] - this.carried[0], y: v.y, z: v.z + u[2] - this.carried[2] }, true);
      this.carried = [u[0], 0, u[2]];
      this.platform = moving;
      this.platformVel = this.carried;
      this.groundVelocity = this.carried;
      this.platformCenter = pose.position;
      return;
    }
    if (ground) this.carried = [0, 0, 0]; // back on solid ground (not just a hop)
    const vel: Vec3 = pose ? pose.velocity : [0, 0, 0];
    if (moving && moving === this.platform) {
      const v = this.ball.linvel();
      this.ball.setLinvel({ x: v.x + vel[0] - this.platformVel[0], y: v.y, z: v.z + vel[2] - this.platformVel[2] }, true);
    }
    this.platform = moving;
    this.platformVel = vel;
    this.groundVelocity = vel;
    this.platformCenter = pose ? pose.position : null;
  }

  private contactPoint(): Vec3 {
    const p = this.ball.translation();
    return [p.x, p.y - SIM.ball.radius, p.z];
  }

  private push(input: Input, dt: number) {
    const mag = Math.hypot(input.x, input.z);
    if (mag < 1e-3) return;
    const dx = input.x / mag, dz = input.z / mag;
    const strength = Math.min(1, mag);
    // Top speed counts relative to the ground: faster riding with a belt, slower against it.
    const v = this.ball.linvel(), g = this.groundVelocity;
    if ((v.x - g[0]) * dx + (v.z - g[2]) * dz > SIM.move.maxSpeed) return;
    const f = SIM.move.force * strength * (this.grounded ? 1 : SIM.move.airControl) * dt;
    const roll = this.ground?.role === 'carrier' && this.ground.effect?.kind === 'roll' ? this.ground.effect : null;
    if (roll) {
      // A rolling iron ball: the sideways part of your push steers it (and it carries you along);
      // the part along its way moves you over its top, which is the balancing.
      const sx = -roll.dir[2], sz = roll.dir[0], side = dx * sx + dz * sz;
      this.ball.applyImpulse({ x: (dx - sx * side) * f, y: 0, z: (dz - sz * side) * f }, true);
      const body = this.bodies[this.ground!.id], cv = body.linvel(), sideways = cv.x * sx + cv.z * sz;
      if (sideways * Math.sign(side) < SIM.carrier.steerMax) {
        const k = f * side * SIM.carrier.steer;
        body.applyImpulse({ x: sx * k, y: 0, z: sz * k }, true);
      }
      return;
    }
    this.ball.applyImpulse({ x: dx * f, y: 0, z: dz * f }, true);
    if (this.ground?.role !== 'carrier') return;
    const body = this.bodies[this.ground.id];
    {
      // Otherwise your push rolls it the same way too ("push where you go"). Push too hard and it
      // runs out from under you.
      body.applyImpulse({ x: dx * f * SIM.carrier.push, y: 0, z: dz * f * SIM.carrier.push }, true);
    }
  }

  /** While you ride a rolling iron ball: it rolls on by itself, and a gentle pull keeps you near its top. */
  private driveCarrier(dt: number) {
    const ground = this.ground;
    if (ground?.role !== 'carrier' || ground.effect?.kind !== 'roll') return;
    const roll = ground.effect, body = this.bodies[ground.id], v = body.linvel();
    const along = v.x * roll.dir[0] + v.z * roll.dir[2];
    const k = Math.max(-SIM.carrier.rollAccel * dt, Math.min(SIM.carrier.rollAccel * dt, roll.speed - along));
    body.setLinvel({ x: v.x + roll.dir[0] * k, y: v.y, z: v.z + roll.dir[2] * k }, true);
    const c = body.translation(), p = this.ball.translation(), ox = p.x - c.x, oz = p.z - c.z;
    if (Math.hypot(ox, oz) < SIM.carrier.settleRange) {
      const u = this.ball.linvel();
      this.ball.setLinvel({ x: u.x - ox * SIM.carrier.settle * dt, y: u.y, z: u.z - oz * SIM.carrier.settle * dt }, true);
    }
  }

  private boardCarrier(solid: Solid) {
    const c = this.carriers.get(solid.id);
    if (!c || c.live) return;
    c.live = true;
    const body = this.bodies[solid.id];
    body.lockTranslations(false, true);
    body.lockRotations(false, true);
  }

  // Boost pads, springs, conveyors and crumbling tiles act on the ball resting on them; wind
  // and low gravity act on it anywhere inside their box.
  private applyEffects(ground: Solid | null, dt: number) {
    const effect = ground?.effect;
    const fresh = ground !== this.lastEffect;
    this.lastEffect = effect ? ground : null;
    const v = this.ball.linvel();
    if (effect?.kind === 'boost') {
      const along = v.x * effect.dir[0] + v.z * effect.dir[2];
      if (along < effect.speed) {
        const add = effect.speed - along;
        this.setVelocityAndSpin({ x: v.x + effect.dir[0] * add, y: v.y, z: v.z + effect.dir[2] * add });
      }
      if (fresh) this.events.push({ type: 'boost', solidId: ground!.id });
    } else if (effect?.kind === 'spring' && this.time >= this.springReadyAt) {
      const hx = effect.push === null ? v.x : effect.dir[0] * effect.push;
      const hz = effect.push === null ? v.z : effect.dir[2] * effect.push;
      this.setVelocityAndSpin({ x: hx, y: effect.power, z: hz });
      this.springReadyAt = this.time + SIM.springCooldown;
      this.events.push({ type: 'spring', solidId: ground!.id });
    } else if (effect?.kind === 'conveyor') {
      const along = v.x * effect.dir[0] + v.y * effect.dir[1] + v.z * effect.dir[2];
      if (along < effect.speed) {
        const k = Math.min(SIM.conveyorAccel * dt, effect.speed - along);
        this.ball.setLinvel({ x: v.x + effect.dir[0] * k, y: v.y + effect.dir[1] * k, z: v.z + effect.dir[2] * k }, true);
      }
    } else if (effect?.kind === 'crumble') {
      const c = this.crumbles.get(ground!.id)!;
      if (c.touchedAt === null && c.goneUntil === null) c.touchedAt = this.time;
    } else if (effect?.kind === 'hazard' && this.phase !== 'finished' && !this.out) {
      this.events.push({ type: 'hazard' });
      if (this.respawnOnFall) this.respawn();
      else {
        this.out = true;
        this.events.push({ type: 'out' });
      }
      return;
    }
    this.updateCrumbles();

    const p = this.ball.translation();
    for (const vol of this.level.volumes) {
      if (p.x < vol.min[0] || p.x > vol.max[0] || p.y < vol.min[1] || p.y > vol.max[1] || p.z < vol.min[2] || p.z > vol.max[2]) continue;
      const u = this.ball.linvel();
      if (vol.kind === 'lowgrav') {
        this.ball.setLinvel({ x: u.x, y: u.y + gravityOf(this.level.theme) * (1 - vol.scale) * dt, z: u.z }, true);
      } else {
        const along = u.x * vol.dir[0] + u.y * vol.dir[1] + u.z * vol.dir[2];
        if (along >= vol.speed) continue;
        const k = Math.min(vol.strength * gustAt(this.level.theme, this.time) * dt, vol.speed - along);
        this.ball.setLinvel({ x: u.x + vol.dir[0] * k, y: u.y + vol.dir[1] * k, z: u.z + vol.dir[2] * k }, true);
      }
    }
  }

  private updateCrumbles() {
    for (const [id, c] of this.crumbles) {
      const solid = this.level.solids[id];
      if (solid.effect?.kind !== 'crumble') continue;
      if (c.touchedAt !== null && this.time >= c.touchedAt + solid.effect.delay) {
        c.touchedAt = null;
        c.goneUntil = this.time + solid.effect.respawn;
        this.setSolidEnabled(id, false);
        this.events.push({ type: 'crumble', solidId: id });
      } else if (c.goneUntil !== null && this.time >= c.goneUntil) {
        c.goneUntil = null;
        this.setSolidEnabled(id, true);
      }
    }
  }

  private restoreCrumbles() {
    for (const [id, c] of this.crumbles) {
      if (c.goneUntil !== null) this.setSolidEnabled(id, true);
      c.touchedAt = null;
      c.goneUntil = null;
    }
    for (const id of this.torn) this.setSolidEnabled(id, true); // paper walls are whole again too
    this.torn.clear();
    for (const [id, c] of this.carriers) {
      // Iron balls wait back where they started.
      const body = this.bodies[id], start = this.level.solids[id].position;
      body.setTranslation(toVec(start), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.lockTranslations(true, true);
      body.lockRotations(true, true);
      c.live = false;
    }
    this.lastEffect = null;
  }

  private setSolidEnabled(id: number, enabled: boolean) {
    const body = this.bodies[id];
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setEnabled(enabled);
  }

  // Ball-to-ball: resolve as an equal-mass collision, but only change *our* ball. The other
  // player's client does the same from their side, so both balls bounce apart.
  private bumpOthers() {
    if (!this.others.length) return;
    const r2 = SIM.ball.radius * 2;
    const p = this.ball.translation();
    const v = this.ball.linvel();
    const nowTouching = new Set<string>();
    for (const o of this.others) {
      let nx = p.x - o.position[0], ny = p.y - o.position[1], nz = p.z - o.position[2];
      const d = Math.hypot(nx, ny, nz);
      if (d >= r2 || d < 1e-6) continue;
      nowTouching.add(o.id);
      nx /= d; ny /= d; nz /= d;
      // Push out of the overlap (our half of it).
      const push = (r2 - d) / 2;
      this.ball.setTranslation({ x: p.x + nx * push, y: p.y + ny * push, z: p.z + nz * push }, true);
      const closing = (v.x - o.velocity[0]) * nx + (v.y - o.velocity[1]) * ny + (v.z - o.velocity[2]) * nz;
      if (closing >= 0 || this.touching.has(o.id)) continue; // separating, or already handled this contact
      const j = -((1 + SIM.ballBounce) / 2) * closing + SIM.ballBumpBoost;
      this.setVelocityAndSpin({ x: v.x + nx * j, y: v.y + Math.max(0, ny * j), z: v.z + nz * j });
      this.events.push({ type: 'ballBump', otherId: o.id, strength: -closing });
    }
    this.touching = nowTouching;
  }

  // Replace the velocity component toward the bumper with a strong push away.
  private kick(bumper: Solid) {
    const p = this.ball.translation();
    const at = bumper.motion ? this.bodies[bumper.id].translation() : { x: bumper.position[0], z: bumper.position[2] }; // a sliding bumper: where it is now
    let dx = p.x - at.x, dz = p.z - at.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const v = this.ball.linvel();
    const into = Math.min(0, v.x * dx + v.z * dz);
    this.setVelocityAndSpin({
      x: v.x - into * dx + dx * SIM.bumperImpulse,
      y: v.y,
      z: v.z - into * dz + dz * SIM.bumperImpulse,
    });
    this.events.push({ type: 'bump', solidId: bumper.id });
  }

  // After a knock, make the spin match the new direction. Otherwise the old spin grips the
  // floor and drags the ball back the way it came, which kills the bounce.
  private setVelocityAndSpin(v: { x: number; y: number; z: number }) {
    const r = SIM.ball.radius;
    this.ball.setLinvel(v, true);
    this.ball.setAngvel({ x: v.z / r, y: 0, z: -v.x / r }, true);
  }

  private updateRace(dt: number) {
    if (this.phase === 'countdown') {
      const prev = Math.ceil(this.countdownLeft);
      this.countdownLeft -= dt;
      const n = Math.ceil(this.countdownLeft);
      if (n !== prev && n > 0) this.events.push({ type: 'countdown', n });
      if (this.countdownLeft <= 0) {
        this.phase = 'playing';
        this.events.push({ type: 'go' });
      }
    } else if (this.phase === 'playing') {
      this.elapsed += dt;
    }

    const p = this.position();
    if (this.grounded) this.lastGroundY = p[1] - SIM.ball.radius;
    if (this.phase === 'finished') return;

    if (!this.out && p[1] < this.lastGroundY - (this.respawnOnFall ? SIM.fallDepth : 6)) {
      if (this.respawnOnFall) this.respawn();
      else {
        this.out = true;
        this.events.push({ type: 'out' });
      }
      return;
    }

    const r2 = SIM.checkpointRadius ** 2;
    this.level.checkpoints.forEach((cp, i) => {
      if (this.reached[i]) return;
      const dx = p[0] - cp.position[0], dz = p[2] - cp.position[2];
      if (dx * dx + dz * dz < r2 && Math.abs(p[1] - cp.position[1]) < 3) {
        this.reached[i] = true;
        const v = this.velocity();
        const yaw = cp.yaw ?? (Math.hypot(v[0], v[2]) > 1 ? Math.atan2(-v[0], -v[2]) : this.spawn.yaw);
        this.spawn = { position: [cp.position[0], cp.position[1] + 1.2, cp.position[2]], yaw };
        this.events.push({ type: 'checkpoint', index: i });
      }
    });

    if (this.phase === 'playing') {
      const s2 = SIM.starRadius ** 2;
      this.level.stars.forEach((star, i) => {
        if (this.stars[i]) return;
        if (star.button) {
          // Rolling over the button (re)starts its timer once the last one has run out.
          const b = star.button.position;
          const bx = p[0] - b[0], bz = p[2] - b[2];
          if (this.grounded && this.time >= this.switchUntil[i] && bx * bx + bz * bz < SIM.buttonRadius ** 2 && Math.abs(p[1] - 1 - b[1]) < 1) {
            this.switchUntil[i] = this.time + star.button.time;
            this.events.push({ type: 'switch', index: i, time: star.button.time });
          }
          if (this.time >= this.switchUntil[i]) return;
        }
        const at = starAt(star, this.time);
        const dx = p[0] - at[0], dz = p[2] - at[2];
        if (dx * dx + dz * dz < s2 && Math.abs(p[1] - at[1]) < 2) {
          this.stars[i] = true;
          this.events.push({ type: 'star', index: i });
        }
      });
    }

    const g = this.level.goal;
    if (g && this.phase === 'playing') {
      const dx = p[0] - g.position[0], dz = p[2] - g.position[2];
      if (dx * dx + dz * dz < g.radius ** 2 && Math.abs(p[1] - g.position[1]) < 3) {
        this.phase = 'finished';
        this.events.push({ type: 'finish', time: this.elapsed });
      }
    }
  }
}
