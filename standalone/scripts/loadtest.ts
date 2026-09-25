import { spawn } from 'node:child_process';

// Load test: starts a server, then R rooms × B bots (one process per room) racing a real course.
// Reports the server's CPU and event-loop delay while racing, and each room's race summary.
// Usage: npm run loadtest -- [rooms=4] [botsPerRoom=16] [levelIndex=0]
//        npm run loadtest -- [rooms=4] quick [games=2]   (Quick Play: server-side bots)
const args = process.argv.slice(2);
const quick = args[1] === 'quick';
const rooms = Number(args[0] ?? 4);
const bots = quick ? 8 : Number(args[1] ?? 16);
const level = Number(args[2] ?? (quick ? 2 : 0));
const port = 2600 + Math.floor(Math.random() * 300);
const url = `ws://localhost:${port}`;

// WORKERS=n REDIS_URL=… npm run loadtest … runs the multi-process cluster instead.
// Own process group, so the whole tree (npx → tsx → gateway → workers) can be stopped at the end.
const server = spawn('npx', ['tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(port), STATS: '1' }, detached: true });
const stopServer = () => { try { process.kill(-server.pid!, 'SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stopServer);
const stats: { worker: number; cpu: number; loopP99ms: number; rssMb: number }[] = [];
await new Promise<void>((resolve) => {
  server.stdout.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      if (line.includes('Pocket Ball server') || line.includes('[gateway] listening')) resolve();
      if (line.startsWith('STATS ')) {
        const s = JSON.parse(line.slice(6));
        stats.push(s);
        console.log(`server w${s.worker}: cpu ${s.cpu}%  loop p99 ${s.loopP99ms} ms  rss ${s.rssMb} MB`);
      }
    }
  });
  server.stderr.on('data', (d: Buffer) => process.stderr.write(d));
});
console.log(quick
  ? `Server up on ${url}. Starting ${rooms} Quick Play rooms (1 client + 7 server bots each), ${level} games each…`
  : `Server up on ${url}. Starting ${rooms} rooms × ${bots} bots on level ${level}…`);

const results = await Promise.all(Array.from({ length: rooms }, (_, i) => new Promise<Record<string, unknown>>((resolve) => {
  const child = spawn('npx', ['tsx', 'scripts/bot-room.ts', url, quick ? 'quick' : String(bots), String(level)]);
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { if (!String(d).includes('ExperimentalWarning')) process.stderr.write(`[room ${i}] ${d}`); });
  child.on('exit', () => {
    const line = out.split('\n').find((l) => l.startsWith('RESULT '));
    resolve(line ? JSON.parse(line.slice(7)) : { error: 'no result', output: out.slice(-500) });
  });
})));

stopServer();
console.log('\nRooms:');
for (const r of results) console.log(' ', JSON.stringify(r));
const workers = [...new Set(stats.map((s) => s.worker))].sort();
let totalCpu = 0, worstLoop = 0;
for (const w of workers) {
  const racing = stats.filter((s) => s.worker === w).slice(1, -1); // skip warm-up and wind-down samples
  if (!racing.length) continue;
  const avg = racing.reduce((n, s) => n + s.cpu, 0) / racing.length;
  totalCpu += avg;
  worstLoop = Math.max(worstLoop, ...racing.map((s) => s.loopP99ms));
  console.log(`worker ${w}: avg CPU ${avg.toFixed(1)}% of a core`);
}
if (totalCpu) {
  console.log(`\nServer while racing: ${totalCpu.toFixed(1)}% of one core in total across ${workers.length} process(es), worst event-loop p99 ${worstLoop} ms`);
  console.log(`≈ ${(totalCpu / rooms).toFixed(2)}% of a core per room → ~${Math.floor(80 / (totalCpu / rooms))} rooms per core at 80% load`);
}
process.exit(0);
