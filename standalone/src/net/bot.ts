import { SIM } from '../config';
import type { LevelData } from '../levels/schema';
import { Autopilot } from '../sim/autopilot';
import { gridSpot, resolveLevel } from '../sim/geometry';
import { initPhysics, Simulation } from '../sim/simulation';
import { NetClient } from './net-client';
import { MODE_INFO, type GameMode } from './modes';
import { INTERP_DELAY_MS, MSG, type BallUpdate } from './protocol';

// A headless player: joins a room, races with the autopilot in real time, and sends
// updates exactly like the browser client. Used by integration tests and the load test
// (and the starting point for Quick Play bots).

export interface BotOptions {
  url: string;
  /** Must match the server's lists: race courses and arenas. */
  levels: LevelData[];
  arenas?: LevelData[];
  /** Join this room; omit to create a new one. */
  code?: string;
  /** Use Quick Play matchmaking instead (`freshQuick`: always open a new Quick Play room). */
  quick?: boolean;
  freshQuick?: boolean;
  name?: string;
  /** Account token (to play signed in and earn rewards). */
  token?: string;
  /** Mark ready as soon as we're in the lobby. */
  autoReady?: boolean;
  /** Replace honest updates (for anti-cheat tests). Return null to send nothing. */
  cheat?: (bot: Bot, honest: BallUpdate) => BallUpdate | null;
}

export class Bot {
  sim: Simulation | null = null;
  private pilot: Autopilot | null = null;
  private raceStartAt = 0;
  private acc = 0;
  private last = 0;
  private timer: ReturnType<typeof setInterval>;
  private lastSent = -Infinity;

  static async connect(opts: BotOptions): Promise<Bot> {
    await initPhysics();
    const join = { name: opts.name, token: opts.token };
    const net = opts.quick
      ? await NetClient.quick(opts.url, join, opts.freshQuick)
      : opts.code ? await NetClient.join(opts.url, opts.code, join) : await NetClient.create(opts.url, join);
    return new Bot(net, opts);
  }

  private constructor(readonly net: NetClient, private opts: BotOptions) {
    if (opts.autoReady) net.ready(true); // the first state has already arrived
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 8);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const state = this.net.state;
    if (!state) return;
    const phase = this.net.phase;

    if (phase === 'countdown' && state.startAt !== this.raceStartAt && this.net.clockReady) {
      this.sim?.dispose();
      const list = MODE_INFO[state.mode as GameMode]?.kind === 'arena' ? this.opts.arenas ?? [] : this.opts.levels;
      const level = resolveLevel(list[state.level]);
      this.sim = new Simulation(level);
      this.sim.restart(Math.max(0, (state.startAt - this.net.serverNow()) / 1000), gridSpot(level, this.net.me()?.slot ?? 0));
      this.pilot = new Autopilot(this.sim);
      this.raceStartAt = state.startAt;
      this.acc = 0;
    }
    if (!this.sim || !this.pilot || (phase !== 'countdown' && phase !== 'racing')) return;
    if ((this.net.me()?.finishTime ?? -1) >= 0) return;

    this.acc += dt;
    while (this.acc >= SIM.dt) {
      this.sim.setOthers(this.net.others(this.net.serverNow() - INTERP_DELAY_MS));
      this.sim.step(this.pilot.input());
      this.sim.drainEvents();
      this.acc -= SIM.dt;
    }
    if (this.opts.cheat) {
      const t = this.net.serverNow();
      if (t - this.lastSent < 50) return;
      this.lastSent = t;
      const fake = this.opts.cheat(this, { t, p: this.sim.position(), v: this.sim.velocity() });
      if (fake) this.net.room.send(MSG.state, fake);
    } else {
      this.net.sendBall(this.sim);
    }
  }

  async stop() {
    clearInterval(this.timer);
    this.sim?.dispose();
    this.sim = null;
    await this.net.leave().catch(() => {});
  }
}
