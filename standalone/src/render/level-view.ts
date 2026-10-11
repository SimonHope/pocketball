import * as THREE from 'three';
import type { Vec3 } from '../sim/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GUARD_COLOR, type Palette } from '../levels/schema';
import { THEMES, type Look, type Surface, type Theme } from '../levels/themes';
import { scaleBoxUVs, surfaceMaterial, surfaceTexture } from './surfaces';
import { poseAt, starAt, travelAt, type ResolvedLevel, type Solid, type StarMarker, type Volume } from '../sim/geometry';
import type { Simulation } from '../sim/simulation';

// Builds meshes for every solid in a resolved level and keeps moving ones in sync with
// the simulation. Also draws checkpoints, stars and the goal. In the game, static boxes are merged
// into one mesh per floor palette and per wall colour (a curvy course has hundreds of pieces);
// the editor keeps one mesh per solid so clicks map back to pieces.


const CHECKPOINT_IDLE = '#3a86ff';
const CHECKPOINT_DONE = '#2ecc71';

/** A chunky five-pointed star, centred on the origin, facing +z. */
function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 0.95;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 });
  geometry.center();
  return geometry;
}

/** A soft white glow behind each star, so it stands out against yellow arms and gold floors. */
function haloTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,240,180,0.45)');
  g.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface StarView {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  halo: THREE.Sprite;
  star: StarMarker;
  /** Where it was when collected (riding stars move); the burst rises from here. */
  base: Vec3;
  /** 0 while waiting; counts up to 1 as it bursts after being collected. */
  burst: number;
  collected: boolean;
  /** Switch stars: the button on the floor. */
  button?: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
}

const BUTTON_OFF = '#e63946';
const BUTTON_ON = '#ffd60a';

function checkerTexture(a: string, b: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// One checker canvas per color pair; floors clone it (clones share the image, so it's
// uploaded to the GPU once) and only change the repeat.
const checkerCache = new Map<string, THREE.CanvasTexture>();

function floorMaterials(theme: Theme, palette: Palette, size: [number, number, number]): THREE.Material[] {
  if (theme.look) {
    // The geometry carries world-scaled UVs and side shading (see solidMesh).
    const top = surfaceMaterial(theme.look.floors[palette]);
    const sideMat = surfaceMaterial(theme.look.sides[palette], { vertexColors: true, size: 256 });
    return [sideMat, sideMat, top, sideMat, sideMat, sideMat];
  }
  const [a, b, side] = theme.palettes[palette];
  let base = checkerCache.get(a + b);
  if (!base) checkerCache.set(a + b, (base = checkerTexture(a, b)));
  const tex = base.clone();
  tex.repeat.set(size[0] / 4, size[2] / 4); // one checker tile = 4x4 units
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.9 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  return [sideMat, sideMat, top, sideMat, sideMat, sideMat];
}

/** The faces of a box with the given material index (BoxGeometry face order: +x, -x, +y, -y, +z, -z). */
function boxFaces(box: THREE.BoxGeometry, keep: (materialIndex: number) => boolean): THREE.BufferGeometry {
  const index = box.index!.array;
  const kept: number[] = [];
  for (const g of box.groups) if (keep(g.materialIndex ?? 0)) for (let i = g.start; i < g.start + g.count; i++) kept.push(index[i]);
  const geo = box.clone();
  geo.setIndex(kept);
  geo.clearGroups();
  return geo;
}

/** The generator's stock colours, and what they're made of in a theme with a look. */
const RAIL = '#f4f4f4', POST = '#444a55', PLAIN = '#b8bfcc'; // PLAIN: blocks with no colour of their own
function roleSurface(look: Look, color: string | undefined): Surface | null {
  if (color === RAIL) return look.rail;
  if (color === GUARD_COLOR) return look.guard;
  if (color && color !== POST && color !== PLAIN) return wallSurface(look, color);
  return null;
}

// One Surface object per wall colour, so walls of the same colour merge into one mesh.
const wallSurfaces = new Map<string, Surface>();
function wallSurface(look: Look, color: string): Surface {
  const key = `${look.wall}:${color}`;
  let s = wallSurfaces.get(key);
  if (!s) wallSurfaces.set(key, (s = { kind: look.wall, base: color, accent: color }));
  return s;
}

/**
 * Static boxes merged by look: floors (top + sides) per palette, walls and rails per colour or
 * surface. With a theme look, sweeper pivots become wooden spools (one merged mesh too).
 */
function mergedStatics(solids: Solid[], theme: Theme): THREE.Mesh[] {
  const look = theme.look;
  const floors = new Map<Palette, { tops: THREE.BufferGeometry[]; sides: THREE.BufferGeometry[] }>();
  const colored = new Map<string, THREE.BufferGeometry[]>();
  const surfaced = new Map<Surface, THREE.BufferGeometry[]>();
  const spools: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  for (const solid of solids) {
    if (solid.shape.kind !== 'box') continue;
    const size = solid.shape.size;
    const box = new THREE.BoxGeometry(...size);
    matrix.compose(new THREE.Vector3(...solid.position), new THREE.Quaternion(...solid.rotation), new THREE.Vector3(1, 1, 1));
    // World-scaled UVs (one texture tile = 4×4 units), so every floor shares one texture.
    scaleBoxUVs(box, size, { shade: !!look });
    if (solid.palette) {
      const group = floors.get(solid.palette) ?? { tops: [], sides: [] };
      const top = boxFaces(box, (m) => m === 2);
      if (look) top.deleteAttribute('color');
      group.tops.push(top.applyMatrix4(matrix));
      group.sides.push(boxFaces(box, (m) => m !== 2).applyMatrix4(matrix));
      floors.set(solid.palette, group);
    } else if (look && solid.color === POST) {
      spools.push(spoolGeometry(size).applyMatrix4(matrix));
    } else {
      const surface = look && roleSurface(look, solid.color);
      if (surface) {
        surfaced.set(surface, [...(surfaced.get(surface) ?? []), box.applyMatrix4(matrix)]);
        continue;
      }
      if (look) box.deleteAttribute('color');
      const key = solid.color ?? '#cccccc';
      colored.set(key, [...(colored.get(key) ?? []), box.applyMatrix4(matrix)]);
      continue;
    }
    box.dispose();
  }
  const meshes: THREE.Mesh[] = [];
  for (const [palette, { tops, sides }] of floors) {
    if (look) {
      meshes.push(
        new THREE.Mesh(mergeGeometries(tops), surfaceMaterial(look.floors[palette])),
        new THREE.Mesh(mergeGeometries(sides), surfaceMaterial(look.sides[palette], { vertexColors: true, size: 256 })),
      );
    } else {
      const [a, b, side] = theme.palettes[palette];
      let base = checkerCache.get(a + b);
      if (!base) checkerCache.set(a + b, (base = checkerTexture(a, b)));
      meshes.push(
        new THREE.Mesh(mergeGeometries(tops), new THREE.MeshStandardMaterial({ map: base.clone(), roughness: 0.8 })),
        new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ color: side, roughness: 0.9 })),
      );
    }
    [...tops, ...sides].forEach((g) => g.dispose());
  }
  for (const [surface, boxes] of surfaced) {
    meshes.push(new THREE.Mesh(mergeGeometries(boxes), surfaceMaterial(surface, { vertexColors: true, size: 256 })));
    boxes.forEach((g) => g.dispose());
  }
  for (const [color, boxes] of colored) {
    meshes.push(new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })));
    boxes.forEach((g) => g.dispose());
  }
  if (look && spools.length) {
    meshes.push(new THREE.Mesh(mergeGeometries(spools), new THREE.MeshStandardMaterial({ color: look.post, roughness: 0.8 })));
    spools.forEach((g) => g.dispose());
  }
  return meshes;
}

