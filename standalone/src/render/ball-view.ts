import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SIM } from '../config';
import { FURS, HATS, SKINS, TRAILS, type Look } from '../cosmetics';
import type { Quat, Vec3 } from '../sim/math';
import { buildHat, skinTexture, TrailView } from './cosmetics-view';

// The clear ball plus the hamster running inside it. The hamster stays upright,
// turns toward the direction of travel, and scurries faster the quicker the ball rolls.
// It also reacts: the ball squashes on landings and hits and pops in after a respawn; the
// hamster leans into acceleration and turns, flails in the air, wobbles when dizzy, and
// hops at the finish.

/** A damped spring towards 0, for squash and stretch (settles in about a quarter second). */
export class Spring {
  value = 0;
  private velocity = 0;
  constructor(private stiffness = 320, private damping = 16) {}
  kick(amount: number) { this.velocity += amount; }
  set(value: number) { this.value = value; this.velocity = 0; }
  step(dt: number) {
    // Small fixed sub-steps keep it stable at any frame rate.
    for (let left = Math.min(dt, 0.1); left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      this.velocity += (-this.stiffness * this.value - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }
}

/** What the ball is doing this frame (solo has it; other players' balls don't). */
export interface BallState { grounded: boolean }

interface Foot {
  mesh: THREE.Mesh;
  baseZ: number;
}

function buildHamster(): { hamster: THREE.Group; feet: Foot[]; fur: THREE.MeshStandardMaterial; belly: THREE.MeshStandardMaterial } {
  const fur = new THREE.MeshStandardMaterial({ color: '#e0a060', roughness: 0.9 });
  const belly = new THREE.MeshStandardMaterial({ color: '#fff1dc', roughness: 0.9 });
  const pink = new THREE.MeshStandardMaterial({ color: '#ff9fb2', roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.3 });
  // Static parts are merged into one mesh per material (4 draw calls instead of 11); the feet
  // stay separate because they animate.
  const sphere = (radius: number, pos: Vec3, scale: Vec3 = [1, 1, 1], detail = 16) => {
    const g = new THREE.SphereGeometry(radius, detail, Math.round(detail * 0.75));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion(), new THREE.Vector3(...scale)));
    return g;
  };
  const merged = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    parts.forEach((p) => p.dispose());
    return mesh;
  };

  const hamster = new THREE.Group();
  const furMesh = merged([sphere(0.42, [0, 0.42, 0], [1, 0.9, 1.15], 20), sphere(0.3, [0, 0.72, 0.32], [1, 1, 1], 20)], fur);
  furMesh.castShadow = true; // the body's shadow is enough; small parts don't cast
  hamster.add(
    furMesh,
    merged([sphere(0.34, [0, 0.34, 0.14], [0.9, 0.8, 1]), sphere(0.2, [0, 0.64, 0.45], [1.5, 0.8, 1])], belly), // tummy, cheeks
    merged([sphere(0.04, [0, 0.7, 0.63], [1, 1, 1], 8), ...[-1, 1].map((s) => sphere(0.09, [s * 0.17, 0.97, 0.28], [1, 1, 0.5], 12))], pink), // nose, ears
    merged([-1, 1].map((s) => sphere(0.045, [s * 0.12, 0.78, 0.58], [1, 1, 1], 10)), black), // eyes
  );
  const footGeometry = sphere(0.08, [0, 0, 0], [1, 0.6, 1.4], 8);
  const feet: Foot[] = [];
  for (const [x, z] of [[-0.2, 0.25], [0.2, 0.25], [-0.2, -0.25], [0.2, -0.25]]) {
    const foot = new THREE.Mesh(footGeometry, pink);
    foot.position.set(x, 0.05, z);
    hamster.add(foot);
    feet.push({ mesh: foot, baseZ: z });
  }
  return { hamster, feet, fur, belly };
}

export class BallView {
  /** What the glass reflects: the theme's painted sky (scene.ts sets it; null = none). */
  static environment: THREE.Texture | null = null;
  /** Unrotated: carries the squash and the respawn pop. The shell inside it rolls. */
  private body = new THREE.Group();
  private shell = new THREE.Group();
  /** + flattens, - stretches upwards. */
  private squashSpring = new Spring();
  private popSpring = new Spring(260, 14);
  private lean = new THREE.Vector2(); // forward, sideways (radians)
  private lastVelocity: Vec3 | null = null;
  private dizzyLeft = 0;
  private cheerLeft = 0;
  private hamster: THREE.Group;
  private feet: Foot[];
  private hamsterYaw = Math.PI; // hamster's local +z is its face; courses run toward -z
  private stride = 0;
  private label: THREE.Sprite | null = null;
  private glassMat: THREE.MeshPhysicalMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private furMat: THREE.MeshStandardMaterial;
  private bellyMat: THREE.MeshStandardMaterial;
  private skinOverlay: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private hat: THREE.Group | null = null;
  private trail: TrailView | null = null;
  private look: Look | null = null;

