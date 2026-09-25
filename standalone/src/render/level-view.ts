import * as THREE from 'three';
import type { Vec3 } from '../sim/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Palette } from '../levels/schema';
import { THEMES, type Theme } from '../levels/themes';
import type { ResolvedLevel, Solid, Volume } from '../sim/geometry';
import type { Simulation } from '../sim/simulation';

// Builds meshes for every solid in a resolved level and keeps moving ones in sync with
// the simulation. Also draws checkpoints and the goal. In the game, static boxes are merged
// into one mesh per floor palette and per wall colour (a curvy course has hundreds of pieces);
// the editor keeps one mesh per solid so clicks map back to pieces.


const CHECKPOINT_IDLE = '#3a86ff';
const CHECKPOINT_DONE = '#2ecc71';

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

/** Static boxes merged by look: floors (checker top + sides) per palette, walls and rails per colour. */
function mergedStatics(solids: Solid[], theme: Theme): THREE.Mesh[] {
  const floors = new Map<Palette, { tops: THREE.BufferGeometry[]; sides: THREE.BufferGeometry[] }>();
  const colored = new Map<string, THREE.BufferGeometry[]>();
  const matrix = new THREE.Matrix4();
  for (const solid of solids) {
    if (solid.shape.kind !== 'box') continue;
    const [sx, , sz] = solid.shape.size;
    const box = new THREE.BoxGeometry(...solid.shape.size);
    matrix.compose(new THREE.Vector3(...solid.position), new THREE.Quaternion(...solid.rotation), new THREE.Vector3(1, 1, 1));
    if (solid.palette) {
      const top = boxFaces(box, (m) => m === 2);
      // Bake the checker scale into the UVs (one tile = 4×4 units), so every floor shares one texture.
      const uv = top.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx / 4, uv.getY(i) * sz / 4);
      const group = floors.get(solid.palette) ?? { tops: [], sides: [] };
      group.tops.push(top.applyMatrix4(matrix));
      group.sides.push(boxFaces(box, (m) => m !== 2).applyMatrix4(matrix));
      floors.set(solid.palette, group);
    } else {
      const key = solid.color ?? '#cccccc';
      colored.set(key, [...(colored.get(key) ?? []), box.applyMatrix4(matrix)]);
      continue;
    }
    box.dispose();
  }
  const meshes: THREE.Mesh[] = [];
  for (const [palette, { tops, sides }] of floors) {
    const [a, b, side] = theme.palettes[palette];
    let base = checkerCache.get(a + b);
    if (!base) checkerCache.set(a + b, (base = checkerTexture(a, b)));
    meshes.push(
      new THREE.Mesh(mergeGeometries(tops), new THREE.MeshStandardMaterial({ map: base.clone(), roughness: 0.8 })),
      new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ color: side, roughness: 0.9 })),
    );
    [...tops, ...sides].forEach((g) => g.dispose());
  }
  for (const [color, boxes] of colored) {
    meshes.push(new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })));
    boxes.forEach((g) => g.dispose());
  }
  return meshes;
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

function effectMesh(solid: Solid): THREE.Mesh | null {
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
  if (e.kind === 'conveyor') return new THREE.Mesh(geo, scrollingTop(s.size, slats(), Math.round(s.size[2] / 1.5), '#2a2d38'));
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

function solidMesh(solid: Solid, theme: Theme): THREE.Mesh {
  const special = effectMesh(solid);
  if (special) return special;
  const s = solid.shape;
  if (s.kind === 'cylinder') {
    if (solid.role === 'bumper') return bumperMesh(s.radius, s.height);
    return new THREE.Mesh(
      new THREE.CylinderGeometry(s.radius, s.radius, s.height, 24),
      new THREE.MeshStandardMaterial({ color: solid.color ?? '#cccccc', roughness: 0.7 }),
    );
  }
  const material = solid.palette
    ? floorMaterials(theme, solid.palette, s.size)
    : new THREE.MeshStandardMaterial({ color: solid.color ?? '#cccccc', roughness: 0.7 });
  return new THREE.Mesh(new THREE.BoxGeometry(...s.size), material);
}

interface CheckpointView {
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  flag: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
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
  private springs = new Map<number, number>(); // spring solid id -> bounce 0..1

  constructor(scene: THREE.Object3D, level: ResolvedLevel, { merge = true } = {}) {
    const mergeable = (s: Solid) => merge && !s.motion && !s.effect && s.shape.kind === 'box';
    for (const mesh of mergedStatics(level.solids.filter(mergeable), THEMES[level.theme])) {
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const solid of level.solids) {
      if (mergeable(solid)) continue;
      const mesh = solidMesh(solid, THEMES[level.theme]);
      mesh.position.set(...solid.position);
      mesh.quaternion.set(...solid.rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.piece = solid.piece; // lets the editor map clicks back to level pieces
      scene.add(mesh);
      this.meshes[solid.id] = mesh;
      if (solid.motion) this.moving.push(solid);
      const e = solid.effect;
      const top = Array.isArray(mesh.material) ? (mesh.material[2] as THREE.MeshStandardMaterial) : null;
      if (e?.kind === 'crumble') this.crumbles.push(solid);
      if (e?.kind === 'boost' && top?.map) this.scrolling.push({ tex: top.map, rate: -1.5 });
      if (e?.kind === 'conveyor' && top?.map) this.scrolling.push({ tex: top.map, rate: e.speed / 1.5 });
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
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3.2),
        new THREE.MeshStandardMaterial({ color: '#dddddd' }),
      );
      pole.position.set(2.4, 1.6, 0);
      group.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.8),
        new THREE.MeshStandardMaterial({ color: CHECKPOINT_IDLE, side: THREE.DoubleSide }),
      );
      flag.position.set(3.0, 2.8, 0);
      group.add(flag);
      group.position.set(...cp.position);
      group.userData.piece = cp.piece;
      scene.add(group);
      this.checkpoints.push({ ring, flag });
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

  setCheckpoint(index: number, reached: boolean) {
    const color = reached ? CHECKPOINT_DONE : CHECKPOINT_IDLE;
    this.checkpoints[index].flag.material.color.set(color);
    this.checkpoints[index].ring.material.emissive.set(color);
  }

  update(sim: Simulation, dt: number) {
    for (const solid of this.moving) {
      const pose = sim.solidPose(solid.id);
      this.meshes[solid.id].position.set(...pose.position);
      this.meshes[solid.id].quaternion.set(...pose.rotation);
    }
    for (const [id, pulse] of this.pulses) {
      const next = Math.max(0, pulse - dt * 4);
      const s = 1 + next * 0.25;
      this.meshes[id].scale.set(s, 1, s);
      if (next === 0) this.pulses.delete(id);
      else this.pulses.set(id, next);
    }
    if (this.goalArch) this.goalArch.rotation.y = sim.time * 0.8;

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