/** A wooden cotton spool standing where a sweeper's pivot box is (same footprint and height). */
function spoolGeometry([w, h]: Vec3): THREE.BufferGeometry {
  const r = w / 2;
  const parts = [
    new THREE.CylinderGeometry(r * 0.7, r * 0.7, h, 16),
    new THREE.CylinderGeometry(r * 1.05, r * 1.05, h * 0.14, 16).translate(0, h / 2 - h * 0.07, 0),
    new THREE.CylinderGeometry(r * 1.05, r * 1.05, h * 0.14, 16).translate(0, -h / 2 + h * 0.07, 0),
  ].map((g) => g.toNonIndexed());
  for (const g of parts) g.deleteAttribute('uv');
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

// ---------- Mechanics ----------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Chevrons pointing along -v (the top face's "forward"), for boost pads. */
const chevrons = () => canvasTexture(64, 64, (ctx) => {
  ctx.fillStyle = '#ff8c00';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#fff3b0';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(8, 44); ctx.lineTo(32, 20); ctx.lineTo(56, 44);
  ctx.stroke();
});

/** Belt slats across the direction of travel. */
const slats = () => canvasTexture(32, 32, (ctx) => {
  ctx.fillStyle = '#3d4150';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#8a90a6';
  ctx.fillRect(0, 0, 32, 6);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(12, 14, 8, 4);
});

/** Streaks for wind (along v) and sparkles for low gravity. */
const streaks = () => canvasTexture(64, 64, (ctx) => {
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [x, y, h] of [[6, 4, 18], [22, 30, 22], [38, 10, 14], [52, 40, 20], [30, 50, 10]]) ctx.fillRect(x, y, 3, h);
});
const sparkles = () => canvasTexture(64, 64, (ctx) => {
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const [x, y] of [[8, 10], [40, 6], [24, 30], [54, 34], [12, 52], [44, 54]]) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
});

/** The textured top face of an effect floor (boost, conveyor): scrolls to show direction. */
function scrollingTop(size: Vec3, tex: THREE.CanvasTexture, repeatAlong: number, side: string, emissive = '#000000'): THREE.Material[] {
  tex.repeat.set(Math.max(1, Math.round(size[0] / 3)), repeatAlong);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive, emissiveMap: emissive === '#000000' ? null : tex, emissiveIntensity: 0.35 });
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.8 });
  return [sideMat, sideMat, top, sideMat, sideMat, sideMat];
}

function effectMesh(solid: Solid, look?: Look): THREE.Mesh | null {
  const e = solid.effect;
  const s = solid.shape;
  if (!e) return null;
  if (e.kind === 'spring' && s.kind === 'cylinder') {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(s.radius, s.radius * 1.1, s.height, 24),
      new THREE.MeshStandardMaterial({ color: '#ff4d6d', emissive: '#5c0a1a', roughness: 0.4 }),
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(s.radius * 0.75, s.radius * 0.75, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#b8860b', emissiveIntensity: 0.6 }),
    );
    cap.position.y = s.height / 2 + 0.04;
    base.add(cap);
    return base;
  }
  if (s.kind !== 'box') return null;
  const geo = new THREE.BoxGeometry(...s.size);
  if (e.kind === 'boost') return new THREE.Mesh(geo, scrollingTop(s.size, chevrons(), Math.max(1, Math.round(s.size[2] / 3)), '#b85c00', '#ff8c00'));
  if (e.kind === 'conveyor') {
    const tex = look ? surfaceTexture(look.belt, 256).clone() : slats();
    return new THREE.Mesh(geo, scrollingTop(s.size, tex, Math.round(s.size[2] / (look ? 4 : 1.5)), '#2a2d38'));
  }
  if (look) {
    // A cracker (it crumbles): one per tile.
    const tex = surfaceTexture(look.crumble).clone();
    tex.repeat.set(Math.max(1, Math.round(s.size[0] / 4)), Math.max(1, Math.round(s.size[2] / 4)));
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, transparent: true });
    const side = new THREE.MeshStandardMaterial({ color: look.crumble.accent, roughness: 0.9, transparent: true });
    return new THREE.Mesh(geo, [side, side, top, side, side, side]);
  }
  // Crumbling tile: sandy with dark cracks.
  const tex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#d9b48a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, 20); ctx.lineTo(22, 28); ctx.lineTo(30, 12); ctx.lineTo(46, 30); ctx.lineTo(60, 22);
    ctx.moveTo(22, 28); ctx.lineTo(26, 50); ctx.lineTo(44, 58);
    ctx.moveTo(46, 30); ctx.lineTo(40, 46);
    ctx.stroke();
    ctx.strokeStyle = '#a57a50';
    ctx.strokeRect(1, 1, 62, 62);
  });
  tex.repeat.set(Math.max(1, Math.round(s.size[0] / 4)), Math.max(1, Math.round(s.size[2] / 4)));
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, transparent: true });
  const side = new THREE.MeshStandardMaterial({ color: '#9c7552', roughness: 0.9, transparent: true });
  return new THREE.Mesh(geo, [side, side, top, side, side, side]);
}

