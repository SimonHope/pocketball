import * as THREE from 'three';
import type { Look } from '../levels/themes';
import type { Vec3 } from '../sim/math';
import { paintCanvas } from './surfaces';

// The world around a course, for themes with a look: a world-locked painted panorama (sky above,
// the ground far below, and giant soft shapes standing around the horizon, pre-blurred so they
// read as out of focus), plus specks drifting in the light. Painting it all into the sky costs
// nothing to draw (the sky is drawn every frame anyway): the motes are the only extra draw call.

/** Where the sun is, relative to what the camera follows (main.ts places the light there). */
export const SUN_OFFSET = new THREE.Vector3(20, 35, 12);

const skies = new Map<Look, THREE.Texture>();

/**
 * An equirectangular sky: gradient, haze near the horizon, a soft glow at the sun, and the
 * backdrop's giants. Painted once per theme and kept (`userData.keep`: don't dispose it).
 */
export function skyTexture(look: Look): THREE.Texture {
  const hit = skies.get(look);
  if (hit) return hit;
  const sky = look.sky;
  const W = 2048, H = 1024;
  const [c, ctx] = paintCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.47, sky.horizon);
  g.addColorStop(0.53, sky.horizon);
  g.addColorStop(1, sky.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Soft haze bands just above the horizon, like a summer afternoon.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.05 + i * 0.01})`;
    ctx.fillRect(0, H * (0.36 + i * 0.025), W, H * 0.03);
  }
  // The sun: three.js maps direction (x, y, z) to u = atan2(z, x) / 2π + 0.5.
  const u = Math.atan2(SUN_OFFSET.z, SUN_OFFSET.x) / (Math.PI * 2) + 0.5;
  const v = 0.5 - sky.sunHeight / 180;
  for (const [r, a] of [[H * 0.35, 0.25], [H * 0.14, 0.5], [H * 0.04, 0.95]] as const) {
    const sun = ctx.createRadialGradient(u * W, v * H, 0, u * W, v * H, r);
    sun.addColorStop(0, hexAlpha(sky.sun, a));
    sun.addColorStop(1, hexAlpha(sky.sun, 0));
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
  }
  paintGround(ctx, W, H, look.ground.base, sky.horizon);
  paintGiants(ctx, W, H, GARDEN, sky.horizon);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.keep = true;
  skies.set(look, tex);
  return tex;
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------- Giant garden cut-outs ----------

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
const CELL_W = 256, CELL_H = 512;

const blade = (ctx: CanvasRenderingContext2D, x: number, h: number, bend: number, width: number, color: string, H: number) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, H);
  ctx.quadraticCurveTo(x - width / 2 + bend * 0.4, H - h * 0.6, x + bend, H - h);
  ctx.quadraticCurveTo(x + width / 2 + bend * 0.4, H - h * 0.6, x + width / 2, H);
  ctx.fill();
};
const stem = (ctx: CanvasRenderingContext2D, x: number, top: number, H: number, color = '#4f8f3a') => {
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x, H);
  ctx.quadraticCurveTo(x + 18, (H + top) / 2, x, top);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x + 22, H - (H - top) * 0.35, 30, 9, -0.6, 0, Math.PI * 2);
  ctx.fill();
};

const GARDEN: Draw[] = [
  // A clump of grass.
  (ctx, w, h) => {
    for (const [x, hh, b, wd, c] of [[70, 420, -40, 34, '#5e9e44'], [120, 480, 30, 40, '#6fb34f'], [170, 380, 50, 30, '#4f8f3a'], [100, 300, -60, 28, '#7cc25a'], [200, 320, 20, 26, '#5e9e44']] as const) blade(ctx, x, hh, b, wd, c, h);
    void w;
  },
  // A daisy.
  (ctx, w, h) => {
    stem(ctx, w / 2, 110, h);
    ctx.fillStyle = '#fffaf0';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.cos(a) * 46, 110 + Math.sin(a) * 30, 30, 11, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffc93c';
    ctx.beginPath();
    ctx.ellipse(w / 2, 110, 24, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  // A tulip.
  (ctx, w, h) => {
    stem(ctx, w / 2, 150, h);
    ctx.fillStyle = '#e8483c';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 50, 110);
    ctx.quadraticCurveTo(w / 2 - 55, 200, w / 2, 205);
    ctx.quadraticCurveTo(w / 2 + 55, 200, w / 2 + 50, 110);
    ctx.lineTo(w / 2 + 25, 150);
    ctx.lineTo(w / 2, 100);
    ctx.lineTo(w / 2 - 25, 150);
    ctx.closePath();
    ctx.fill();
  },
  // A stretch of wooden fence.
  (ctx, w, h) => {
    ctx.fillStyle = '#c99a66';
    ctx.fillRect(0, h * 0.45, w, 22);
    ctx.fillRect(0, h * 0.75, w, 22);
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 82;
      ctx.fillStyle = i % 2 ? '#d9ab76' : '#cf9f6b';
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h * 0.3);
      ctx.lineTo(x + 32, h * 0.24);
      ctx.lineTo(x + 64, h * 0.3);
      ctx.lineTo(x + 64, h);
      ctx.fill();
    }
  },
  // A watering can.
  (ctx, w, h) => {
    ctx.fillStyle = '#5aa6a0';
    ctx.beginPath();
    ctx.roundRect(40, h - 230, 150, 210, 18);
    ctx.fill();
    ctx.strokeStyle = '#5aa6a0';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(115, h - 230, 55, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(185, h - 90);
    ctx.lineTo(245, h - 230);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(58, h - 210, 18, 170);
    void w;
  },
  // A terracotta pot with a little plant.
  (ctx, w, h) => {
    for (const [x, hh, b] of [[100, 230, -30], [130, 260, 10], [160, 220, 35]] as const) blade(ctx, x, hh, b, 26, '#5e9e44', h - 150);
    ctx.fillStyle = '#c8653a';
    ctx.beginPath();
    ctx.moveTo(50, h - 170);
    ctx.lineTo(206, h - 170);
    ctx.lineTo(186, h);
    ctx.lineTo(70, h);
    ctx.fill();
    ctx.fillStyle = '#d97a4c';
    ctx.fillRect(42, h - 185, 172, 30);
    void w;
  },
  // A garden gnome.
  (ctx, w, h) => {
    ctx.fillStyle = '#3b6fb3';
    ctx.beginPath();
    ctx.roundRect(70, h - 190, 116, 190, 30);
    ctx.fill();
    ctx.fillStyle = '#fff6e8';
    ctx.beginPath();
    ctx.moveTo(78, h - 210);
    ctx.quadraticCurveTo(128, h - 60, 178, h - 210);
    ctx.fill();
    ctx.fillStyle = '#f2c4a0';
    ctx.beginPath();
    ctx.arc(128, h - 225, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8483c';
    ctx.beginPath();
    ctx.moveTo(84, h - 240);
    ctx.lineTo(128, h - 400);
    ctx.lineTo(172, h - 240);
    ctx.fill();
    void w;
  },
  // A dandelion clock.
  (ctx, w, h) => {
    stem(ctx, w / 2, 130, h, '#6b9e4a');
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * 60, 130 + Math.sin(a) * 60, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(w / 2, 130, 48, 0, Math.PI * 2);
    ctx.fill();
  },
];

/** The lower half: the lawn far below, mown in stripes, fading into the haze at the horizon. */
function paintGround(ctx: CanvasRenderingContext2D, W: number, H: number, grass: string, haze: string) {
  const top = H / 2;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, haze);
  g.addColorStop(0.12, grass);
  g.addColorStop(1, shade(grass, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  // Mowing stripes: bands along the direction around the horizon, fading out near it.
  for (let i = 0; i < 14; i++) {
    const y = top + H * 0.07 + i * H * 0.03;
    ctx.fillStyle = `rgba(255,255,255,${0.035 * Math.min(1, i / 3)})`;
    ctx.fillRect(0, y, W, H * 0.015);
  }
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/** How much of the sky (as a share of its height) each giant may take, and how often it appears. */
const GARDEN_SIZES: [scale: number, weight: number][] = [[1, 5], [0.95, 2], [0.85, 2], [0.6, 3], [0.55, 1], [0.6, 1], [0.7, 1], [0.95, 2]];

/**
 * Giants all the way around the horizon of an equirectangular sky (x = direction, y = height),
 * hazed towards the horizon colour, the far row more. They're painted at a quarter of the sky's
 * resolution and scaled up, which softens them like a blur (a canvas blur filter is slow on
 * some devices). Their feet sit just below the horizon, where the far ground fades into the haze.
 */
function paintGiants(sky: CanvasRenderingContext2D, W: number, H: number, draws: Draw[], haze: string) {
  const SCALE = 4;
  const [layer, ctx] = paintCanvas(W / SCALE, H / SCALE);
  ctx.scale(1 / SCALE, 1 / SCALE);
  const [cell, cx] = paintCanvas(CELL_W, CELL_H);
  const kinds = GARDEN_SIZES.flatMap(([, n], i) => Array<number>(n).fill(i));
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const horizon = H / 2;
  // Two rows: far (small, hazy) behind near (bigger, clearer).
  for (const [row, count, size, hazeAmount] of [[0, 34, 0.17, 0.55], [1, 22, 0.3, 0.3]] as const) {
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const h = H * size * GARDEN_SIZES[kind][0] * (0.75 + rand() * 0.5);
      const w = h * (CELL_W / CELL_H);
      const x = ((i + rand() * 0.6) / count) * W;
      const foot = horizon + H * (row ? 0.03 : 0.012);
      cx.globalCompositeOperation = 'source-over';
      cx.clearRect(0, 0, CELL_W, CELL_H);
      draws[kind](cx, CELL_W, CELL_H);
      cx.globalCompositeOperation = 'source-atop'; // haze only where something was drawn
      cx.fillStyle = hexAlpha(haze, hazeAmount);
      cx.fillRect(0, 0, CELL_W, CELL_H);
      for (const wrap of [0, -W, W]) {
        if (x + wrap + w < 0 || x + wrap > W) continue;
        ctx.drawImage(cell, x + wrap, foot - h, w, h);
      }
    }
  }
  // Haze over their feet, so they stand in the distance rather than on a line.
  const g = ctx.createLinearGradient(0, horizon - H * 0.03, 0, horizon + H * 0.05);
  g.addColorStop(0, hexAlpha(haze, 0));
  g.addColorStop(0.5, hexAlpha(haze, 0.85));
  g.addColorStop(1, hexAlpha(haze, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon - H * 0.03, W, H * 0.08);
  sky.imageSmoothingQuality = 'high';
  sky.drawImage(layer, 0, 0, W, H);
}

/** Drifting specks (pollen, dust in the sun) in a box that follows the ball. */
export class Motes {
  /** Off on the low graphics setting (main.ts sets it from the quality tier). */
  static enabled = true;
  readonly points: THREE.Points;
  private velocities: Float32Array;
  private static readonly SPAN: Vec3 = [40, 16, 40];

  constructor(color: string, count: number) {
    const pos = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = (Math.random() - 0.5) * Motes.SPAN[k];
      this.velocities.set([(Math.random() - 0.5) * 0.6, 0.1 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const g = dot.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color, size: 0.22, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    }));
    this.points.frustumCulled = false;
  }

  /** Drift, and wrap around `center` (the ball) so there are always some nearby. */
  update(center: Vec3, dt: number) {
    this.points.visible = Motes.enabled;
    if (!Motes.enabled) return;
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array, v = this.velocities, span = Motes.SPAN;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        let x = p[i + k] + v[i + k] * dt;
        const rel = x - center[k];
        if (rel > span[k] / 2) x -= span[k];
        else if (rel < -span[k] / 2) x += span[k];
        p[i + k] = x;
      }
    }
    attr.needsUpdate = true;
  }
}

/** Specks for a theme's look (the caller moves them, and hides them on the low graphics setting). */
export function addScenery(group: THREE.Object3D, look: Look): Motes {
  const motes = new Motes(look.motes.color, look.motes.count);
  group.add(motes.points);
  return motes;
}
