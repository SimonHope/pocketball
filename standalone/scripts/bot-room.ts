import { ARENAS, LEVELS } from '../src/levels';
import { Bot } from '../src/net/bot';

// One room full of bots racing a real course. Prints a JSON summary line when the race ends.
// Usage: tsx scripts/bot-room.ts <serverUrl> <bots> <levelIndex>
//        tsx scripts/bot-room.ts <serverUrl> quick <games>   (1 client + server bots, Quick Play)
const [url = 'ws://localhost:2567', botsArg = '16', levelArg = '0'] = process.argv.slice(2);

if (botsArg === 'quick') {
  // One real client in a fresh Quick Play room; the server fills it with bots and cycles modes.
  const games = Number(levelArg) || 2;
  const me = await Bot.connect({ url, levels: LEVELS, arenas: ARENAS, quick: true, freshQuick: true });
  const played: string[] = [];
  let strikes = 0;
  const started = Date.now();
  while (played.length < games && Date.now() - started < 8 * 60_000) {
    while (!(me.net.phase === 'results' && me.net.state.final)) await new Promise((r) => setTimeout(r, 100));
    played.push(me.net.state.mode);
    strikes += [...me.net.state.players.values()].filter((p) => p.bot).reduce((n, p) => n + p.strikes, 0);
    while (me.net.phase === 'results') await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`RESULT ${JSON.stringify({ code: me.net.state.code, games: played, botStrikes: strikes, seconds: Math.round((Date.now() - started) / 1000) })}`);
  await me.stop();
  process.exit(0);
}

const count = Number(botsArg);
const level = Number(levelArg);

const host = await Bot.connect({ url, levels: LEVELS });
const code = host.net.state.code;
const guests = await Promise.all(Array.from({ length: count - 1 }, () => Bot.connect({ url, levels: LEVELS, code, autoReady: true })));
const bots = [host, ...guests];
const wait = async (check: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return check();
};
await wait(() => [...host.net.state.players.values()].filter((p) => p.ready).length === count - 1, 15_000);
host.net.setLevel(level);
await new Promise((r) => setTimeout(r, 300));
host.net.start();
const started = Date.now();
const done = await wait(() => host.net.phase === 'results', 6 * 60_000);

const players = [...host.net.state.players.values()];
const finishes = players.filter((p) => p.finishTime >= 0).map((p) => p.finishTime);
console.log(`RESULT ${JSON.stringify({
  code,
  ended: done,
  raceSeconds: Math.round((Date.now() - started) / 1000),
  finished: finishes.length,
  dnf: players.filter((p) => p.dnf).length,
  strikes: players.reduce((n, p) => n + p.strikes, 0),
  bestTime: finishes.length ? Math.min(...finishes).toFixed(2) : null,
  worstTime: finishes.length ? Math.max(...finishes).toFixed(2) : null,
  maxRttMs: Math.max(...bots.map((b) => b.net.rtt)),
})}`);
await Promise.all(bots.map((b) => b.stop()));
process.exit(0);
