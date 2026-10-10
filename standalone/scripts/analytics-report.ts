import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../server/meta/store';
import { computeReport, FEEDBACK_EVENTS, storedEvents } from '../server/meta/report';
import { eventsFromFile } from '../src/meta/feedback';

// Usage: npm run analytics                       (reads DATA_DIR/hamball.db, default ./data)
//        npm run analytics -- a.json b.json      (also counts course feedback exported from browsers)
//        npm run analytics -- --export out.json  (writes the database's course feedback as a file
//                                                 for the feedback viewer, /feedback.html)
const args = process.argv.slice(2);
const exportAt = args.indexOf('--export');
const exportTo = exportAt >= 0 ? args[exportAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && (exportAt < 0 || i !== exportAt + 1));

const store = new Store(join(process.env.DATA_DIR ?? 'data', 'hamball.db'));
if (exportTo) {
  writeFileSync(exportTo, JSON.stringify({ format: 'pocketball-feedback', exported: new Date().toISOString(), events: storedEvents(store.db, FEEDBACK_EVENTS) }));
  console.log(`Wrote ${exportTo}`);
  process.exit(0);
}
const extra = files.flatMap((f) => eventsFromFile(JSON.parse(readFileSync(f, 'utf8'))));
const r = computeReport(store.db, Date.now(), extra);
const pct = (x: number | null) => (x === null ? 'n/a (not enough days yet)' : `${Math.round(x * 100)}%`);
const p = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

console.log(`Players: ${r.players}   Sessions: ${r.sessions}`);
console.log(`Day-1 retention: ${pct(r.retention.d1)} of ${r.retention.d1Cohort}   Day-7: ${pct(r.retention.d7)} of ${r.retention.d7Cohort}   (goal: D1 ≥ 25–30%)`);
console.log(`Session length: median ${r.sessionMinutes.median} min, average ${r.sessionMinutes.average} min`);
console.log('\nCourses, hardest first (finish rate = finishes / starts):');
for (const l of r.levels) console.log(`  ${l.level.padEnd(20)} ${String(l.starts).padStart(5)} starts  ${String(l.finishes).padStart(5)} finishes  ${String(l.quits).padStart(5)} quits  ${Math.round(l.finishRate * 100)}%`);

console.log(`\nCourse feedback (current layouts; the ones to look at first on top)${files.length ? `, with ${files.length} file(s)` : ''}:`);
if (!r.feedback.length) console.log('  none yet: play with ?playtest, or rate courses from the results screen');
for (const c of r.feedback) {
  const quits = Object.entries(c.quits).map(([why, n]) => `${why} ${n}`).join(', ');
  console.log(`  ${c.level} (v ${c.v}): ${c.ratings} ratings, fun ${c.fun ?? '–'}/5, ${c.runs} runs (${c.finishedRuns} finished), ${c.fallsPerRun} falls/run`);
  if (c.ratings) {
    console.log(`    difficulty  easy ${p(c.difficulty.easy)}  right ${p(c.difficulty.right)}  hard ${p(c.difficulty.hard)}    length  short ${p(c.length.short)}  right ${p(c.length.right)}  long ${p(c.length.long)}`);
    console.log(`    stars  easy ${p(c.stars.easy)}  fun ${p(c.stars.fun)}  hard ${p(c.stars.hard)}  unnoticed ${p(c.stars.unnoticed)}    variety  fresh ${p(c.variety.fresh)}  ok ${p(c.variety.ok)}  samey ${p(c.variety.samey)}`);
  }
  if (quits) console.log(`    quit: ${quits}`);
  if (c.worstSection) console.log(`    most falls: ${c.worstSection.section ? `after checkpoint ${c.worstSection.section}` : 'before the first checkpoint'} (${c.worstSection.fallsPerRun}/run)`);
  if (c.sectionTimes.length) console.log(`    median time per section: ${c.sectionTimes.map((t) => `${t}s`).join(' → ')}`);
  if (c.starRates.length) console.log(`    stars found: ${c.starRates.map((x, i) => `★${i + 1} ${p(x).trim()}`).join('  ')}`);
  for (const text of c.comments.slice(0, 5)) console.log(`    “${text}”`);
}

console.log('\nTop errors:');
for (const e of r.errors) console.log(`  ${String(e.count).padStart(5)}×  ${e.message}`);
if (!r.errors.length) console.log('  none');
