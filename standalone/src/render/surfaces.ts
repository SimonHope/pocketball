import * as THREE from 'three';
import type { Vec3 } from '../sim/math';
import type { Surface } from '../levels/themes';

// Procedural surfaces for the hamster's world: wood boards, lawn, paving stones, popsicle-stick
// wood, crackers... Each is painted once on a canvas (seeded, so it looks the same every time),
// cached, and shared by every mesh that uses it. One texture tile covers TILE × TILE world units;
// geometry gets world-scaled UVs (scaleBoxUVs) so tiles line up across merged pieces.

export const TILE = 4;

/** Small seeded RNG (mulberry32): the same texture on every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `hex` lightened (amount > 0) or darkened (< 0), as an rgba() string with `alpha`. */
function tint(hex: string, amount: number, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgba(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)}, ${alpha})`;
}

type Ctx = CanvasRenderingContext2D;

/**
 * A canvas for painting a texture. `willReadFrequently` keeps it on the CPU: painting thousands
 * of small shapes there and uploading once is much faster than on a GPU canvas, which would be
 * read back for the upload anyway.
 */
export function paintCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d', { willReadFrequently: true })!];
}

/** Many small shapes in one colour, in one path: far fewer draw calls than one each. */
function batch(ctx: Ctx, color: string, shapes: (ctx: Ctx) => void, stroke?: number) {
  ctx.beginPath();
  shapes(ctx);
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** Wood grain along x across a band: long faint wavy lines, and the odd knot. */
function grain(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, color: string, lines: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (const [shade, alpha, width] of [[-0.18, 0.25, 0.8], [-0.3, 0.3, 1.3], [-0.4, 0.2, 1.8]] as const) {
    batch(ctx, tint(color, shade, alpha), (c) => {
      for (let i = 0; i < lines / 3; i++) {
        const gy = y + rand() * h, amp = 0.6 + rand() * 1.8, freq = 0.01 + rand() * 0.03, phase = rand() * 6;
        c.moveTo(x, gy + Math.sin(x * freq + phase) * amp);
        for (let gx = x + 8; gx <= x + w; gx += 8) c.lineTo(gx, gy + Math.sin(gx * freq + phase) * amp);
      }
    }, width);
  }
  if (rand() < 0.5) {
    const kx = x + rand() * w, ky = y + h * (0.3 + rand() * 0.4);
    ctx.fillStyle = tint(color, -0.35, 0.5);
    ctx.beginPath();
    ctx.ellipse(kx, ky, 6 + rand() * 6, 2.5 + rand() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Boards running along x, `boards` across the tile, with seams and staggered end joints. */
function boards(ctx: Ctx, rand: () => number, size: number, base: string, seam: string, count: number, paint?: string) {
  const bh = size / count;
  for (let b = 0; b < count; b++) {
    const y = b * bh;
    const joint = rand() * size;
    for (const [x0, x1] of [[0, joint], [joint, size]]) {
      const tone = (rand() - 0.5) * 0.12;
      ctx.fillStyle = tint(base, tone);
      ctx.fillRect(x0, y, x1 - x0, bh);
      grain(ctx, rand, x0, y, x1 - x0, bh, base, 10);
      if (paint) {
        // Paint over the boards, worn through in places so the wood shows.
        ctx.fillStyle = tint(paint, tone * 0.5, 0.9);
        ctx.fillRect(x0, y, x1 - x0, bh);
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = tint(base, -0.1, 0.55);
          ctx.beginPath();
          ctx.ellipse(x0 + rand() * (x1 - x0), y + rand() * bh, 2 + rand() * 7, 1 + rand() * 3, rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        grain(ctx, rand, x0, y, x1 - x0, bh, paint, 4);
      }
      ctx.fillStyle = tint(seam, -0.2, 0.8);
      ctx.fillRect(x1 - 1.5, y, 3, bh); // end joint
    }
    ctx.fillStyle = tint(seam, -0.25, 0.85);
    ctx.fillRect(0, y, size, 3); // seam between boards
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, y + 3, size, 2); // a little light on the board's edge
  }
}

/** Lawn: thousands of short blades, light and dark, over soft larger patches. */
function turf(ctx: Ctx, rand: () => number, size: number, base: string, light: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const r = size * (0.05 + rand() * 0.12);
    ctx.fillStyle = tint(rand() < 0.5 ? light : base, rand() < 0.5 ? -0.12 : 0.05, 0.25);
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Blades in six shades, each shade one path.
  const shades = [tint(light, 0, 0.7), tint(light, 0.15, 0.7), tint(base, -0.15, 0.6), tint(base, -0.25, 0.6), tint(base, -0.35, 0.6), tint(light, 0.08, 0.6)];
  shades.forEach((color, s) => batch(ctx, color, (c) => {
    for (let i = 0; i < (size * 14) / shades.length; i++) {
      const x = rand() * size, y = rand() * size, len = 3 + rand() * 6, a = -Math.PI / 2 + (rand() - 0.5) * 1.2;
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
  }, 1.2 + (s % 2) * 0.6));
}

/** Paving: slabs in staggered rows, each a slightly different tone, speckled, with mortar. */
function stone(ctx: Ctx, rand: () => number, size: number, base: string, mortar: string) {
  ctx.fillStyle = tint(mortar, -0.1);
  ctx.fillRect(0, 0, size, size);
  const rows = 2, rh = size / rows, gap = 5;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -size * 0.25 : 0;
    while (x < size) {
      const w = size * (0.38 + rand() * 0.24);
      const tone = (rand() - 0.5) * 0.14;
      for (const wrap of [0, size, -size]) {
        const sx = x + wrap + gap / 2, sy = r * rh + gap / 2, sw = w - gap, sh = rh - gap;
        if (sx > size || sx + sw < 0) continue;
        ctx.fillStyle = tint(base, tone);
        ctx.beginPath();
        ctx.roundRect(sx, sy, sw, sh, 10);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(sx + 4, sy + 3, sw - 8, 4); // light catches the top edge
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(sx + 4, sy + sh - 6, sw - 8, 4);
      }
      x += w;
    }
  }
  for (const amount of [-0.25, 0.2]) {
    batch(ctx, tint(base, amount, 0.35), (c) => {
      for (let i = 0; i < size * 3; i++) c.rect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    });
  }
}

/** Soil seen from the side, under a strip of lawn at the top. */
function soil(ctx: Ctx, rand: () => number, size: number, base: string, grass: string) {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, tint(base, 0.08));
  g.addColorStop(1, tint(base, -0.2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (const amount of [-0.3, 0.25]) {
    batch(ctx, tint(base, amount, 0.5), (c) => {
      for (let i = 0; i < size * 1.5; i++) {
        const x = rand() * size, y = rand() * size, r = 0.8 + rand() * 2.2;
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      }
    });
  }
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, size, size * 0.07);
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = tint(grass, (rand() - 0.5) * 0.3);
    ctx.fillRect(x, size * 0.07, 3, rand() * size * 0.05); // ragged edge
  }
}

/** Popsicle-stick wood: pale, fine grain along x. */
function stick(ctx: Ctx, rand: () => number, size: number, base: string, accent: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  grain(ctx, rand, 0, 0, size, size, accent, 26);
}

/** A cracker: golden, toasted towards its edges, with docking holes and sugar. */
function cracker(ctx: Ctx, rand: () => number, size: number, base: string, toast: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, tint(toast, 0, 0.75));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (const [amount, n] of [[0.25, size * 2.4], [-0.2, size * 1.6]]) {
    batch(ctx, tint(base, amount, 0.35), (c) => {
      for (let i = 0; i < n; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
    });
  }
  const n = 5, step = size / (n + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      ctx.fillStyle = tint(toast, -0.25, 0.85);
      ctx.beginPath();
      ctx.arc(i * step, j * step, size * 0.012, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = tint(toast, -0.3, 0.6);
  ctx.lineWidth = size * 0.02;
  ctx.strokeRect(size * 0.01, size * 0.01, size * 0.98, size * 0.98);
}

/** A clipped hedge: layers of small leaves in three shades. */
function hedge(ctx: Ctx, rand: () => number, size: number, base: string) {
  ctx.fillStyle = tint(base, -0.25);
  ctx.fillRect(0, 0, size, size);
  for (const [n, light] of [[size * 3, -0.15], [size * 3, 0.05], [size * 1.5, 0.25]] as const) {
    batch(ctx, tint(base, light, 0.9), (c) => {
      for (let i = 0; i < n; i++) {
        const x = rand() * size, y = rand() * size, rx = 3 + rand() * 4;
        c.moveTo(x + rx, y);
        c.ellipse(x, y, rx, 1.5 + rand() * 2, rand() * Math.PI, 0, Math.PI * 2);
      }
    });
  }
}

/** A rubber belt: dark with ribs across it. */
function rubber(ctx: Ctx, rand: () => number, size: number, base: string, rib: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    const y = (i / 8) * size;
    ctx.fillStyle = rib;
    ctx.fillRect(0, y, size, size / 32);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, y + size / 32, size, size / 64);
  }
  batch(ctx, 'rgba(255,255,255,0.05)', (c) => {
    for (let i = 0; i < size * 2; i++) c.rect(rand() * size, rand() * size, 1, 1);
  });
}

const cache = new Map<string, THREE.CanvasTexture>();

/** The (shared, cached) texture for a surface. Use materials' clones of it, so disposing one doesn't drop it. */
export function surfaceTexture(surface: Surface, size = 512): THREE.CanvasTexture {
  const key = `${surface.kind}:${surface.base}:${surface.accent}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [canvas, ctx] = paintCanvas(size, size);
  let seed = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 0x01000193);
  const rand = rng(seed);
  const { base, accent } = surface;
  switch (surface.kind) {
    case 'planks': boards(ctx, rand, size, base, accent, 4); break;
    case 'painted': boards(ctx, rand, size, '#d4a26a', accent, 4, base); break;
    case 'turf': turf(ctx, rand, size, base, accent); break;
    case 'soil': soil(ctx, rand, size, base, accent); break;
    case 'stone': stone(ctx, rand, size, base, accent); break;
    case 'stick': stick(ctx, rand, size, base, accent); break;
    case 'cracker': cracker(ctx, rand, size, base, accent); break;
    case 'rubber': rubber(ctx, rand, size, base, accent); break;
    case 'hedge': hedge(ctx, rand, size, base); break;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const ROUGHNESS: Record<Surface['kind'], number> = {
  planks: 0.75, painted: 0.6, turf: 0.95, soil: 1, stone: 0.9, stick: 0.7, cracker: 0.85, rubber: 0.9, hedge: 1,
};

/** A material showing `surface`. `vertexColors`: geometry carries a colour attribute (side shading). */
export function surfaceMaterial(surface: Surface, { vertexColors = false, size = 512 } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: surfaceTexture(surface, size).clone(), roughness: ROUGHNESS[surface.kind], vertexColors });
}

