import { Client, type Room } from '@colyseus/sdk';
import type { OtherBall, Simulation } from '../sim/simulation';
import type { Vec3 } from '../sim/math';
import type { Look } from '../cosmetics';
import type { GameMode } from './modes';
import { MSG, QUICK_ROOM, ROOM_NAME, SEND_HZ, type BallUpdate, type Phase, type Pong, type RaceState } from './protocol';

// The multiplayer connection, shared by the browser game and headless bots (no DOM here).
// - keeps a server-clock estimate (ping/pong, lowest round trip wins)
// - sends our ball SEND_HZ times a second
// - buffers other players' updates and interpolates them for smooth drawing and bumping

interface Snapshot { t: number; p: Vec3; v: Vec3; c?: Vec3 }

/** Sent when joining. Signed-in players send their account token (name and look then come from the account). */
export interface JoinOptions {
  name?: string;
  look?: Look;
  token?: string;
}

const MAX_EXTRAPOLATE_MS = 250;
const BUFFER_MS = 1500;

export class NetClient {
  readonly room: Room<unknown, RaceState>;
  /** Server clock minus local clock, in ms. */
  private offset = 0;
  private samples: { rtt: number; offset: number }[] = [];
  private pings = new Map<number, number>();
  private nextPing = 0;
  private lastSend = -Infinity;
  private buffers = new Map<string, Snapshot[]>();
  private syncTimer: ReturnType<typeof setInterval>;

  static async create(url: string, opts: JoinOptions = {}): Promise<NetClient> {
    return NetClient.ready(await new Client(url).create<RaceState>(ROOM_NAME, opts));
  }

  static async join(url: string, code: string, opts: JoinOptions = {}): Promise<NetClient> {
    return NetClient.ready(await new Client(url).joinById<RaceState>(code.trim().toUpperCase(), opts));
  }

  /** Quick Play: join any open public room, or start one (`fresh`: always a new one, for load tests). */
  static async quick(url: string, opts: JoinOptions = {}, fresh = false): Promise<NetClient> {
    const client = new Client(url);
    return NetClient.ready(fresh
      ? await client.create<RaceState>(QUICK_ROOM, opts)
      : await client.joinOrCreate<RaceState>(QUICK_ROOM, opts));
  }

  /** Resolves once the first full state has arrived, so callers can read it straight away. */
  private static async ready(room: Room<unknown, RaceState>): Promise<NetClient> {
    const net = new NetClient(room);
    if (!room.state?.code) await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
    return net;
  }

  private constructor(room: Room<unknown, RaceState>) {
    this.room = room;
    room.onMessage(MSG.pong, (m: Pong) => this.onPong(m));
    room.onStateChange(() => this.ingest());
    // A burst of pings for a quick first estimate, then a slow trickle to track drift.
    for (let i = 0; i < 6; i++) setTimeout(() => this.ping(), i * 120);
    this.syncTimer = setInterval(() => this.ping(), 3000);
  }

  // ---------- Clock ----------

  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** Round-trip time of the best recent ping, in ms. */
  get rtt(): number {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : 0;
  }

  get clockReady(): boolean {
    return this.samples.length >= 3;
  }

  private ping() {
    const id = this.nextPing++;
    this.pings.set(id, Date.now());
    this.room.send(MSG.ping, { id });
  }

  private onPong({ id, now }: Pong) {
    const sent = this.pings.get(id);
    if (sent === undefined) return;
    this.pings.delete(id);
    const received = Date.now();
    this.samples.push({ rtt: received - sent, offset: now - (sent + received) / 2 });
    if (this.samples.length > 10) this.samples.shift();
    // Trust the sample that spent the least time in transit.
    this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }

  // ---------- State ----------

  get state(): RaceState {
    return this.room.state;
  }

  get id(): string {
    return this.room.sessionId;
  }

  get phase(): Phase {
    return (this.state?.phase ?? 'lobby') as Phase;
  }

  get isHost(): boolean {
    return this.state?.hostId === this.id;
  }

  me() {
    return this.state?.players.get(this.id);
  }

