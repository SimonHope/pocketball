import type { StoredEvent } from '../meta/feedback';
import { load, save } from './storage';

// Course feedback kept in this browser: ratings and run logs (the same events analytics sends,
// when stats are on), so playtests work offline too and can be exported as a file.

const KEY = 'hamball.feedback';
const PLAYTEST_KEY = 'hamball.playtest';
const KEEP = 300;

function read(): StoredEvent[] {
  try {
    const list = JSON.parse(load(KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as StoredEvent[]) : [];
  } catch {
    return [];
  }
}

/** Keeps a feedback-related event (the newest KEEP of them). */
export function keepEvent(name: string, props: Record<string, unknown>) {
  const list = read();
  list.push({ name, t: Date.now(), props });
  save(KEY, JSON.stringify(list.slice(-KEEP)));
}

export function feedbackEvents(): StoredEvent[] {
  return read();
}

/** How many ratings (and quit answers) are kept here. */
export function ratingCount(): number {
  return read().filter((e) => e.name === 'level_feedback').length;
}

/** Whether this browser has rated this version of a course. */
export function hasRated(level: string, v: string): boolean {
  return read().some((e) => e.name === 'level_feedback' && e.props?.level === level && e.props?.v === v && !e.props?.quit);
}

/** Downloads everything kept here as a JSON file (the format `npm run analytics -- <files>` and the feedback viewer read). */
export function exportFeedback(anonId: string) {
  const body = JSON.stringify({ format: 'pocketball-feedback', anonId, exported: new Date().toISOString(), events: read() });
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pocketball-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Playtest mode: `?playtest` turns it on (remembered), `?playtest=0` off. It asks for feedback
 * after every finish and quit, and shows the comment box.
 */
export function playtestMode(): boolean {
  const param = new URLSearchParams(location.search).get('playtest');
  if (param !== null) save(PLAYTEST_KEY, param === '0' ? '' : '1');
  return load(PLAYTEST_KEY) === '1';
}
