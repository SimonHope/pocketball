import { matchMaker, Server } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { LevelData } from '../src/levels/schema';
import type { GameMode } from '../src/net/modes';
import { QUICK_ROOM, ROOM_NAME } from '../src/net/protocol';
import { initPhysics } from '../src/sim/simulation';
import { apiRouter, type ApiOptions } from './meta/http';
import { MetaService } from './meta/service';
import { RaceRoom } from './race-room';

export interface ServerOptions {
  port: number;
  /** Override the course / arena lists (tests use small ones). */
  levels?: LevelData[];
  arenas?: LevelData[];
  /** Mode timings (tests shorten them). */
  hillMs?: number;
  arenaMs?: number;
  roundBreakMs?: number;
  /** Artificial added round-trip delay in ms, for testing on a "bad connection". */
  latencyMs?: number;
  /** Start → GO delay (tests shorten it). */
  countdownMs?: number;
  /** Quick Play lobby wait and results pause (tests shorten them). */
  quickLobbyMs?: number;
  quickResultsMs?: number;
  /** Pin Quick Play to these modes (tests). */
  quickModes?: GameMode[];
  /** Accounts and progression (in-memory by default). */
  meta?: MetaService;
  api?: ApiOptions;
  /** Share matchmaking with other processes (multi-core / multi-machine). */
  redisUrl?: string;
}

export async function startServer(opts: ServerOptions) {
  await initPhysics(); // server-side bots run the real simulation
  const meta = opts.meta ?? new MetaService();
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    ...(opts.redisUrl ? {
      presence: new RedisPresence(opts.redisUrl),
      driver: new RedisDriver(opts.redisUrl),
      // Room counts shared between processes are refreshed periodically, so a burst of new rooms
      // would all see the same numbers and pile onto one process. Pick randomly among the
      // least-loaded processes instead.
      selectProcessIdToCreateRoom: async () => {
        const all = await matchMaker.stats.fetchAll();
        if (!all.length) return matchMaker.processId;
        const fewest = Math.min(...all.map((p) => p.roomCount));
        const candidates = all.filter((p) => p.roomCount <= fewest + 1);
        return candidates[Math.floor(Math.random() * candidates.length)].processId;
      },
    } : {}),
    express: (app) => {
      app.set('trust proxy', 1); // real client IPs behind a load balancer (rate limits)
      // For the gateway: which Colyseus process this is (WebSocket routing).
      app.get('/api/process', (_req, res) => { res.json({ processId: matchMaker.processId }); });
      app.get('/api/metrics', (_req, res) => { res.type('text/plain').send(metrics()); });
      app.use('/api', apiRouter(meta, opts.api));
    },
  });

  const configure = (room: RaceRoom) => {
    room.meta = meta;
    if (opts.levels) room.levels = opts.levels;
    if (opts.arenas) room.arenas = opts.arenas;
    if (opts.hillMs !== undefined) room.hillMs = opts.hillMs;
    if (opts.arenaMs !== undefined) room.arenaMs = opts.arenaMs;
    if (opts.roundBreakMs !== undefined) room.roundBreakMs = opts.roundBreakMs;
    if (opts.countdownMs !== undefined) room.countdownMs = opts.countdownMs;
    if (opts.quickLobbyMs !== undefined) room.quickLobbyMs = opts.quickLobbyMs;
    if (opts.quickResultsMs !== undefined) room.quickResultsMs = opts.quickResultsMs;
    if (opts.quickModes) room.quickModes = opts.quickModes;
  };
  server.define(ROOM_NAME, class extends RaceRoom {
    onCreate() { configure(this); super.onCreate(); }
  });
  server.define(QUICK_ROOM, class extends RaceRoom {
    quick = true;
    onCreate() { configure(this); super.onCreate(); }
  });

  if (opts.latencyMs) server.simulateLatency(opts.latencyMs);
  await server.listen(opts.port);
  return {
    server,
    url: `ws://localhost:${opts.port}`,
    http: `http://localhost:${opts.port}`,
    meta,
    stop: () => server.gracefullyShutdown(false),
  };
}

/** Prometheus-style numbers for dashboards and alerts (per process). */
function metrics(): string {
  const { roomCount, ccu } = matchMaker.stats.local;
  const mem = process.memoryUsage();
  return [
    `pocketball_rooms ${roomCount}`,
    `pocketball_clients ${ccu}`,
    `pocketball_rss_bytes ${mem.rss}`,
    `pocketball_heap_bytes ${mem.heapUsed}`,
    `pocketball_uptime_seconds ${Math.round(process.uptime())}`,
    '',
  ].join('\n');
}