/**
 * World-scaled UVs for a box, one texture tile per TILE units. Side faces count down from
 * their top edge (so a strip of lawn drawn at the top of a side texture sits at the top of
 * every side). `shade`: also adds a colour attribute darkening the sides towards the bottom
 * (taller sides more), and the bottom face: cheap ambient occlusion.
 */
export function scaleBoxUVs(box: THREE.BoxGeometry, [w, h, d]: Vec3, { shade = false, tile = TILE } = {}) {
  const uv = box.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry faces, 4 vertices each in this order: +x, -x, +y, -y, +z, -z.
  const dims: [number, number, boolean][] = [[d, h, true], [d, h, true], [w, d, false], [w, d, false], [w, h, true], [w, h, true]];
  const colors = shade ? new Float32Array(uv.count * 3) : null;
  const bottom = Math.max(0.45, 1 - h * 0.06);
  dims.forEach(([fu, fv, side], face) => {
    for (let k = face * 4; k < face * 4 + 4; k++) {
      const u = uv.getX(k), v = uv.getY(k);
      uv.setXY(k, (u * fu) / tile, side ? 1 - ((1 - v) * fv) / tile : (v * fv) / tile);
      if (colors) {
        const c = face === 3 ? bottom : side ? (v > 0.5 ? 1 : bottom) : 1;
        colors.set([c, c, c], k * 3);
      }
    }
  });
  uv.needsUpdate = true;
  if (colors) box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
