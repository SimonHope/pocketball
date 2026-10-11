import * as THREE from 'three';
import type { Vec3 } from '../sim/math';

// Particles that answer what the player does: dust when you land, streaks off a boost, sparks
// off a bumper, crumbs from a cracker, sparkles for a star, confetti at the finish. Two fixed
// pools (additive light, and ordinary dust and flakes), each one THREE.Points: two draw calls
// in all, however busy it gets, and no allocation per frame.

export type Burst = 'dust' | 'streak' | 'spark' | 'crumbs' | 'splinters' | 'sparkle' | 'confetti';

export interface BurstOptions {
  /** 0..1+: how hard the hit was (scales count, speed and size). */
  strength?: number;
  /** Direction of travel (streaks fly the other way) or of the hit (sparks fly this way). */
  dir?: Vec3;
  /** Overrides the preset colour (dust takes the theme's). */
  color?: string;
}

const POOL = 220;
const CONFETTI = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f43'];

/** One sprite sheet: a soft round dot (left) and a star (right). */
function atlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 5 : 14;
    g.lineTo(48 + Math.cos(a) * r, 16 + Math.sin(a) * r);
  }
  g.fill();
  return new THREE.CanvasTexture(c);
}

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute float frame;
  attribute vec3 tint;
  uniform float pixelsPerUnit;
  varying float vAlpha;
  varying float vFrame;
  varying vec3 vTint;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelsPerUnit / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = alpha;
    vFrame = frame;
    vTint = tint;
    #include <fog_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying float vFrame;
  varying vec3 vTint;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(map, vec2((gl_PointCoord.x + vFrame) * 0.5, 1.0 - gl_PointCoord.y));
    gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** A fixed set of particles drawn as one Points mesh. Free slots have alpha 0 and are skipped by the shader. */
class Pool {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pos = new Float32Array(POOL * 3);
  private vel = new Float32Array(POOL * 3);
  private tint = new Float32Array(POOL * 3);
  private size = new Float32Array(POOL);
  private alpha = new Float32Array(POOL);
  private frame = new Float32Array(POOL);
  private age = new Float32Array(POOL).fill(Infinity);
  private life = new Float32Array(POOL);
  private size0 = new Float32Array(POOL);
  private gravity = new Float32Array(POOL);
  private drag = new Float32Array(POOL);
  private flutter = new Float32Array(POOL);
  private next = 0;
  private live = 0;

