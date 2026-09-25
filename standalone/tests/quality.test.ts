import { describe, expect, it } from 'vitest';
import { AutoQuality } from '../src/render/quality';

const feed = (q: AutoQuality, ms: number, frames: number) => { for (let i = 0; i < frames; i++) q.sample(ms); };

describe('auto quality', () => {
  it('steps down when frames are slow, one tier at a time', () => {
    const changes: string[] = [];
    const q = new AutoQuality('high', (t) => changes.push(t));
    feed(q, 16, 400);
    expect(changes).toEqual([]);
    feed(q, 33, 150); // 30 fps
    expect(q.tier).toBe('medium');
    feed(q, 33, 300); // (after settling for a moment) still slow

    expect(changes).toEqual(['medium', 'low']);
  });

  it('ignores hidden-tab hiccups', () => {
    const q = new AutoQuality('high', () => {});
    feed(q, 16, 200);
    feed(q, 5000, 50);
    expect(q.tier).toBe('high');
  });

  it('steps back up at most once when there is lots of headroom', () => {
    const q = new AutoQuality('low', () => {});
    feed(q, 8, 2000);
    expect(q.tier).toBe('medium');
    feed(q, 8, 5000);
    expect(q.tier).toBe('medium'); // no ping-pong
  });

  it('phones start lower', () => {
    expect(AutoQuality.initialTier(true)).toBe('medium');
    expect(AutoQuality.initialTier(false)).toBe('high');
  });
});