  // ---------- Sending ----------

  /** Sends our ball if it's time to (call every step or frame). */
  sendBall(sim: Simulation) {
    const now = this.serverNow();
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    const c = sim.carrierOut();
    const update: BallUpdate = { t: now, p: sim.position(), v: sim.velocity(), ...(c ? { c } : {}) };
    this.room.send(MSG.state, update);
  }

  ready(ready: boolean) { this.room.send(MSG.ready, { ready }); }
  setLevel(index: number) { this.room.send(MSG.level, { index }); }
  setMode(mode: GameMode) { this.room.send(MSG.mode, { mode }); }
  start() { this.room.send(MSG.start); }
  toLobby() { this.room.send(MSG.toLobby); }
  rename(name: string) { this.room.send(MSG.rename, { name }); }

  async leave() {
    clearInterval(this.syncTimer);
    // If the server already closed the connection (e.g. it restarted), leave() would wait
    // forever for a close that already happened.
    await Promise.race([this.room.leave(true), new Promise((r) => setTimeout(r, 2000))]);
  }

  // ---------- Other players ----------

  private ingest() {
    const players = this.state?.players;
    if (!players) return;
    players.forEach((p, id) => {
      if (id === this.id || !p.t) return;
      let buf = this.buffers.get(id);
      if (!buf) this.buffers.set(id, (buf = []));
      const last = buf[buf.length - 1];
      if (last && p.t <= last.t) {
        if (p.t < last.t - 500) buf.length = 0; // a new race started: forget the old one
        else return;
      }
      buf.push({ t: p.t, p: [p.x, p.y, p.z], v: [p.vx, p.vy, p.vz], ...(p.carrier ? { c: [p.cx, p.cy, p.cz] as Vec3 } : {}) });
      while (buf.length > 2 && buf[1].t < p.t - BUFFER_MS) buf.shift();
    });
    for (const id of this.buffers.keys()) if (!players.has(id)) this.buffers.delete(id);
  }

  /** Where another player's iron ball was at server time `t`, if they're pushing one. */
  carrierAt(id: string, t: number): Vec3 | null {
    const buf = this.buffers.get(id);
    if (!buf?.length) return null;
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].t >= t) i--;
    const b = buf[i], a = buf[i - 1];
    if (!b.c) return null;
    if (!a?.c || t >= b.t || t <= a.t) return b.c;
    const f = (t - a.t) / (b.t - a.t || 1);
    return [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f];
  }

  /** Where another player's ball was at server time `t` (interpolated, briefly extrapolated). */
  sample(id: string, t: number): { position: Vec3; velocity: Vec3 } | null {
    const buf = this.buffers.get(id);
    if (!buf?.length) return null;
    if (t <= buf[0].t) return { position: buf[0].p, velocity: buf[0].v };
    for (let i = buf.length - 1; i > 0; i--) {
      const a = buf[i - 1], b = buf[i];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / (b.t - a.t || 1);
        return {
          position: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f],
          velocity: [a.v[0] + (b.v[0] - a.v[0]) * f, a.v[1] + (b.v[1] - a.v[1]) * f, a.v[2] + (b.v[2] - a.v[2]) * f],
        };
      }
    }
    const last = buf[buf.length - 1];
    const ahead = Math.min(t - last.t, MAX_EXTRAPOLATE_MS) / 1000;
    return {
      position: [last.p[0] + last.v[0] * ahead, last.p[1] + last.v[1] * ahead, last.p[2] + last.v[2] * ahead],
      velocity: last.v,
    };
  }

  /**
   * Other racers' balls at server time `t`, for drawing and for bumping into. Finished (and
   * disqualified) players are left out: they stop sending, so their ball would sit frozen on
   * the goal and block everyone else.
   */
  others(t: number): OtherBall[] {
    const out: OtherBall[] = [];
    this.state?.players.forEach((p, id) => {
      if (id === this.id || p.spectator || p.out || !p.connected || p.finishTime >= 0 || p.dnf) return;
      const s = this.sample(id, t);
      if (s) out.push({ id, ...s });
    });
    return out;
  }
}
