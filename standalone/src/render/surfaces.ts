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

// ---------- The kitchen counter ----------

/** A laminate worktop: pale, with fine flecks of two tones and the odd faint smear. */
function counter(ctx: Ctx, rand: () => number, size: number, base: string, fleck: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = tint(base, rand() < 0.5 ? -0.04 : 0.05, 0.5);
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, size * (0.08 + rand() * 0.15), size * (0.03 + rand() * 0.05), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [amount, n, r] of [[-0.2, size * 3, 1.2], [-0.45, size * 1.2, 1], [0.3, size * 1.5, 1.1]] as const) {
    batch(ctx, tint(fleck, amount, 0.55), (c) => {
      for (let i = 0; i < n; i++) c.rect(rand() * size, rand() * size, r, r);
    });
  }
}

/** Shortbread: golden, baked darker at the edges of each biscuit, with docking holes and chocolate chips. */
function cookie(ctx: Ctx, rand: () => number, size: number, base: string, chip: string) {
  const n = 2, cell = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * cell, y = j * cell;
      ctx.fillStyle = tint(base, (rand() - 0.5) * 0.08);
      ctx.fillRect(x, y, cell, cell);
      const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, cell * 0.25, x + cell / 2, y + cell / 2, cell * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, tint(base, -0.35, 0.6));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = tint(base, -0.45, 0.8);
      ctx.fillRect(x, y, cell, size * 0.008); // the gap between biscuits
      ctx.fillRect(x, y, size * 0.008, cell);
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = tint(chip, (rand() - 0.5) * 0.2);
        ctx.beginPath();
        const cx = x + cell * (0.15 + rand() * 0.7), cy = y + cell * (0.15 + rand() * 0.7), r = cell * (0.03 + rand() * 0.03);
        ctx.moveTo(cx + r, cy);
        for (let a = 1; a < 7; a++) ctx.lineTo(cx + Math.cos(a) * r * (0.7 + rand() * 0.4), cy + Math.sin(a) * r * (0.7 + rand() * 0.4));
        ctx.fill();
      }
    }
  }
  batch(ctx, tint(base, 0.25, 0.4), (c) => {
    for (let i = 0; i < size * 1.5; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
  });
}

/** A wafer: a raised grid of little squares, lighter on their top edges. */
function wafer(ctx: Ctx, rand: () => number, size: number, base: string, groove: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const n = 4, cell = size / n, line = size * 0.022;
  ctx.fillStyle = tint(groove, -0.1, 0.75);
  for (let i = 0; i < n; i++) {
    ctx.fillRect(i * cell, 0, line, size);
    ctx.fillRect(0, i * cell, size, line);
  }
  // Each square is raised: lit on its top and left edges, shadowed on the others.
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(i * cell + line, 0, line * 0.8, size);
    ctx.fillRect(0, i * cell + line, size, line * 0.8);
    ctx.fillStyle = tint(groove, -0.2, 0.35);
    ctx.fillRect((i + 1) * cell - line * 0.9, 0, line * 0.9, size);
    ctx.fillRect(0, (i + 1) * cell - line * 0.9, size, line * 0.9);
  }
  batch(ctx, tint(base, -0.12, 0.3), (c) => {
    for (let i = 0; i < size * 1.2; i++) c.rect(rand() * size, rand() * size, 1.2, 1.2);
  });
}

/** Frosting: soft swirls of icing with sprinkles in a few bright colours. */
function frosting(ctx: Ctx, rand: () => number, size: number, base: string, sprinkle: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.04 + rand() * 0.08);
    ctx.strokeStyle = tint(base, 0.35, 0.45);
    ctx.lineWidth = size * 0.01;
    ctx.beginPath();
    ctx.arc(x, y, r, rand() * 3, rand() * 3 + 3.5);
    ctx.stroke();
  }
  const colours = [sprinkle, '#ffffff', '#ffd23f', '#7fd6ff', '#ff6fa8'];
  colours.forEach((col, k) => batch(ctx, col, (c) => {
    for (let i = 0; i < size * 0.12; i++) {
      const x = rand() * size, y = rand() * size, a = rand() * Math.PI, len = size * 0.016;
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    void k;
  }, size * 0.008));
}