function volumeMesh(v: Volume): THREE.Mesh {
  const size: Vec3 = [v.max[0] - v.min[0], v.max[1] - v.min[1], v.max[2] - v.min[2]];
  const wind = v.kind === 'wind';
  const tex = wind ? streaks() : sparkles();
  // Box faces: streaks run along the wind; for a sideways wind, the side faces' v axis is y,
  // so rotate the texture to run horizontally.
  if (wind && Math.abs(v.dir[1]) < 0.5) tex.rotation = Math.PI / 2;
  tex.repeat.set(Math.max(1, Math.round(size[0] / 6)), Math.max(1, Math.round(size[1] / 6)));
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshBasicMaterial({
      color: wind ? '#dff6ff' : '#c9a7ff', map: tex, transparent: true, opacity: wind ? 0.35 : 0.3,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  mesh.position.set((v.min[0] + v.max[0]) / 2, (v.min[1] + v.max[1]) / 2, (v.min[2] + v.max[2]) / 2);
  mesh.renderOrder = 2;
  return mesh;
}

/** A toadstool: a spotted cap on a pale stem, on the bumper's cylinder (same radius and height). */
function toadstoolMesh(radius: number, height: number, look: Look): THREE.Mesh {
  const spots = new THREE.CanvasTexture(spotCanvas(look.bumper.cap, look.bumper.spots));
  spots.colorSpace = THREE.SRGBColorSpace;
  spots.wrapS = THREE.RepeatWrapping;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius, height, 24),
    new THREE.MeshStandardMaterial({ color: look.bumper.stem, roughness: 0.8 }),
  );
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.12, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1),
    new THREE.MeshStandardMaterial({ map: spots, roughness: 0.45, emissive: '#3a0a06' }),
  );
  cap.position.y = height / 2 - 0.15;
  stem.add(cap);
  return stem;
}

function spotCanvas(cap: string, spot: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = cap;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = spot;
  for (const [x, y, r] of [[20, 30, 9], [70, 60, 12], [120, 25, 8], [160, 70, 11], [210, 35, 10], [245, 80, 7], [40, 95, 7], [100, 100, 6], [190, 105, 6]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** A yellow pencil lying along the arm (x), sharpened at one end with an eraser at the other. */
function pencilMesh([length, height]: Vec3, look: Look): THREE.Mesh {
  const r = height * 0.45, body = length * 0.78, tip = length * 0.13, end = length * 0.09;
  const paint = new THREE.MeshStandardMaterial({ color: look.pencil.paint, roughness: 0.45 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, body, 6).rotateZ(Math.PI / 2).translate((tip - end) / 2, 0, 0), paint);
  const wood = new THREE.Mesh(new THREE.ConeGeometry(r, tip, 6).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: look.pencil.wood, roughness: 0.8 }));
  wood.position.x = body / 2 + (tip - end) / 2 + tip / 2;
  const lead = new THREE.Mesh(new THREE.ConeGeometry(r * 0.32, tip * 0.32, 6).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.4 }));
  lead.position.x = tip / 2 - tip * 0.16;
  wood.add(lead);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, end * 0.45, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9ccd3', metalness: 0.6, roughness: 0.35 }));
  ferrule.position.x = -body / 2 + (tip - end) / 2 - end * 0.22;
  const eraser = new THREE.Mesh(new THREE.CylinderGeometry(r, r, end * 0.55, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: look.pencil.eraser, roughness: 0.9 }));
  eraser.position.x = ferrule.position.x - end * 0.5;
  mesh.add(wood, ferrule, eraser);
  return mesh;
}

function bumperMesh(radius: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 24),
    new THREE.MeshStandardMaterial({ color: '#ff4d6d', emissive: '#6b0f1f', roughness: 0.4 }),
  );
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#555555' }),
  );
  cap.position.y = height / 2 + 0.04;
  mesh.add(cap);
  return mesh;
}


// ---------- Moving pieces ----------
// Game objects, so they look the same in every theme (DESIGN.md): piano keys, a lazy Susan, a
// conker on a string, a ruler, logs and paper.

const once = <T>(make: () => T) => { let v: T | undefined; return () => (v ??= make()); };

/** A lazy Susan's top: turned rings, a few spokes so you can see it turn, and a red middle. */
const discTop = once(() => canvasTexture(256, 256, (ctx) => {
  ctx.fillStyle = '#dcc7a6';
  ctx.fillRect(0, 0, 256, 256);
  for (let r = 18; r < 128; r += 7) {
    ctx.strokeStyle = r % 14 ? 'rgba(110,70,35,.16)' : 'rgba(110,70,35,.32)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(128, 128, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(110,70,35,.35)';
  ctx.lineWidth = 5;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30); ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124); ctx.stroke();
  }
  ctx.fillStyle = '#b5523b';
  ctx.beginPath(); ctx.arc(128, 128, 24, 0, Math.PI * 2); ctx.fill();
}));

/** Ruler markings along v: a tick every unit, longer every fifth. */
const rulerTop = once(() => canvasTexture(64, 256, (ctx) => {
  ctx.fillStyle = '#f2d479';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#4a3b1c';
  for (let i = 0; i < 16; i++) {
    const y = i * 16;
    ctx.fillRect(0, y, i % 5 ? 12 : 26, 2);
    ctx.fillRect(64 - (i % 5 ? 12 : 26), y, i % 5 ? 12 : 26, 2);
  }
}));

