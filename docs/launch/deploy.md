# Deploying the game server

The game server (`standalone/server/`) runs the multiplayer rooms and the account API (`/api`). The game itself is a static site (`npm run build` → `dist/`) that can go on any static host or CDN, or be uploaded to portals (see `soft-launch.md`).

## Architecture

```
players ──wss/https──▶ gateway (PORT 2567) ──▶ worker 0..N-1 (one per CPU core)
                                              │  rooms in memory; matchmaking shared via Redis
                                              └─ SQLite file on a volume (accounts, progress)
```

- **One process per core.** Node runs game code on one core per process. `WORKERS=n` (needs `REDIS_URL`) starts a gateway plus n workers.
- **Room placement.** New rooms go to the least-loaded worker. Invite codes and Quick Play find rooms on any worker.
- **Crashes.** The gateway restarts crashed workers.
- **Deploys don't cut races short.** On SIGTERM each room tells its players, finishes its current game (at most 3 min), then closes. `kill_timeout` in `fly.toml` is 5 min.
- **Measured capacity.** A 16-player room, or a Quick Play room with bots, costs about 1.2–3% of a core depending on mode. That's roughly **30–60 rooms per core**. A 2-CPU machine handles about 60–120 rooms, or roughly 500–1,000 concurrent players.

## Fly.io (first deploy)

1. Install `flyctl`, then `fly auth login`.
2. In `standalone/`, run `fly launch --no-deploy` and keep the existing `fly.toml`.
3. Create the database volume: `fly volumes create pocket_ball_data --size 1 --region iad`.
4. Set up Redis, e.g. Upstash Redis on Fly (`fly redis create`), then `fly secrets set REDIS_URL=redis://…`.
5. Shop (optional): `fly secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…`. Register the webhook URL `https://<app>.fly.dev/api/shop/webhook` for the event `checkout.session.completed`.
6. Set `PUBLIC_URL` in `fly.toml` to where the game is served.
7. Deploy with `fly deploy`, then check `https://<app>.fly.dev/api/health`.
8. Build the game with `VITE_SERVER_URL=wss://<app>.fly.dev npm run build`.

## Scaling

- **Up (easy):** a bigger machine, with `WORKERS` equal to its CPU count (`performance-4x` → `WORKERS=4`).
- **Out (more machines): not ready yet.** SQLite lives on one machine's volume, so the app is pinned to one machine. Going wider needs:
  1. Postgres instead of SQLite (the `Store` class is the only place to change).
  2. Public WebSocket routing to a specific machine. Colyseus supports this with `publicAddress` per machine; on Fly, use `fly-replay` or one public hostname per machine.
- **Regions:** one region to start. Players far away get 150–250 ms. The game was tested at 300 ms round trips and stays fair, but it feels better with a closer region. Add regions once going wider works.

## Monitoring

- **Uptime:** point an external checker (BetterStack, UptimeRobot) at `GET /api/health` every minute and alert on 2 failures.
- **Load:** `GET /api/metrics` (per worker) reports `pocketball_rooms`, `pocketball_clients`, memory and uptime. Alert on sustained high CPU (Fly metrics) or event-loop lag. `STATS=1` logs CPU and event-loop p99 every 5 s.
- **Errors:** `npm run analytics` (on the server, or against a copy of the database) lists the top client errors.

## Backups

- Fly takes daily volume snapshots, kept 5 days by default.
- For point-in-time recovery, stream the SQLite file to object storage with Litestream (a sidecar process).
- Test a restore before launch.

## Local production-like run

`docker compose up --build` starts Redis and a 2-worker server with `SHOP_DEV=1`. The Dockerfile builds the server bundle (`npm run build:server`) and runs it with production dependencies only. That was checked without Docker (bundle + `npm ci --omit=dev` + 4 workers); the image build itself should be run once on a machine with Docker running.