/** A chocolate bar: moulded squares, each with a lit top edge and a shadowed bottom one. */
function chocolate(ctx: Ctx, rand: () => number, size: number, base: string, groove: string) {
  const n = 4, cell = size / n, bevel = cell * 0.08;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * cell, y = j * cell;
      ctx.fillStyle = tint(groove, 0);
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = tint(base, (rand() - 0.5) * 0.05);
      ctx.fillRect(x + bevel, y + bevel, cell - bevel * 2, cell - bevel * 2);
      ctx.fillStyle = tint(base, 0.18, 0.7);
      ctx.fillRect(x + bevel, y + bevel, cell - bevel * 2, bevel * 0.6);
      ctx.fillStyle = tint(base, -0.25, 0.7);
      ctx.fillRect(x + bevel, y + cell - bevel * 1.6, cell - bevel * 2, bevel * 0.6);
    }
  }
}

/** A candy cane: diagonal red and white stripes with a soft shine. */
function candycane(ctx: Ctx, _rand: () => number, size: number, base: string, stripe: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = stripe;
  const w = size / 8;
  for (let x = -size; x < size * 2; x += w * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + size, size);
    ctx.lineTo(x + size, size);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, size * 0.3, size, size * 0.12);
}

// ---------- The freezer ----------

/** Frost ferns: feathery branches growing from a point, each side shoot shorter. */
function fern(c: Ctx, rand: () => number, x: number, y: number, len: number, a: number, depth: number) {
  const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
  c.moveTo(x, y);
  c.lineTo(ex, ey);
  if (depth === 0) return;
  for (let k = 1; k <= 3; k++) {
    const t = k / 4, bx = x + (ex - x) * t, by = y + (ey - y) * t;
    for (const side of [-1, 1]) fern(c, rand, bx, by, len * (0.45 - t * 0.2) * (0.8 + rand() * 0.4), a + side * (0.7 + rand() * 0.3), depth - 1);
  }
}

