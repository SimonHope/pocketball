import { describe, expect, it } from 'vitest';
import { eliminationCount, hillScorer, rankForMode, type Standing } from '../src/net/modes';

const s = (id: string, o: Partial<Standing> = {}): Standing => ({
  id, finishTime: -1, progress: 0, dnf: false, score: 0, out: false, outOrder: 0, ...o,
});

describe('Elimination', () => {
  it('drops a quarter each round, at least one, never everyone', () => {
    expect([16, 12, 9, 7, 5, 4, 3, 2, 1].map(eliminationCount)).toEqual([4, 3, 3, 2, 2, 1, 1, 1, 0]);
  });

  it('16 players reach a single winner in 7 rounds (16→12→9→6→4→3→2→1)', () => {
    let left = 16, rounds = 0;
    while (left > 1) { left -= eliminationCount(left); rounds++; }
    expect(rounds).toBe(7);
  });

  it('ranks survivors first, then by how late they went out', () => {
    expect(rankForMode('elimination', [
      s('outFirst', { out: true, outOrder: 1 }),
      s('champ', { finishTime: 20 }),
      s('outLast', { out: true, outOrder: 3 }),
      s('runnerUp', { finishTime: 22 }),
    ])).toEqual(['champ', 'runnerUp', 'outLast', 'outFirst']);
  });
});

describe('King of the Hill', () => {
  const zone = { position: [0, 0, 0] as [number, number, number], radius: 4 };
  it('scores the only player in the zone', () => {
    expect(hillScorer(zone, [{ id: 'a', position: [1, 1, 1] }, { id: 'b', position: [9, 1, 0] }])).toBe('a');
  });
  it('nobody scores when the zone is contested (bump them out!)', () => {
    expect(hillScorer(zone, [{ id: 'a', position: [1, 1, 1] }, { id: 'b', position: [-2, 1, 0] }])).toBeNull();
  });
  it('ignores balls far above or below the zone', () => {
    expect(hillScorer(zone, [{ id: 'a', position: [1, 8, 1] }])).toBeNull();
  });
  it('ranks by score', () => {
    expect(rankForMode('hill', [s('a', { score: 5 }), s('b', { score: 12 }), s('c', { score: 0 })])).toEqual(['b', 'a', 'c']);
  });
});

describe('Bumper Arena', () => {
  it('survivors win; then whoever lasted longest', () => {
    expect(rankForMode('arena', [s('early', { out: true, outOrder: 1 }), s('survivor'), s('late', { out: true, outOrder: 2 })]))
      .toEqual(['survivor', 'late', 'early']);
  });
});
