import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { startGateway } from './gateway';
import { MetaService } from './meta/service';
import { Store } from './meta/store';
import { startServer } from './server';

// Entry point: `npm run server`. Optional env vars:
//   PORT, LATENCY_MS, STATS=1          server, simulated lag, CPU/event-loop stats
//   DATA_DIR                           where the SQLite database lives (default ./data)
//   PUBLIC_URL                         where the game is served (Stripe return links)
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   open the shop
//   SHOP_DEV=1                         grant packs without payment (local testing only)
//   GUESTS_PER_MINUTE                  new guest accounts per IP per minute (default 10)
//   WORKERS=n + REDIS_URL              use n CPU cores: a gateway on PORT in front of n worker
//                                      processes sharing matchmaking through Redis
const port = Number(process.env.PORT ?? 2567);
const latencyMs = Number(process.env.LATENCY_MS ?? 0);
const workers = Number(process.env.WORKERS ?? 1);

if (workers > 1 && process.env.WORKER_INDEX === undefined) {
  if (!process.env.REDIS_URL) throw new Error('WORKERS > 1 needs REDIS_URL (the workers share matchmaking through Redis)');
  // Create/upgrade the database once, before the workers start opening it together.
  const dataDir = process.env.DATA_DIR ?? 'data';
  mkdirSync(dataDir, { recursive: true });
  new Store(join(dataDir, 'hamball.db')).close();
  const gateway = await startGateway({ port, workers, script: process.argv[1] });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void gateway.stop().then(() => process.exit(0)));
  }
} else {
  await initServer();
  // A worker started by the gateway exits if the gateway goes away (e.g. it was killed), rather
  // than running on as an orphan nobody routes to.
  if (process.env.WORKER_INDEX !== undefined && process.send) {
    process.on('disconnect', () => process.exit(0));
  }
}

async function initServer() {
  const dataDir = process.env.DATA_DIR ?? 'data';
  mkdirSync(dataDir, { recursive: true });
  const meta = new MetaService(new Store(join(dataDir, 'hamball.db')));
  await startServer({
    port, latencyMs, meta,
    redisUrl: process.env.REDIS_URL,
    api: {
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      shopDev: process.env.SHOP_DEV === '1',
      publicUrl: process.env.PUBLIC_URL,
      guestsPerMinute: process.env.GUESTS_PER_MINUTE ? Number(process.env.GUESTS_PER_MINUTE) : undefined,
    },
  });
  const worker = process.env.WORKER_INDEX !== undefined ? ` (worker ${process.env.WORKER_INDEX})` : '';
  console.log(`Pocket Ball server on ws://localhost:${port}${worker}${latencyMs ? ` (simulating ${latencyMs} ms latency)` : ''}`);

  if (process.env.STATS) {
    // One line every 5 s, read by the load test: CPU %, event-loop delay, memory.
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    let cpu = process.cpuUsage();
    let at = performance.now();
    setInterval(() => {
      const used = process.cpuUsage(cpu);
      const elapsed = (performance.now() - at) * 1000;
      console.log(`STATS ${JSON.stringify({
        worker: Number(process.env.WORKER_INDEX ?? 0),
        cpu: +(((used.user + used.system) / elapsed) * 100).toFixed(1),
        loopP99ms: +(loop.percentile(99) / 1e6).toFixed(1),
        rssMb: Math.round(process.memoryUsage().rss / 1e6),
      })}`);
      loop.reset();
      cpu = process.cpuUsage();
      at = performance.now();
    }, 5000);
  }
}
