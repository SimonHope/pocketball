import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { formatLevel } from '../src/levels/format';
import { addSafetyWalls, GUARD_COLOR } from '../src/levels/guard';
import { parseLevel } from '../src/levels/schema';
import { initPhysics } from '../src/sim/simulation';

// Rebuilds the safety walls on every race course in src/levels/ (or the files named).
// Usage: npm run add-walls [-- file.json ...]

await initPhysics();
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('src/levels').filter((f) => f.endsWith('.json'));
for (const file of files) {
  const path = file.includes('/') ? file : `src/levels/${file}`;
  const level = parseLevel(JSON.parse(readFileSync(path, 'utf8')));
  const walled = addSafetyWalls(level);
  const count = walled.pieces.filter((p) => p.type === 'block' && p.color === GUARD_COLOR).length;
  writeFileSync(path, formatLevel(walled));
  console.log(`${level.name.padEnd(18)} ${count} wall pieces`);
}
