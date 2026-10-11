import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Effects } from '../src/render/effects';
import { Spring } from '../src/render/ball-view';

// Game-feel pieces that don't need a screen: the particle pools and the squash spring.

describe('effects', () => {
  afterEach(() => { Effects.scale = 1; });

  it('bursts emit particles that age out', () => {
    const fx = new Effects(new THREE.Group());
    fx.burst('dust', [0, 0, 0], { strength: 1 });
    fx.update(0.01);
    const n = fx.count;
    expect(n).toBeGreaterThan(10);
    for (let t = 0; t < 3; t += 0.05) fx.update(0.05);
    expect(fx.count).toBe(0);
    fx.dispose();
  });

  it('never holds more than its pools, reusing the oldest particles', () => {
    const fx = new Effects(new THREE.Group());
    for (let i = 0; i < 20; i++) fx.burst('confetti', [0, 0, 0]);
    fx.update(0.01);
    expect(fx.count).toBeLessThanOrEqual(440); // two pools of 220
    fx.dispose();
  });

  it('the low setting and reduced motion emit fewer', () => {
    const count = (scale: number) => {
      Effects.scale = scale;
      const fx = new Effects(new THREE.Group());
      fx.burst('sparkle', [0, 0, 0]);
      fx.update(0.01);
      const n = fx.count;
      fx.dispose();
      return n;
    };
    expect(count(0.5)).toBeLessThan(count(1));
    expect(count(0.25)).toBeGreaterThan(0);
  });

  it('updating reuses the same buffers (no allocation per frame)', () => {
    const group = new THREE.Group();
    const fx = new Effects(group);
    const points = group.children.filter((c): c is THREE.Points => c instanceof THREE.Points);
    const arrays = points.map((p) => p.geometry.getAttribute('position').array);
    fx.burst('spark', [0, 0, 0], { dir: [1, 0, 0] });
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    expect(points.map((p) => p.geometry.getAttribute('position').array)).toEqual(arrays);
    expect(points).toHaveLength(2); // two draw calls, however busy
    fx.dispose();
  });
});

describe('squash spring', () => {
  it('settles back to rest within half a second at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const s = new Spring();
      s.kick(8);
      let peak = 0;
      for (let t = 0; t < 0.5; t += dt) {
        s.step(dt);
        peak = Math.max(peak, Math.abs(s.value));
      }
      expect(peak).toBeGreaterThan(0.1);
      expect(Math.abs(s.value)).toBeLessThan(0.02);
    }
  });
});
