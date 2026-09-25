import { expect, it } from 'vitest';
import { startServer } from '../server/server';
import { Bot } from '../src/net/bot';
import { SPRINT } from './fixtures';

// Deploys: shutting a server down mid-race lets the race finish, shows results, then closes.
// Own file: shutdown stops the (process-wide) Colyseus matchmaker.

it('lets a race in progress finish before the server shuts down', async () => {
  const srv = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT], countdownMs: 800 });
  const bot = await Bot.connect({ url: srv.url, levels: [SPRINT] });
  const notices: string[] = [];
  let left = false;
  bot.net.room.onMessage('notice', (m: { text: string }) => notices.push(m.text));
  bot.net.room.onLeave(() => { left = true; });
  bot.net.start();
  const phase = () => bot.net.phase as string; // (a call, so TS doesn't narrow across awaits)
  while (phase() !== 'racing') await new Promise((r) => setTimeout(r, 20));

  const stopped = srv.stop(); // like SIGTERM during a deploy
  await new Promise((r) => setTimeout(r, 300));
  expect(notices[0]).toContain('restarting after this game');
  expect(left).toBe(false); // still racing

  while (phase() !== 'results') await new Promise((r) => setTimeout(r, 20));
  expect(bot.net.me()!.finishTime).toBeGreaterThan(0); // the race counted
  await stopped; // the server only finishes shutting down after the room closes
  for (let i = 0; i < 100 && !left; i++) await new Promise((r) => setTimeout(r, 50)); // close frame in flight
  expect(left).toBe(true);
  await bot.stop();
}, 30_000);
