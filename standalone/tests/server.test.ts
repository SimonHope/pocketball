import { matchMaker } from '@colyseus/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../server/server';
import { Bot } from '../src/net/bot';
import { NetClient } from '../src/net/net-client';
import { CODE_ALPHABET, CODE_LENGTH } from '../src/net/protocol';
import { LIMITS } from '../src/net/rules';
import { SPRINT } from './fixtures';

// Real server + real clients over WebSockets. Races use a short course and countdown.

const LEVELS = [SPRINT, SPRINT];
let server: Awaited<ReturnType<typeof startServer>>;
const open: { stop?: () => Promise<unknown>; leave?: () => Promise<unknown> }[] = [];

async function until(check: () => boolean, what: string, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function bot(opts: Partial<Parameters<typeof Bot.connect>[0]> = {}) {
  const b = await Bot.connect({ url: server.url, levels: LEVELS, ...opts });
  open.push(b);
  return b;
}

async function client(code?: string, name?: string) {
  const c = code ? await NetClient.join(server.url, code, { name }) : await NetClient.create(server.url, { name });
  open.push(c);
  await until(() => !!c.state?.code, 'first state');
  return c;
}

beforeAll(async () => {
  server = await startServer({ port: 20000 + Math.floor(Math.random() * 20000), levels: LEVELS, countdownMs: 1500 });
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((o) => (o.stop ?? o.leave)?.call(o).catch(() => {})));
});
afterAll(async () => {
  await server.stop();
});

describe('rooms', () => {
  it('creates a room with a 6-character code that others can join', async () => {
    const host = await client(undefined, 'Zippy Hammy');
    const code = host.state.code;
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);

    const guest = await client(code.toLowerCase(), 'Bouncy Peanut'); // codes are case-insensitive
    await until(() => host.state.players.size === 2, 'host sees guest');
    expect(host.isHost).toBe(true);
    expect(guest.isHost).toBe(false);
    expect([...host.state.players.values()].map((p) => p.name).sort()).toEqual(['Bouncy Peanut', 'Zippy Hammy']);
  });

  it('rejects unknown codes', async () => {
    await expect(NetClient.join(server.url, 'ZZZZZZ')).rejects.toThrow();
  });

  it('replaces typed names with generated ones', async () => {
    const c = await client(undefined, 'I am a bad word');
    expect(c.me()!.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(c.me()!.name).not.toBe('I am a bad word');
  });

  it('gives each player a different color', async () => {
    const host = await client();
    const a = await client(host.state.code);
    const b = await client(host.state.code);
    await until(() => host.state.players.size === 3, '3 players');
    const colors = new Set([host, a, b].map((c) => c.me()!.color));
    expect(colors.size).toBe(3);
  });

  it('hands the room to the next player when the host leaves', async () => {
    const host = await client();
    const guest = await client(host.state.code);
    await until(() => host.state.players.size === 2, 'guest joined');
    await host.leave();
    open.splice(open.indexOf(host), 1);
    await until(() => guest.isHost, 'guest becomes host');
  });
});

