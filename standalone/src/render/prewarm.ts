import * as THREE from 'three';
import { PALETTES } from '../levels/schema';
import { THEMES } from '../levels/themes';
import { Motes, skyTexture } from './backdrop';
import { BallView } from './ball-view';
import { surfaceMaterial } from './surfaces';

// Themes with a look paint their textures on first use and need a few extra shader variants
// (textured sides with shading, the reflective glass, the motes). Doing that while the menu is
// idle keeps the first course of a theme from stalling: compiled programs are shared by key,
// and painted textures are cached.

/** Paints every look's textures and compiles their shaders against `scene`'s lights, a theme at a time when idle. */
export function prewarmLooks(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
  const looks = Object.values(THEMES).flatMap((t) => (t.look ? [t.look] : []));
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(() => fn(), { timeout: 2000 }) : setTimeout(fn, 200));
  const next = (i: number) => {
    const look = looks[i];
    if (!look) return;
    idle(() => {
      const group = new THREE.Group();
      const box = new THREE.BoxGeometry(1, 1, 1);
      const shaded = box.clone();
      shaded.setAttribute('color', new THREE.BufferAttribute(new Float32Array(box.getAttribute('position').count * 3).fill(1), 3));
      const materials = [
        ...PALETTES.map((p) => surfaceMaterial(look.floors[p])),
        ...PALETTES.map((p) => surfaceMaterial(look.sides[p], { vertexColors: true, size: 256 })),
        surfaceMaterial(look.rail, { vertexColors: true, size: 256 }),
        surfaceMaterial(look.guard, { vertexColors: true, size: 256 }),
        surfaceMaterial(look.crumble),
      ];
      for (const m of materials) {
        group.add(new THREE.Mesh(m.vertexColors ? shaded : box, m));
        if (m.map) renderer.initTexture(m.map);
      }
      const sky = skyTexture(look);
      renderer.initTexture(sky);
      const prevEnv = BallView.environment;
      BallView.environment = sky;
      const ball = new BallView(group);
      ball.update([0, 0, 0], [0, 0, 0, 1], [0, 0, 0], 0);
      BallView.environment = prevEnv;
      group.add(new Motes(look.motes.color, 1).points);
      void renderer.compileAsync(group, camera, scene).finally(() => {
        ball.dispose();
        for (const m of materials) m.dispose(); // the programs and the cached textures stay
        box.dispose();
        shaded.dispose();
        next(i + 1);
      });
    });
  };
  next(0);
}