/** Bark: dark streaks running round a log (u) and along it (v). */
const bark = once(() => canvasTexture(128, 64, (ctx) => {
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = i % 3 ? 'rgba(40,25,10,.35)' : 'rgba(200,160,110,.25)';
    ctx.fillRect((i * 37) % 128, 0, 2 + (i % 3), 64);
  }
}));

const logEnd = once(() => canvasTexture(64, 64, (ctx) => {
  ctx.fillStyle = '#d9b382';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(120,80,40,.45)';
  for (let r = 4; r < 32; r += 5) { ctx.beginPath(); ctx.arc(32, 32, r, 0, Math.PI * 2); ctx.stroke(); }
}));

/** Tissue paper: soft white with a printed pattern and a dotted tear line, so it never reads as a wall. */
const tissue = once(() => canvasTexture(128, 128, (ctx) => {
  ctx.fillStyle = '#fdf8f0';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#9fd3e6';
  for (let y = 8; y < 128; y += 24) for (let x = (y / 24) % 2 ? 20 : 8; x < 128; x += 24) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#f4a6b8';
  for (let y = 20; y < 128; y += 24) for (let x = (y / 24) % 2 ? 8 : 20; x < 128; x += 24) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(120,100,80,.45)';
  for (let y = 2; y < 128; y += 8) ctx.fillRect(63, y, 2, 4); // the perforation
}));

/** Iron: dark metal with lighter bands and rivets, so you can see it roll. */
const ironSkin = once(() => canvasTexture(256, 128, (ctx) => {
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#767e89';
  for (const x of [0, 64, 128, 192]) ctx.fillRect(x, 0, 10, 128);
  ctx.fillRect(0, 59, 256, 10);
  ctx.fillStyle = '#a3abb6';
  for (const x of [5, 69, 133, 197]) for (let y = 12; y < 128; y += 24) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
}));

const pickets = once(() => canvasTexture(128, 64, (ctx) => {
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#f8f6ef';
  for (let x = 4; x < 128; x += 16) { ctx.fillRect(x, 6, 10, 58); ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x + 5, 0); ctx.lineTo(x + 10, 6); ctx.fill(); }
  ctx.fillStyle = '#bfb8a6';
  ctx.fillRect(0, 18, 128, 4);
  ctx.fillRect(0, 46, 128, 4);
}));

/** An iron ball (also drawn under other players pushing theirs). */
export function ironBallMesh(radius: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), new THREE.MeshStandardMaterial({ map: ironSkin(), metalness: 0.65, roughness: 0.38 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** A launcher's lamp: green while loading, flashing amber in the last second, red as it fires. */
const LAMP_IDLE = '#8ac926', LAMP_SOON = '#ffb703', LAMP_NOW = '#ff595e';
/** Seconds before a launch the lamp starts flashing, and the next log drops into place. */
const LAMP_WARN = 1.0, LOG_DROP = 0.5;

interface Launcher { solid: Solid; lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>; next: THREE.Mesh; lift: number; last: number }

/**
 * A hopper over a log's starting place: a roof on two posts (you roll under it), a lamp that
 * counts down to each launch, and the next log dropping out of the roof into place.
 */
function launcherMeshes(solid: Solid): { frame: THREE.Mesh; lamp: Launcher['lamp']; next: THREE.Mesh; lift: number } | null {
  const m = solid.motion, s = solid.shape;
  if (m?.kind !== 'travel' || s.kind !== 'cylinder') return null;
  const dx = m.to[0] - m.from[0], dz = m.to[2] - m.from[2], yaw = Math.atan2(dx, dz);
  const across = s.height + 0.8, roofBottom = s.radius + 0.3, roofH = 2 * s.radius + 0.4, depth = 2 * s.radius + 1;
  const parts = [new THREE.BoxGeometry(across, roofH, depth).translate(0, roofBottom + roofH / 2, 0)];
  for (const side of [-1, 1]) parts.push(new THREE.BoxGeometry(0.35, roofBottom + roofH + s.radius, 0.35).translate(side * (across / 2 - 0.2), (roofBottom + roofH - s.radius) / 2, depth / 2 - 0.3));
  const frame = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.8 }));
  frame.position.set(...m.from);
  frame.rotation.y = yaw;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), new THREE.MeshStandardMaterial({ color: LAMP_IDLE, emissive: LAMP_IDLE, emissiveIntensity: 0.9 }));
  lamp.position.set(0, roofBottom + roofH + 0.35, depth / 2 - 0.4); // on top of the roof, at the front
  frame.add(lamp);
  // The waiting log: hidden in the roof, it drops to where the real one starts just before launch.
  const next = skinMesh(solid)!;
  next.quaternion.set(...solid.rotation);
  next.visible = false;
  return { frame, lamp, next, lift: roofBottom + s.radius + 0.2 };
}

/** Gates warn before they move: red just before they rise and shut, green just before they open. */
const GATE = '#ffffff', GATE_SHUTTING = '#ff595e', GATE_OPENING = '#8ac926';

/** Piano keys: ivory, drawn a touch narrower than they are so a dark line shows between them. */
const KEY = '#f5f0e1', KEY_WARN = '#ff9f43';

