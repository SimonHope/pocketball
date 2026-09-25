import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { formatLevel } from '../levels/format';
import { parseLevel, type LevelData, type Piece } from '../levels/schema';
import { LevelView } from '../render/level-view';
import { applyTheme, createStage } from '../render/scene';
import { DRAFT_KEY, load, save } from '../render/storage';
import { Autopilot } from '../sim/autopilot';
import { resolveLevel } from '../sim/geometry';
import type { Vec3 } from '../sim/math';
import { initPhysics, Simulation } from '../sim/simulation';
import { blankLevel, PIECE_FIELDS, pieceTemplate, ROUTE_FIELDS, routeTemplate, vecKeys, type Field } from './fields';
import { buildForm } from './form';

// In-browser level editor. Edits a LevelData object directly; every change is autosaved
// as a draft that the game can playtest (`/?play=draft`).

await initPhysics();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Scene ----------
const stage = createStage(55);
const { renderer, scene, camera } = stage;
camera.position.set(25, 30, 30);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, -20);
orbit.update();
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setTranslationSnap(0.5);
scene.add(gizmo.getHelper());
const proxy = new THREE.Object3D();
scene.add(proxy);
const grid = new THREE.GridHelper(240, 60, 0x335577, 0x5a7fa8);
grid.position.y = -20;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);

// ---------- State ----------
type Selection = { kind: 'piece'; index: number } | { kind: 'route'; index: number } | null;

let level: LevelData = loadDraft() ?? blankLevel();
let selection: Selection = null;
const undoStack: string[] = [];
const redoStack: string[] = [];
let preview: THREE.Group | null = null;

function loadDraft(): LevelData | null {
  try { return parseLevel(JSON.parse(load(DRAFT_KEY) ?? 'null')); } catch { return null; }
}

function snapshot() {
  undoStack.push(JSON.stringify(level));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

/** Applies a change as one undoable step. */
function commit(mutate: () => void) {
  snapshot();
  mutate();
  refresh();
}

function refresh() {
  save(DRAFT_KEY, JSON.stringify(level));
  if (selection?.kind === 'piece' && !level.pieces[selection.index]) selection = null;
  if (selection?.kind === 'route' && !level.route?.[selection.index]) selection = null;
  rebuild();
  renderLists();
  renderProps();
  attachGizmo();
  validate();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(JSON.stringify(level));
  level = JSON.parse(prev) as LevelData;
  refresh();
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(JSON.stringify(level));
  level = JSON.parse(next) as LevelData;
  refresh();
}

// ---------- Preview ----------
function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose();
      m.dispose();
    }
  });
}

function rebuild() {
  if (preview) {
    scene.remove(preview);
    disposeGroup(preview);
  }
  preview = new THREE.Group();
  // A race needs a goal to draw; if it was deleted, draw the level without one.
  const hasGoal = level.pieces.some((p) => p.type === 'goal') || level.kind === 'arena';
  const drawable: LevelData = hasGoal ? level : { ...level, pieces: [...level.pieces, { type: 'goal', position: [0, -5000, 0] }] };
  const resolved = resolveLevel(drawable);
  new LevelView(preview, resolved, { merge: false }); // one mesh per piece, for picking
  applyTheme(stage, resolved.theme);

  // Start marker: an arrow showing the spawn point and facing.
  const start = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 16), new THREE.MeshStandardMaterial({ color: '#2ecc71' }));
  start.position.set(...level.start.position);
  start.rotation.set(-Math.PI / 2, THREE.MathUtils.degToRad(level.start.yaw ?? 0), 0, 'YXZ');
  preview.add(start);

  // Route: a line from the start through each waypoint (drawn at ball-center height).
  const route = level.route ?? [];
  const points = [new THREE.Vector3(...level.start.position), ...route.map((r) => new THREE.Vector3(r.p[0], r.p[1] + 1, r.p[2]))];
  preview.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ffd166' })));
  route.forEach((r, i) => {
    const selected = selection?.kind === 'route' && selection.index === i;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? 0.5 : 0.35, 12, 8),
      new THREE.MeshStandardMaterial({ color: r.wait ? '#c77dff' : '#ffd166', emissive: selected ? '#ff8c42' : '#000000' }),
    );
    dot.position.set(r.p[0], r.p[1] + 1, r.p[2]);
    dot.userData.route = i;
    preview!.add(dot);
  });

  // Highlight the selected piece.
  if (selection?.kind === 'piece') {
    const box = new THREE.Box3();
    preview.traverse((o) => { if (o.userData.piece === selection!.index) box.expandByObject(o); });
    if (!box.isEmpty()) preview.add(new THREE.Box3Helper(box.expandByScalar(0.15), 0xff8c42));
  }
  scene.add(preview);
}

