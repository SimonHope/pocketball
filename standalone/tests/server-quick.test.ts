import { describe, expect, it } from 'vitest';
import { startServer } from '../server/server';
import { Bot } from '../src/net/bot';
import { NetClient } from '../src/net/net-client';
import { PIT, SPRINT } from './fixtures';

// Quick Play and party modes. Each test starts its own server with short timings, so these
// live in their own file: Colyseus has one matchmaker per process, and stopping a server
// shuts it down for every other server in the same process.

async function until(check: () => boolean, what: string, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Quick Play', () => {
  it('fills the race with bots, runs it, and rolls into the next lobby', async () => {
    const quick = await startServer({
      port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT], countdownMs: 1200,
      quickLobbyMs: 1500, quickResultsMs: 800, quickModes: ['race'],
    });
    const human = await Bot.connect({ url: quick.url, levels: [SPRINT], quick: true });
    try {
      expect(human.net.state.quick).toBe(true);
      expect(human.net.state.autoStartAt).toBeGreaterThan(0); // countdown to start began when we joined
      await until(() => human.net.phase === 'countdown', 'auto start');
      const players = [...human.net.state.players.values()];
      expect(players.length).toBe(8); // us + 7 bots
      expect(players.filter((p) => p.bot)).toHaveLength(7);

      await until(() => human.net.phase === 'results', 'results', 25_000);
      const bots = [...human.net.state.players.values()].filter((p) => p.bot);
      expect(bots.every((p) => p.progress > 15)).toBe(true); // every bot raced
      expect(bots.filter((p) => p.finishTime >= 0).length).toBeGreaterThanOrEqual(3);
      expect(bots.every((p) => p.strikes === 0)).toBe(true); // bots obey the same rules
      expect(human.net.me()!.finishTime).toBeGreaterThan(0);

      await until(() => human.net.phase === 'lobby', 'next lobby');
      expect([...human.net.state.players.values()].some((p) => p.bot)).toBe(false); // bots leave between races
      await until(() => human.net.state.autoStartAt > 0, 'next race scheduled');
    } finally {
      await human.stop();
      await quick.stop();
    }
  });

  it('matches a second player into the same public room', async () => {
    const quick = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT], quickLobbyMs: 60_000 });
    const a = await NetClient.quick(quick.url);
    const b = await NetClient.quick(quick.url);
    try {
      expect(b.state.code).toBe(a.state.code);
      expect(a.isHost).toBe(false); // Quick Play has no host
    } finally {
      await a.leave();
      await b.leave();
      await quick.stop();
    }
  });
});

describe('party modes (Quick Play rooms with server bots)', () => {
  async function modeServer(mode: 'elimination' | 'hill' | 'arena') {
    return startServer({
      port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT, SPRINT], arenas: [PIT],
      countdownMs: 1000, quickLobbyMs: 800, quickResultsMs: 60_000, roundBreakMs: 600,
      hillMs: 8000, arenaMs: 15_000, quickModes: [mode],
    });
  }

  it('Elimination: rounds continue until one winner is left', async () => {
    const srv = await modeServer('elimination');
    const human = await Bot.connect({ url: srv.url, levels: [SPRINT, SPRINT], arenas: [PIT], quick: true });
    try {
      expect(human.net.state.mode).toBe('elimination');
      await until(() => human.net.phase === 'results' && human.net.state.final, 'final results', 90_000);
      const players = [...human.net.state.players.values()];
      const survivors = players.filter((p) => !p.out);
      expect(survivors).toHaveLength(1);
      expect(survivors[0].place).toBe(1);
      expect(human.net.state.round).toBeGreaterThanOrEqual(4); // 8 → 6 → 4 → 3 → 2 → 1
      // Players who lasted longer place higher.
      const out = players.filter((p) => p.out).sort((a, b) => a.place - b.place);
      for (let i = 1; i < out.length; i++) expect(out[i - 1].outOrder).toBeGreaterThan(out[i].outOrder);
    } finally {
      await human.stop();
      await srv.stop();
    }
  }, 120_000);

  it('King of the Hill: bots fight over the zone and the scores decide the places', async () => {
    const srv = await modeServer('hill');
    const human = await Bot.connect({ url: srv.url, levels: [SPRINT, SPRINT], arenas: [PIT], quick: true });
    try {
      await until(() => human.net.phase === 'racing', 'game on');
      expect(human.net.state.activeZone).toBe(0);
      await until(() => human.net.phase === 'results', 'results', 20_000);
      const players = [...human.net.state.players.values()].sort((a, b) => a.place - b.place);
      expect(players[0].score).toBeGreaterThan(0.5);
      for (let i = 1; i < players.length; i++) expect(players[i - 1].score).toBeGreaterThanOrEqual(players[i].score);
      expect(players.every((p) => p.strikes === 0)).toBe(true);
    } finally {
      await human.stop();
      await srv.stop();
    }
  }, 60_000);

  it('Bumper Arena: bots knock each other off until one is left (or time runs out)', async () => {
    const srv = await modeServer('arena');
    const human = await Bot.connect({ url: srv.url, levels: [SPRINT, SPRINT], arenas: [PIT], quick: true });
    try {
      await until(() => human.net.phase === 'results', 'results', 30_000);
      const players = [...human.net.state.players.values()].sort((a, b) => a.place - b.place);
      const out = players.filter((p) => p.out);
      expect(out.length).toBeGreaterThanOrEqual(2); // knock-offs happen
      expect(players[0].out).toBe(false);          // a survivor wins
      expect(players.every((p) => p.strikes === 0)).toBe(true);
    } finally {
      await human.stop();
      await srv.stop();
    }
  }, 60_000);
});

