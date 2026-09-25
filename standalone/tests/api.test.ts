import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../server/server';
import { LEVELS, levelId } from '../src/levels';
import type { MatchRewards, Profile } from '../src/meta/api';
import { NetClient } from '../src/net/net-client';
import { Bot } from '../src/net/bot';
import { autopilotTrace } from './helpers';
import { SPRINT } from './fixtures';

// The account API over HTTP, the Stripe webhook, and rewards reaching signed-in players.
// Own file: it runs its own server (one Colyseus matchmaker per process).

const WEBHOOK_SECRET = 'whsec_test_secret';
let srv: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  srv = await startServer({
    port: 20000 + Math.floor(Math.random() * 20000), levels: [SPRINT], countdownMs: 1000,
    api: { stripeSecretKey: 'sk_test_unused', stripeWebhookSecret: WEBHOOK_SECRET },
  });
});
afterAll(async () => { await srv.stop(); });

async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${srv.http}/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

async function until(check: () => boolean, what: string, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('account API', () => {
  it('guest sign-up, profile, restore on another device', async () => {
    const g = await api<{ token: string; recoveryCode: string; profile: Profile }>('/guest', { body: { name: 'Zippy Hammy' } });
    expect(g.status).toBe(200);
    expect(g.json.profile).toMatchObject({ name: 'Zippy Hammy', level: 1 });
    expect(g.json.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await api('/me', { token: g.json.token })).status).toBe(200);
    expect((await api('/me')).status).toBe(401);

    const r = await api<{ token: string; profile: Profile }>('/restore', { body: { code: g.json.recoveryCode } });
    expect(r.json.profile.id).toBe(g.json.profile.id);
    expect((await api('/me', { token: g.json.token })).status).toBe(401); // old device signed out
  });

  it('answers CORS preflight (the game is served from another origin)', async () => {
    const res = await fetch(`${srv.http}/api/me`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('a solo run goes through replay checks onto the leaderboard', async () => {
    const g = await api<{ token: string }>('/guest', { body: {} });
    const run = await autopilotTrace(LEVELS[0]);
    const lid = levelId(LEVELS[0]);
    const res = await api<{ result: { time: number; rank: number } }>('/solo', { token: g.json.token, body: { level: lid, trace: run.updates } });
    expect(res.status).toBe(200);
    expect(res.json.result.time).toBeCloseTo(run.time, 1);
    const board = await api<{ top: { name: string; me: boolean }[] }>(`/leaderboard/${lid}`, { token: g.json.token });
    expect(board.json.top.some((e) => e.me)).toBe(true);
    expect((await api('/leaderboard/nope')).status).toBe(404);
  });
});

describe('shop', () => {
  const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const webhook = (body: string, signature: string) =>
    fetch(`${srv.http}/api/shop/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body });

  it('grants the pack when Stripe confirms payment (signed webhook), once', async () => {
    const g = await api<{ token: string; profile: Profile }>('/guest', { body: {} });
    const body = JSON.stringify({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_42', client_reference_id: g.json.profile.id, payment_status: 'paid', metadata: { sku: 'starter-pack' } } },
    });
    expect((await webhook(body, sign(body))).status).toBe(200);
    expect((await webhook(body, sign(body))).status).toBe(200); // Stripe retries: no double grant
    const me = await api<Profile>('/me', { token: g.json.token });
    expect(me.json.bought).toEqual(expect.arrayContaining(['skin:swirl', 'hat:halo', 'trail:rainbow']));
  });

  it('rejects forged or stale webhooks', async () => {
    const body = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_x', client_reference_id: 'x', payment_status: 'paid', metadata: { sku: 'starter-pack' } } } });
    expect((await webhook(body, sign(body, undefined, 'whsec_wrong'))).status).toBe(400);
    expect((await webhook(body, sign(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
    expect((await webhook(body, 'garbage')).status).toBe(400);
  });
});

describe('rewards in multiplayer', () => {
  it('a signed-in player races under their account and gets rewards at the end', async () => {
    const g = await api<{ token: string; profile: Profile }>('/guest', { body: { name: 'Turbo Mochi' } });
    const me = await Bot.connect({ url: srv.url, levels: [SPRINT], token: g.json.token });
    let rewards: MatchRewards | null = null;
    me.net.room.onMessage('rewards', (m: MatchRewards) => { rewards = m; });
    try {
      expect(me.net.me()!.name).toBe('Turbo Mochi');
      me.net.start();
      await until(() => rewards !== null, 'rewards', 20_000);
      expect(rewards!.granted!.xp).toBeGreaterThan(0);
      const after = await api<Profile>('/me', { token: g.json.token });
      expect(after.json.xp).toBe(rewards!.granted!.xp + rewards!.challenges.reduce((n, c) => n + c.xp, 0));
    } finally {
      await me.stop();
    }
  });

  it('players without an account can still play (no rewards)', async () => {
    const c = await NetClient.create(srv.url);
    let got = false;
    c.room.onMessage('rewards', () => { got = true; });
    expect(c.me()).toBeTruthy();
    await c.leave();
    expect(got).toBe(false);
  });
});