  /** `tint` colors the ball (multiplayer player color); the default is the classic clear blue. */
  constructor(private parent: THREE.Object3D, tint?: string) {
    const r = SIM.ball.radius;
    this.glassMat = new THREE.MeshPhysicalMaterial({ transparent: true, roughness: 0.05, clearcoat: 1, depthWrite: false, envMapIntensity: 0.9 });
    const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), this.glassMat);
    glass.renderOrder = 2;
    this.shell.add(glass);
    // A few rings so you can see the ball rolling.
    const ringMat = (this.ringMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6 }));
    this.setTint(tint);
    const ringRotations: Vec3[] = [[0, 0, 0], [Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]];
    const rings = ringRotations.map((rot) => new THREE.TorusGeometry(r * 0.995, 0.025, 6, 48)
      .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot))));
    this.shell.add(new THREE.Mesh(mergeGeometries(rings), ringMat)); // one draw call for all three
    rings.forEach((g) => g.dispose());
    this.body.add(this.shell);
    parent.add(this.body);

    // Skin pattern: a slightly larger transparent sphere that rolls with the ball.
    this.skinOverlay = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.004, 32, 24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.skinOverlay.visible = false;
    this.skinOverlay.renderOrder = 3;
    this.shell.add(this.skinOverlay);

    const { hamster, feet, fur, belly } = buildHamster();
    this.hamster = hamster;
    this.feet = feet;
    this.furMat = fur;
    this.bellyMat = belly;
    parent.add(hamster);
  }

  /** Skin, hat, fur and trail (see src/cosmetics.ts). */
  setLook(look: Look) {
    const prev = this.look;
    this.look = { ...look };
    const skin = SKINS[look.skin];
    const map = skinTexture(skin);
    this.skinOverlay.material.map = map;
    this.skinOverlay.material.needsUpdate = true;
    this.skinOverlay.visible = !!map;
    this.furMat.color.set(FURS[look.fur].fur);
    this.bellyMat.color.set(FURS[look.fur].belly);
    if (prev?.hat !== look.hat) {
      if (this.hat) this.hamster.remove(this.hat);
      this.hat = buildHat(HATS[look.hat].id);
      if (this.hat) this.hamster.add(this.hat);
    }
    if (prev?.trail !== look.trail) {
      this.trail?.dispose();
      const colors = TRAILS[look.trail].colors;
      this.trail = colors.length ? new TrailView(this.parent, colors) : null;
    }
  }

  /** Player color (multiplayer), or undefined for the classic clear blue. */
  setTint(tint?: string) {
    this.glassMat.color.set(tint ?? '#bfe9ff');
    this.glassMat.opacity = tint ? 0.35 : 0.28;
    this.ringMat.color.set(tint ?? '#8fd3ff');
  }

  /** A floating name tag above the ball (other players in multiplayer). */
  setLabel(text: string, color: string) {
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.shell.parent?.remove(this.label);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = Math.min(250, ctx.measureText(text).width + 28);
    ctx.fillStyle = 'rgba(10, 20, 40, 0.65)';
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 8, w, 48, 24);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Constant on-screen size: readable far away, not huge up close.
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    this.label.scale.set(0.2, 0.05, 1);
    this.label.renderOrder = 10;
    this.parent.add(this.label);
  }

  setVisible(visible: boolean) {
    this.body.visible = this.hamster.visible = visible;
    this.visible = visible;
    if (this.label) this.label.visible = visible;
  }

  dispose() {
    this.trail?.dispose();
    this.skinOverlay.material.map = null; // skin textures are shared between balls
    for (const root of [this.body, this.hamster, this.label]) {
      if (!root) continue;
      this.parent.remove(root);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          o.geometry.dispose();
          const m = o.material as THREE.Material & { map?: THREE.Texture | null };
          m.map?.dispose();
          m.dispose();
        }
      });
    }
  }

  faceYaw(cameraYaw: number) {
    // Camera yaw points from the ball back to the camera, so the hamster faces the other way.
    this.hamsterYaw = cameraYaw + Math.PI;
  }

  private visible = true;

  /** Landing, a spring or a hit: + squashes flat, - stretches tall (about 0.1–0.5). */
  squash(amount: number) {
    this.squashSpring.kick(amount * 18);
  }

  /** After a respawn: pop in from smaller. */
  pop() {
    this.popSpring.set(-0.4);
  }

  /** Knocked about: wobble for a second. */
  dizzy() {
    this.dizzyLeft = 1;
  }

  /** Over the line: hop and spin. */
  cheer() {
    this.cheerLeft = 1.5;
  }

  private react(velocity: Vec3, dt: number, state: BallState) {
    this.squashSpring.step(dt);
    this.popSpring.step(dt);
    const s = Math.max(-0.35, Math.min(0.35, this.squashSpring.value));
    const pop = 1 + this.popSpring.value;
    this.body.scale.set(pop * (1 + s * 0.5), pop * (1 - s), pop * (1 + s * 0.5));
    this.hamster.scale.set(1 + s * 0.25, 1 - s * 0.5, 1 + s * 0.25).multiplyScalar(pop);

    // Lean into acceleration (forward/back) and turns (sideways), relative to where it faces.
    if (dt > 0 && this.lastVelocity) {
      const ax = (velocity[0] - this.lastVelocity[0]) / dt, az = (velocity[2] - this.lastVelocity[2]) / dt;
      const fx = Math.sin(this.hamsterYaw), fz = Math.cos(this.hamsterYaw);
      const forward = state.grounded ? (ax * fx + az * fz) * 0.012 : 0;
      const side = state.grounded ? (ax * fz - az * fx) * 0.012 : 0;
      const k = 1 - Math.exp(-10 * dt);
      this.lean.x += (Math.max(-0.32, Math.min(0.32, forward)) - this.lean.x) * k;
      this.lean.y += (Math.max(-0.32, Math.min(0.32, side)) - this.lean.y) * k;
    }
    this.lastVelocity = [velocity[0], velocity[1], velocity[2]];
    this.dizzyLeft = Math.max(0, this.dizzyLeft - dt);
    this.cheerLeft = Math.max(0, this.cheerLeft - dt);
  }

  update(position: Vec3, rotation: Quat, velocity: Vec3, dt: number, state: BallState = { grounded: true }) {
    if (this.glassMat.envMap !== BallView.environment) {
      this.glassMat.envMap = BallView.environment;
      this.glassMat.needsUpdate = true;
    }
    this.trail?.update(position, this.visible ? Math.hypot(velocity[0], velocity[2]) : 0, dt);
    this.label?.position.set(position[0], position[1] + 2.1, position[2]);
    this.body.position.set(...position);
    this.shell.quaternion.set(...rotation);
    this.react(velocity, dt, state);

    const speed = Math.hypot(velocity[0], velocity[2]);
    if (speed > 0.5) {
      const target = Math.atan2(velocity[0], velocity[2]);
      const diff = Math.atan2(Math.sin(target - this.hamsterYaw), Math.cos(target - this.hamsterYaw));
      this.hamsterYaw += diff * Math.min(1, dt * 8);
    }

    // In the air the feet flail (fast and wide); otherwise they scurry with the roll.
    const air = !state.grounded;
    this.stride += dt * (air ? 22 : Math.min(speed, 20) * 1.6);
    const running = air || speed > 0.3;
    const cheer = this.cheerLeft > 0 ? Math.abs(Math.sin((1.5 - this.cheerLeft) * Math.PI * 2)) * 0.22 : 0;
    const bob = (running && !air ? Math.abs(Math.sin(this.stride)) * 0.04 : 0) + cheer;
    this.hamster.position.set(position[0], position[1] - SIM.ball.radius + 0.06 + bob, position[2]);
    const wobble = this.dizzyLeft > 0 ? Math.sin(this.dizzyLeft * 26) * 0.35 * this.dizzyLeft : 0;
    const spin = this.cheerLeft > 0 ? (1 - this.cheerLeft / 1.5) * Math.PI * 2 : 0;
    this.hamster.rotation.set(this.lean.x, this.hamsterYaw + spin, -this.lean.y + wobble, 'YXZ');
    this.feet.forEach((f, i) => {
      const phase = this.stride + (i % 2 === 0 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI / 2);
      f.mesh.position.z = f.baseZ + (running ? Math.sin(phase) * (air ? 0.16 : 0.1) : 0);
    });
  }
}
