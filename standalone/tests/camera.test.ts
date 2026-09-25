import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';

describe('camera modes', () => {
  it('C cycles chase → fixed → top-down → chase', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera());
    const seen = [rig.mode];
    for (let i = 0; i < 3; i++) { rig.mode = rig.nextMode; seen.push(rig.mode); }
    expect(seen).toEqual(['dynamic', 'fixed', 'top', 'dynamic']);
  });

  it('top-down looks almost straight down and keeps its heading on respawn', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.mode = 'top';
    const follow = { position: [0, 1, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number], grounded: true, lastGroundY: 0 };
    rig.snap(follow, 0);
    rig.snap(follow, Math.PI / 2); // a checkpoint facing another way
    expect(rig.yaw).toBe(0);
    rig.update(1 / 60, follow);
    const down = new THREE.Vector3();
    cam.getWorldDirection(down);
    expect(down.y).toBeLessThan(-0.95);
  });
});
