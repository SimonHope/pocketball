import { afterAll, beforeAll, expect, it } from 'vitest';
import { startServer } from '../server/server';
import { Bot } from '../src/net/bot';
import { SPRINT } from './fixtures';

// Same race as server.test.ts, but on a bad connection: every message is delayed.
// (Separate file: Colyseus keeps one matchmaker per process.)

const LATENCY_MS = 300; // added round-trip delay (Colyseus simulateLatency)
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT], countdownMs: 2000, latencyMs: LATENCY_MS });
});
afterAll(async () => { await server.stop(); });

async function until(check: () => boolean, what: string, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

it('races fairly with 300 ms round trips: clocks agree, nobody gets flagged', async () => {
  const host = await Bot.connect({ url: server.url, levels: [SPRINT] });
  const guest = await Bot.connect({ url: server.url, levels: [SPRINT], code: host.net.state.code, autoReady: true });
  try {
    await until(() => host.net.clockReady && guest.net.clockReady, 'clock sync');
    expect(host.net.rtt).toBeGreaterThanOrEqual(LATENCY_MS - 10);
    // Both clients' estimates of the server clock agree closely despite the lag.
    expect(Math.abs(host.net.serverNow() - guest.net.serverNow())).toBeLessThan(40);

    await until(() => [...host.net.state.players.values()].some((p) => p.ready), 'guest ready');
    host.net.start();
    await until(() => host.net.phase === 'results', 'results');
    for (const p of host.net.state.players.values()) {
      expect(p.finishTime, p.name).toBeGreaterThan(0);
      expect(p.strikes, p.name).toBe(0);
    }
  } finally {
    await Promise.all([host.stop(), guest.stop()]);
  }
});
