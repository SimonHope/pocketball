import type { DatabaseSync } from 'node:sqlite';

// Numbers for M5's soft-launch exit test: day-1/day-7 retention, session length, and
// where players quit. Computed from the anonymous events table.

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY);

export interface Report {
  players: number;
  sessions: number;
  retention: { d1: number | null; d7: number | null; d1Cohort: number; d7Cohort: number };
  sessionMinutes: { median: number; average: number };
  levels: { level: string; starts: number; finishes: number; quits: number; finishRate: number }[];
  errors: { message: string; count: number }[];
}

export function computeReport(db: DatabaseSync, now = Date.now()): Report {
  const rows = db.prepare('SELECT anon_id, session, name, props, t FROM events ORDER BY t').all() as
    { anon_id: string; session: string; name: string; props: string; t: number }[];

  // Days each player was seen on.
  const days = new Map<string, Set<number>>();
  const sessions = new Map<string, { first: number; last: number }>();
  for (const r of rows) {
    let d = days.get(r.anon_id);
    if (!d) days.set(r.anon_id, (d = new Set()));
    d.add(dayOf(r.t));
    const s = sessions.get(r.session);
    if (!s) sessions.set(r.session, { first: r.t, last: r.t });
    else s.last = r.t;
  }

  // Retention: of players whose first day is old enough, how many came back exactly N days later.
  const today = dayOf(now);
  const retained = (n: number) => {
    let cohort = 0, back = 0;
    for (const d of days.values()) {
      const first = Math.min(...d);
      if (first + n > today) continue;
      cohort++;
      if (d.has(first + n)) back++;
    }
    return { cohort, rate: cohort ? back / cohort : null };
  };
  const d1 = retained(1), d7 = retained(7);

  const lengths = [...sessions.values()].map((s) => (s.last - s.first) / 60_000).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  const average = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;

  const levels = new Map<string, { starts: number; finishes: number; quits: number }>();
  for (const r of rows) {
    if (r.name !== 'level_start' && r.name !== 'level_finish' && r.name !== 'level_quit') continue;
    const level = String((JSON.parse(r.props) as { level?: string }).level ?? '?');
    let l = levels.get(level);
    if (!l) levels.set(level, (l = { starts: 0, finishes: 0, quits: 0 }));
    if (r.name === 'level_start') l.starts++;
    else if (r.name === 'level_finish') l.finishes++;
    else l.quits++;
  }

  const errors = (db.prepare('SELECT message, count FROM errors ORDER BY count DESC LIMIT 10').all() as { message: string; count: number }[]);

  return {
    players: days.size,
    sessions: sessions.size,
    retention: { d1: d1.rate, d7: d7.rate, d1Cohort: d1.cohort, d7Cohort: d7.cohort },
    sessionMinutes: { median: Math.round(median * 10) / 10, average: Math.round(average * 10) / 10 },
    levels: [...levels.entries()].map(([level, l]) => ({ level, ...l, finishRate: l.starts ? l.finishes / l.starts : 0 }))
      .sort((a, b) => a.finishRate - b.finishRate),
    errors,
  };
}
