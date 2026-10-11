import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { THEMES, type ThemeName } from '../levels/themes';
import type { ResolvedLevel } from '../sim/geometry';
import { skyTexture as paintedSky } from './backdrop';
import { BallView } from './ball-view';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
}

function skyTexture([top, horizon, bottom]: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.6, horizon);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStage(fov: number): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c4e3ff', 70, 200);

  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 500);

  const ambient = new THREE.HemisphereLight('#ffffff', '#6a7a99', 1.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const stage = { renderer, scene, camera, sun, ambient };
  applyTheme(stage, 'meadow');
  return stage;
}

/** Sky, fog and lighting for a world theme. */
export function applyTheme({ scene, sun, ambient }: Stage, name: ThemeName) {
  const t = THEMES[name];
  const old = scene.background as THREE.Texture | null;
  if (old && !old.userData.keep) old.dispose();
  // A theme with a look: a world-locked painted sky that the fog fades into.
  scene.background = t.look ? paintedSky(t.look) : skyTexture(t.sky);
  BallView.environment = t.look ? scene.background : null; // the glass reflects the painted world
  const fog = scene.fog as THREE.Fog;
  fog.color.set(t.look ? t.look.sky.horizon : t.fog);
  [fog.near, fog.far] = t.look ? [90, 320] : [70, 200]; // the painted panorama does the far distance
  sun.color.set(t.sun.color);
  sun.intensity = t.sun.intensity;
  ambient.color.set(t.ambient.sky);
  ambient.groundColor.set(t.ambient.ground);
  ambient.intensity = t.ambient.intensity;
}

/**
 * Downhill courses: a valley floor far below the finish, so you can see how high the summit
 * is. It sits deeper than the fall-respawn depth, so a falling ball never visibly reaches it.
 */
export function addValley(scene: THREE.Object3D, level: ResolvedLevel) {
  const box = new THREE.Box3();
  for (const s of level.solids) box.expandByPoint(new THREE.Vector3(...s.position));
  if (box.max.y - box.min.y < 40) return; // not a downhill course
  const centre = box.getCenter(new THREE.Vector3());
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(450, 128).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: THEMES[level.theme].ground, roughness: 1 }),
  );
  ground.position.set(centre.x, box.min.y - 45, centre.z);
  ground.receiveShadow = true;
  scene.add(ground);
}

/** Floating clouds below and around the course, for a sense of height. */
export function addClouds(scene: THREE.Object3D, level: ResolvedLevel) {
  const box = new THREE.Box3();
  for (const s of level.solids) box.expandByPoint(new THREE.Vector3(...s.position));
  const mat = new THREE.MeshStandardMaterial({ color: THEMES[level.theme].clouds, roughness: 1 });
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  // All 90 puffs in one merged mesh: a single draw call.
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const cx = rand(box.min.x - 60, box.max.x + 60), cy = rand(box.min.y - 40, box.min.y - 15), cz = rand(box.min.z - 60, box.max.z + 40);
    for (let j = 0; j < 5; j++) {
      puffs.push(new THREE.SphereGeometry(rand(3, 6), 12, 10).translate(cx + rand(-8, 8), cy + rand(-1.5, 1.5), cz + rand(-4, 4)));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(puffs), mat));
  puffs.forEach((g) => g.dispose());
}
