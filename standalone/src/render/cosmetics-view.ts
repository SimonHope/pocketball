import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Skin } from '../cosmetics';
import type { Vec3 } from '../sim/math';

// Drawing cosmetics: ball skin patterns (canvas textures), simple hat models, and trails.
// Placeholder art, built from primitives until final models arrive.

const skinCache = new Map<string, THREE.Texture>();

/** A transparent pattern wrapped around the ball (equirectangular canvas). */
export function skinTexture(skin: Skin): THREE.Texture | null {
  if (skin.pattern === 'none') return null;
  const cached = skinCache.get(skin.id);
  if (cached) return cached;
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = skin.color;
  g.strokeStyle = skin.color;
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
  };
  const heart = (x: number, y: number, r: number) => {
    g.beginPath();
    g.moveTo(x, y + r);
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r);
    g.fill();
  };
  switch (skin.pattern) {
    case 'stripes':
      for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 24, h);
      break;
    case 'dots':
      for (let y = 24; y < h; y += 48) for (let x = (y / 48) % 2 ? 32 : 0; x < w; x += 64) { g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); }
      break;
    case 'stars':
      for (let y = 32; y < h; y += 64) for (let x = (y / 64) % 2 ? 48 : 0; x < w; x += 96) star(x, y, 20);
      break;
    case 'hearts':
      for (let y = 32; y < h; y += 64) for (let x = (y / 64) % 2 ? 48 : 0; x < w; x += 96) heart(x, y, 16);
      break;
    case 'checker':
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < w; x += 64) g.fillRect(x, y, 32, 32);
      break;
    case 'swirl':
      g.lineWidth = 14;
      for (let k = -2; k < 6; k++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, k * 64 + x * 0.5 + Math.sin(x / 40) * 16);
        g.stroke();
      }
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  skinCache.set(skin.id, tex);
  return tex;
}

/** A hat, positioned to sit on the hamster's head (hamster-local coordinates). */
export function buildHat(id: string): THREE.Group | null {
  const hat = new THREE.Group();
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
  switch (id) {
    case 'party': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 16), mat('#ff5ca8'));
      cone.position.y = 0.18;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat('#fff36b'));
      pom.position.y = 0.37;
      hat.add(cone, pom);
      break;
    }
    case 'crown': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16, 1, true), mat('#ffd24a', { metalness: 0.6, side: THREE.DoubleSide }));
      band.position.y = 0.05;
      hat.add(band);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), mat('#ffd24a', { metalness: 0.6 }));
        const a = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.15, 0.14, Math.sin(a) * 0.15);
        hat.add(spike);
      }
      break;
    }
    case 'cap': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3d7fd9'));
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16, 1, false, -Math.PI / 2, Math.PI), mat('#2a5aa0'));
      brim.position.set(0, 0.01, 0.12);
      hat.add(dome, brim);
      break;
    }
    case 'bow': {
      for (const s of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat('#ff4d6d'));
        loop.scale.set(1.3, 0.8, 0.5);
        loop.position.set(s * 0.1, 0.06, 0);
        hat.add(loop);
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat('#c9184a'));
      knot.position.y = 0.06;
      hat.add(knot);
      hat.position.x = 0.1;
      break;
    }
    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20), mat('#222'));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 20), mat('#222'));
      top.position.y = 0.16;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.05, 20), mat('#c9184a'));
      band.position.y = 0.05;
      hat.add(brim, top, band);
      break;
    }
    case 'halo': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), mat('#fff3a0', { emissive: '#ffd24a', emissiveIntensity: 1 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.22;
      hat.add(ring);
      break;
    }
    default:
      return null;
  }
  hat.position.y += 0.98;
  hat.position.z = 0.3;
  return mergeByColor(hat);
}

/** Collapses a group's meshes into one mesh per color (fewer draw calls). */
function mergeByColor(group: THREE.Group): THREE.Group {
  const byColor = new Map<string, { mat: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[] }>();
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    const key = `${mat.color.getHexString()}|${mat.emissive.getHexString()}|${mat.metalness}|${mat.side}`;
    const geo = (o.geometry as THREE.BufferGeometry).toNonIndexed().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    o.geometry.dispose();
    if (!byColor.has(key)) byColor.set(key, { mat, geos: [] });
    byColor.get(key)!.geos.push(geo);
  });
  const out = new THREE.Group();
  out.position.copy(group.position);
  for (const { mat, geos } of byColor.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    geos.forEach((g) => g.dispose());
    out.add(mesh);
  }
  return out;
}

/** Fading particles left behind a moving ball: one Points object (a single draw call). */
export class TrailView {
  /** Off on the Low graphics tier. */
  static enabled = true;
  private points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private positions: Float32Array;
  private colors: Float32Array;   // RGBA; alpha fades with age
  private base: THREE.Color[];
  private ages: Float32Array;
  private next = 0;
  private emitAcc = 0;
  private static texture: THREE.Texture | null = null;

  constructor(private parent: THREE.Object3D, colors: string[], private count = 36) {
    if (!TrailView.texture) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      TrailView.texture = new THREE.CanvasTexture(c);
    }
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 4);
    this.ages = new Float32Array(count).fill(Infinity);
    this.base = Array.from({ length: count }, (_, i) => new THREE.Color(colors[i % colors.length]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.5, map: TrailView.texture, vertexColors: true, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  update(position: Vec3, speed: number, dt: number) {
    const LIFE = 0.7;
    this.points.visible = TrailView.enabled;
    if (!TrailView.enabled) return;
    this.emitAcc += dt * Math.min(40, speed * 2.2);
    while (speed > 3 && this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const i = this.next;
      this.positions.set([position[0] + (Math.random() - 0.5) * 0.5, position[1] - 0.6 + Math.random() * 0.4, position[2] + (Math.random() - 0.5) * 0.5], i * 3);
      this.ages[i] = 0;
      this.next = (this.next + 1) % this.count;
    }
    if (speed <= 3) this.emitAcc = 0;
    for (let i = 0; i < this.count; i++) {
      this.ages[i] += dt;
      const alpha = this.ages[i] < LIFE ? 0.9 * (1 - this.ages[i] / LIFE) : 0;
      const c = this.base[i];
      this.colors.set([c.r, c.g, c.b, alpha], i * 4);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
