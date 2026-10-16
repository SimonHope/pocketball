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
  BACKDROPS[look.backdrop].overhead?.(ctx, W, H, look);
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
  BACKDROPS[look.backdrop].atSun?.(ctx, u * W, v * H, H, sky.sun);
  const set = BACKDROPS[look.backdrop];
  set.ground(ctx, W, H, look.ground.base, sky.horizon);
  if (look.aurora) paintAuroraBelow(ctx, W, H, look.aurora);
  paintGiants(ctx, W, H, set.draws, set.sizes, sky.horizon);
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

// ---------- Giant living-room things ----------

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
const CELL_W = 256, CELL_H = 512;

// The living room the "meadow" is really in: furniture towering past the rug, and the desk fan
// that makes the wind.
const LIVINGROOM: Draw[] = [
  // The sofa.
  (ctx, w, h) => {
    ctx.fillStyle = '#5f7f8f';
    ctx.beginPath();
    ctx.roundRect(8, h - 250, 240, 170, 26); // the back
    ctx.fill();
    ctx.fillStyle = '#6d8f9f';
    ctx.beginPath();
    ctx.roundRect(30, h - 150, 196, 80, 14); // the seat cushions
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(126, h - 150, 4, 80); // the seam between them
    ctx.fillStyle = '#56737f';
    for (const x of [0, 206]) {
      ctx.beginPath();
      ctx.roundRect(x, h - 190, 50, 140, 20); // the arms
      ctx.fill();
    }
    ctx.fillStyle = '#3d2c22';
    ctx.fillRect(24, h - 70, 12, 70); // the legs
    ctx.fillRect(220, h - 70, 12, 70);
    void w;
  },
  // A floor lamp, lit.
  (ctx, w, h) => {
    const glow = ctx.createRadialGradient(128, 130, 10, 128, 130, 120);
    glow.addColorStop(0, 'rgba(255,226,160,0.7)');
    glow.addColorStop(1, 'rgba(255,226,160,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(8, 10, 240, 240);
    ctx.fillStyle = '#f3e3c3';
    ctx.beginPath();
    ctx.moveTo(78, 60); ctx.lineTo(178, 60); ctx.lineTo(206, 160); ctx.lineTo(50, 160);
    ctx.fill();
    ctx.fillStyle = '#4a4038';
    ctx.fillRect(123, 160, 10, h - 180);
    ctx.beginPath();
    ctx.ellipse(128, h - 14, 60, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // The TV on a low cabinet.
  (ctx, w, h) => {
    ctx.fillStyle = '#8a6142';
    ctx.fillRect(10, h - 120, 236, 120);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(127, h - 110, 3, 100);
    ctx.fillStyle = '#1d2026';
    ctx.beginPath();
    ctx.roundRect(18, h - 290, 220, 150, 8);
    ctx.fill();
    ctx.fillStyle = '#3a4a6a'; // a dim screen with a sheen across it
    ctx.fillRect(28, h - 280, 200, 130);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(28, h - 280); ctx.lineTo(110, h - 280); ctx.lineTo(60, h - 150); ctx.lineTo(28, h - 150);
    ctx.fill();
    ctx.fillStyle = '#1d2026';
    ctx.fillRect(118, h - 140, 20, 20);
    void w;
  },
  // A bookshelf.
  (ctx, w, h) => {
    ctx.fillStyle = '#7a5236';
    ctx.fillRect(20, 20, 216, h - 20);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spines = ['#c0392b', '#2e6f9e', '#e0b13c', '#3f8f5a', '#8e5ea2', '#d9d0c0', '#c86b3c'];
    for (let shelf = 0; shelf < 5; shelf++) {
      const bottom = 20 + ((shelf + 1) * (h - 40)) / 5;
      ctx.fillStyle = '#5c3c26';
      ctx.fillRect(20, bottom, 216, 10);
      for (let x = 32; x < 222;) {
        const bw = 10 + rand() * 14, bh = 50 + rand() * 30;
        ctx.fillStyle = spines[Math.floor(rand() * spines.length)];
        ctx.fillRect(x, bottom - bh, Math.min(bw, 224 - x), bh);
        x += bw + 2;
      }
    }
    void w;
  },
  // A window with curtains: the real sky, outside.
  (ctx, w, h) => {
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(40, 60, 176, 260);
    const sky = ctx.createLinearGradient(0, 72, 0, 308);
    sky.addColorStop(0, '#7fb2e8');
    sky.addColorStop(1, '#d8ecff');
    ctx.fillStyle = sky;
    ctx.fillRect(52, 72, 152, 236);
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(124, 72, 8, 236);
    ctx.fillRect(52, 186, 152, 8);
    ctx.fillStyle = '#c96a5a';
    for (const x of [10, 186]) {
      ctx.beginPath();
      ctx.moveTo(x, 40); ctx.lineTo(x + 60, 40);
      ctx.quadraticCurveTo(x + 40, 200, x + 60, 360); ctx.lineTo(x, 360);
      ctx.fill();
    }
    ctx.fillStyle = '#5c3c26';
    ctx.fillRect(0, 34, 256, 10); // the curtain rail
    void w; void h;
  },
  // The desk fan: the wind on the "meadow".
  (ctx, w, h) => {
    ctx.fillStyle = '#dfe6ea';
    ctx.beginPath();
    ctx.ellipse(128, h - 16, 70, 16, 0, 0, Math.PI * 2); // the base
    ctx.fill();
    ctx.fillRect(120, h - 200, 16, 190); // the stand
    ctx.strokeStyle = '#cfd8dd';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, h - 300, 100, 0, Math.PI * 2); // the cage
    ctx.stroke();
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(128, h - 300);
      ctx.lineTo(128 + Math.cos(a) * 100, h - 300 + Math.sin(a) * 100);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(140,190,215,0.75)'; // the blades, blurred as they spin
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.ellipse(128 + Math.cos(a) * 48, h - 300 + Math.sin(a) * 48, 46, 24, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#dfe6ea';
    ctx.beginPath();
    ctx.arc(128, h - 300, 18, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // A houseplant: big leaves over a pot.
  (ctx, w, h) => {
    ctx.fillStyle = '#3f7f3a';
    for (const [x, y, a] of [[80, 200, -0.6], [176, 190, 0.6], [128, 130, 0], [60, 290, -1], [196, 280, 1], [128, 230, 0.2]] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, 34, 70, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#2f6a2c';
    ctx.lineWidth = 6;
    for (const [x, y] of [[80, 200], [176, 190], [128, 130], [60, 290], [196, 280]] as const) {
      ctx.beginPath();
      ctx.moveTo(128, h - 150);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#e6dccb';
    ctx.beginPath();
    ctx.moveTo(56, h - 160); ctx.lineTo(200, h - 160); ctx.lineTo(182, h); ctx.lineTo(74, h);
    ctx.fill();
    void w;
  },
  // An armchair.
  (ctx, w, h) => {
    ctx.fillStyle = '#b0703c';
    ctx.beginPath();
    ctx.roundRect(40, h - 300, 176, 220, 40);
    ctx.fill();
    ctx.fillStyle = '#c27f47';
    ctx.beginPath();
    ctx.roundRect(50, h - 150, 156, 70, 14);
    ctx.fill();
    ctx.fillStyle = '#9c6234';
    for (const x of [16, 196]) {
      ctx.beginPath();
      ctx.roundRect(x, h - 200, 44, 150, 18);
      ctx.fill();
    }
    ctx.fillStyle = '#3d2c22';
    ctx.fillRect(40, h - 50, 10, 50);
    ctx.fillRect(206, h - 50, 10, 50);
    void w;
  },
];

// ---------- Giant kitchen things ----------

const KITCHEN: Draw[] = [
  // A sweet jar: glass, a lid, and boiled sweets inside.
  (ctx, w, h) => {
    ctx.fillStyle = 'rgba(220,240,255,0.55)';
    ctx.beginPath();
    ctx.roundRect(36, h - 300, 184, 300, 40);
    ctx.fill();
    const sweets = ['#ff5d8f', '#ffd23f', '#5ec8ff', '#8ee07a', '#c58cff'];
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = sweets[i % sweets.length];
      ctx.beginPath();
      ctx.arc(64 + ((i * 37) % 130), h - 24 - Math.floor(i / 5) * 34 - (i % 2) * 10, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d9474b';
    ctx.beginPath();
    ctx.roundRect(46, h - 330, 164, 40, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(54, h - 280, 16, 240);
    void w;
  },
  // A kettle.
  (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d6';
    ctx.beginPath();
    ctx.moveTo(40, h);
    ctx.quadraticCurveTo(30, h - 230, 128, h - 240);
    ctx.quadraticCurveTo(226, h - 230, 216, h);
    ctx.fill();
    ctx.strokeStyle = '#3b3b44';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(128, h - 230, 70, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.fillStyle = '#e8e2d6';
    ctx.beginPath();
    ctx.moveTo(206, h - 90);
    ctx.lineTo(254, h - 170);
    ctx.lineTo(240, h - 180);
    ctx.lineTo(200, h - 130);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(66, h - 190, 16, 160);
    void w;
  },
  // A cereal box.
  (ctx, w, h) => {
    ctx.fillStyle = '#f2a33a';
    ctx.fillRect(46, h - 440, 164, 440);
    ctx.fillStyle = '#d9474b';
    ctx.fillRect(46, h - 440, 164, 70);
    ctx.fillStyle = '#fff6e8';
    ctx.beginPath();
    ctx.arc(128, h - 230, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c97a2a';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(108 + (i % 3) * 20, h - 240 + Math.floor(i / 3) * 20, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(176, h - 440, 34, 440);
    void w;
  },
  // A mug, with a curl of steam.
  (ctx, w, h) => {
    ctx.fillStyle = '#5b8fd6';
    ctx.beginPath();
    ctx.roundRect(50, h - 190, 130, 190, 14);
    ctx.fill();
    ctx.strokeStyle = '#5b8fd6';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(186, h - 100, 40, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 10;
    for (const x of [90, 135]) {
      ctx.beginPath();
      ctx.moveTo(x, h - 210);
      ctx.bezierCurveTo(x - 30, h - 260, x + 30, h - 300, x, h - 350);
      ctx.stroke();
    }
    void w;
  },
  // A stand mixer.
  (ctx, w, h) => {
    ctx.fillStyle = '#e8606b';
    ctx.beginPath();
    ctx.roundRect(30, h - 40, 196, 40, 10);
    ctx.fill();
    ctx.fillRect(40, h - 330, 56, 300);
    ctx.beginPath();
    ctx.roundRect(40, h - 360, 196, 90, 40);
    ctx.fill();
    ctx.fillStyle = '#d6d9de';
    ctx.beginPath();
    ctx.moveTo(110, h - 160);
    ctx.lineTo(230, h - 160);
    ctx.lineTo(214, h - 44);
    ctx.lineTo(126, h - 44);
    ctx.fill();
    void w;
  },
  // A milk bottle.
  (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf7';
    ctx.beginPath();
    ctx.moveTo(60, h);
    ctx.lineTo(60, h - 220);
    ctx.quadraticCurveTo(60, h - 290, 100, h - 330);
    ctx.lineTo(100, h - 400);
    ctx.lineTo(156, h - 400);
    ctx.lineTo(156, h - 330);
    ctx.quadraticCurveTo(196, h - 290, 196, h - 220);
    ctx.lineTo(196, h);
    ctx.fill();
    ctx.fillStyle = '#4f86d6';
    ctx.fillRect(96, h - 420, 64, 26);
    ctx.fillRect(60, h - 170, 136, 50);
    void w;
  },
  // A cake on a stand, with a cherry.
  (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d6';
    ctx.fillRect(110, h - 80, 36, 80);
    ctx.fillRect(40, h - 92, 176, 14);
    ctx.fillStyle = '#f7c6d9';
    ctx.beginPath();
    ctx.roundRect(56, h - 230, 144, 140, 12);
    ctx.fill();
    ctx.fillStyle = '#fff6f0';
    ctx.fillRect(56, h - 170, 144, 16);
    ctx.beginPath();
    ctx.roundRect(52, h - 244, 152, 30, 14);
    ctx.fill();
    ctx.fillStyle = '#d9233b';
    ctx.beginPath();
    ctx.arc(128, h - 262, 18, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // A toaster, a slice of toast popping up.
  (ctx, w, h) => {
    ctx.fillStyle = '#e2b25c';
    ctx.beginPath();
    ctx.roundRect(70, h - 250, 116, 90, 14);
    ctx.fill();
    ctx.fillStyle = '#c9cdd4';
    ctx.beginPath();
    ctx.roundRect(30, h - 190, 196, 190, 30);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(46, h - 170, 18, 150);
    ctx.fillStyle = '#3b3b44';
    ctx.fillRect(204, h - 120, 18, 40);
    void w;
  },
];

// ---------- Giant freezer things ----------

const FREEZER: Draw[] = [
  // The fridge itself shows through: a milk bottle in the door, glowing in the fridge light.
  (ctx, w, h) => {
    const glow = ctx.createRadialGradient(128, h - 200, 10, 128, h - 200, 150);
    glow.addColorStop(0, 'rgba(255,248,220,0.55)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, h - 360, 256, 360);
    ctx.fillStyle = '#fbfbf6';
    ctx.beginPath();
    ctx.moveTo(98, h - 380); ctx.lineTo(158, h - 380); ctx.lineTo(158, h - 330);
    ctx.quadraticCurveTo(200, h - 290, 196, h - 240); ctx.lineTo(196, h);
    ctx.lineTo(60, h); ctx.lineTo(60, h - 240);
    ctx.quadraticCurveTo(56, h - 290, 98, h - 330);
    ctx.fill();
    ctx.fillStyle = '#3a7bd5'; // the cap and the label
    ctx.fillRect(94, h - 400, 68, 24);
    ctx.fillRect(60, h - 170, 136, 60);
    void w;
  },
  // An egg box, its lid up.
  (ctx, w, h) => {
    ctx.fillStyle = '#c9b48f';
    ctx.fillRect(20, h - 90, 216, 90);
    ctx.beginPath();
    ctx.moveTo(20, h - 90); ctx.lineTo(40, h - 230); ctx.lineTo(216, h - 230); ctx.lineTo(236, h - 90);
    ctx.fill();
    ctx.fillStyle = '#b39d78';
    ctx.fillRect(40, h - 230, 176, 16);
    ctx.fillStyle = '#f3e3cc';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(62 + i * 66, h - 110, 26, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    void w;
  },
  // A tub of ice cream, its lid frosted.
  (ctx, w, h) => {
    ctx.fillStyle = '#f7efe2';
    ctx.beginPath();
    ctx.moveTo(30, h - 230);
    ctx.lineTo(226, h - 230);
    ctx.lineTo(206, h);
    ctx.lineTo(50, h);
    ctx.fill();
    ctx.fillStyle = '#e8607a';
    ctx.fillRect(40, h - 160, 176, 70);
    ctx.fillStyle = '#6b3a24';
    ctx.fillRect(40, h - 90, 172, 16);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(22, h - 252, 212, 30, 10);
    ctx.fill();
    void w;
  },
  // A bag of frozen peas, crumpled at the top.
  (ctx, w, h) => {
    ctx.fillStyle = '#3f9a4a';
    ctx.beginPath();
    ctx.moveTo(40, h);
    ctx.quadraticCurveTo(26, h - 200, 56, h - 330);
    ctx.lineTo(80, h - 350);
    ctx.lineTo(110, h - 330);
    ctx.lineTo(140, h - 355);
    ctx.lineTo(170, h - 328);
    ctx.lineTo(200, h - 345);
    ctx.quadraticCurveTo(232, h - 200, 216, h);
    ctx.fill();
    ctx.fillStyle = '#8fd96a';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(96 + (i % 3) * 32, h - 190 + Math.floor(i / 3) * 30, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(60, h - 300, 14, 260);
    void w;
  },
  // An ice-cube tray stood on end.
  (ctx, w, h) => {
    ctx.fillStyle = '#7fc8e8';
    ctx.beginPath();
    ctx.roundRect(66, h - 460, 124, 460, 12);
    ctx.fill();
    ctx.fillStyle = '#d9f1fb';
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 2; c++) {
        ctx.beginPath();
        ctx.roundRect(78 + c * 56, h - 448 + r * 64, 44, 52, 8);
        ctx.fill();
      }
    }
    void w;
  },
  // A stack of ice cubes.
  (ctx, w, h) => {
    for (const [x, y, s, a] of [[40, 0, 110, -0.05], [140, 0, 100, 0.08], [80, 105, 105, 0.12], [110, 205, 90, -0.1]] as const) {
      ctx.save();
      ctx.translate(x + s / 2, h - y - s / 2);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(200,232,250,0.8)';
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s / 2, s, s, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-s / 2 + 12, -s / 2 + 10, s * 0.5, 10);
      ctx.restore();
    }
    void w;
  },
  // A box of fish fingers.
  (ctx, w, h) => {
    ctx.fillStyle = '#2f6fc0';
    ctx.fillRect(28, h - 200, 200, 200);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(28, h - 200, 200, 40);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#e9a44c';
      ctx.beginPath();
      ctx.roundRect(56, h - 140 + i * 36, 144, 26, 8);
      ctx.fill();
    }
    void w;
  },
  // A rocket ice lolly on its stick.
  (ctx, w, h) => {
    ctx.fillStyle = '#e9cf9a';
    ctx.fillRect(114, h - 120, 28, 120);
    for (const [y0, y1, c] of [[h - 220, h - 120, '#ff5a4f'], [h - 300, h - 220, '#fff3d6'], [h - 380, h - 300, '#ffb02e']] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(70, y0, 116, y1 - y0, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.moveTo(70, h - 370);
    ctx.lineTo(128, h - 460);
    ctx.lineTo(186, h - 370);
    ctx.fill();
    void w;
  },
  // A frozen pizza box, lying flat.
  (ctx, w, h) => {
    ctx.fillStyle = '#d9473b';
    ctx.fillRect(10, h - 70, 236, 70);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.ellipse(128, h - 35, 70, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // A cone with a scoop.
  (ctx, w, h) => {
    ctx.fillStyle = '#e2b072';
    ctx.beginPath();
    ctx.moveTo(78, h - 220);
    ctx.lineTo(178, h - 220);
    ctx.lineTo(128, h);
    ctx.fill();
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath();
    ctx.arc(128, h - 245, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb3c7';
    ctx.beginPath();
    ctx.arc(128, h - 320, 50, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
];

/**
 * The freezer's ceiling: frosted plastic overhead, ending in a frosty lip with icicles hanging
 * off it, all the way around (painted into the sky, so it costs nothing to draw).
 */
function paintCeiling(ctx: CanvasRenderingContext2D, W: number, H: number, { sky: { top } }: Look) {
  const lip = H * 0.15; // high overhead, above the tallest giants
  const g = ctx.createLinearGradient(0, 0, 0, lip);
  g.addColorStop(0, shade(top, 0.35));
  g.addColorStop(1, shade(top, 0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, lip);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, lip - H * 0.012, W, H * 0.02);
  for (let x = 0; x < W; x += 6 + rand() * 18) {
    const len = H * (0.01 + rand() * rand() * 0.07), wd = 4 + rand() * 9;
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '235,247,255' : '214,236,250'},0.9)`;
    ctx.beginPath();
    ctx.moveTo(x - wd / 2, lip);
    ctx.lineTo(x + wd / 2, lip);
    ctx.lineTo(x + (rand() - 0.5) * 2, lip + len);
    ctx.fill();
  }
}

/** The lower half for the freezer: a frosted shelf far below, with the bars of a wire rack. */
function paintRack(ctx: CanvasRenderingContext2D, W: number, H: number, frost: string, haze: string) {
  const top = H / 2;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, haze);
  g.addColorStop(0.12, frost);
  g.addColorStop(1, shade(frost, -0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  // Faint bars near the horizon only: further down they'd circle the view like a bowl.
  for (let i = 1; i < 6; i++) {
    const y = top + H * 0.05 * Math.pow(i / 3, 1.35);
    ctx.fillStyle = `rgba(255,255,255,${0.05 * Math.min(1, i / 3)})`;
    ctx.fillRect(0, y, W, 2 + i * 0.5);
  }
}

// ---------- The city on a heavenly night ----------

const ROOF = '#161634', LIT = 'rgba(255,207,122,0.55)';
const litWindow = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = LIT;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ROOF;
  ctx.fillRect(x + w / 2 - 2, y, 4, h); // the window bars
  ctx.fillRect(x, y + h / 2 - 2, w, 4);
};
/** A block of the city: a dark tower from `top` down, its windows lit here and there. */
const tower = (ctx: CanvasRenderingContext2D, x: number, top: number, w: number, h: number, seed: number) => {
  ctx.fillStyle = ROOF;
  ctx.fillRect(x, top, w, h - top);
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = LIT;
  for (let y = top + 14; y < h - 14; y += 22) {
    for (let wx = x + 10; wx < x + w - 14; wx += 18) if (rand() < 0.35) ctx.fillRect(wx, y, 8, 11);
  }
};
/** A glowing mushroom, soft at the edges: the ones along the course, grown huge in the distance. */
const glowCap = (ctx: CanvasRenderingContext2D, x: number, foot: number, size: number, colour: string) => {
  ctx.fillStyle = '#d9d4ea';
  ctx.fillRect(x - size * 0.12, foot - size, size * 0.24, size);
  const g = ctx.createRadialGradient(x, foot - size, 0, x, foot - size, size * 0.9);
  g.addColorStop(0, hexAlpha(colour, 0.5));
  g.addColorStop(1, hexAlpha(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - size, foot - size * 1.9, size * 2, size * 1.8);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, foot - size, size * 0.55, size * 0.32, 0, Math.PI, 0);
  ctx.fill();
};

const CITY: Draw[] = [
  // A tower block.
  (ctx, _w, h) => tower(ctx, 40, 90, 176, h, 3),
  // A skyscraper with an aerial and its red light.
  (ctx, w, h) => {
    tower(ctx, 70, 60, 116, h, 9);
    ctx.fillStyle = ROOF;
    ctx.fillRect(124, 0, 8, 60);
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath();
    ctx.arc(128, 6, 6, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // Offices that step in towards the top.
  (ctx, w, h) => {
    tower(ctx, 20, 240, 216, h, 17);
    tower(ctx, 50, 150, 156, 260, 21);
    tower(ctx, 86, 80, 84, 170, 27);
    void w;
  },
  // A cluster of glowing mushrooms.
  (ctx, w, h) => {
    glowCap(ctx, 80, h, 150, '#7ff0c8');
    glowCap(ctx, 170, h, 110, '#ff9fd8');
    glowCap(ctx, 128, h, 70, '#9fb8ff');
    void w;
  },
  // A chimney stack with two pots: the roofs close by.
  (ctx, w, h) => {
    ctx.fillStyle = ROOF;
    ctx.fillRect(70, h - 300, 116, 300);
    ctx.fillRect(62, h - 312, 132, 18);
    ctx.fillRect(80, h - 360, 34, 50);
    ctx.fillRect(142, h - 350, 34, 40);
    void w;
  },
  // A house end with a pitched roof and two lit windows.
  (ctx, w, h) => {
    ctx.fillStyle = ROOF;
    ctx.beginPath();
    ctx.moveTo(10, h);
    ctx.lineTo(10, h - 220);
    ctx.lineTo(128, h - 330);
    ctx.lineTo(246, h - 220);
    ctx.lineTo(246, h);
    ctx.fill();
    litWindow(ctx, 50, h - 180, 50, 60);
    litWindow(ctx, 150, h - 110, 50, 60);
    void w;
  },
  // A clock tower.
  (ctx, w, h) => {
    ctx.fillStyle = ROOF;
    ctx.fillRect(84, h - 330, 88, 330);
    ctx.beginPath();
    ctx.moveTo(78, h - 330); ctx.lineTo(128, h - 470); ctx.lineTo(178, h - 330);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,190,0.75)';
    ctx.beginPath();
    ctx.arc(128, h - 280, 26, 0, Math.PI * 2);
    ctx.fill();
    void w;
  },
  // One tall glowing mushroom.
  (ctx, w, h) => {
    glowCap(ctx, 128, h, 190, '#7ff0c8');
    void w;
  },
];

/** The night sky: stars by the thousand, the Milky Way, a few bright ones with glints, and a faint aurora. */
function paintNightSky(ctx: CanvasRenderingContext2D, W: number, H: number, look: Look) {
  const [hem, mid] = look.aurora ?? ['#4dff9e', '#12b98c'];
  let seed = 23;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const top = H * 0.48; // stars stop just above the horizon haze
  // The Milky Way: a soft band, dense with faint stars.
  const band = (x: number) => H * (0.24 + 0.1 * Math.sin((x / W) * Math.PI * 2 + 1));
  for (let i = 0; i < 260; i++) {
    const x = rand() * W, y = band(x) + (rand() - 0.5) * H * 0.08, r = H * (0.02 + rand() * 0.04);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rand() < 0.5 ? '200,190,255' : '170,210,255'},0.07)`);
    g.addColorStop(1, 'rgba(180,190,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(235,235,255,0.55)';
  ctx.beginPath();
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W, y = band(x) + (rand() + rand() - 1) * H * 0.07, r = 0.4 + rand() * 0.8;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  // Stars everywhere, brighter ones fewer.
  for (const [n, r, a] of [[2200, 0.8, 0.55], [500, 1.3, 0.8], [90, 2, 1]] as const) {
    ctx.fillStyle = `rgba(255,250,240,${a})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * top * (0.2 + 0.8 * Math.sqrt(rand()));
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // A few bright stars with a four-point glint.
  ctx.strokeStyle = 'rgba(255,248,225,0.7)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 28; i++) {
    const x = rand() * W, y = rand() * top * 0.85, l = 5 + rand() * 7;
    ctx.beginPath();
    ctx.moveTo(x - l, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x, y - l); ctx.lineTo(x, y + l);
    ctx.stroke();
  }
  // A faint aurora low in the sky, for the low graphics setting (the live one moves in front of it).
  for (let i = 0; i < 600; i++) {
    const x = rand() * W;
    const strength = Math.max(0, Math.sin((x / W) * Math.PI * 6 + 0.7)) * Math.max(0, Math.sin((x / W) * Math.PI * 2));
    if (strength < 0.1) continue;
    const foot = H * (0.4 + 0.03 * Math.sin((x / W) * Math.PI * 14)), len = H * (0.06 + rand() * 0.1);
    const g = ctx.createLinearGradient(0, foot, 0, foot - len);
    g.addColorStop(0, hexAlpha(hem, 0.08 * strength));
    g.addColorStop(0.5, hexAlpha(mid, 0.05 * strength));
    g.addColorStop(1, hexAlpha(mid, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, foot - len, 3, len);
  }
}

/**
 * The aurora's glow below the horizon, as if lighting the haze far beneath you: only soft
 * shapes, painted at a sixteenth of the sky's size and scaled up, so it's a blur.
 */
function paintAuroraBelow(sky: CanvasRenderingContext2D, W: number, H: number, [hem, mid, top]: [string, string, string]) {
  const S = 16, w = W / S, h = H / S;
  const [layer, ctx] = paintCanvas(w, h);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const strength = Math.max(0, Math.sin(u * Math.PI * 6 + 0.7)) * (0.5 + 0.5 * Math.max(0, Math.sin(u * Math.PI * 2))) + 0.15;
    const foot = h * 0.5, len = h * (0.12 + 0.1 * Math.sin(u * Math.PI * 10) ** 2) * strength;
    const g = ctx.createLinearGradient(0, foot, 0, foot + len);
    g.addColorStop(0, hexAlpha(hem, 0.3 * strength));
    g.addColorStop(0.35, hexAlpha(mid, 0.22 * strength));
    g.addColorStop(1, hexAlpha(top, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, foot, 1, len);
  }
  sky.save();
  sky.globalCompositeOperation = 'lighter'; // it glows over the stars and the town
  sky.imageSmoothingQuality = 'high';
  sky.drawImage(layer, 0, 0, W, H);
  sky.restore();
}

/** The moon where the sun's glow is: a pale disc with soft grey seas. */
function paintMoon(ctx: CanvasRenderingContext2D, x: number, y: number, H: number, color: string) {
  const r = H * 0.028;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,160,190,0.35)';
  for (const [dx, dy, rr] of [[-0.3, -0.2, 0.28], [0.25, 0.1, 0.22], [-0.05, 0.4, 0.18]] as const) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The lower half at night: you're up among the stars, so they carry on below the horizon (dimmer,
 * thinning out), over a far-off town whose lights are pinpricks near the horizon.
 */
function paintStreet(ctx: CanvasRenderingContext2D, W: number, H: number, ground: string, haze: string) {
  const top = H / 2;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, haze);
  g.addColorStop(0.1, ground);
  g.addColorStop(1, shade(ground, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  let seed = 5;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [n, r, a] of [[1400, 0.8, 0.4], [250, 1.2, 0.6]] as const) {
    ctx.fillStyle = `rgba(235,235,255,${a})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = top + H * 0.06 + (H / 2) * Math.pow(rand(), 1.6) * 0.9;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // The town: clusters of tiny warm lights just below the horizon.
  ctx.fillStyle = 'rgba(255,205,130,0.75)';
  ctx.beginPath();
  for (let c = 0; c < 40; c++) {
    const cx = rand() * W, cy = top + H * (0.012 + rand() * 0.03);
    for (let i = 0; i < 12; i++) {
      const x = cx + (rand() - 0.5) * W * 0.02, y = cy + (rand() - 0.5) * H * 0.006, r = 0.6 + rand() * 0.8;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** The lower half for the kitchen: the floor far below, big tiles with grout, fading into the haze. */
function paintTiles(ctx: CanvasRenderingContext2D, W: number, H: number, tile: string, haze: string) {
  const top = H / 2;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, haze);
  g.addColorStop(0.12, tile);
  g.addColorStop(1, shade(tile, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  // Faint grout rows, further apart away from the horizon (columns would meet at a point straight
  // below, which reads as a bowl rather than a floor).
  for (let i = 1; i < 12; i++) {
    const y = top + H * 0.06 * Math.pow(i / 3, 1.4);
    if (y > H) break;
    ctx.fillStyle = `rgba(80,40,20,${0.05 * Math.min(1, i / 3)})`;
    ctx.fillRect(0, y, W, 2 + i * 0.4);
  }
}

/**
 * The lower half for the living room: the big green rug far below (the "meadow" you're on),
 * its fringe of shag in stripes, and the floorboards past its edge near the horizon.
 */
function paintGround(ctx: CanvasRenderingContext2D, W: number, H: number, rug: string, haze: string) {
  const top = H / 2;
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, haze);
  g.addColorStop(0.06, '#a8784c'); // floorboards, out past the rug
  g.addColorStop(0.11, rug);
  g.addColorStop(1, shade(rug, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  // The rug's pile, brushed in bands that fade out near its edge.
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
type Sizes = [scale: number, weight: number][];
const LIVINGROOM_SIZES: Sizes = [[0.6, 3], [0.95, 2], [0.55, 2], [1, 3], [0.8, 2], [0.75, 3], [0.7, 2], [0.6, 2]];
const KITCHEN_SIZES: Sizes = [[0.75, 3], [0.6, 2], [1, 2], [0.5, 3], [0.85, 2], [0.9, 2], [0.65, 2], [0.5, 2]];
const FREEZER_SIZES: Sizes = [[0.75, 2], [0.4, 2], [0.6, 3], [0.8, 3], [1, 2], [0.65, 3], [0.55, 2], [0.95, 2], [0.4, 2], [0.85, 2]];
// Low, so the sky (stars, the Milky Way, the aurora) has room above them: the city is far below.
const CITY_SIZES: Sizes = [[0.45, 4], [0.6, 2], [0.45, 3], [0.3, 2], [0.3, 2], [0.3, 2], [0.5, 1], [0.38, 2]];

/**
 * Each look's giants and the floor far below; `overhead`: painted over the sky's gradient (the
 * freezer's ceiling, the night's stars); `atSun`: painted at the sun (the moon).
 */
const BACKDROPS: Record<Look['backdrop'], {
  draws: Draw[]; sizes: Sizes; ground: typeof paintGround;
  overhead?: (ctx: CanvasRenderingContext2D, W: number, H: number, look: Look) => void;
  atSun?: typeof paintMoon;
}> = {
  livingroom: { draws: LIVINGROOM, sizes: LIVINGROOM_SIZES, ground: paintGround },
  kitchen: { draws: KITCHEN, sizes: KITCHEN_SIZES, ground: paintTiles },
  freezer: { draws: FREEZER, sizes: FREEZER_SIZES, ground: paintRack, overhead: paintCeiling },
  city: { draws: CITY, sizes: CITY_SIZES, ground: paintStreet, overhead: paintNightSky, atSun: paintMoon },
};

/**
 * Giants all the way around the horizon of an equirectangular sky (x = direction, y = height),
 * hazed towards the horizon colour, the far row more. They're painted at a quarter of the sky's
 * resolution and scaled up, which softens them like a blur (a canvas blur filter is slow on
 * some devices). Their feet sit just below the horizon, where the far ground fades into the haze.
 */
function paintGiants(sky: CanvasRenderingContext2D, W: number, H: number, draws: Draw[], sizes: Sizes, haze: string) {
  const SCALE = 4;
  const [layer, ctx] = paintCanvas(W / SCALE, H / SCALE);
  ctx.scale(1 / SCALE, 1 / SCALE);
  const [cell, cx] = paintCanvas(CELL_W, CELL_H);
  const kinds = sizes.flatMap(([, n], i) => Array<number>(n).fill(i));
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const horizon = H / 2;
  // Two rows: far (small, hazy) behind near (bigger, clearer).
  for (const [row, count, size, hazeAmount] of [[0, 34, 0.17, 0.55], [1, 22, 0.3, 0.3]] as const) {
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const h = H * size * sizes[kind][0] * (0.75 + rand() * 0.5);
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

  /** `fall`: drift down, a little faster (frost flakes) instead of rising in the light; `blow`: and sideways this fast (a blizzard). */
  constructor(color: string, count: number, fall = false, blow = 0) {
    const pos = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = (Math.random() - 0.5) * Motes.SPAN[k];
      const up = fall ? -(0.4 + Math.random() * 0.6) : 0.1 + Math.random() * 0.3;
      this.velocities.set([(Math.random() - 0.5) * 0.6 + blow * (0.7 + Math.random() * 0.6), up, (Math.random() - 0.5) * 0.6], i * 3);
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
      // Flakes are drawn plainly: added light would vanish against a pale freezer.
      color, size: fall ? 0.3 : 0.22, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false,
      blending: fall ? THREE.NormalBlending : THREE.AdditiveBlending, opacity: fall ? 0.85 : 0.5,
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

const AURORA_VERTEX = /* glsl */ `
  attribute float seed;
  attribute float soft;
  uniform float time;
  varying vec2 vUv;
  varying float vSeed;
  varying float vSoft;
  void main() {
    vUv = uv;
    vSeed = seed;
    vSoft = soft;
    vec3 p = position;
    // The curtain sways in and out, and its hem ripples.
    p.xz *= 1.0 + 0.07 * sin(uv.x * 7.0 + time * 0.13 + seed);
    p.y += sin(uv.x * 11.0 + time * 0.21 + seed * 2.0) * 7.0 * (1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const AURORA_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform vec3 hem;
  uniform vec3 mid;
  uniform vec3 top;
  varying vec2 vUv;
  varying float vSeed;
  varying float vSoft;
  void main() {
    float x = vUv.x, y = vUv.y;
    // Rays: fine vertical streaks drifting along the curtain, gathered into brighter folds.
    float rays = 0.55 + 0.45 * sin(x * 140.0 + sin(x * 13.0 + time * 0.35 + vSeed) * 5.0 + time * 0.5);
    float folds = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(x * 21.0 - time * 0.22 + vSeed * 3.0), 2.0);
    float fade = smoothstep(0.0, 0.1, y) * pow(1.0 - y, 1.4) * smoothstep(0.0, 0.15, x) * smoothstep(1.0, 0.85, x);
    // The glow below the horizon: no rays, broad slow folds, faint and fading fast (a blur).
    float softFolds = 0.4 + 0.6 * (0.5 + 0.5 * sin(x * 6.0 - time * 0.15 + vSeed * 3.0));
    float softFade = smoothstep(0.0, 0.3, y) * pow(1.0 - y, 2.0) * smoothstep(0.0, 0.3, x) * smoothstep(1.0, 0.7, x);
    float alpha = mix(rays * folds * fade, softFolds * softFade * 0.45, vSoft);
    vec3 color = y < 0.35 ? mix(hem, mid, y / 0.35) : mix(mid, top, (y - 0.35) / 0.65);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Aurora curtains on a wide ring around the ball, swaying and shimmering: one mesh, one draw
 * call, drawn as added light and never fogged. Hidden on the low graphics setting (the sky has
 * a painted one).
 */
export class Aurora {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor([hem, mid, top]: [string, string, string]) {
    // Low enough to sit in a chase camera's view (it looks a little down), from the horizon up.
    const R = 200, base = -5, height = 105, segs = 48;
    const pos: number[] = [], uvs: number[] = [], seeds: number[] = [], softs: number[] = [], index: number[] = [];
    // Four curtains at different bearings and sizes, so there's one in most views, each with a
    // soft glow hanging below the horizon under it (`soft`: drawn as a blur, growing downwards).
    const curtains = [[0.2, 1.3, 1, 0.3], [2.1, 1.0, 0.8, 1.7], [3.4, 1.4, 1.1, 2.9], [5.0, 0.9, 0.7, 4.1]];
    for (const [start, span, scale, seed, soft] of [...curtains.map((c) => [...c, 0]), ...curtains.map((c) => [...c, 1])]) {
      const first = pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, a = start + span * t, r = R * (1 + 0.08 * Math.sin(t * 5 + seed));
        for (const v of [0, 1]) {
          pos.push(Math.cos(a) * r, base + (soft ? -v * 0.9 : v) * height * scale, Math.sin(a) * r);
          uvs.push(t, v);
          seeds.push(seed);
          softs.push(soft);
        }
      }
      for (let i = 0; i < segs; i++) {
        const k = first + i * 2;
        index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    geometry.setAttribute('soft', new THREE.Float32BufferAttribute(softs, 1));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, hem: { value: new THREE.Color(hem) }, mid: { value: new THREE.Color(mid) }, top: { value: new THREE.Color(top) } },
      vertexShader: AURORA_VERTEX,
      fragmentShader: AURORA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Follow the ball (so the curtains stay far off all round) and shimmer. */
  update(center: Vec3, dt: number) {
    this.mesh.visible = Motes.enabled;
    if (!Motes.enabled) return;
    this.mesh.position.set(center[0], center[1], center[2]);
    this.mesh.material.uniforms.time.value += dt;
  }
}

/** A look's living scenery: specks in the air and (some looks) an aurora. Updated every frame. */
export interface Scenery { update(center: Vec3, dt: number): void }

/** Scenery for a theme's look (the caller moves it; it hides itself on the low graphics setting). */
export function addScenery(group: THREE.Object3D, look: Look): Scenery {
  const motes = new Motes(look.motes.color, look.motes.count, look.motes.fall, look.motes.blow);
  group.add(motes.points);
  const aurora = look.aurora ? new Aurora(look.aurora) : null;
  if (aurora) group.add(aurora.mesh);
  return {
    update(center, dt) {
      motes.update(center, dt);
      aurora?.update(center, dt);
    },
  };
}
