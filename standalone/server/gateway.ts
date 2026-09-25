import { fork, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

// Using every CPU core: Node runs game code on one core per process, so a machine runs N
// worker processes (each a full game server) that share matchmaking through Redis. This
// gateway is the one public port in front of them:
//   - WebSocket connections go to the worker hosting the room. The Colyseus client connects to
//     /<processId>/<roomId>, so the first path segment says which worker.
//   - Everything else (matchmaking, /api) is spread round-robin; the workers share state
//     through Redis (rooms) and the SQLite file (accounts).
// It also restarts crashed workers and passes SIGTERM on for graceful shutdown.

export interface GatewayOptions {
  port: number;
  workers: number;
  /** Script to fork for each worker (it gets WORKER_INDEX and PORT). */
  script: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

interface Worker { index: number; port: number; child: ChildProcess | null; processId: string | null }

export async function startGateway(opts: GatewayOptions) {
  const log = opts.log ?? ((m: string) => console.log(`[gateway] ${m}`));
  const workers: Worker[] = Array.from({ length: opts.workers }, (_, i) => ({ index: i, port: opts.port + 1 + i, child: null, processId: null }));
  let stopping = false;
  let next = 0;

  const spawn = (w: Worker) => {
    w.processId = null;
    w.child = fork(opts.script, [], {
      env: { ...process.env, ...opts.env, WORKER_INDEX: String(w.index), PORT: String(w.port) },
      // TypeScript source (dev/tests) runs through tsx; the production bundle is plain JS.
      execArgv: opts.script.endsWith('.ts') ? ['--import', 'tsx'] : process.execArgv,
    });
    w.child.on('exit', (code) => {
      w.child = null;
      w.processId = null;
      if (stopping) return;
      log(`worker ${w.index} exited (${code}); restarting`);
      setTimeout(() => spawn(w), 1000);
    });
  };
  workers.forEach(spawn);

  // Learn each worker's Colyseus process id (it changes when a worker restarts).
  const identify = async () => {
    await Promise.all(workers.map(async (w) => {
      if (!w.child) return;
      try {
        const res = await fetch(`http://127.0.0.1:${w.port}/api/process`);
        w.processId = ((await res.json()) as { processId: string }).processId;
      } catch {
        w.processId = null; // not up yet
      }
    }));
  };
  const identifyTimer = setInterval(identify, 2000);
  for (let i = 0; i < 50 && workers.some((w) => !w.processId); i++) {
    await identify();
    if (workers.some((w) => !w.processId)) await new Promise((r) => setTimeout(r, 200));
  }

  const ready = () => workers.filter((w) => w.processId);

  const server = http.createServer((req, res) => {
    const up = ready();
    if (!up.length) return void res.writeHead(503).end('starting');
    const w = up[next++ % up.length];
    const forwardedFor = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
    const proxied = http.request(
      { host: '127.0.0.1', port: w.port, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': forwardedFor } },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(proxied);
  });

  // WebSocket upgrade: route by process id (first path segment), then just pipe bytes.
  server.on('upgrade', (req, socket, head) => {
    const processId = (req.url ?? '/').split('/')[1];
    const w = workers.find((x) => x.processId && x.processId === processId);
    if (!w) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const upstream = net.connect(w.port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      lines.push(`X-Forwarded-For: ${req.socket.remoteAddress ?? ''}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => { upstream.destroy(); socket.destroy(); };
    upstream.on('error', close);
    socket.on('error', close);
  });

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  log(`listening on ${opts.port} → ${workers.length} workers (ports ${workers[0].port}–${workers.at(-1)!.port})`);

  /** Graceful stop: workers finish their current races, then exit. */
  const stop = async () => {
    stopping = true;
    clearInterval(identifyTimer);
    await Promise.all(workers.map((w) => new Promise<void>((resolve) => {
      if (!w.child) return resolve();
      w.child.once('exit', () => resolve());
      w.child.kill('SIGTERM');
    })));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { stop, workers };
}
