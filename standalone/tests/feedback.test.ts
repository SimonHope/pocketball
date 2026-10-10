import { describe, expect, it } from 'vitest';
import { LEVELS, levelId } from '../src/levels';
import { parseLevel, type LevelData, type Piece } from '../src/levels/schema';
import { computeFeedback, eventsFromFile, levelVersion, RunRecorder, type RunLog, type StoredEvent } from '../src/meta/feedback';
import { makeSim, skipCountdown, teleport, toward } from './helpers';

// Course feedback: what a run records, and how ratings and runs add up per course.

function course(...extra: Piece[]): LevelData {
  return parseLevel({
    format: 1, name: 'Feedback', start: { position: [0, 1, 0] },
    pieces: [{ type: 'pad', center: [0, 0, -10], w: 10, d: 30 }, { type: 'goal', position: [0, 0, -22] }, ...extra],
  });
}

describe('run recorder', () => {
  it('records falls where the ball left the floor, checkpoint splits, stars, restarts and the finish', async () => {
    const sim = await makeSim(course({ type: 'checkpoint', position: [0, 0, -8] }, { type: 'star', position: [0, 1.4, -12] }));
    const rec = new RunRecorder();
    rec.reset();
    const go = (seconds: number, input: () => { x: number; z: number }) => {
      for (let i = 0; i < seconds * 120; i++) {
        sim.step(input());
        rec.step(sim);
        for (const e of sim.drainEvents()) rec.event(e, sim);
      }
    };
    skipCountdown(sim);
    go(1.2, toward(sim, 0, -9)); // through the checkpoint
    teleport(sim, [3, 1, -10]);
    go(2, () => ({ x: 1, z: 0 })); // off the right edge (x = 5)
    expect(rec.log.splits).toHaveLength(1);
    expect(rec.log.falls).toHaveLength(1);
    const [x, z, section] = rec.log.falls[0];
    expect(x).toBeGreaterThanOrEqual(3);
    expect(x).toBeLessThanOrEqual(5);
    expect(z).toBe(-10);
    expect(section).toBe(1);
    go(3, toward(sim, 0, -22));
    expect(rec.log.stars).toEqual([0]);
    expect(rec.log.finished).toBe(true);
    expect(rec.log.time).toBeGreaterThan(rec.log.splits[0]);
    rec.reset(true);
    expect(rec.log).toMatchObject({ restarts: 1, falls: [], finished: false });
    rec.reset();
    expect(rec.log.restarts).toBe(0);
  });
});

describe('level versions', () => {
  it('are stable, and change with the layout', () => {
    const level = LEVELS[0];
    expect(levelVersion(level)).toMatch(/^[0-9a-f]{8}$/);
    expect(levelVersion(JSON.parse(JSON.stringify(level)))).toBe(levelVersion(level));
    expect(levelVersion({ ...level, pieces: level.pieces.slice(1) })).not.toBe(levelVersion(level));
  });
});

describe('computeFeedback', () => {
  const runLog = (over: Partial<RunLog>): RunLog => ({ falls: [], splits: [10, 20], restarts: 0, stars: [], time: 30, finished: true, ...over });
  const ev = (name: string, props: Record<string, unknown>, t = 0): StoredEvent => ({ name, t, props });

  it('adds up ratings, quits, falls and section times per course version', () => {
    const events = [
      ev('level_feedback', { level: 'a', v: '1', fun: 2, difficulty: 'hard', length: 'right', stars: 'fun', variety: 'samey', comment: 'too many gaps', spot: [3, -40] }, 5),
      ev('level_feedback', { level: 'a', v: '1', fun: 4, difficulty: 'right', comment: 'nice', spot: [1, 2] }, 9),
      ev('level_feedback', { level: 'a', v: '1', quit: 'hard' }),
      ev('level_finish', { level: 'a', v: '1', run: runLog({ falls: [[1, -30, 1], [2, -31, 1]], stars: [0, 2] }) }),
      ev('level_finish', { level: 'a', v: '1', run: runLog({ splits: [12, 26], time: 34, stars: [0] }) }),
      ev('level_quit', { level: 'a', v: '1', run: runLog({ falls: [[0, -10, 0]], finished: false, splits: [] }) }),
      ev('level_feedback', { level: 'b', v: '1', fun: 5, difficulty: 'right' }),
      ev('level_feedback', { level: 'a', v: 'old', fun: 1 }), // an older layout: its own entry
      ev('level_start', { level: 'a' }),
    ];
    const all = computeFeedback(events);
    expect(all.map((c) => `${c.level}@${c.v}`)).toEqual(['a@old', 'a@1', 'b@1']); // most attention first
    const a = all.find((c) => c.level === 'a' && c.v === '1')!;
    expect(a).toMatchObject({ ratings: 2, fun: 3, runs: 3, finishedRuns: 2, fallsPerRun: 1, quits: { hard: 1 } });
    expect(a.difficulty).toEqual({ easy: 0, right: 0.5, hard: 0.5 });
    expect(a.length.right).toBe(1); // only one rating answered it
    expect(a.worstSection).toEqual({ section: 1, fallsPerRun: 0.7 });
    expect(a.sectionTimes).toEqual([12, 14, 10]); // medians of [10, 12], [10, 14], [10, 8]
    expect(a.starRates).toEqual([1, 0, 0.5]);
    expect(a.comments).toEqual(['nice', 'too many gaps']); // latest first
    expect(a.spots).toEqual([[3, -40], [1, 2]]);
    // Only current layouts.
    expect(computeFeedback(events, new Map([['a', '1']])).map((c) => `${c.level}@${c.v}`)).toEqual(['a@1', 'b@1']);
  });

  it('reads exported files and ignores anything else', () => {
    expect(eventsFromFile({ events: [{ name: 'level_feedback', t: 1, props: { level: 'a' } }, { nope: true }, 'x'] })).toHaveLength(1);
    expect(eventsFromFile({})).toEqual([]);
    expect(eventsFromFile(null)).toEqual([]);
  });

  it('works for every built-in course id', () => {
    const level = LEVELS[3];
    const r = computeFeedback([ev('level_feedback', { level: levelId(level), v: levelVersion(level), fun: 3 })]);
    expect(r[0].level).toBe(levelId(level));
  });
});
