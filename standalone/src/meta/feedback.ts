import type { LevelData } from '../levels/schema';
import type { Vec3 } from '../sim/math';
import type { SimEvent } from '../sim/simulation';

// Course feedback for tuning: what players think of each course (ratings after a run, or why
// they quit) and what happened on their runs (where they fell, how long each part took). No DOM:
// shared by the game, the analytics report (server/meta/report.ts) and the feedback viewer.

/** What happened on one run, recorded automatically. */
export interface RunLog {
  /** Where the ball left the floor before each fall (rounded x, z), and how many checkpoints were reached by then. */
  falls: [x: number, z: number, section: number][];
  /** Elapsed time at each checkpoint, in the order reached. */
  splits: number[];
  /** Restarts on this course before this run. */
  restarts: number;
  /** Indices of the stars collected. */
  stars: number[];
  time: number;
  finished: boolean;
}

export type Fun = 1 | 2 | 3 | 4 | 5;
export interface Ratings {
  fun?: Fun;
  difficulty?: 'easy' | 'right' | 'hard';
  length?: 'short' | 'right' | 'long';
  stars?: 'easy' | 'fun' | 'hard' | 'unnoticed';
  variety?: 'fresh' | 'ok' | 'samey';
  /** The quit form instead of the ratings: why they stopped. */
  quit?: 'hard' | 'long' | 'boring' | 'lost' | 'other';
  /** The most frustrating spot, tapped on the course map (world x, z). */
  spot?: [x: number, z: number];
  /** Playtest mode only. */
  comment?: string;
}

export interface Feedback extends Ratings {
  level: string;
  /** Which version of the course (see levelVersion): ratings of an older layout aren't mixed in. */
  v: string;
}

/** An analytics event as the server stores it (and as exported feedback files hold them). */
export interface StoredEvent {
  name: string;
  t: number;
  props?: Record<string, unknown>;
}

export const MAX_FALLS = 40;
export const MAX_COMMENT = 200;