function skinMesh(solid: Solid): THREE.Mesh | null {
  const s = solid.shape;
  switch (solid.skin) {
    case 'key': {
      if (s.kind !== 'box') return null;
      return new THREE.Mesh(
        new THREE.BoxGeometry(s.size[0] - 0.12, s.size[1], s.size[2] - 0.12),
        new THREE.MeshStandardMaterial({ color: KEY, roughness: 0.3 }),
      );
    }
    case 'disc': {
      if (s.kind !== 'cylinder') return null;
      const side = new THREE.MeshStandardMaterial({ color: '#a47148', roughness: 0.6 });
      return new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, s.height, 48), [side, new THREE.MeshStandardMaterial({ map: discTop(), roughness: 0.55 }), side]);
    }
    case 'ruler': {
      if (s.kind !== 'box') return null;
      const tex = rulerTop().clone();
      const alongX = s.size[0] > s.size[2];
      tex.repeat.set(1, Math.max(1, Math.round(Math.max(s.size[0], s.size[2]) / 16)));
      if (alongX) { tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2; }
      const side = new THREE.MeshStandardMaterial({ color: '#d9b85c', roughness: 0.6 });
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
      return new THREE.Mesh(new THREE.BoxGeometry(...s.size), [side, side, top, side, side, side]);
    }
    case 'rod':
      return new THREE.Mesh(new THREE.BoxGeometry(...(s.kind === 'box' ? s.size : [0.2, 1, 0.2] as Vec3)).scale(0.5, 1, 0.5), new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.9 }));
    case 'bob': {
      if (s.kind !== 'cylinder') return null;
      // A conker: a glossy brown ball (as tall as the cylinder it really is) with a pale cap.
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(s.radius * 1.05, 28, 18).scale(1, s.height / (2 * s.radius * 1.05), 1), new THREE.MeshStandardMaterial({ color: '#7a3b1e', roughness: 0.28, metalness: 0.05 }));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(s.radius * 0.35, s.radius * 0.5, 0.14, 20), new THREE.MeshStandardMaterial({ color: '#d9c3a0', roughness: 0.9 }));
      cap.position.y = s.height / 2 - 0.02;
      mesh.add(cap);
      return mesh;
    }
    case 'roller':
    case 'log': {
      if (s.kind !== 'cylinder') return null;
      const side = bark().clone();
      side.repeat.set(2, 1);
      const end = new THREE.MeshStandardMaterial({ map: logEnd(), roughness: 0.8 });
      return new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, s.height, 20), [new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 }), end, end]);
    }
    case 'iron':
      return s.kind === 'sphere' ? ironBallMesh(s.radius) : null;
    case 'spikes': {
      if (s.kind !== 'box') return null;
      // A dark bed with a field of steel cones on top (one merged mesh).
      const bed = new THREE.Mesh(new THREE.BoxGeometry(...s.size), new THREE.MeshStandardMaterial({ color: '#3a3d44', roughness: 0.8 }));
      const cones: THREE.BufferGeometry[] = [];
      for (let x = -s.size[0] / 2 + 0.6; x <= s.size[0] / 2 - 0.5; x += 1.2) {
        for (let z = -s.size[2] / 2 + 0.6; z <= s.size[2] / 2 - 0.5; z += 1.2) cones.push(new THREE.ConeGeometry(0.38, 0.9, 6).translate(x, s.size[1] / 2 + 0.45, z));
      }
      if (cones.length) bed.add(new THREE.Mesh(mergeGeometries(cones), new THREE.MeshStandardMaterial({ color: '#c3c8d0', metalness: 0.7, roughness: 0.3 })));
      return bed;
    }
    case 'step': {
      if (s.kind !== 'box') return null;
      const side = new THREE.MeshStandardMaterial({ color: '#a47148', roughness: 0.7 });
      return new THREE.Mesh(new THREE.BoxGeometry(...s.size), [side, side, new THREE.MeshStandardMaterial({ color: '#e0b56a', roughness: 0.6 }), side, side, side]);
    }
    case 'gate': {
      if (s.kind !== 'box') return null;
      const tex = pickets().clone();
      tex.repeat.set(Math.max(1, Math.round(s.size[0] / 3)), 1);
      return new THREE.Mesh(new THREE.BoxGeometry(...s.size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: '#000000' }));
    }
    case 'paper': {
      if (s.kind !== 'box') return null;
      const tex = tissue().clone();
      tex.repeat.set(Math.max(1, Math.round(s.size[0] / 3)), 1);
      return new THREE.Mesh(new THREE.BoxGeometry(...s.size), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent: true, opacity: 0.85, emissive: '#fff4e0', emissiveIntensity: 0.15 }));
    }
    default:
      return null;
  }
}

/**
 * A turntable's rim as one mesh in the disc's own frame (it turns with the disc), plus yellow
 * posts either side of each gap so the way on and off reads at a glance.
 */
function rimMeshes(disc: Solid, rim: Solid[]): THREE.Mesh[] {
  const boxes: THREE.BufferGeometry[] = [], posts: THREE.BufferGeometry[] = [];
  const ends: Vec3[] = [];
  for (const r of rim) {
    if (r.shape.kind !== 'box') continue;
    const [w, h, len] = r.shape.size;
    const q = new THREE.Quaternion(...r.rotation);
    const at = new THREE.Vector3(r.position[0] - disc.position[0], r.position[1] - disc.position[1], r.position[2] - disc.position[2]);
    boxes.push(new THREE.BoxGeometry(w, h, len).applyQuaternion(q).translate(at.x, at.y, at.z));
    const along = new THREE.Vector3(0, 0, len / 2 - 0.1).applyQuaternion(q);
    ends.push([at.x + along.x, at.y, at.z + along.z], [at.x - along.x, at.y, at.z - along.z]);
  }
  // Ends with no neighbour are the edges of a gap.
  for (const e of ends) {
    const neighbours = ends.filter((o) => Math.hypot(o[0] - e[0], o[2] - e[2]) < 0.6).length;
    if (neighbours === 1) posts.push(new THREE.CylinderGeometry(0.28, 0.28, 1.7, 10).translate(e[0], e[1] + 0.25, e[2]));
  }
  const out = [new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshStandardMaterial({ color: '#b08968', roughness: 0.7 }))];
  if (posts.length) out.push(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#7a5200', emissiveIntensity: 0.5, roughness: 0.4 })));
  return out;
}

