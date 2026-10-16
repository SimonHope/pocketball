import * as THREE from 'three';
import { VIEW } from '../config';
import type { Vec3 } from '../sim/math';

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export type CameraMode = 'dynamic' | 'fixed' | 'top';
export const CAMERA_MODES: CameraMode[] = ['dynamic', 'fixed', 'top'];
export const CAMERA_LABELS: Record<CameraMode, string> = { dynamic: 'chase', fixed: 'fixed', top: 'top-down' };

export interface Follow {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  lastGroundY: number;
}

// Chase camera: swings behind the direction of travel, pulls back and widens FOV with
// speed, lifts on descents, and shakes on impacts. 'fixed' mode keeps a fixed-angle view;
// 'top' looks almost straight down and keeps its heading (mazes are built for it).
export class CameraRig {
  mode: CameraMode = 'dynamic';
  /** Camera sits at focus + (sin(yaw), cos(yaw)) * distance. Input is relative to this. */
  yaw = 0;
  readonly focus = new THREE.Vector3();

  private manualTimer = 0; // auto-turn is paused while > 0
  private speed = 0;       // smoothed horizontal speed
  private lift = 0;        // smoothed extra height from vertical motion
  private shake = 0;
  /** A short FOV punch (boosts, springs) and a dip on hard landings; both ease back. */
  private fovKick = 0;
  private dipBy = 0;
  /** The last course's ending: drift up and look to the stars (0 = off, eases to 1). */
  private gazing = false;
  private gaze = 0;
  /** 1 = full motion effects, 0 = none (the "reduced motion" setting). */
  static motion = 1;
  private pos = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  private get settings() {
    return VIEW.camera[this.mode];
  }

  /** The mode after this one (the C key). */
  get nextMode(): CameraMode {
    return CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
  }

  /** Manual orbit (Q/E or mouse drag). Positive = view turns left. */
  rotate(amount: number) {
    this.yaw += amount;
    this.manualTimer = VIEW.camera.manualHold;
  }

  /** Widen the view for a moment (degrees). */
  kickFov(degrees: number) {
    this.fovKick = Math.max(this.fovKick, degrees * CameraRig.motion);
  }

  /** Sink the camera a little (a hard landing). */
  dip(amount: number) {
    this.dipBy = Math.max(this.dipBy, amount * CameraRig.motion);
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount * CameraRig.motion);
  }

  /** Rise slowly and turn up to the sky (the very end of the journey). */
  gazeUp(on = true) {
    this.gazing = on;
    if (!on) this.gaze = 0;
  }

  snap(follow: Follow, yaw: number) {
    // Top-down keeps its heading on respawn so the map doesn't spin under you.
    if (this.mode !== 'top') this.yaw = yaw;
    this.speed = 0;
    this.lift = 0;
    this.shake = 0;
    this.manualTimer = 0;
    this.gazeUp(false);
    const { focus, desired } = this.target(follow);
    this.pos.copy(desired);
    this.focus.copy(focus);
  }

  update(dt: number, follow: Follow) {
    const s = this.settings;
    const v = follow.velocity;
    const speed = Math.hypot(v[0], v[2]);
    this.speed += (speed - this.speed) * approach(4, dt);
    this.manualTimer = Math.max(0, this.manualTimer - dt);

    // Swing behind the direction of travel, but hold still when the ball rolls back
    // toward the camera; otherwise reversing would spin the view around.
    if (s.autoTurn > 0 && this.manualTimer === 0 && speed > 0.1) {
      const behind = Math.atan2(-v[0], -v[2]);
      const diff = wrapAngle(behind - this.yaw);
      const weight = smoothstep(s.minTurnSpeed, s.minTurnSpeed + 8, speed)
        * smoothstep(2.4, 1.6, Math.abs(diff))
        * (follow.grounded ? 1 : 0.25);
      this.yaw += diff * approach(s.autoTurn * weight, dt);
    }
    // Rise when heading downhill or falling, dip slightly going uphill.
    const liftTarget = Math.min(s.maxLift, Math.max(-2, -v[1] * s.slopeLift));
    this.lift += (liftTarget - this.lift) * approach(3, dt);
    this.gaze += ((this.gazing ? 1 : 0) - this.gaze) * approach(0.35, dt);

    const { focus, desired } = this.target(follow);
    const k = approach(VIEW.camera.followLerp, dt);
    this.pos.lerp(desired, k);
    this.focus.lerp(focus, k);

    this.fovKick *= Math.exp(-5 * dt);
    this.dipBy *= Math.exp(-7 * dt);
    const fov = s.fov + Math.min(s.maxFov - s.fov, this.speed * s.speedFov) + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * approach(this.fovKick > 0.5 ? 12 : 4, dt);
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.pos);
    this.camera.position.y -= this.dipBy;
    if (this.shake > 0.001) {
      const a = this.shake * this.shake * VIEW.camera.shakeAmount;
      this.camera.position.x += (Math.random() * 2 - 1) * a;
      this.camera.position.y += (Math.random() * 2 - 1) * a;
      this.camera.position.z += (Math.random() * 2 - 1) * a;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.focus);
  }

  private target({ position: p, velocity: v, lastGroundY }: Follow) {
    const s = this.settings;
    const la = VIEW.camera.lookAhead;
    const focus = new THREE.Vector3(
      p[0] + v[0] * la,
      Math.max(p[1], lastGroundY - 4) + s.focusHeight,
      p[2] + v[2] * la,
    );
    const distance = s.distance + Math.min(s.maxZoom, this.speed * s.speedZoom);
    const desired = focus.clone().add(new THREE.Vector3(
      Math.sin(this.yaw) * distance, s.height + this.lift + this.gaze * 6, Math.cos(this.yaw) * distance,
    ));
    // Gazing: the view tips up past the ball, away from the camera, toward the stars.
    if (this.gaze > 0.001) focus.add(new THREE.Vector3(-Math.sin(this.yaw) * 30, 40, -Math.cos(this.yaw) * 30).multiplyScalar(this.gaze));
    return { focus, desired };
  }
}