// ---------- Selection + gizmo ----------
function selectedObject(): Record<string, unknown> | null {
  if (selection?.kind === 'piece') return level.pieces[selection.index] as unknown as Record<string, unknown>;
  if (selection?.kind === 'route') return (level.route?.[selection.index] as unknown as Record<string, unknown>) ?? null;
  return null;
}

function anchorOf(obj: Record<string, unknown>): THREE.Vector3 {
  const keys = vecKeys(obj);
  const sum = new THREE.Vector3();
  for (const k of keys) sum.add(new THREE.Vector3(...(obj[k] as Vec3)));
  const a = sum.divideScalar(Math.max(1, keys.length));
  if (selection?.kind === 'route') a.y += 1;
  return a;
}

let lastProxy = new THREE.Vector3();
let dragSnapshotTaken = false;

function attachGizmo() {
  const obj = selectedObject();
  if (!obj) {
    gizmo.detach();
    return;
  }
  proxy.position.copy(anchorOf(obj));
  lastProxy = proxy.position.clone();
  gizmo.attach(proxy);
}

const round = (n: number) => Math.round(n * 100) / 100;

gizmo.addEventListener('objectChange', () => {
  const obj = selectedObject();
  if (!obj) return;
  const d = proxy.position.clone().sub(lastProxy);
  if (d.lengthSq() === 0) return;
  if (!dragSnapshotTaken) {
    snapshot();
    dragSnapshotTaken = true;
  }
  for (const k of vecKeys(obj)) {
    const v = obj[k] as Vec3;
    obj[k] = [round(v[0] + d.x), round(v[1] + d.y), round(v[2] + d.z)];
  }
  lastProxy.copy(proxy.position);
  rebuild();
});
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (!e.value && dragSnapshotTaken) {
    dragSnapshotTaken = false;
    refresh();
  }
});

function select(sel: Selection) {
  selection = sel;
  rebuild();
  renderLists();
  renderProps();
  attachGizmo();
}

// Click (not drag) on the canvas picks a piece or waypoint.
const raycaster = new THREE.Raycaster();
let downAt: [number, number] | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== 0) return;
  if (gizmo.dragging || !preview) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  for (const hit of raycaster.intersectObjects(preview.children, true)) {
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.piece === undefined && o.userData.route === undefined) o = o.parent;
    if (!o) continue;
    if (o.userData.route !== undefined) return select({ kind: 'route', index: o.userData.route as number });
    if ((o.userData.piece as number) < level.pieces.length) return select({ kind: 'piece', index: o.userData.piece as number });
  }
  select(null);
});

// ---------- Panels ----------
function describe(p: Piece): string {
  switch (p.type) {
    case 'path': return `path ${p.width}w${p.rails ? ' rails' : ''}`;
    case 'pad': return `pad ${p.w}×${p.d}`;
    case 'mover': return `mover ${p.period}s`;
    case 'sweeper': return `sweeper ${p.length}`;
    case 'conveyor': return `conveyor ${p.speed ?? 12}`;
    case 'wind': return `wind ${p.dir.join(',')}`;
    default: return p.type;
  }
}

function listButton(text: string, selected: boolean, onClick: () => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.classList.toggle('sel', selected);
  b.addEventListener('click', onClick);
  return b;
}

function renderLists() {
  $('piece-list').replaceChildren(...level.pieces.map((p, i) =>
    listButton(`${i}  ${describe(p)}`, selection?.kind === 'piece' && selection.index === i, () => select({ kind: 'piece', index: i }))));
  $('route-list').replaceChildren(...(level.route ?? []).map((r, i) =>
    listButton(`${i}  (${r.p[0]}, ${r.p[1]}, ${r.p[2]})${r.wait ? ' wait' : ''}${r.speed ? ` @${r.speed}` : ''}`,
      selection?.kind === 'route' && selection.index === i, () => select({ kind: 'route', index: i }))));
  $<HTMLButtonElement>('btn-undo').disabled = undoStack.length === 0;
  $<HTMLButtonElement>('btn-redo').disabled = redoStack.length === 0;
}

const LEVEL_FIELDS: Field[] = [
  { key: 'name', kind: 'text', label: 'Name' },
  { key: 'theme', kind: 'theme', label: 'Theme' },
  { key: 'kind', kind: 'kind', label: 'Kind' },
  { key: 'start', kind: 'vec3', label: 'Start (ball)' },
  { key: 'yaw', kind: 'number', label: 'Start yaw (°)', step: 15 },
  { key: 'gold', kind: 'number', label: 'Gold ≤ s', step: 1 },
  { key: 'silver', kind: 'number', label: 'Silver ≤ s', step: 1 },
  { key: 'bronze', kind: 'number', label: 'Bronze ≤ s', step: 1 },
];