function solidMesh(solid: Solid, theme: Theme): THREE.Mesh {
  const look = theme.look;
  const skinned = skinMesh(solid);
  if (skinned) return skinned;
  const special = effectMesh(solid, look);
  if (special) return special;
  const s = solid.shape;
  if (s.kind === 'sphere') return new THREE.Mesh(new THREE.SphereGeometry(s.radius, 32, 20), new THREE.MeshStandardMaterial({ color: solid.color ?? '#cccccc', roughness: 0.5 }));
  if (look && solid.role === 'arm' && s.kind === 'box') return pencilMesh(s.size, look);
  if (s.kind === 'cylinder') {
    if (solid.role === 'bumper') return look ? toadstoolMesh(s.radius, s.height, look) : bumperMesh(s.radius, s.height);
    return new THREE.Mesh(
      new THREE.CylinderGeometry(s.radius, s.radius, s.height, 24),
      new THREE.MeshStandardMaterial({ color: solid.color ?? '#cccccc', roughness: 0.7 }),
    );
  }
  const geometry = new THREE.BoxGeometry(...s.size);
  const surface = look && roleSurface(look, solid.color);
  if (look && (solid.palette || surface)) scaleBoxUVs(geometry, s.size, { shade: true });
  const material = solid.palette
    ? floorMaterials(theme, solid.palette, s.size)
    : surface ? surfaceMaterial(surface, { vertexColors: true, size: 256 })
    : new THREE.MeshStandardMaterial({ color: solid.color ?? '#cccccc', roughness: 0.7 });
  return new THREE.Mesh(geometry, material);
}

/** A paper pennant: a triangle from the pole, with a slight fold. */
function pennantGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.45, 0, 0, -0.45, 0, 0.75, 0.02, 0.08, 1.5, 0, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 2, 1, 3]);
  g.computeVertexNormals();
  return g;
}

interface CheckpointView {
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  flag: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** 1 → 0 after it's reached: the ring swells once. */
  pulse: number;
}

export class LevelView {
  private meshes: THREE.Mesh[] = [];
  private moving: Solid[] = [];
  private pulses = new Map<number, number>(); // bumper solid id -> 0..1
  private checkpoints: CheckpointView[] = [];
  private goalArch: THREE.Mesh | null = null;
  private zones: { ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshStandardMaterial>; beam: THREE.Mesh }[] = [];
  /** Textures that scroll to show which way things move: offset change per second (v axis). */
  private scrolling: { tex: THREE.Texture; rate: number }[] = [];
  private crumbles: Solid[] = [];
  private keys: Solid[] = [];
  private rollers: Solid[] = [];
  private papers: Solid[] = [];
  private gates: Solid[] = [];
  private launchers: Launcher[] = [];
  /** A launched log broke up at the end of its run: where, and which way it was going. */
  onBreak?: (at: Vec3, dir: Vec3) => void;
  /** Wheels: the hub and spokes, turning with their steps. */
  private wheels: { mesh: THREE.Mesh; axis: THREE.Vector3; speed: number }[] = [];
  private springs = new Map<number, number>(); // spring solid id -> bounce 0..1
  private stars: StarView[] = [];

