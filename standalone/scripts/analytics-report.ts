import { join } from 'node:path';
import { Store } from '../server/meta/store';
import { computeReport } from '../server/meta/report';

// Usage: npm run analytics   (reads DATA_DIR/hamball.db, default ./data)
const store = new Store(join(process.env.DATA_DIR ?? 'data', 'hamball.db'));
const r = computeReport(store.db);
const pct = (x: number | null) => (x === null ? 'n/a (not enough days yet)' : `${Math.round(x * 100)}%`);

console.log(`Players: ${r.players}   Sessions: ${r.sessions}`);
console.log(`Day-1 retention: ${pct(r.retention.d1)} of ${r.retention.d1Cohort}   Day-7: ${pct(r.retention.d7)} of ${r.retention.d7Cohort}   (goal: D1 ≥ 25–30%)`);
console.log(`Session length: median ${r.sessionMinutes.median} min, average ${r.sessionMinutes.average} min`);
console.log('\nCourses, hardest first (finish rate = finishes / starts):');
for (const l of r.levels) console.log(`  ${l.level.padEnd(20)} ${String(l.starts).padStart(5)} starts  ${String(l.finishes).padStart(5)} finishes  ${String(l.quits).padStart(5)} quits  ${Math.round(l.finishRate * 100)}%`);
console.log('\nTop errors:');
for (const e of r.errors) console.log(`  ${String(e.count).padStart(5)}×  ${e.message}`);
if (!r.errors.length) console.log('  none');