function renderProps() {
  const props = $('props');
  const obj = selectedObject();
  $('sel-actions').style.display = obj ? 'flex' : 'none';
  if (selection?.kind === 'piece' && obj) {
    const piece = level.pieces[selection.index];
    $('props-title').textContent = `Piece ${selection.index}: ${piece.type}`;
    buildForm(props, obj, PIECE_FIELDS[piece.type], (key, value) => commit(() => {
      if (value === undefined) delete obj[key];
      else obj[key] = value;
    }));
  } else if (selection?.kind === 'route' && obj) {
    $('props-title').textContent = `Waypoint ${selection.index}`;
    buildForm(props, obj, ROUTE_FIELDS, (key, value) => commit(() => {
      if (value === undefined) delete obj[key];
      else obj[key] = value;
    }));
  } else {
    $('props-title').textContent = 'Level settings';
    const medals = level.medals ?? { gold: 20, silver: 26, bronze: 35 };
    const view = { name: level.name, theme: level.theme ?? 'meadow', kind: level.kind ?? 'race', start: level.start.position, yaw: level.start.yaw ?? 0, ...medals };
    buildForm(props, view, LEVEL_FIELDS, (key, value) => commit(() => {
      if (key === 'name') level.name = String(value);
      else if (key === 'theme') level.theme = value as LevelData['theme'];
      else if (key === 'kind') level.kind = value as LevelData['kind'];
      else if (key === 'start') level.start.position = value as Vec3;
      else if (key === 'yaw') level.start.yaw = value as number;
      else level.medals = { ...medals, [key]: value as number };
    }));
  }
}

function validate() {
  const status = $('status');
  try {
    parseLevel(JSON.parse(JSON.stringify(level)));
    status.className = 'ok';
    status.textContent = `✓ Valid · ${level.pieces.length} pieces · ${level.route?.length ?? 0} waypoints · autosaved`;
  } catch (e) {
    status.className = 'err';
    status.textContent = `✗ ${(e as Error).message}`;
  }
}

function flash(text: string, ok: boolean) {
  const status = $('status');
  status.className = ok ? 'ok' : 'err';
  status.textContent = text;
}

// ---------- Actions ----------
/** Where new pieces go: the floor under the camera's focus point (or the focus point itself). */
function floorPointAtTarget(): Vec3 {
  const t = orbit.target.clone();
  if (preview) {
    raycaster.set(new THREE.Vector3(t.x, t.y + 50, t.z), new THREE.Vector3(0, -1, 0));
    const hit = raycaster.intersectObjects(preview.children, true).find((h) => h.object.userData.piece !== undefined);
    if (hit) t.y = hit.point.y;
  }
  return [Math.round(t.x * 2) / 2, Math.round(t.y * 2) / 2, Math.round(t.z * 2) / 2];
}

const ADDABLE: Piece['type'][] = ['pad', 'path', 'block', 'bumper', 'sweeper', 'mover', 'checkpoint', 'goal', 'zone', 'boost', 'spring', 'conveyor', 'crumble', 'wind', 'lowgrav'];
$('add-buttons').replaceChildren(...ADDABLE.map((type) => {
  const b = document.createElement('button');
  b.textContent = `+ ${type}`;
  b.addEventListener('click', () => {
    const existingGoal = level.pieces.findIndex((p) => p.type === 'goal');
    if (type === 'goal' && existingGoal >= 0) {
      flash('A level has exactly one goal — selected the existing one.', false);
      return select({ kind: 'piece', index: existingGoal });
    }
    commit(() => { level.pieces.push(pieceTemplate(type, floorPointAtTarget())); });
    select({ kind: 'piece', index: level.pieces.length - 1 });
  });
  return b;
}));

$('btn-add-wp').addEventListener('click', () => {
  const route = (level.route ??= []);
  const after = selection?.kind === 'route' ? selection.index + 1 : route.length;
  const base = route[after - 1]?.p ?? floorPointAtTarget();
  commit(() => { route.splice(after, 0, routeTemplate([base[0], base[1], base[2] - 4])); });
  select({ kind: 'route', index: after });
});

function deleteSelection() {
  if (selection?.kind === 'piece') {
    const i = selection.index;
    commit(() => { level.pieces.splice(i, 1); });
  } else if (selection?.kind === 'route') {
    const i = selection.index;
    commit(() => { level.route?.splice(i, 1); });
  }
  select(null);
}