/** A short hash of a course's pieces (8 hex digits): it changes whenever the layout does. */
export function levelVersion(level: LevelData): string {
  const text = JSON.stringify(level.pieces);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Records a run from the simulation: call `step` every sim step, then `event` for each of its events. */
export class RunRecorder {
  log: RunLog = RunRecorder.empty(0);
  private lastGround: Vec3 | null = null;
  private sections = 0;

  private static empty(restarts: number): RunLog {
    return { falls: [], splits: [], restarts, stars: [], time: 0, finished: false };
  }

  /** A fresh run: `restart` counts it as another try at the same course. */
  reset(restart = false) {
    this.log = RunRecorder.empty(restart ? this.log.restarts + 1 : 0);
    this.lastGround = null;
    this.sections = 0;
  }

  step(sim: { grounded: boolean; position(): Vec3 }) {
    if (sim.grounded) this.lastGround = sim.position();
  }

  event(e: SimEvent, sim: { elapsed: number }) {
    const log = this.log;
    switch (e.type) {
      case 'fall':
        if (this.lastGround && log.falls.length < MAX_FALLS) log.falls.push([Math.round(this.lastGround[0]), Math.round(this.lastGround[2]), this.sections]);
        this.lastGround = null;
        break;
      case 'checkpoint':
        this.sections++;
        log.splits.push(r1(sim.elapsed));
        break;
      case 'star':
        log.stars.push(e.index);
        break;
      case 'finish':
        log.finished = true;
        log.time = r1(e.time);
        break;
    }
  }

  /** The run so far (for a quit, `time` is how long they played). */
  snapshot(elapsed: number): RunLog {
    return { ...this.log, time: this.log.finished ? this.log.time : r1(elapsed), falls: [...this.log.falls], splits: [...this.log.splits], stars: [...this.log.stars] };
  }
}

// ---------- Report ----------

export interface CourseFeedback {
  level: string;
  v: string;
  ratings: number;
  /** Average fun, 1–5 (null with no fun ratings). */
  fun: number | null;
  /** Shares (0–1) of each answer, among the ratings that answered that question. */
  difficulty: Record<'easy' | 'right' | 'hard', number>;
  length: Record<'short' | 'right' | 'long', number>;
  stars: Record<'easy' | 'fun' | 'hard' | 'unnoticed', number>;
  variety: Record<'fresh' | 'ok' | 'samey', number>;
  quits: Partial<Record<NonNullable<Ratings['quit']>, number>>;
  runs: number;
  finishedRuns: number;
  fallsPerRun: number;
  /** The checkpoint section with the most falls per run (0 = before the first checkpoint). */
  worstSection: { section: number; fallsPerRun: number } | null;
  /** Median seconds from each checkpoint to the next (first entry: start to checkpoint 1); finished runs only. */
  sectionTimes: number[];
  /** How often each star was found on finished runs (0–1), by index. */
  starRates: number[];
  falls: [number, number][];
  spots: [number, number][];
  /** Latest first. */
  comments: string[];
  /** Higher = look at this course first. */
  attention: number;
}

const share = <K extends string>(keys: readonly K[], answers: (K | undefined)[]): Record<K, number> => {
  const given = answers.filter((a): a is K => a !== undefined);
  return Object.fromEntries(keys.map((k) => [k, given.length ? given.filter((a) => a === k).length / given.length : 0])) as Record<K, number>;
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const isRun = (x: unknown): x is RunLog => !!x && typeof x === 'object' && Array.isArray((x as RunLog).falls) && Array.isArray((x as RunLog).splits);

/**
 * Per-course numbers from `level_feedback`, `level_finish` and `level_quit` events, one entry
 * per course version, the courses needing the most attention first (least fun, most "too
 * hard" and quits). Pass `latest` (level → version) to keep only each course's current layout.
 */
export function computeFeedback(events: StoredEvent[], latest?: Map<string, string>): CourseFeedback[] {
  const groups = new Map<string, { level: string; v: string; ratings: Ratings[]; runs: RunLog[]; comments: { t: number; text: string }[] }>();
  for (const e of events) {
    if (e.name !== 'level_feedback' && e.name !== 'level_finish' && e.name !== 'level_quit') continue;
    const p = e.props ?? {};
    const level = typeof p.level === 'string' ? p.level : null;
    const v = typeof p.v === 'string' ? p.v : '?';
    if (!level || (latest && latest.has(level) && latest.get(level) !== v)) continue;
    const key = `${level}@${v}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { level, v, ratings: [], runs: [], comments: [] }));
    // Ratings come from level_feedback; runs from level_finish and level_quit.
    if (e.name === 'level_feedback') {
      g.ratings.push(p as Ratings);
      if (typeof p.comment === 'string' && p.comment.trim()) g.comments.push({ t: e.t, text: p.comment.trim().slice(0, MAX_COMMENT) });
    } else if (isRun(p.run)) g.runs.push(p.run);
  }

  return [...groups.values()].map((g) => {
    const funs = g.ratings.map((r) => r.fun).filter((f): f is Fun => typeof f === 'number');
    const fun = funs.length ? Math.round((funs.reduce((a, b) => a + b, 0) / funs.length) * 10) / 10 : null;
    const quits: CourseFeedback['quits'] = {};
    for (const r of g.ratings) if (r.quit) quits[r.quit] = (quits[r.quit] ?? 0) + 1;
    const runs = g.runs.length, finished = g.runs.filter((r) => r.finished);
    const falls = g.runs.flatMap((r) => r.falls);
    const bySection = new Map<number, number>();
    for (const [, , s] of falls) bySection.set(s, (bySection.get(s) ?? 0) + 1);
    const worst = [...bySection.entries()].sort((a, b) => b[1] - a[1])[0];
    const sectionCount = Math.max(0, ...finished.map((r) => r.splits.length + 1));
    const sectionTimes = Array.from({ length: sectionCount }, (_, i) => median(finished.flatMap((r) => {
      const marks = [0, ...r.splits, r.time];
      return marks.length > i + 1 ? [marks[i + 1] - marks[i]] : [];
    })));
    const starCount = Math.max(0, ...finished.flatMap((r) => r.stars.map((s) => s + 1)));
    const difficulty = share(['easy', 'right', 'hard'] as const, g.ratings.map((r) => r.difficulty));
    const quitCount = Object.values(quits).reduce((a, b) => a + (b ?? 0), 0);
    return {
      level: g.level,
      v: g.v,
      ratings: g.ratings.filter((r) => !r.quit).length,
      fun,
      difficulty,
      length: share(['short', 'right', 'long'] as const, g.ratings.map((r) => r.length)),
      stars: share(['easy', 'fun', 'hard', 'unnoticed'] as const, g.ratings.map((r) => r.stars)),
      variety: share(['fresh', 'ok', 'samey'] as const, g.ratings.map((r) => r.variety)),
      quits,
      runs,
      finishedRuns: finished.length,
      fallsPerRun: runs ? Math.round((falls.length / runs) * 10) / 10 : 0,
      worstSection: worst && runs ? { section: worst[0], fallsPerRun: Math.round((worst[1] / runs) * 10) / 10 } : null,
      sectionTimes: sectionTimes.map((t) => Math.round(t * 10) / 10),
      starRates: Array.from({ length: starCount }, (_, i) => (finished.length ? finished.filter((r) => r.stars.includes(i)).length / finished.length : 0)),
      falls: falls.map(([x, z]) => [x, z] as [number, number]),
      spots: g.ratings.flatMap((r) => (Array.isArray(r.spot) && r.spot.length === 2 ? [r.spot] : [])),
      comments: g.comments.sort((a, b) => b.t - a.t).map((c) => c.text),
      attention: (fun === null ? 0 : 5 - fun) + difficulty.hard * 2 + (g.ratings.length ? (quitCount / g.ratings.length) * 2 : 0),
    };
  }).sort((a, b) => b.attention - a.attention || b.runs - a.runs);
}

/** Events from an exported feedback file (or anything shaped like one); ignores what isn't. */
export function eventsFromFile(json: unknown): StoredEvent[] {
  const list = (json as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is StoredEvent => !!e && typeof e === 'object' && typeof (e as StoredEvent).name === 'string' && typeof (e as StoredEvent).t === 'number');
}
