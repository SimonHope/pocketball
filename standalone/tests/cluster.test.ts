import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGateway } from '../server/gateway';
import type { Profile } from '../src/meta/api';
import { NetClient } from '../src/net/net-client';

// Several worker processes behind the gateway, sharing matchmaking through Redis (how one
// machine uses all its CPU cores). Needs redis-server installed, or REDIS_URL (CI service).

const hasRedis = !!process.env.REDIS_URL || spawnSync('redis-server', ['--version']).status === 0;
const PORT = 25000 + Math.floor(Math.random() * 10000);
let redis: ChildProcess | null = null;
let gateway: Awaited<ReturnType<typeof startGateway>> | null = null;
let dataDir = '';
const url = `ws://localhost:${PORT}`;
const http = `http://localhost:${PORT}`;

async function until(check: () => boolean | Promise<boolean>, what: string, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const workerRooms = async (port: number) =>
  Number((await (await fetch(`http://127.0.0.1:${port}/api/metrics`)).text()).match(/pocketball_rooms (\d+)/)![1]);

describe.skipIf(!hasRedis)('multi-process cluster (gateway + 2 workers + Redis)', () => {
  beforeAll(async () => {
    let redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      const redisPort = PORT + 50;
      redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
      redisUrl = `redis://127.0.0.1:${redisPort}`;
      await new Promise((r) => setTimeout(r, 500));
    }
    dataDir = mkdtempSync(join(tmpdir(), 'pocket-ball-cluster-'));
    gateway = await startGateway({
      port: PORT, workers: 2, script: 'server/main.ts', log: () => {},
      env: { REDIS_URL: redisUrl, DATA_DIR: dataDir, WORKERS: '1', STATS: '' },
    });
  }, 60_000);

  afterAll(async () => {
    await gateway?.stop();
    redis?.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('routes the API through the gateway and shares accounts across workers', async () => {
    const guest = await (await fetch(`${http}/api/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json() as { token: string };
    for (let i = 0; i < 4; i++) { // round-robin: both workers answer
      const me = await fetch(`${http}/api/me`, { headers: { Authorization: `Bearer ${guest.token}` } });
      expect(me.status).toBe(200);
      expect(((await me.json()) as Profile).level).toBe(1);
    }
  });

  it('a room code works no matter which worker handles the join', async () => {
    const host = await NetClient.create(url);
    const guests = await Promise.all([0, 1, 2].map(() => NetClient.join(url, host.state.code)));
    try {
      await until(() => host.state.players.size === 4, 'everyone in one room');
      for (const g of guests) expect(g.state.code).toBe(host.state.code);
    } finally {
      await Promise.all([host, ...guests].map((c) => c.leave()));
    }
  });

  it('Quick Play matchmaking finds the same public room across workers', async () => {
    const a = await NetClient.quick(url);
    const b = await NetClient.quick(url);
    try {
      expect(b.state.code).toBe(a.state.code);
    } finally {
      await a.leave();
      await b.leave();
    }
  });

  it('spreads new rooms over the workers', async () => {
    const rooms = [];
    for (let i = 0; i < 6; i++) rooms.push(await NetClient.create(url));
    try {
      const counts = await Promise.all(gateway!.workers.map((w) => workerRooms(w.port)));
      expect(counts.every((n) => n >= 2)).toBe(true);
    } finally {
      await Promise.all(rooms.map((r) => r.leave()));
    }
  });

  it('restarts a crashed worker', async () => {
    const w = gateway!.workers[0];
    const before = w.processId;
    w.child!.kill('SIGKILL');
    await until(() => !!w.processId && w.processId !== before, 'worker back with a new process id', 30_000);
    const c = await NetClient.create(url); // still works
    await c.leave();
  }, 40_000);
});