function duplicateSelection() {
  if (selection?.kind !== 'piece') return;
  const src = level.pieces[selection.index];
  if (src.type === 'goal') return flash('A level has exactly one goal.', false);
  const copy = structuredClone(src) as unknown as Record<string, unknown>;
  for (const k of vecKeys(copy)) {
    const v = copy[k] as Vec3;
    copy[k] = [v[0] + 2, v[1], v[2] - 2];
  }
  commit(() => { level.pieces.push(copy as unknown as Piece); });
  select({ kind: 'piece', index: level.pieces.length - 1 });
}

function focusSelection() {
  const obj = selectedObject();
  const target = obj ? anchorOf(obj) : new THREE.Vector3(...level.start.position);
  const offset = camera.position.clone().sub(orbit.target);
  orbit.target.copy(target);
  camera.position.copy(target).add(offset);
  orbit.update();
}

$('btn-del').addEventListener('click', deleteSelection);
$('btn-dup').addEventListener('click', duplicateSelection);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-new').addEventListener('click', () => {
  if (!confirm('Start a new level? (Undo can bring the current one back.)')) return;
  commit(() => { level = blankLevel(); });
  select(null);
});
$('btn-open').addEventListener('click', () => $<HTMLInputElement>('file').click());
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const parsed = parseLevel(JSON.parse(await file.text()));
    commit(() => { level = parsed; });
    select(null);
    flash(`Opened ${file.name}`, true);
  } catch (err) {
    flash(`Couldn't open ${file.name}: ${(err as Error).message}`, false);
  }
  (e.target as HTMLInputElement).value = '';
});
$('btn-save').addEventListener('click', () => {
  const slug = level.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'level';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([formatLevel(level)], { type: 'application/json' }));
  a.download = `${slug}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(formatLevel(level));
    flash('Copied level JSON to the clipboard', true);
  } catch {
    flash('Clipboard not available', false);
  }
});
$('btn-play').addEventListener('click', () => {
  try {
    parseLevel(JSON.parse(JSON.stringify(level)));
  } catch (e) {
    return flash(`Fix this before playtesting: ${(e as Error).message}`, false);
  }
  save(DRAFT_KEY, JSON.stringify(level));
  location.href = `${import.meta.env.BASE_URL}?play=draft`;
});
$('btn-game').addEventListener('click', () => { location.href = import.meta.env.BASE_URL; });

// Runs the same check as the automated course test: can the bot finish by following the route?
$('btn-bot').addEventListener('click', () => {
  let data: LevelData;
  try {
    data = parseLevel(JSON.parse(JSON.stringify(level)));
  } catch (e) {
    return flash(`Fix this first: ${(e as Error).message}`, false);
  }
  if (!data.route?.length) return flash('Add route waypoints so the bot knows where to go.', false);
  const sim = new Simulation(resolveLevel(data));
  try {
    while (sim.phase === 'countdown') sim.step({ x: 0, z: 0 });
    sim.drainEvents();
    const pilot = new Autopilot(sim);
    let falls = 0;
    let fellAt = -1;
    for (let t = 0; t < 120 && sim.phase !== 'finished'; t += 1 / 120) {
      sim.step(pilot.input());
      for (const e of sim.drainEvents()) {
        if (e.type === 'fall') { falls++; fellAt = pilot.index; }
      }
      if (falls >= 3) break;
    }
    if (sim.phase === 'finished' && falls === 0) {
      const m = data.medals;
      flash(`✓ Bot finished in ${sim.elapsed.toFixed(2)}s with no falls${m && sim.elapsed > m.bronze ? ' — but slower than bronze; loosen medal times' : ''}`, !(m && sim.elapsed > m.bronze));
    } else {
      const where = fellAt >= 0 ? fellAt : pilot.index;
      flash(`✗ Bot ${sim.phase === 'finished' ? `finished but fell ${falls}×` : 'did not finish'} — trouble near waypoint ${where}`, false);
      if (level.route?.[where]) select({ kind: 'route', index: where });
    }
  } finally {
    sim.dispose();
  }
});

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (typing) return;
  if (mod && e.code === 'KeyD') { e.preventDefault(); duplicateSelection(); }
  else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelection(); }
  else if (e.code === 'KeyF') focusSelection();
  else if (e.code === 'Escape') select(null);
});

// ---------- Go ----------
refresh();
focusSelection();
renderer.setAnimationLoop(() => {
  orbit.update();
  renderer.render(scene, camera);
});