/** A frosted freezer shelf: pale and cold, soft frost drifts, feathery ferns and fine scratches. */
function frost(ctx: Ctx, rand: () => number, size: number, base: string, fern_: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(rand() * size, rand() * size);
    ctx.scale(size * (0.1 + rand() * 0.15), size * (0.06 + rand() * 0.1));
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  batch(ctx, tint(fern_, -0.1, 0.6), (c) => {
    for (let i = 0; i < 9; i++) fern(c, rand, rand() * size, rand() * size, size * (0.06 + rand() * 0.06), rand() * Math.PI * 2, 2);
  }, 1.1);
  batch(ctx, 'rgba(255,255,255,0.7)', (c) => {
    for (let i = 0; i < 9; i++) fern(c, rand, rand() * size, rand() * size, size * (0.05 + rand() * 0.05), rand() * Math.PI * 2, 2);
  }, 0.9);
  // Scratches: long thin lines, from things slid in and out.
  batch(ctx, tint(fern_, -0.15, 0.25), (c) => {
    for (let i = 0; i < 18; i++) {
      const x = rand() * size, y = rand() * size, a = (rand() - 0.5) * 0.5, len = size * (0.1 + rand() * 0.3);
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
  }, 0.8);
  batch(ctx, 'rgba(255,255,255,0.8)', (c) => {
    for (let i = 0; i < size * 1.5; i++) c.rect(rand() * size, rand() * size, 1.2, 1.2); // glints
  });
}

/** Clear ice: a deeper tint towards the middle, trapped bubbles, a few cracks and a bright edge. */
function icecube(ctx: Ctx, rand: () => number, size: number, base: string, shine: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7);
  g.addColorStop(0, tint(base, -0.12, 0.6));
  g.addColorStop(1, tint(shine, 0, 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Cloudy streaks inside the ice.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = tint(shine, 0, 0.12);
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, size * (0.1 + rand() * 0.2), size * (0.015 + rand() * 0.03), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  batch(ctx, tint(shine, 0, 0.55), (c) => {
    for (let i = 0; i < 40; i++) {
      const x = rand() * size, y = rand() * size, r = 1 + rand() * rand() * 5;
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, Math.PI * 2);
    }
  }, 1);
  // Cracks: jagged lines, white on their lit side.
  for (const [color, dx] of [[tint(base, -0.3, 0.35), 1], [tint(shine, 0, 0.6), 0]] as const) {
    batch(ctx, color, (c) => {
      for (let i = 0; i < 4; i++) {
        let x = rand() * size, y = rand() * size, a = rand() * Math.PI * 2;
        c.moveTo(x + dx, y + dx);
        for (let k = 0; k < 5; k++) {
          a += (rand() - 0.5) * 1.2;
          x += Math.cos(a) * size * 0.04;
          y += Math.sin(a) * size * 0.04;
          c.lineTo(x + dx, y + dx);
        }
      }
    }, 1.2);
  }
  ctx.strokeStyle = tint(shine, 0, 0.5);
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(size * 0.006, size * 0.006, size * 0.988, size * 0.988);
}

/** A bag of frozen peas: packed round peas, each lit on one side, dusted with frost. */
function peas(ctx: Ctx, rand: () => number, size: number, base: string, frost_: string) {
  ctx.fillStyle = tint(base, -0.35);
  ctx.fillRect(0, 0, size, size);
  const r = size * 0.028;
  const tones = [-0.12, -0.04, 0.04, 0.1];
  for (const tone of tones) {
    batch(ctx, tint(base, tone), (c) => {
      for (let i = 0; i < (size * size) / (r * r * 3.2) / tones.length; i++) {
        const x = rand() * size, y = rand() * size, pr = r * (0.85 + rand() * 0.3);
        for (const [wx, wy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
          if (x + wx < -pr || x + wx > size + pr || y + wy < -pr || y + wy > size + pr) continue;
          c.moveTo(x + wx + pr, y + wy);
          c.arc(x + wx, y + wy, pr, 0, Math.PI * 2);
        }
      }
    });
  }
  batch(ctx, 'rgba(255,255,255,0.35)', (c) => {
    for (let i = 0; i < size * 0.8; i++) {
      const x = rand() * size, y = rand() * size;
      c.moveTo(x + r * 0.35, y);
      c.arc(x, y, r * 0.35, 0, Math.PI * 2); // highlights
    }
  });
  batch(ctx, tint(frost_, 0, 0.6), (c) => {
    for (let i = 0; i < size * 2; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
  });
}

/** Breadcrumb on a fish finger: golden, rough, with toasted flecks. */
function breaded(ctx: Ctx, rand: () => number, size: number, base: string, toast: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (const [color, n, r] of [[tint(toast, 0, 0.7), size * 2.5, 3.4], [tint(base, 0.35, 0.75), size * 2.5, 2.8], [tint(toast, -0.35, 0.8), size, 2.2], [tint(base, -0.12, 0.6), size * 1.5, 4]] as const) {
    batch(ctx, color, (c) => {
      for (let i = 0; i < n; i++) {
        const x = rand() * size, y = rand() * size, rr = r * (0.6 + rand() * 0.8);
        c.moveTo(x + rr, y);
        c.lineTo(x, y + rr * 0.8);
        c.lineTo(x - rr, y);
        c.lineTo(x, y - rr);
      }
    });
  }
  batch(ctx, 'rgba(255,255,255,0.45)', (c) => {
    for (let i = 0; i < size * 0.8; i++) c.rect(rand() * size, rand() * size, 1.2, 1.2); // frost
  });
}

/** Freezer-wall plastic seen from the side, with a thick rim of frost along the top. */
function rime(ctx: Ctx, rand: () => number, size: number, base: string, snow: string) {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, tint(base, 0.1));
  g.addColorStop(1, tint(base, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  batch(ctx, tint(snow, 0, 0.35), (c) => {
    for (let i = 0; i < size * 1.2; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
  });
  ctx.fillStyle = snow;
  ctx.fillRect(0, 0, size, size * 0.06);
  // A ragged, dripping lower edge: frost hanging off the rim.
  ctx.beginPath();
  ctx.moveTo(0, size * 0.06);
  for (let x = 0; x <= size; x += 4) ctx.lineTo(x, size * (0.06 + rand() * 0.03 + (rand() < 0.08 ? rand() * 0.07 : 0)));
  ctx.lineTo(size, 0);
  ctx.lineTo(0, 0);
  ctx.fill();
}

/** Ice-cube-tray plastic: glossy, with moulded cells and a highlight along each rib. */
function tray(ctx: Ctx, _rand: () => number, size: number, base: string, rib: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const n = 4, cell = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * cell, y = j * cell, inset = cell * 0.1;
      const g = ctx.createLinearGradient(x, y, x, y + cell);
      g.addColorStop(0, tint(rib, -0.1, 0.8));
      g.addColorStop(1, tint(base, 0.15, 0.8));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.12);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < n; i++) ctx.fillRect(0, i * cell + cell * 0.02, size, cell * 0.05);
}

/** Thin ice: pale and clouded, with a spider of cracks from a point and a few bubbles. */
function thinice(ctx: Ctx, rand: () => number, size: number, base: string, crack: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const cx = size * (0.35 + rand() * 0.3), cy = size * (0.35 + rand() * 0.3);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, tint(crack, 0, 0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (const [color, w, off] of [[tint(crack, -0.25, 0.75), size * 0.006, 0], [tint('#ffffff', 0, 0.8), size * 0.003, size * 0.004]] as const) {
    const r = rng(Math.round(cx * 1000 + cy)); // the same cracks for both strokes
    batch(ctx, color, (c) => {
      for (let i = 0; i < 9; i++) {
        let a = (i / 9) * Math.PI * 2 + r() * 0.4, x = cx, y = cy;
        c.moveTo(x + off, y + off);
        for (let k = 0; k < 6; k++) {
          a += (r() - 0.5) * 0.7;
          x += Math.cos(a) * size * (0.05 + r() * 0.04);
          y += Math.sin(a) * size * (0.05 + r() * 0.04);
          c.lineTo(x + off, y + off);
        }
      }
      for (let ring = 1; ring <= 2; ring++) {
        const rr = size * 0.12 * ring;
        c.moveTo(cx + rr + off, cy + off);
        for (let k = 1; k <= 9; k++) {
          const a = (k / 9) * Math.PI * 2, j = 1 + (r() - 0.5) * 0.3;
          c.lineTo(cx + Math.cos(a) * rr * j + off, cy + Math.sin(a) * rr * j + off);
        }
      }
    }, w);
  }
  batch(ctx, 'rgba(255,255,255,0.6)', (c) => {
    for (let i = 0; i < 25; i++) {
      const x = rand() * size, y = rand() * size, r = 1 + rand() * 3;
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, Math.PI * 2);
    }
  }, 1);
  ctx.strokeStyle = tint(crack, -0.1, 0.6);
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(size * 0.006, size * 0.006, size * 0.988, size * 0.988);
}

// ---------- The rooftop at night ----------

/** Roof slates: staggered rows, each slate its own tone, its lower edge catching the moonlight. */
function slate(ctx: Ctx, rand: () => number, size: number, base: string, moon: string, moss?: string) {
  ctx.fillStyle = tint(base, -0.45);
  ctx.fillRect(0, 0, size, size);
  const rows = 4, rh = size / rows, n = 3, sw = size / n;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? sw / 2 : 0;
    for (let i = -1; i < n; i++) {
      const x = i * sw + off + 2, y = r * rh + 1, w = sw - 4, h = rh - 2;
      ctx.fillStyle = tint(base, (rand() - 0.5) * 0.2);
      ctx.fillRect(x, y, w, h);
      batch(ctx, tint(base, -0.18, 0.4), (c) => {
        for (let k = 0; k < 4; k++) {
          const ly = y + rand() * h;
          c.moveTo(x, ly);
          c.lineTo(x + w, ly + (rand() - 0.5) * 6); // the grain of the stone
        }
      }, 1);
      ctx.fillStyle = tint(moon, 0, 0.35);
      ctx.fillRect(x, y + h - 4, w, 3); // the moon on its lower edge
      if (moss && rand() < 0.6) {
        batch(ctx, tint(moss, (rand() - 0.5) * 0.2, 0.85), (c) => {
          const mx = x + rand() * w, my = y + h * (0.5 + rand() * 0.4);
          for (let k = 0; k < 30; k++) {
            const px = mx + (rand() - 0.5) * w * 0.4, py = my + (rand() - 0.5) * h * 0.35, pr = 2 + rand() * 4;
            c.moveTo(px + pr, py);
            c.arc(px, py, pr, 0, Math.PI * 2);
          }
        });
      }
    }
  }
}

/** Terracotta ridge tiles: rounded, so each is lit down its middle, overlapping along the ridge. */
function ridge(ctx: Ctx, rand: () => number, size: number, base: string, dark: string) {
  const g = ctx.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0, tint(dark, -0.2));
  g.addColorStop(0.5, tint(base, 0.15));
  g.addColorStop(1, tint(dark, -0.2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const n = 3, th = size / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = tint(dark, -0.4, 0.7);
    ctx.fillRect(0, i * th, size, th * 0.06); // where one tile overlaps the next
    ctx.fillStyle = 'rgba(255,230,200,0.12)';
    ctx.fillRect(0, i * th + th * 0.06, size, th * 0.05);
  }
  batch(ctx, tint(dark, -0.2, 0.35), (c) => {
    for (let i = 0; i < size * 1.5; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
  });
}

/** Roofing felt: dark, with a fine grit and the odd glittery fleck. */
function felt(ctx: Ctx, rand: () => number, size: number, base: string, glitter: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (const [amount, n] of [[-0.25, size * 6], [0.15, size * 4]] as const) {
    batch(ctx, tint(base, amount, 0.6), (c) => {
      for (let i = 0; i < n; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
    });
  }
  batch(ctx, glitter, (c) => {
    for (let i = 0; i < size * 0.25; i++) c.rect(rand() * size, rand() * size, 2, 2);
  });
  ctx.fillStyle = tint(base, -0.35, 0.8);
  for (let i = 0; i < 2; i++) ctx.fillRect(0, i * (size / 2), size, size * 0.012); // seams between the sheets
}

/** Brick: courses of bricks in a stretcher bond, each its own tone, in dark mortar. */
function brick(ctx: Ctx, rand: () => number, size: number, base: string, mortar: string) {
  ctx.fillStyle = tint(mortar, -0.45); // darker than given, so maze walls (base = mortar = their colour) still show it
  ctx.fillRect(0, 0, size, size);
  const rows = 8, rh = size / rows, bw = size / 4, gap = size * 0.012;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let i = -1; i < 4; i++) {
      ctx.fillStyle = tint(base, (rand() - 0.5) * 0.25);
      ctx.fillRect(i * bw + off + gap, r * rh + gap, bw - gap * 2, rh - gap * 2);
    }
  }
  batch(ctx, tint(base, -0.3, 0.35), (c) => {
    for (let i = 0; i < size * 2; i++) c.rect(rand() * size, rand() * size, 1.5, 1.5);
  });
}

/**
 * Fairy lights: a dark cable looping along, with bulbs in warm colours, each in a soft halo
 * (these glow: the texture is also the emissive map). Two strings, so taller walls get two.
 */
function lights(ctx: Ctx, rand: () => number, size: number, bulb: string, cable: string) {
  ctx.fillStyle = tint(cable, -0.3);
  ctx.fillRect(0, 0, size, size);
  const colours = [bulb, '#ff9ec7', '#8fe3ff', bulb, '#c6ff9a'];
  for (const y0 of [size * 0.08, size * 0.58]) {
    ctx.strokeStyle = tint(cable, 0.15);
    ctx.lineWidth = size * 0.008;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 4) ctx.lineTo(x, y0 + Math.sin((x / size) * Math.PI * 8) * size * 0.012);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const x = (i + 0.5) * (size / 8), y = y0 + size * 0.035, col = colours[i % colours.length];
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 0.05);
      halo.addColorStop(0, tint(col, 0, 0.55));
      halo.addColorStop(1, tint(col, 0, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - size * 0.05, y - size * 0.05, size * 0.1, size * 0.1);
      ctx.fillStyle = tint(col, 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.011, size * 0.017, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  void rand;
}

/** Zinc guttering: dull grey metal with seams and faint streaks. */
function zinc(ctx: Ctx, rand: () => number, size: number, base: string, seam: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  batch(ctx, tint(base, 0.12, 0.25), (c) => {
    for (let i = 0; i < 30; i++) {
      const x = rand() * size;
      c.moveTo(x, rand() * size * 0.3);
      c.lineTo(x + (rand() - 0.5) * 4, size);
    }
  }, 1.5);
  ctx.fillStyle = seam;
  for (let i = 0; i < 2; i++) ctx.fillRect(i * (size / 2), 0, size * 0.01, size);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, 0, size, size * 0.015); // the rolled top edge
}

/** Glow-in-the-dark star stickers on a dark board, a few peeling at a corner (these glow too). */
function sticker(ctx: Ctx, rand: () => number, size: number, base: string, glow: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const star = (x: number, y: number, r: number, a: number) => {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const ang = a + (k / 10) * Math.PI * 2, rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.fill();
  };
  for (let i = 0; i < 7; i++) {
    const x = size * (0.1 + rand() * 0.8), y = size * (0.1 + rand() * 0.8), r = size * (0.05 + rand() * 0.07), a = rand() * Math.PI;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
    halo.addColorStop(0, tint(glow, 0, 0.35));
    halo.addColorStop(1, tint(glow, 0, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.fillStyle = tint(glow, (rand() - 0.5) * 0.2);
    star(x, y, r, a);
    if (rand() < 0.35) {
      ctx.fillStyle = tint(base, 0.2); // a corner peeling up, showing the sticker's back
      star(x + r * 0.5, y - r * 0.5, r * 0.3, a);
    }
  }
  ctx.strokeStyle = tint(glow, -0.5, 0.4);
  ctx.lineWidth = size * 0.01;
  ctx.strokeRect(size * 0.005, size * 0.005, size * 0.99, size * 0.99);
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
    case 'counter': counter(ctx, rand, size, base, accent); break;
    case 'cookie': cookie(ctx, rand, size, base, accent); break;
    case 'wafer': wafer(ctx, rand, size, base, accent); break;
    case 'frosting': frosting(ctx, rand, size, base, accent); break;
    case 'chocolate': chocolate(ctx, rand, size, base, accent); break;
    case 'candycane': candycane(ctx, rand, size, base, accent); break;
    case 'frost': frost(ctx, rand, size, base, accent); break;
    case 'icecube': icecube(ctx, rand, size, base, accent); break;
    case 'peas': peas(ctx, rand, size, base, accent); break;
    case 'breaded': breaded(ctx, rand, size, base, accent); break;
    case 'rime': rime(ctx, rand, size, base, accent); break;
    case 'tray': tray(ctx, rand, size, base, accent); break;
    case 'thinice': thinice(ctx, rand, size, base, accent); break;
    case 'slate': slate(ctx, rand, size, base, accent); break;
    case 'moss': slate(ctx, rand, size, base, '#a9b6e0', accent); break;
    case 'ridge': ridge(ctx, rand, size, base, accent); break;
    case 'felt': felt(ctx, rand, size, base, accent); break;
    case 'brick': brick(ctx, rand, size, base, accent); break;
    case 'lights': lights(ctx, rand, size, base, accent); break;
    case 'zinc': zinc(ctx, rand, size, base, accent); break;
    case 'sticker': sticker(ctx, rand, size, base, accent); break;
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
  counter: 0.45, cookie: 0.85, wafer: 0.8, frosting: 0.4, chocolate: 0.35, candycane: 0.3,
  frost: 0.3, icecube: 0.12, peas: 0.6, breaded: 0.9, rime: 0.5, tray: 0.2, thinice: 0.15,
  slate: 0.55, moss: 0.8, ridge: 0.7, felt: 0.95, brick: 0.9, lights: 0.5, zinc: 0.45, sticker: 0.6,
};

/** These shine by themselves (fairy-light bulbs, glow-in-the-dark stickers): their texture is also their glow. */
const EMISSIVE: Partial<Record<Surface['kind'], number>> = { lights: 1, sticker: 0.9 };

/** Ice reflects the painted world (how much): the cheapest strong sign that a floor is ice. */
const GLOSS: Partial<Record<Surface['kind'], number>> = { frost: 0.2, icecube: 0.55, rime: 0.2, tray: 0.4, thinice: 0.5 };

/** What glossy surfaces reflect: the theme's painted sky (scene.ts sets it, as for the ball's glass). */
export const surfaceEnv: { map: THREE.Texture | null } = { map: null };

/** A material showing `surface`. `vertexColors`: geometry carries a colour attribute (side shading). */
export function surfaceMaterial(surface: Surface, { vertexColors = false, size = 512 } = {}): THREE.MeshStandardMaterial {
  const gloss = GLOSS[surface.kind], glow = EMISSIVE[surface.kind];
  const map = surfaceTexture(surface, size).clone();
  return new THREE.MeshStandardMaterial({
    map, roughness: ROUGHNESS[surface.kind], vertexColors,
    ...(gloss && surfaceEnv.map ? { envMap: surfaceEnv.map, envMapIntensity: gloss } : {}),
    ...(glow ? { emissive: '#ffffff', emissiveMap: map, emissiveIntensity: glow } : {}),
  });
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