  constructor(scene: THREE.Object3D, level: ResolvedLevel, { merge = true } = {}) {
    const mergeable = (s: Solid) => merge && !s.motion && !s.effect && s.shape.kind === 'box';
    for (const mesh of mergedStatics(level.solids.filter(mergeable), THEMES[level.theme])) {
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const solid of level.solids) {
      if (mergeable(solid) || solid.skin === 'rim') continue; // rims are drawn with their disc
      const mesh = solidMesh(solid, THEMES[level.theme]);
      if (solid.skin === 'disc') {
        for (const part of rimMeshes(solid, level.solids.filter((r) => r.skin === 'rim' && r.piece === solid.piece))) {
          part.castShadow = true;
          mesh.add(part);
        }
      }
      if (solid.skin === 'key') this.keys.push(solid);
      if (solid.skin === 'roller' || solid.skin === 'log') this.rollers.push(solid);
      if (solid.skin === 'log') {
        const parts = launcherMeshes(solid);
        if (parts) {
          parts.frame.castShadow = true;
          scene.add(parts.frame, parts.next);
          this.launchers.push({ solid, lamp: parts.lamp, next: parts.next, lift: parts.lift, last: 0 });
        }
      }
      if (solid.skin === 'paper') this.papers.push(solid);
      if (solid.skin === 'gate') this.gates.push(solid);
      mesh.position.set(...solid.position);
      mesh.quaternion.set(...solid.rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.piece = solid.piece; // lets the editor map clicks back to level pieces
      scene.add(mesh);
      this.meshes[solid.id] = mesh;
      if (solid.motion || solid.role === 'carrier') this.moving.push(solid); // iron balls roll by physics
      const e = solid.effect;
      const top = Array.isArray(mesh.material) ? (mesh.material[2] as THREE.MeshStandardMaterial) : null;
      if (e?.kind === 'crumble') this.crumbles.push(solid);
      if (e?.kind === 'boost' && top?.map) this.scrolling.push({ tex: top.map, rate: -1.5 });
      if (e?.kind === 'conveyor' && top?.map) this.scrolling.push({ tex: top.map, rate: e.speed / 1.5 });
    }

    // Each wheel's hub and spokes (drawn only; the steps are what you ride).
    const steps = level.solids.filter((st) => st.skin === 'step' && st.motion?.kind === 'orbit');
    for (const piece of new Set(steps.map((st) => st.piece))) {
      const own = steps.filter((st) => st.piece === piece), m = own[0].motion;
      if (m?.kind !== 'orbit') continue;
      const axis = new THREE.Vector3(...m.axis), parts: THREE.BufferGeometry[] = [];
      const along = Math.max(...own.map((st) => (st.shape.kind === 'box' ? st.shape.size[2] : 1))) / 2 + 0.25; // just past the steps' far edge
      parts.push(new THREE.CylinderGeometry(0.9, 0.9, 0.8, 16).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)).translate(...axis.clone().multiplyScalar(along).toArray()));
      for (const st of own) {
        const to = new THREE.Vector3(...st.position).sub(new THREE.Vector3(...m.center)), len = to.length();
        const spoke = new THREE.BoxGeometry(0.3, len, 0.3).translate(0, len / 2, 0);
        spoke.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().normalize()));
        parts.push(spoke.translate(...axis.clone().multiplyScalar(along).toArray()));
      }
      const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: '#8d5a34', roughness: 0.7 }));
      mesh.position.set(...m.center);
      mesh.castShadow = true;
      mesh.userData.piece = piece;
      scene.add(mesh);
      this.wheels.push({ mesh, axis, speed: m.speed });
    }

    for (const v of level.volumes) {
      const mesh = volumeMesh(v);
      mesh.userData.piece = v.piece;
      scene.add(mesh);
      const map = (mesh.material as THREE.MeshBasicMaterial).map!;
      // Streaks drift with the wind (updrafts rise); sparkles float up slowly.
      this.scrolling.push({ tex: map, rate: v.kind === 'wind' ? -Math.max(0.6, v.speed / 6) : -0.15 });
    }

    for (const cp of level.checkpoints) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.12, 8, 40),
        new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: CHECKPOINT_IDLE, emissiveIntensity: 0.8 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      group.add(ring);
      // With a theme look: a cocktail stick with a paper pennant.
      const look = THEMES[level.theme].look;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(look ? 0.07 : 0.08, look ? 0.05 : 0.08, 3.2),
        new THREE.MeshStandardMaterial({ color: look ? '#e8c998' : '#dddddd', roughness: 0.7 }),
      );
      pole.position.set(2.4, 1.6, 0);
      group.add(pole);
      const flag = new THREE.Mesh(
        look ? pennantGeometry() : new THREE.PlaneGeometry(1.2, 0.8),
        new THREE.MeshStandardMaterial({ color: CHECKPOINT_IDLE, side: THREE.DoubleSide, roughness: 0.9 }),
      );
      flag.position.set(look ? 2.45 : 3.0, 2.8, 0);
      group.add(flag);
      group.position.set(...cp.position);
      group.userData.piece = cp.piece;
      scene.add(group);
      this.checkpoints.push({ ring, flag, pulse: 0 });
    }

    if (level.stars.length) {
      const geometry = starGeometry(), glow = haloTexture();
      for (const [i, star] of level.stars.entries()) {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: '#ffd60a', emissive: '#ffb703', emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.35, transparent: true,
        }));
        mesh.position.set(...star.position);
        mesh.rotation.y = i; // not all in step
        mesh.castShadow = true;
        mesh.userData.piece = star.piece;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.setScalar(3.4);
        mesh.add(halo);
        scene.add(mesh);
        let button: StarView['button'];
        if (star.button) {
          // A round floor switch; it lights up while its star is out.
          button = new THREE.Mesh(
            new THREE.CylinderGeometry(1.4, 1.5, 0.12, 28),
            new THREE.MeshStandardMaterial({ color: BUTTON_OFF, emissive: BUTTON_OFF, emissiveIntensity: 0.35, roughness: 0.4 }),
          );
          button.position.set(star.button.position[0], star.button.position[1] + 0.06, star.button.position[2]);
          button.receiveShadow = true;
          button.userData.piece = star.piece;
          scene.add(button);
        }
        this.stars.push({ mesh, halo, star, base: star.position, burst: 0, collected: false, button });
      }
    }

    if (level.goal) {
      const goal = new THREE.Group();
      this.goalArch = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.35, 12, 48),
        new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffb703', emissiveIntensity: 0.9, metalness: 0.3 }),
      );
      this.goalArch.position.y = 3.2;
      this.goalArch.castShadow = true;
      goal.add(this.goalArch);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(level.goal.radius, 40),
        new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffb703', emissiveIntensity: 0.5 }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.03;
      goal.add(disc);
      goal.position.set(...level.goal.position);
      goal.userData.piece = level.goal.piece;
      scene.add(goal);
    }

    // Arena hill zones: a ring on the floor plus a light beam; the active one glows.
    for (const z of level.zones) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(z.radius - 0.3, z.radius, 48),
        new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd166', emissiveIntensity: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(z.radius, z.radius, 14, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.y = 7;
      beam.visible = false;
      group.add(ring, beam);
      group.position.set(...z.position);
      group.userData.piece = z.piece;
      scene.add(group);
      this.zones.push({ ring, beam });
    }
  }

  /** King of the Hill: highlight the active zone (-1 = none). */
  setActiveZone(index: number) {
    this.zones.forEach((z, i) => {
      z.beam.visible = i === index;
      z.ring.material.emissiveIntensity = i === index ? 1.2 : 0.4;
    });
  }

  pulseBumper(solidId: number) {
    this.pulses.set(solidId, 1);
  }

  bounceSpring(solidId: number) {
    this.springs.set(solidId, 1);
  }

  /** Collected stars burst and disappear; `false` puts a star back (restart). */
  setStar(index: number, collected: boolean) {
    const star = this.stars[index];
    if (!star) return;
    star.collected = collected;
    star.burst = 0;
    star.base = star.mesh.position.toArray() as Vec3;
    star.mesh.visible = true;
    star.mesh.scale.setScalar(1);
    star.mesh.material.opacity = 1;
    star.halo.material.opacity = 1;
  }

  setCheckpoint(index: number, reached: boolean) {
    const color = reached ? CHECKPOINT_DONE : CHECKPOINT_IDLE;
    this.checkpoints[index].flag.material.color.set(color);
    this.checkpoints[index].ring.material.emissive.set(color);
    this.checkpoints[index].pulse = reached ? 1 : 0;
  }

  update(sim: Simulation, dt: number) {
    for (const cp of this.checkpoints) {
      if (cp.pulse <= 0) continue;
      cp.pulse = Math.max(0, cp.pulse - dt * 2.5);
      cp.ring.scale.setScalar(1 + Math.sin(cp.pulse * Math.PI) * 0.45);
    }
    for (const solid of this.moving) {
      const pose = sim.solidPose(solid.id);
      this.meshes[solid.id].position.set(...pose.position);
      this.meshes[solid.id].quaternion.set(...pose.rotation);
    }
    // Piano keys warn just before they sink.
    for (const solid of this.keys) {
      const y = sim.solidPose(solid.id).position[1], soon = poseAt(solid, sim.time + 0.45).position[1];
      const mat = this.meshes[solid.id].material as THREE.MeshStandardMaterial;
      mat.color.set(soon < y - 0.05 && Math.abs(y - solid.position[1]) < 0.5 ? KEY_WARN : KEY);
    }
    // Logs roll as they go, come out of their pipe, and shrink away off the far edge.
    for (const solid of this.rollers) {
      const m = solid.motion, mesh = this.meshes[solid.id];
      if (m?.kind !== 'travel' || solid.shape.kind !== 'cylinder') continue;
      const u = travelAt(m, sim.time).run ?? 0;
      const dist = u * Math.hypot(m.to[0] - m.from[0], m.to[2] - m.from[2]);
      mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dist / solid.shape.radius));
      // Launched logs appear from their hopper and break up at the end (below); the others come
      // out of a pipe and shrink away off the far edge.
      if (solid.skin === 'roller') mesh.scale.setScalar(Math.max(0, Math.min(1, u / 0.04, (0.97 - u) / 0.12)));
    }
    for (const l of this.launchers) {
      const m = l.solid.motion;
      if (m?.kind !== 'travel') continue;
      const { run, left } = travelAt(m, sim.time), u = run ?? -1;
      // Its run ended: the log got to the end and broke up (the next waits in the launcher).
      if (u < l.last && this.onBreak) this.onBreak([...m.to], [m.to[0] - m.from[0], m.to[1] - m.from[1], m.to[2] - m.from[2]]);
      l.last = u;
      this.meshes[l.solid.id].visible = run !== null; // waiting: up in the roof, out of sight
      const lamp = left < 0.3 ? LAMP_NOW : left < LAMP_WARN ? (Math.floor(left * 8) % 2 ? LAMP_SOON : LAMP_IDLE) : LAMP_IDLE;
      l.lamp.material.color.set(lamp);
      l.lamp.material.emissive.set(lamp);
      l.next.visible = left < LOG_DROP;
      if (l.next.visible) {
        const drop = 1 - left / LOG_DROP; // 0 → 1 as it falls into place
        l.next.position.set(m.from[0], m.from[1] + l.lift * (1 - drop * drop), m.from[2]);
      }
    }
    for (const solid of this.papers) this.meshes[solid.id].visible = !sim.isTorn(solid.id);
    for (const w of this.wheels) w.mesh.quaternion.setFromAxisAngle(w.axis, w.speed * sim.time);
    for (const solid of this.gates) {
      const y = sim.solidPose(solid.id).position[1], soon = poseAt(solid, sim.time + 0.5).position[1];
      const mat = this.meshes[solid.id].material as THREE.MeshStandardMaterial;
      mat.emissive.set(soon > y + 0.05 ? GATE_SHUTTING : soon < y - 0.05 ? GATE_OPENING : '#000000');
      mat.emissiveIntensity = 0.6;
      mat.color.set(GATE);
    }
    for (const [id, pulse] of this.pulses) {
      const next = Math.max(0, pulse - dt * 4);
      const s = 1 + next * 0.25;
      this.meshes[id].scale.set(s, 1, s);
      if (next === 0) this.pulses.delete(id);
      else this.pulses.set(id, next);
    }
    if (this.goalArch) this.goalArch.rotation.y = sim.time * 0.8;
    for (const [i, star] of this.stars.entries()) {
      if (star.button) {
        // Locked: a faint ghost and a red button. Unlocked: solid, the button lit, and it blinks
        // in its last two seconds.
        const left = (sim.switchUntil[i] ?? 0) - sim.time;
        const on = left > 0 || star.collected;
        star.button.material.color.set(left > 0 ? BUTTON_ON : BUTTON_OFF);
        star.button.material.emissive.set(left > 0 ? BUTTON_ON : BUTTON_OFF);
        if (!star.collected) star.mesh.material.opacity = !on ? 0.22 : left < 2 && Math.floor(left * 6) % 2 ? 0.35 : 1;
        star.mesh.material.emissiveIntensity = on ? 0.7 : 0.1;
        star.halo.material.opacity = on ? 1 : 0.15;
      }
      if (!star.mesh.visible) continue;
      if (star.collected) {
        // Burst: spin fast, swell, rise and fade out.
        star.burst = Math.min(1, star.burst + dt * 2.5);
        star.mesh.rotation.y += dt * 18;
        star.mesh.scale.setScalar(1 + star.burst * 1.2);
        star.mesh.position.y = star.base[1] + star.burst * 2;
        star.mesh.material.opacity = 1 - star.burst;
        star.halo.material.opacity = 1 - star.burst;
        if (star.burst >= 1) star.mesh.visible = false;
      } else {
        const at = starAt(star.star, sim.time);
        star.mesh.rotation.y += dt * 2;
        star.mesh.position.set(at[0], at[1] + Math.sin(sim.time * 2.5 + star.star.position[0]) * 0.18, at[2]);
      }
    }

    for (const s of this.scrolling) s.tex.offset.y = (s.tex.offset.y + s.rate * dt) % 1;
    for (const [id, b] of this.springs) {
      const next = Math.max(0, b - dt * 3);
      this.meshes[id].scale.set(1, 1 + Math.sin(next * Math.PI) * 1.5, 1);
      if (next === 0) this.springs.delete(id);
      else this.springs.set(id, next);
    }
    // Crumbling tiles shake harder and harder, then drop away and fade.
    for (const solid of this.crumbles) {
      const mesh = this.meshes[solid.id];
      const { shake, gone } = sim.crumbleState(solid.id);
      const mats = mesh.material as THREE.MeshStandardMaterial[];
      if (gone) {
        mesh.position.y = Math.max(solid.position[1] - 6, mesh.position.y - dt * 12);
        mats.forEach((m) => { m.opacity = Math.max(0, m.opacity - dt * 2.5); });
        mesh.visible = mats[2].opacity > 0;
      } else {
        const j = shake * shake * 0.12;
        mesh.visible = true;
        mesh.position.set(solid.position[0] + (Math.random() - 0.5) * j, solid.position[1], solid.position[2] + (Math.random() - 0.5) * j);
        mats.forEach((m) => { m.opacity = 1; });
      }
    }
  }
}