describe('racing', () => {
  it('only starts when everyone is ready, then runs a full race to results', async () => {
    const host = await bot({ name: 'Turbo Mochi' });
    const code = host.net.state.code;
    const guests = [await bot({ code }), await bot({ code })];
    await until(() => host.net.state.players.size === 3, '3 players');

    host.net.start(); // guests aren't ready yet
    await new Promise((r) => setTimeout(r, 300));
    expect(host.net.phase).toBe('lobby');

    guests.forEach((g) => g.net.ready(true));
    await until(() => [...host.net.state.players.values()].filter((p) => p.ready).length === 2, 'guests ready');
    host.net.start();
    await until(() => host.net.phase === 'countdown', 'countdown');
    await until(() => host.net.phase === 'racing', 'racing');
    await until(() => host.net.phase === 'results', 'results', 20_000);

    const players = [...host.net.state.players.values()];
    for (const p of players) {
      expect(p.finishTime, p.name).toBeGreaterThan(2);
      expect(p.finishTime, p.name).toBeLessThan(15);
      expect(p.strikes, p.name).toBe(0);
    }
    expect(players.map((p) => p.place).sort()).toEqual([1, 2, 3]);
    const byPlace = [...players].sort((a, b) => a.place - b.place);
    expect(byPlace[0].finishTime).toBeLessThanOrEqual(byPlace[1].finishTime);

    host.net.toLobby();
    await until(() => host.net.phase === 'lobby', 'back to lobby');
    expect(players.every((p) => !p.ready)).toBe(true);
  });

  it('keeps late joiners as spectators until the next race', async () => {
    const host = await bot();
    host.net.start();
    await until(() => host.net.phase === 'countdown', 'countdown');
    const late = await client(host.net.state.code);
    expect(late.me()!.spectator).toBe(true);
    await until(() => host.net.phase === 'results', 'results', 20_000);
    host.net.toLobby();
    await until(() => late.phase === 'lobby' && !late.me()!.spectator, 'spectator joins lobby');
  });

  it('ignores a cheater teleporting to the goal and disqualifies them', async () => {
    const honest = await bot();
    const goal = SPRINT.pieces.find((p) => p.type === 'goal')!;
    if (goal.type !== 'goal') throw new Error();
    const cheater = await bot({
      code: honest.net.state.code,
      autoReady: true,
      cheat: (b, u) => (b.net.phase === 'racing' ? { ...u, p: [goal.position[0], goal.position[1] + 1, goal.position[2]] } : u),
    });
    await until(() => honest.net.state.players.size === 2 && [...honest.net.state.players.values()].some((p) => p.ready), 'cheater ready');
    honest.net.start();
    await until(() => honest.net.phase === 'results', 'results', 20_000);
    const c = cheater.net.me()!;
    expect(c.finishTime).toBe(-1);
    expect(c.dnf).toBe(true);
    expect(c.strikes).toBeGreaterThanOrEqual(LIMITS.strikesToDnf);
    expect(honest.net.me()!.place).toBe(1);
  });

  it('sees other players moving smoothly (interpolated)', async () => {
    const a = await bot();
    const b = await bot({ code: a.net.state.code, autoReady: true });
    await until(() => [...a.net.state.players.values()].some((p) => p.ready), 'b ready');
    a.net.start();
    await until(() => a.net.phase === 'racing', 'racing');
    await new Promise((r) => setTimeout(r, 1200));
    const t = a.net.serverNow() - 100;
    const s1 = a.net.sample(b.net.id, t)!, s2 = a.net.sample(b.net.id, t + 25)!;
    expect(s1.position[2]).toBeLessThan(0); // b has moved down the course
    expect(s2.position[2]).toBeLessThan(s1.position[2]); // and positions between updates progress
    await until(() => a.net.phase === 'results', 'results', 20_000);
  });
});

describe('connection problems', () => {
  it('holds a dropped player\'s seat and lets them back in', async () => {
    const host = await client();
    const guest = await client(host.state.code);
    await until(() => host.state.players.size === 2, 'guest joined');
    const id = guest.id;
    guest.room.reconnection.minUptime = 0; // normally only after 5 s in the room
    // Cut the connection abruptly from the server side, like a network drop.
    const room = matchMaker.getLocalRoomById(host.state.code);
    const socket = room.clients.find((c) => c.sessionId === id)!.ref as unknown as { terminate(): void };
    socket.terminate();
    await until(() => host.state.players.get(id)?.connected === false, 'marked disconnected');
    await until(() => host.state.players.get(id)?.connected === true, 'reconnected', 10_000);
    expect(host.state.players.size).toBe(2);
  });
});

describe('cosmetics over the network', () => {
  it('other players see your look; the server allows only valid, owned items', async () => {
    const { NetClient: NC } = await import('../src/net/net-client');
    // Without an account only free items can be worn (skin 0, hat 0, furs 0–1, trail 0).
    const a = await NC.create(server.url, { look: { skin: 0, hat: 0, fur: 1, trail: 0 } });
    open.push(a);
    const b = await NC.join(server.url, a.state.code, { look: { skin: 99, hat: 2, fur: -3, trail: 1 } as never });
    open.push(b);
    await until(() => b.state.players.size === 2, 'both in');
    expect(b.state.players.get(a.id)!.fur).toBe(1);
    await until(() => !!a.state.players.get(b.id), 'a sees b');
    const seenByA = a.state.players.get(b.id)!;
    expect([seenByA.skin, seenByA.hat, seenByA.fur, seenByA.trail]).toEqual([0, 0, 0, 0]); // invalid or locked → default
    b.room.send('look', { skin: 'hack', hat: 6, fur: 1, trail: 2 });
    await until(() => a.state.players.get(b.id)!.fur === 1, 'look change synced');
    expect(a.state.players.get(b.id)!.hat).toBe(0); // the halo is a paid item
  });
});
