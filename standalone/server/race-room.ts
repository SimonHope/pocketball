import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import { ARENAS, LEVELS } from '../src/levels';
import type { LevelData } from '../src/levels/schema';
import {
  ARENA_MS, ARENA_OUT_DEPTH, eliminationCount, HILL_MS, HILL_ZONE_MS, hillScorer, isGameMode, MODE_INFO,
  rankForMode, ROUND_BREAK_MS, type GameMode,
} from '../src/net/modes';
import { ownedLook, sanitizeLook, SKINS, HATS, FURS, TRAILS, type Look } from '../src/cosmetics';
import type { MetaService } from './meta/service';
import { isValidName, randomName } from '../src/net/names';
import {
  CODE_ALPHABET, CODE_LENGTH, COUNTDOWN_MS, FINISH_GRACE_MS, MAX_PLAYERS, MAX_RACE_MS, MSG, PATCH_MS,
  PLAYER_COLORS, PlayerState, QUICK_FILL, QUICK_FULL_HUMANS, QUICK_LOBBY_MS, QUICK_RESULTS_MS, RaceState,
  RECONNECT_SECONDS, carrierOf, type BallUpdate, type Phase, type Ping,
} from '../src/net/protocol';
import { LIMITS, MoveChecker, routeProgress } from '../src/net/rules';
import { gridSpot, resolveLevel, type ResolvedLevel } from '../src/sim/geometry';
import type { Vec3 } from '../src/sim/math';
import type { OtherBall } from '../src/sim/simulation';
import type { ArenaTarget } from '../src/sim/arena-pilot';
import { randomStyle, ServerBot } from './server-bot';

// One multiplayer room: lobby → countdown → game → results → lobby, for every mode:
//   race         first to the goal
//   elimination  back-to-back race rounds; the slowest quarter drop out each round
//   hill         King of the Hill: score while alone in the moving zone
//   arena        Bumper Arena: knocked off = out; last one standing wins
// Private rooms (joined by code) have a host. Quick Play rooms are public, start by
// themselves, cycle through modes and fill empty spots with bots.
// The server doesn't simulate human players: it checks each reported ball against the
// rules (src/net/rules.ts, src/net/modes.ts) and keeps score itself. Bots run the real
// simulation here and go through the same checks.

const BOT_GRACE_MS = 5000;
const QUICK_MODES: GameMode[] = ['race', 'hill', 'race', 'arena', 'race', 'elimination'];

function applyLook(p: PlayerState, look: Look) {
  p.skin = look.skin;
  p.hat = look.hat;
  p.fur = look.fur;
  p.trail = look.trail;
}

function makeCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export class RaceRoom extends Room<{ state: RaceState }> {
  /** Race courses and arenas this room can use. Tests swap in small ones. */
  levels: LevelData[] = LEVELS;
  arenas: LevelData[] = ARENAS;
  countdownMs = COUNTDOWN_MS;
  /** Quick Play timings (tests shorten them). */
  quickLobbyMs = QUICK_LOBBY_MS;
  quickResultsMs = QUICK_RESULTS_MS;
  /** Mode timings (tests shorten them). */
  hillMs = HILL_MS;
  arenaMs = ARENA_MS;
  roundBreakMs = ROUND_BREAK_MS;
  /** Public Quick Play room instead of a private one. */
  quick = false;
  /** Quick Play's mode rotation (tests pin it to one mode). */
  quickModes: GameMode[] = QUICK_MODES;
  /** Accounts and progression (set by startServer). */
  meta: MetaService | null = null;
  maxClients = MAX_PLAYERS;
  maxMessagesPerSecond = 60;
  state = new RaceState();

  private resolved: { race: ResolvedLevel[]; arena: ResolvedLevel[] } = { race: [], arena: [] };
  private checkers = new Map<string, MoveChecker>();
  private bots = new Map<string, ServerBot>();
  private nextBotId = 0;
  private lastTick = Date.now();
  private resultsAt = 0;
  private nextRoundAt = 0;
  private outCounter = 0;
  private quickModeIndex = 0;
  private holder: { id: string; since: number } | null = null; // King of the Hill: who's alone in the zone
  /** Signed-in players: session id → account id (server-side only, never synced). */
  private accounts = new Map<string, string>();
  private gameId = 0;
  /** Shutting down (deploy): finish the current game, then close. */
  private draining = false;

  onCreate() {
    this.roomId = makeCode();
    this.state.code = this.roomId;
    this.state.quick = this.quick;
    this.resolved = { race: this.levels.map(resolveLevel), arena: this.arenas.map(resolveLevel) };
    if (this.quick) {
      this.quickModeIndex = randomInt(this.quickModes.length);
      this.setMode(this.quickModes[this.quickModeIndex]);
      this.state.level = randomInt(this.list().length);
    } else {
      void this.setPrivate(true); // joined by code only, never by random matchmaking
    }
    this.setPatchRate(PATCH_MS);
    this.setSimulationInterval(() => this.tick(), 1000 / 60);

    this.onMessage(MSG.ping, (client, m: Ping) => client.send(MSG.pong, { id: m?.id, now: Date.now() }));
    this.onMessage(MSG.ready, (client, m: { ready?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && this.phase === 'lobby') p.ready = m?.ready === true;
    });
    this.onMessage(MSG.rename, (client, m: { name?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && this.phase === 'lobby' && isValidName(m?.name)) {
        p.name = m.name;
        const account = this.accounts.get(client.sessionId);
        if (account) this.meta?.setName(account, m.name);
      }
    });
    this.onMessage(MSG.look, (client, m: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const account = this.accounts.get(client.sessionId);
      if (!p) return;
      // Signed in: equip on the account (only owned items stick). Otherwise free items only.
      applyLook(p, account && this.meta ? this.meta.setLook(account, m) : ownedLook(sanitizeLook(m), 1, new Set()));
    });
    this.onMessage(MSG.mode, (client, m: { mode?: unknown }) => {
      if (this.isHost(client) && this.phase === 'lobby' && isGameMode(m?.mode)) this.setMode(m.mode);
    });
    this.onMessage(MSG.level, (client, m: { index?: unknown }) => {
      if (!this.isHost(client) || this.phase !== 'lobby') return;
      if (typeof m?.index === 'number' && Number.isInteger(m.index) && m.index >= 0 && m.index < this.list().length) {
        this.state.level = m.index;
      }
    });
    this.onMessage(MSG.start, (client) => {
      if (this.isHost(client) && this.phase === 'lobby' && this.everyoneReady()) this.startGame();
    });
    this.onMessage(MSG.toLobby, (client) => {
      if (this.isHost(client) && this.phase === 'results' && this.state.final) this.backToLobby();
    });
    this.onMessage(MSG.state, (client, m: BallUpdate) => this.applyUpdate(client.sessionId, m));
  }

  onJoin(client: Client, options?: { name?: unknown; look?: unknown; token?: unknown }) {
    const p = new PlayerState();
    const account = this.meta?.authenticate(options?.token) ?? null;
    if (account && this.meta) {
      // Signed in: race under the account's name and (owned) look; earn rewards.
      this.accounts.set(client.sessionId, account);
      const profile = this.meta.profile(account);
      p.name = this.uniqueName(profile.name);
      applyLook(p, profile.look);
    } else {
      p.name = this.uniqueName(isValidName(options?.name) ? options.name : randomName());
      applyLook(p, ownedLook(sanitizeLook(options?.look), 1, new Set()));
    }
    p.color = this.freeColor();
    p.spectator = this.phase !== 'lobby'; // joined mid-game: watch, then play next time
    p.finishTime = -1;
    [p.x, p.y, p.z] = this.level().start.position;
    this.state.players.set(client.sessionId, p);
    if (!this.quick && !this.state.hostId) this.state.hostId = client.sessionId;
    if (this.quick && this.phase === 'lobby') this.scheduleQuickStart();
  }

  onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.accounts.delete(client.sessionId);
    this.checkers.delete(client.sessionId);
    if (this.humans().length === 0 && this.quick) {
      void this.disconnect(); // nobody left but bots
      return;
    }
    if (this.state.hostId === client.sessionId) {
      // Hand the room to whoever has been here longest (map keeps join order).
      const next = this.humans().find(([, p]) => p.connected) ?? this.humans()[0];
      this.state.hostId = next ? next[0] : '';
    }
  }

  onDispose() {
    this.clearBots();
  }

  /**
   * The server is shutting down (e.g. a deploy). Colyseus waits for rooms to close, so let a
   * game in progress finish rather than cutting players off mid-race.
   */
  onBeforeShutdown() {
    this.draining = true;
    void this.lock();
    this.broadcast(MSG.notice, { text: 'The server is restarting after this game — you\'ll need to rejoin afterwards.' });
    if (this.phase === 'lobby' || (this.phase === 'results' && this.state.final)) {
      void this.disconnect();
      return;
    }
    this.clock.setTimeout(() => void this.disconnect(), 180_000); // never hold a deploy for longer
  }

  // ---------- Helpers: mode, levels, players ----------

  private get phase(): Phase { return this.state.phase as Phase; }
  private get mode(): GameMode { return this.state.mode as GameMode; }
  private list(): ResolvedLevel[] { return this.resolved[MODE_INFO[this.mode].kind]; }
  private level(): ResolvedLevel { return this.list()[this.state.level] ?? this.list()[0]; }

  private setMode(mode: GameMode) {
    const kindChanged = MODE_INFO[mode].kind !== MODE_INFO[this.mode].kind;
    this.state.mode = mode;
    if (kindChanged) this.state.level = 0;
  }

  private isHost(client: Client) {
    return !this.quick && client.sessionId === this.state.hostId;
  }

  private humans() {
    return [...this.state.players.entries()].filter(([, p]) => !p.bot);
  }

  /** Players taking part in the current round (not watching, not out). */
  private active() {
    return [...this.state.players.entries()].filter(([, p]) => !p.spectator && !p.out);
  }

  private everyoneReady() {
    return this.humans().every(([id, p]) => id === this.state.hostId || p.ready || !p.connected);
  }

  private clearBots() {
    for (const bot of this.bots.values()) bot.dispose();
    this.bots.clear();
  }

  // ---------- Game flow ----------

  /** From the lobby: everyone in, scores reset, first round. */
  private startGame() {
    this.outCounter = 0;
    this.gameId = Date.now();
    for (const p of this.state.players.values()) {
      p.spectator = false;
      p.out = false;
      p.outOrder = 0;
      p.outRound = 0;
      p.score = 0;
    }
    this.state.round = 1;
    this.state.final = this.mode !== 'elimination';
    this.startRound();
  }

  private startRound() {
    const level = this.level();
    const now = Date.now();
    this.state.startAt = now + this.countdownMs;
    this.state.autoStartAt = 0;
    const timed = this.mode === 'hill' ? this.hillMs : this.mode === 'arena' ? this.arenaMs : 0;
    this.state.modeEndAt = timed ? this.state.startAt + timed : 0;
    this.state.endAt = timed ? this.state.modeEndAt : this.state.startAt + MAX_RACE_MS;
    this.state.activeZone = this.mode === 'hill' ? 0 : -1;
    this.state.zoneMoveAt = this.mode === 'hill' ? this.state.startAt + HILL_ZONE_MS : 0;
    this.checkers.clear();
    this.clearBots();
    let slot = 0;
    for (const [id, p] of this.state.players.entries()) {
      p.spectator = p.out; // eliminated players watch the remaining rounds
      p.finishTime = -1;
      p.dnf = false;
      p.strikes = 0;
      p.progress = 0;
      p.place = 0;
      p.t = 0;
      p.vx = p.vy = p.vz = 0;
      if (p.spectator) continue;
      p.slot = slot++;
      const spot = gridSpot(level, p.slot);
      [p.x, p.y, p.z] = spot;
      this.checkers.set(id, new MoveChecker(level, this.state.startAt, spot));
      if (p.bot) {
        this.bots.set(id, new ServerBot(level, p.slot, this.countdownMs / 1000, randomStyle(), {
          mode: this.mode,
          target: (self) => this.botTarget(id, self),
        }));
      }
    }
    this.state.phase = 'countdown';
  }

  /** A ball update from a player (or a bot), checked against the rules before it counts. */
  private applyUpdate(id: string, u: BallUpdate) {
    if (this.phase !== 'countdown' && this.phase !== 'racing') return;
    const p = this.state.players.get(id);
    const checker = this.checkers.get(id);
    if (!p || !checker || p.spectator || p.out || p.dnf || p.finishTime >= 0) return;

    const result = checker.check(u, Date.now());
    if (!result.ok) {
      if (process.env.DEBUG_STRIKES && result.strike) console.warn(`[${this.roomId}] rejected ${p.name}${p.bot ? ' (bot)' : ''}: ${result.reason}`);
      if (result.strike && ++p.strikes >= LIMITS.strikesToDnf) {
        p.dnf = true;
        if (this.mode === 'arena') this.knockOut(p);
      }
      return;
    }
    p.t = u.t;
    [p.x, p.y, p.z] = u.p;
    [p.vx, p.vy, p.vz] = u.v;
    const c = carrierOf(u);
    p.carrier = !!c;
    if (c) [p.cx, p.cy, p.cz] = c;
    p.progress = routeProgress(this.level(), u.p);
    if (result.finishTime !== undefined && MODE_INFO[this.mode].kind === 'race') {
      p.finishTime = result.finishTime;
      this.state.endAt = Math.min(this.state.endAt, Date.now() + FINISH_GRACE_MS);
    }
  }

  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (this.quick) this.quickTick(now);
    if (this.phase === 'results' && !this.state.final && now >= this.nextRoundAt) this.nextEliminationRound();
    if (this.phase === 'countdown' && now >= this.state.startAt) this.state.phase = 'racing';
    if (this.phase === 'countdown' || this.phase === 'racing') this.stepBots(dt, now);
    if (this.phase !== 'racing') return;

    if (this.mode === 'hill') this.hillTick(dt, now);
    if (this.mode === 'arena') this.arenaTick();
    this.updatePlaces();

    if (this.roundOver(now)) this.endRound(now);
  }

  private updatePlaces() {
    const racers = [...this.state.players.entries()].filter(([, p]) => !p.spectator || p.out);
    rankForMode(this.mode, racers.map(([id, p]) => ({
      id, finishTime: p.finishTime, progress: p.progress, dnf: p.dnf, score: p.score, out: p.out, outOrder: p.outOrder,
    }))).forEach((id, i) => { this.state.players.get(id)!.place = i + 1; });
  }

  private roundOver(now: number): boolean {
    const active = this.active();
    const done = ([, p]: [string, PlayerState]) => p.finishTime >= 0 || p.dnf;
    switch (this.mode) {
      case 'race': {
        // Once every human is done, bots get a few seconds rather than holding everyone up.
        if (active.filter(([, p]) => !p.bot).every(done)) this.state.endAt = Math.min(this.state.endAt, now + BOT_GRACE_MS);
        return active.every(done) || now >= this.state.endAt;
      }
      case 'elimination': {
        const finished = active.filter(([, p]) => p.finishTime >= 0).length;
        return finished >= active.length - eliminationCount(active.length) || active.every(done) || now >= this.state.endAt;
      }
      case 'hill':
        return now >= this.state.modeEndAt || active.length === 0;
      case 'arena': {
        const standing = active.length;
        const started = [...this.state.players.values()].filter((p) => !p.spectator || p.out).length;
        return (started >= 2 ? standing <= 1 : standing === 0) || now >= this.state.modeEndAt;
      }
    }
  }

  private endRound(now: number) {
    this.clearBots();
    if (this.mode === 'elimination') {
      // The bottom of the round's order drops out: everyone who didn't finish in time,
      // and at least the quarter the round is meant to remove (but never everyone).
      const active = this.active();
      const order = rankForMode('race', active.map(([id, p]) => ({
        id, finishTime: p.finishTime, progress: p.progress, dnf: p.dnf, score: 0, out: false, outOrder: 0,
      })));
      const unfinished = active.filter(([, p]) => p.finishTime < 0).length;
      const drop = Math.min(active.length - 1, Math.max(eliminationCount(active.length), unfinished));
      for (const id of order.slice(order.length - drop).reverse()) {
        const p = this.state.players.get(id)!;
        p.out = true;
        p.outRound = this.state.round;
        p.outOrder = ++this.outCounter;
      }
      this.updatePlaces();
      this.state.final = this.active().length <= 1;
      this.nextRoundAt = now + this.roundBreakMs;
    } else {
      this.state.final = true;
    }
    this.state.phase = 'results';
    this.resultsAt = now;
    if (this.state.final) this.payRewards();
    if (this.draining && this.state.final) this.clock.setTimeout(() => void this.disconnect(), 6000); // time to see results
  }

  /** The game is over: pay signed-in players and tell each what they earned. */
  private payRewards() {
    if (!this.meta) return;
    const racers = [...this.state.players.values()].filter((p) => !p.spectator || p.out).length;
    for (const [sessionId, account] of this.accounts) {
      const p = this.state.players.get(sessionId);
      if (!p || (p.spectator && !p.out) || !p.place) continue;
      const result = this.meta.recordMatch(account, `match:${this.roomId}:${this.gameId}:${account}`, {
        type: 'match',
        mode: this.mode,
        quick: this.quick,
        place: p.place,
        players: racers,
        finished: p.finishTime >= 0,
        survived: this.mode === 'arena' && !p.out,
        reachedFinal: this.mode === 'elimination' && (!p.out || p.outRound === this.state.round),
      });
      this.clients.find((c) => c.sessionId === sessionId)?.send(MSG.rewards, result);
    }
  }

  private nextEliminationRound() {
    this.state.round++;
    this.state.level = (this.state.level + 1) % this.list().length; // a different course each round
    this.startRound();
  }

  private hillTick(dt: number, now: number) {
    const zones = this.level().zones;
    if (!zones.length) return;
    if (now >= this.state.zoneMoveAt) {
      this.state.activeZone = (this.state.activeZone + 1) % zones.length;
      this.state.zoneMoveAt = now + HILL_ZONE_MS;
    }
    const zone = zones[this.state.activeZone];
    const players = this.active().filter(([, p]) => p.t).map(([id, p]) => ({ id, position: [p.x, p.y, p.z] as Vec3 }));
    const scorer = hillScorer(zone, players);
    if (scorer) this.state.players.get(scorer)!.score += dt;
    if (scorer !== this.holder?.id) this.holder = scorer ? { id: scorer, since: now } : null;
  }

  private arenaTick() {
    const floor = Math.min(...this.level().solids.filter((s) => s.role === 'floor').map((s) =>
      s.position[1] + (s.shape.kind === 'box' ? s.shape.size[1] / 2 : 0)));
    for (const [, p] of this.active()) {
      if (p.t && p.y < floor + 1 - ARENA_OUT_DEPTH) this.knockOut(p);
    }
  }

  private knockOut(p: PlayerState) {
    if (p.out) return;
    p.out = true;
    p.outOrder = ++this.outCounter;
  }

  /**
   * Arena bots. King of the Hill: bots take turns — the one nearest the zone claims it (or
   * knocks out whoever holds it) while the rest circle the edge waiting for an opening; if
   * they all piled in, the zone would always be contested and nobody would score.
   * Bumper Arena: chase the nearest rival.
   */
  private botTarget(id: string, self: Vec3): ArenaTarget | null {
    const rivals = this.active().filter(([rid, p]) => rid !== id && p.t).map(([, p]) => p);
    if (this.mode === 'hill') {
      const zone = this.level().zones[this.state.activeZone];
      if (!zone) return null;
      const [zx, zy, zz] = zone.position;
      const dist = (x: number, z: number) => Math.hypot(x - zx, z - zz);
      const inZone = rivals.filter((p) => dist(p.x, p.z) < zone.radius);
      const hold = { at: zone.position, charge: false };
      const myDist = dist(self[0], self[2]);
      if (myDist < zone.radius) {
        // Inside: alone → hold it; otherwise ram the nearest rival out.
        if (!inZone.length) return hold;
        const r = inZone.reduce((a, b) => (Math.hypot(a.x - self[0], a.z - self[2]) < Math.hypot(b.x - self[0], b.z - self[2]) ? a : b));
        return { at: [r.x, r.y, r.z], charge: true };
      }
      // Outside: if two or more are already fighting in there, let them. Otherwise the
      // closest bot outside goes in (to claim it, or to knock out the one holder).
      const edge = () => {
        // Wait on the edge on *our* side of the zone (so getting there doesn't cross it),
        // spread out a little per bot.
        const angle = Math.atan2(self[2] - zz, self[0] - zx) + (((Number(id.replace(/\D/g, '')) * 7) % 5) - 2) * 0.25;
        return { at: [zx + Math.cos(angle) * (zone.radius + 2.5), zy, zz + Math.sin(angle) * (zone.radius + 2.5)] as Vec3, charge: false };
      };
      if (inZone.length >= 2) return edge();
      const closer = [...this.bots.keys()].some((bid) => {
        const b = this.state.players.get(bid);
        return bid !== id && b && !b.out && b.t && dist(b.x, b.z) >= zone.radius && dist(b.x, b.z) < myDist;
      });
      if (closer) return edge(); // wait for an opening
      if (!inZone.length) return hold;
      // Give a lone holder a moment before attacking (1.5–4 s, varies by bot), so the zone
      // actually gets scored in rather than being contested non-stop.
      const patience = 1500 + (Number(id.replace(/\D/g, '')) * 937) % 2500;
      if (this.holder && Date.now() - this.holder.since < patience) return edge();
      return { at: [inZone[0].x, inZone[0].y, inZone[0].z], charge: true };
    }
    let best: PlayerState | null = null, bestD = Infinity;
    for (const p of rivals) {
      const d = Math.hypot(p.x - self[0], p.z - self[2]);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best ? { at: [best.x + best.vx * 0.3, best.y, best.z + best.vz * 0.3], charge: true } : null;
  }

  private stepBots(dt: number, now: number) {
    if (!this.bots.size) return;
    const balls: OtherBall[] = [];
    this.state.players.forEach((p, id) => {
      if (!p.spectator && !p.out && p.connected && p.t && p.finishTime < 0 && !p.dnf) {
        balls.push({ id, position: [p.x, p.y, p.z], velocity: [p.vx, p.vy, p.vz] });
      }
    });
    for (const [id, bot] of this.bots) {
      const p = this.state.players.get(id);
      if (!p || p.finishTime >= 0 || p.dnf || p.out) continue;
      const update = bot.advance(dt, now, balls.filter((b) => b.id !== id));
      if (update) this.applyUpdate(id, update);
    }
  }

  private backToLobby() {
    this.clearBots();
    for (const [id, p] of [...this.state.players.entries()]) {
      if (p.bot) this.state.players.delete(id);
      p.ready = false;
      p.spectator = false;
      p.out = false;
    }
    this.state.round = 0;
    this.state.final = true;
    this.state.activeZone = -1;
    this.state.phase = 'lobby';
  }

  // ---------- Quick Play ----------

  private scheduleQuickStart() {
    const now = Date.now();
    if (!this.state.autoStartAt) this.state.autoStartAt = now + this.quickLobbyMs;
    if (this.humans().length >= QUICK_FULL_HUMANS) this.state.autoStartAt = Math.min(this.state.autoStartAt, now + 3000);
  }

  private quickTick(now: number) {
    if (this.phase === 'lobby' && this.state.autoStartAt && now >= this.state.autoStartAt) {
      while (this.state.players.size < QUICK_FILL) this.addBot();
      this.startGame();
    } else if (this.phase === 'results' && this.state.final && now - this.resultsAt >= this.quickResultsMs) {
      this.backToLobby();
      this.quickModeIndex = (this.quickModeIndex + 1) % this.quickModes.length;
      this.setMode(this.quickModes[this.quickModeIndex]);
      this.state.level = randomInt(this.list().length);
      this.state.autoStartAt = 0;
      if (this.humans().length) this.scheduleQuickStart();
    }
  }

  private addBot() {
    const p = new PlayerState();
    p.bot = true;
    p.ready = true;
    applyLook(p, {
      skin: randomInt(SKINS.length), hat: randomInt(HATS.length), fur: randomInt(FURS.length), trail: randomInt(TRAILS.length),
    });
    p.name = this.uniqueName(randomName());
    p.color = this.freeColor();
    p.finishTime = -1;
    this.state.players.set(`bot-${this.nextBotId++}`, p);
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.state.players.values()].map((p) => p.name));
    for (let i = 0; i < 20 && taken.has(name); i++) name = randomName();
    return name;
  }

  private freeColor(): number {
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return 0;
  }
}