  constructor(map: THREE.Texture, additive: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('frame', new THREE.BufferAttribute(this.frame, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, pixelsPerUnit: { value: 600 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.uniforms.map.value = map;
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** How many particles are alive. */
  get count() { return this.live; }

  emit(at: Vec3, vel: Vec3, color: THREE.Color, size: number, life: number, opts: { gravity?: number; drag?: number; star?: boolean; flutter?: number } = {}) {
    const i = this.next; // the oldest slot: reused when the pool is full
    this.next = (this.next + 1) % POOL;
    this.pos.set(at, i * 3);
    this.vel.set(vel, i * 3);
    this.tint[i * 3] = color.r;
    this.tint[i * 3 + 1] = color.g;
    this.tint[i * 3 + 2] = color.b;
    this.size0[i] = this.size[i] = size;
    this.alpha[i] = 1;
    this.frame[i] = opts.star ? 1 : 0;
    this.age[i] = 0;
    this.life[i] = life;
    this.gravity[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 0;
    this.flutter[i] = opts.flutter ?? 0;
  }

  update(dt: number, pixelsPerUnit: number) {
    let live = 0;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      const age = (this.age[i] += dt);
      const t = Math.min(1, age / this.life[i]);
      const k = Math.exp(-this.drag[i] * dt), j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 2] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.gravity[i] * dt;
      const f = this.flutter[i];
      this.pos[j] += (this.vel[j] + (f ? Math.sin(age * 9 + i) * f : 0)) * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += (this.vel[j + 2] + (f ? Math.cos(age * 7 + i) * f : 0)) * dt;
      this.alpha[i] = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      this.size[i] = this.size0[i] * (1 + t * 0.6);
    }
    this.live = live;
    this.points.visible = live > 0;
    this.points.material.uniforms.pixelsPerUnit.value = pixelsPerUnit;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = a.tint.needsUpdate = a.frame.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  /** Share of each burst actually emitted: lower on the low graphics setting and with reduced motion. */
  static scale = 1;
  /** Screen pixels per world unit at distance 1 (main.ts sets it from the camera and canvas). */
  static pixelsPerUnit = 600;
  private static texture: THREE.Texture | null = null;
  private light: Pool;
  private matte: Pool;
  private color = new THREE.Color();
  private dust: string;

  constructor(parent: THREE.Object3D, dustColor = '#d9d4c7') {
    Effects.texture ??= typeof document === 'undefined' ? new THREE.Texture() : atlas(); // no canvas in tests
    this.light = new Pool(Effects.texture, true);
    this.matte = new Pool(Effects.texture, false);
    this.dust = dustColor;
    parent.add(this.matte.points, this.light.points);
  }

  /** Particles alive in both pools (tests, stats). */
  get count() { return this.light.count + this.matte.count; }

  burst(kind: Burst, at: Vec3, { strength = 0.5, dir = [0, 0, -1], color }: BurstOptions = {}) {
    const s = Math.max(0.2, Math.min(1.5, strength));
    const n = (base: number) => Math.max(1, Math.round(base * Effects.scale));
    const c = (hex: string) => this.color.set(hex);
    const [dx, , dz] = dir;
    const dl = Math.hypot(dx, dz) || 1;
    switch (kind) {
      case 'dust': {
        // A low ring of puffs rolling outwards from under the ball.
        for (let i = 0, count = n(8 + 16 * s); i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(2, 5) * (0.6 + s);
          this.matte.emit([at[0] + Math.cos(a) * 0.6, at[1] + 0.15, at[2] + Math.sin(a) * 0.6], [Math.cos(a) * sp, rand(0.5, 1.8), Math.sin(a) * sp],
            c(color ?? this.dust), rand(0.5, 0.9) * (0.7 + s * 0.6), rand(0.45, 0.8), { drag: 4, gravity: 1 });
        }
        break;
      }
      case 'streak': {
        // Specks shot backwards along the line of travel.
        for (let i = 0, count = n(18); i < count; i++) {
          const back = rand(0.5, 2.5), side = rand(-0.7, 0.7), sp = rand(14, 24);
          this.light.emit([at[0] - (dx / dl) * back - (dz / dl) * side, at[1] + rand(-0.6, 0.4), at[2] - (dz / dl) * back + (dx / dl) * side],
            [-(dx / dl) * sp, rand(-0.5, 0.5), -(dz / dl) * sp], c(color ?? '#ffcf6b'), rand(0.18, 0.32), rand(0.2, 0.4), { drag: 3 });
        }
        break;
      }
      case 'spark': {
        for (let i = 0, count = n(8 + 8 * s); i < count; i++) {
          const a = Math.atan2(dz, dx) + rand(-1.2, 1.2), sp = rand(6, 13) * (0.7 + s * 0.5);
          this.light.emit(at, [Math.cos(a) * sp, rand(1, 5), Math.sin(a) * sp], c(color ?? '#fff3b0'), rand(0.2, 0.35), rand(0.25, 0.45), { drag: 2.5, gravity: 14 });
        }
        break;
      }
      case 'splinters': {
        // A log breaking up: chunks of wood flung on along its way and up, and a puff of bark dust.
        for (let i = 0, count = n(20); i < count; i++) {
          const a = Math.atan2(dz, dx) + rand(-0.9, 0.9), sp = rand(3, 8);
          this.matte.emit([at[0] + rand(-1.2, 1.2), at[1] + rand(-0.4, 0.4), at[2] + rand(-1.2, 1.2)], [Math.cos(a) * sp, rand(3, 7), Math.sin(a) * sp],
            c(i % 3 ? '#8b5a2b' : '#d9b382'), rand(0.3, 0.6), rand(0.7, 1.1), { gravity: 22, drag: 0.6 });
        }
        for (let i = 0, count = n(8); i < count; i++) {
          this.matte.emit([at[0] + rand(-1, 1), at[1] - 0.6, at[2] + rand(-1, 1)], [rand(-1.5, 1.5), rand(0.5, 1.5), rand(-1.5, 1.5)], c('#a07a52'), rand(0.7, 1.1), rand(0.5, 0.8), { drag: 3, gravity: 1 });
        }
        break;
      }
      case 'crumbs': {
        for (let i = 0, count = n(14); i < count; i++) {
          this.matte.emit([at[0] + rand(-1.8, 1.8), at[1] - 0.2, at[2] + rand(-1.8, 1.8)], [rand(-1, 1), rand(0, 2), rand(-1, 1)],
            c(color ?? '#c98d47'), rand(0.25, 0.45), rand(0.7, 1.1), { gravity: 18 });
        }
        break;
      }
      case 'sparkle': {
        for (let i = 0, count = n(16); i < count; i++) {
          const a = (i / count) * Math.PI * 2, r = rand(0.3, 0.9), up = rand(2, 4.5);
          this.light.emit([at[0] + Math.cos(a) * r, at[1] + rand(-0.3, 0.3), at[2] + Math.sin(a) * r], [Math.cos(a) * 2.2, up, Math.sin(a) * 2.2],
            c(color ?? '#ffd60a'), rand(0.35, 0.6), rand(0.6, 0.9), { drag: 2, star: true });
        }
        break;
      }
      case 'confetti': {
        for (let i = 0, count = n(70); i < count; i++) {
          const a = rand(0, Math.PI * 2), sp = rand(3, 8);
          this.matte.emit([at[0], at[1] + rand(1, 3), at[2]], [Math.cos(a) * sp, rand(7, 13), Math.sin(a) * sp],
            c(CONFETTI[i % CONFETTI.length]), rand(0.3, 0.5), rand(1.6, 2.4), { gravity: 11, drag: 1.2, flutter: 1.5, star: i % 3 === 0 });
        }
        break;
      }
    }
  }

  update(dt: number) {
    this.light.update(dt, Effects.pixelsPerUnit);
    this.matte.update(dt, Effects.pixelsPerUnit);
  }

  dispose() {
    this.light.dispose();
    this.matte.dispose();
  }
}
