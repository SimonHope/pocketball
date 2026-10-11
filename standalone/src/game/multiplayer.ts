import * as THREE from 'three';
import type { Look } from '../cosmetics';
import { ARENAS, LEVELS } from '../levels';
import type { LevelData } from '../levels/schema';
import { GAME_MODES, MODE_INFO, type GameMode } from '../net/modes';
import { isValidName, randomName } from '../net/names';
import { NetClient, type JoinOptions } from '../net/net-client';
import { eliminationCount } from '../net/modes';
import { INTERP_DELAY_MS, MSG, PLAYER_COLORS, type Phase, type PlayerState } from '../net/protocol';
import { BallView } from '../render/ball-view';
import { ironBallMesh } from '../render/level-view';
import type { CameraRig, Follow } from '../render/camera';
import { formatTime, type Hud } from '../render/hud';
import { load, save } from '../render/storage';
import { gridSpot } from '../sim/geometry';
import type { Input, Simulation } from '../sim/simulation';
import type { Screens } from '../ui/screens';
import { toast } from '../ui/toast';
import { renderRewards } from '../ui/progress';
import type { MatchRewards } from '../meta/api';
import type { RaceSession } from './session';

// Multiplayer: create/join rooms, the lobby, racing against other players' balls, results.
// The main app hands over to this while in a room and calls its per-frame hooks.

export { SERVER_URL } from '../net/endpoints';
import { SERVER_URL } from '../net/endpoints';

const NAME_KEY = 'hamball.name';
const PARKED = 1e9; // countdown that never ends: the ball waits on the grid in the lobby

export interface MpHost {
  /** The player's chosen cosmetics. */
  look(): Look;
  /** Account token, if signed in (rewards, account name and look). */
  token(): string | null;
  /** The signed-in account's name (null when offline). */
  accountName(): string | null;
  rename(name: string): void;
  /** Rewards arrived: refresh the profile. */
  onRewards(): void;
  track(name: string, props?: Record<string, unknown>): void;
  rig: CameraRig;
  hud: Hud;
  screens: Screens;
  scene: THREE.Object3D;
  /** Replace the current session with this level (no countdown, no demo). */
  loadSession(data: LevelData): RaceSession;
  session(): RaceSession;
  /** Tell the app whether a room is active (switches its mode). */
  setActive(active: boolean): void;
  showMenu(): void;
}

interface Remote {
  view: BallView;
  /** Their iron ball, made when they first push one. */
  iron?: THREE.Mesh;
  rot: THREE.Quaternion;
  name: string;
  color: number;
  look: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function dropRemote(r: Remote, scene: THREE.Object3D) {
  r.view.dispose();
  if (r.iron) scene.remove(r.iron);
}

export class Multiplayer {
  net: NetClient | null = null;
  private name: string;
  private phase: Phase | null = null;
  private levelKey = '';
  private raceStartAt = 0;
  private remotes = new Map<string, Remote>();
  private resultsTimer: ReturnType<typeof setTimeout> | undefined;
  private leaving = false;

  constructor(private host: MpHost) {
    const stored = load(NAME_KEY);
    this.name = isValidName(stored) ? stored : randomName();
    const { screens } = host;

    screens.on('mp', {
      create: () => void this.connect(),
      join: () => void this.connect($<HTMLInputElement>('mp-code').value),
      reroll: () => this.reroll(),
      back: () => screens.show('menu'),
    });
    $('mp-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.connect($<HTMLInputElement>('mp-code').value);
    });
    screens.on('lobby', {
      ready: () => this.net?.ready(!this.net.me()?.ready),
      start: () => this.net?.start(),
      reroll: () => this.reroll(),
      copy: () => void this.copyInvite(),
      back: () => void this.leave(),
    });
    screens.on('mp-results', {
      lobby: () => this.net?.toLobby(),
      back: () => void this.leave(),
    });
    const levelSelect = $<HTMLSelectElement>('lobby-level');
    levelSelect.addEventListener('change', () => this.net?.setLevel(Number(levelSelect.value)));
    const modeSelect = $<HTMLSelectElement>('lobby-mode');
    modeSelect.replaceChildren(...GAME_MODES.map((m) => new Option(MODE_INFO[m].label, m)));
    modeSelect.addEventListener('change', () => this.net?.setMode(modeSelect.value as GameMode));
  }

  get active(): boolean {
    return this.net !== null;
  }

  /** Racing (or counting down) and no menu covering the screen. */
  get racing(): boolean {
    return (this.phase === 'countdown' || this.phase === 'racing') && this.host.screens.current === null;
  }

  private get spectating(): boolean {
    const me = this.net?.me();
    return !!me?.spectator || !!me?.out || this.host.session().sim.out;
  }

  // ---------- Entry ----------

  /** Signed in, the account's name is used (the server enforces it). */
  private get displayName(): string {
    return this.host.accountName() ?? this.name;
  }

  open(code = '') {
    $('mp-name').textContent = this.displayName;
    $('mp-dot').style.background = PLAYER_COLORS[0];
    $<HTMLInputElement>('mp-code').value = code;
    $('mp-error').textContent = '';
    this.host.screens.show('mp');
  }

  /** Quick Play: matchmaking into a public room that starts by itself (bots fill spots). */
  async quickPlay() {
    this.host.screens.show('loading');
    try {
      this.net = await NetClient.quick(SERVER_URL, this.joinOptions());
    } catch {
      this.host.screens.show('menu');
      this.toast("Couldn't reach the multiplayer server. Try again in a moment.", 4000);
      return;
    }
    this.joined();
  }

  async connect(code?: string) {
    const trimmed = code?.trim();
    if (code !== undefined && !trimmed) {
      $('mp-error').textContent = 'Type the 6-letter room code first.';
      return;
    }
    $('mp-error').textContent = 'Connecting…';
    try {
      this.net = trimmed
        ? await NetClient.join(SERVER_URL, trimmed, this.joinOptions())
        : await NetClient.create(SERVER_URL, this.joinOptions());
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      $('mp-error').textContent = trimmed && /not found|invalid|locked|full/i.test(msg)
        ? `No open room with code ${trimmed.toUpperCase()} (it may be full).`
        : 'Couldn\'t reach the multiplayer server. Try again in a moment.';
      return;
    }
    this.joined();
  }

  private joinOptions(): JoinOptions {
    return { name: this.name, look: this.host.look(), token: this.host.token() ?? undefined };
  }

  private joined() {
    if (!this.net) return;
    $('mp-error').textContent = '';
    this.leaving = false;
    this.phase = null;
    this.levelKey = '';
    this.raceStartAt = 0;
    const room = this.net.room;
    room.onStateChange(() => this.onState());
    room.onMessage(MSG.notice, (m: { text?: string }) => this.toast(String(m?.text ?? ''), 8000));
    room.onMessage(MSG.rewards, (m: MatchRewards) => {
      this.lastRewards = m;
      this.host.onRewards();
      if (this.host.screens.current === 'mp-results') this.renderMatchRewards();
    });
    room.onDrop(() => this.toast('Connection lost — reconnecting…'));
    room.onReconnect(() => this.toast('Reconnected!', 1500));
    room.onLeave(() => {
      if (this.leaving) return;
      this.toast('Disconnected from the room.', 3000);
      this.cleanup();
      this.host.showMenu();
    });
    if (!this.net.state.quick) history.replaceState(null, '', `?room=${this.net.state.code}`);
    this.host.setActive(true);
    this.host.track('mp_join', { quick: this.net.state.quick });
    this.onState();
  }

  async leave() {
    if (!this.net) return;
    this.leaving = true;
    await this.net.leave().catch(() => {});
    this.cleanup();
    this.host.showMenu();
  }

  private cleanup() {
    clearTimeout(this.resultsTimer);
    for (const r of this.remotes.values()) dropRemote(r, this.host.scene);
    this.remotes.clear();
    this.net = null;
    this.phase = null;
    history.replaceState(null, '', location.pathname);
    this.host.setActive(false);
  }

  private reroll() {
    this.name = randomName();
    save(NAME_KEY, this.name);
    if (this.host.accountName()) this.host.rename(this.name);
    $('mp-name').textContent = this.name;
    this.net?.rename(this.name);
  }

  private async copyInvite() {
    if (!this.net) return;
    const url = `${location.origin}${location.pathname}?room=${this.net.state.code}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('Invite link copied!', 1500);
    } catch {
      this.toast(url, 5000);
    }
  }

  toast(text: string, ms = 0) {
    toast(text, ms);
  }

  // ---------- Room state ----------

  private onState() {
    const net = this.net;
    if (!net?.state) return;
    const phase = net.phase;
    const entered = phase !== this.phase;
    this.phase = phase;

    if (phase === 'lobby') {
      if (entered || this.currentKey() !== this.levelKey) this.enterLobby();
      this.renderLobby();
    } else if (phase === 'countdown' || phase === 'racing') {
      if (net.state.startAt !== this.raceStartAt) this.beginRace();
    } else if (phase === 'results' && entered) {
      clearTimeout(this.resultsTimer);
      this.resultsTimer = setTimeout(() => this.showResults(), 1500);
    }
    this.syncRemotes();
  }

  private get mode(): GameMode {
    return (this.net?.state.mode ?? 'race') as GameMode;
  }

  /** Courses for the current mode: race courses, or arenas for the party modes. */
  private levelList(): LevelData[] {
    return MODE_INFO[this.mode].kind === 'arena' ? ARENAS : LEVELS;
  }

  private currentKey(): string {
    return `${MODE_INFO[this.mode].kind}:${this.net?.state.level ?? 0}`;
  }

  private ensureLevel(): RaceSession {
    const key = this.currentKey();
    if (key !== this.levelKey) {
      this.levelKey = key;
      for (const r of this.remotes.values()) dropRemote(r, this.host.scene);
      this.remotes.clear();
      return this.host.loadSession(this.levelList()[this.net!.state.level] ?? this.levelList()[0]);
    }
    return this.host.session();
  }

  private enterLobby() {
    clearTimeout(this.resultsTimer);
    const s = this.ensureLevel();
    s.restart(PARKED, gridSpot(s.level, 0));
    s.sim.drainEvents();
    this.host.rig.snap(s.follow(), s.sim.spawn.yaw);
    s.ballView.faceYaw(s.sim.spawn.yaw);
    s.ballView.setVisible(true);
    this.host.hud.setVisible(false);
    this.host.hud.hideBanner();
    this.host.screens.show('lobby');
  }

  private renderLobby() {
    const net = this.net!;
    const quick = net.state.quick;
    const players = [...net.state.players.entries()];
    $('lobby-title').textContent = quick ? 'Quick Play' : 'Your room';
    $('lobby-code-block').hidden = quick;
    $('lobby-code').textContent = net.state.code;
    $('lobby-players').replaceChildren(...players.map(([id, p]) => {
      const row = document.createElement('div');
      row.className = 'p';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PLAYER_COLORS[p.color];
      const name = document.createElement('span');
      name.textContent = `${p.name}${p.bot ? ' 🤖' : ''}${id === net.id ? ' (you)' : ''}`;
      const tag = document.createElement('span');
      const isHost = id === net.state.hostId;
      tag.className = `tag${isHost || p.ready ? ' ok' : ''}`;
      tag.textContent = quick ? '' : !p.connected ? 'reconnecting…' : isHost ? '👑 host' : p.ready ? '✓ ready' : 'not ready';
      row.append(dot, name, tag);
      return row;
    }));

    const canPick = net.isHost && !quick;
    const modeSelect = $<HTMLSelectElement>('lobby-mode');
    modeSelect.value = this.mode;
    modeSelect.hidden = !canPick;
    $('lobby-mode-name').textContent = canPick ? '' : MODE_INFO[this.mode].label;
    $('lobby-mode-blurb').textContent = MODE_INFO[this.mode].blurb;
    const select = $<HTMLSelectElement>('lobby-level');
    const list = this.levelList();
    if (select.dataset.kind !== MODE_INFO[this.mode].kind) {
      select.dataset.kind = MODE_INFO[this.mode].kind;
      select.replaceChildren(...list.map((l, i) => new Option(l.name, String(i))));
    }
    select.value = String(net.state.level);
    select.hidden = !canPick;
    $('lobby-level-name').textContent = canPick ? '' : list[net.state.level]?.name ?? '';

    const waiting = players.filter(([id, p]) => id !== net.state.hostId && !p.ready && p.connected).length;
    const readyBtn = $<HTMLButtonElement>('lobby-ready');
    const startBtn = $<HTMLButtonElement>('lobby-start');
    readyBtn.hidden = net.isHost || quick;
    readyBtn.textContent = net.me()?.ready ? '✓ Ready (click to undo)' : "I'm ready";
    startBtn.hidden = !net.isHost || quick;
    startBtn.disabled = waiting > 0;
    if (quick) {
      $('lobby-hint').textContent = this.quickCountdownText('Starts in', 'Bots fill any empty spots.');
      return;
    }
    $('lobby-hint').textContent = players.length === 1
      ? 'Share the code — or start now to race solo.'
      : waiting > 0
        ? `Waiting for ${waiting} player${waiting > 1 ? 's' : ''} to get ready…`
        : net.isHost ? 'Everyone is ready!' : 'Waiting for the host to start…';
  }

  private beginRace() {
    const net = this.net!;
    this.lastRewards = null;
    this.raceStartAt = net.state.startAt;
    const s = this.ensureLevel();
    const me = net.me();
    const { hud, rig, screens } = this.host;
    screens.show(null);
    hud.setVisible(true);
    hud.setBest(null);
    if (!me || me.spectator) {
      s.restart(PARKED);
      s.sim.drainEvents();
      s.ballView.setVisible(false);
      if (me?.out) hud.showBanner("You're out", 'Watching the rest…', 3000);
      else hud.showBanner('Game in progress', "You'll join the next one", 4000);
      return;
    }
    const countdown = Math.max(0, (net.state.startAt - net.serverNow()) / 1000);
    s.restart(countdown, gridSpot(s.level, me.slot));
    s.sim.respawnOnFall = this.mode !== 'arena';
    s.sim.drainEvents();
    const left = [...net.state.players.values()].filter((p) => !p.spectator).length;
    const intro: Record<GameMode, [string, string]> = {
      race: [MODE_INFO.race.label, s.level.name],
      elimination: [`Round ${net.state.round}`, `${left} left — the slowest ${eliminationCount(left)} will be out`],
      hill: [MODE_INFO.hill.label, 'Stay alone in the glowing zone to score'],
      arena: [MODE_INFO.arena.label, 'Knock everyone off — last one standing wins'],
    };
    hud.showBanner(...intro[this.mode], Math.max(800, countdown * 1000 - 3000));
    s.ballView.setVisible(true);
    s.ballView.setTint(PLAYER_COLORS[me.color]);
    rig.snap(s.follow(), s.sim.spawn.yaw);
    s.ballView.faceYaw(s.sim.spawn.yaw);
  }

  private showResults() {
    const net = this.net;
    if (!net || net.phase !== 'results') return;
    const final = net.state.final;
    const rows = [...net.state.players.entries()]
      .filter(([, p]) => !p.spectator || p.out)
      .sort(([, a], [, b]) => a.place - b.place);
    const justOut = rows.filter(([, p]) => p.out && p.outRound === net.state.round).map(([, p]) => p.name);
    $('mp-results-title').textContent = final
      ? `${MODE_INFO[this.mode].label} — results`
      : `Round ${net.state.round}: ${justOut.join(', ') || 'nobody'} ${justOut.length === 1 ? 'is' : 'are'} out`;
    $('mp-results-table').replaceChildren(...rows.flatMap(([id, p]) => {
      const cls = id === net.id ? 'me' : '';
      const place = Object.assign(document.createElement('span'), { className: cls, textContent: `${p.place || '–'}.` });
      const who = document.createElement('span');
      who.className = cls;
      who.style.display = 'flex';
      who.style.gap = '8px';
      who.style.alignItems = 'center';
      const dot = Object.assign(document.createElement('span'), { className: 'dot' });
      dot.style.background = PLAYER_COLORS[p.color];
      who.append(dot, `${p.name}${p.bot ? ' 🤖' : ''}`);
      const time = Object.assign(document.createElement('span'), { className: cls, textContent: this.resultText(p) });
      return [place, who, time];
    }));
    $<HTMLButtonElement>('mp-results-lobby').hidden = !net.isHost || !final;
    $('mp-results-hint').textContent = !final ? 'Next round starting…'
      : net.state.quick ? 'Next game coming up…' : net.isHost ? '' : 'Waiting for the host…';
    this.host.hud.setVisible(false);
    this.host.screens.show('mp-results');
    this.renderMatchRewards();
    if (final) {
      const me = net.me();
      this.host.track('match_end', { mode: this.mode, place: me?.place, players: rows.length, quick: net.state.quick });
    }
  }

  private lastRewards: MatchRewards | null = null;

  private renderMatchRewards() {
    const box = $('mp-results-rewards');
    const r = this.lastRewards;
    if (!this.net?.state.final) return box.replaceChildren();
    if (!r) return renderRewards(box, [], this.host.token() ? '' : 'Play online with an account to earn XP and coins.');
    renderRewards(box, [...(r.granted ? [r.granted] : []), ...r.challenges]);
  }

  /** What the results table shows for a player, per mode. */
  private resultText(p: PlayerState): string {
    switch (this.mode) {
      case 'hill': return `${p.score.toFixed(1)}s`;
      case 'arena': return p.out ? 'Knocked out' : 'Survivor 🏆';
      case 'elimination': if (p.out) return `Out (round ${p.outRound})`; break;
    }
    return p.finishTime >= 0 ? formatTime(p.finishTime) : 'DNF';
  }

  /** The HUD clock: time left in timed modes, otherwise the race time. */
  clock(raceTime: number): number {
    const net = this.net;
    if (net?.state.modeEndAt && (this.phase === 'racing' || this.phase === 'countdown')) {
      return Math.max(0, (net.state.modeEndAt - net.serverNow()) / 1000);
    }
    return raceTime;
  }

  // ---------- Other players' balls ----------

  private syncRemotes() {
    const net = this.net!;
    const show = this.phase !== 'lobby';
    const seen = new Set<string>();
    net.state.players.forEach((p: PlayerState, id: string) => {
      if (id === net.id || p.spectator || !show) return;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r || r.color !== p.color) {
        if (r) dropRemote(r, this.host.scene);
        r = { view: new BallView(this.host.scene, PLAYER_COLORS[p.color]), rot: new THREE.Quaternion(), name: '', color: p.color, look: '' };
        this.remotes.set(id, r);
      }
      if (r.name !== p.name) {
        r.name = p.name;
        r.view.setLabel(p.name, PLAYER_COLORS[p.color]);
      }
      const look = `${p.skin},${p.hat},${p.fur},${p.trail}`;
      if (r.look !== look) {
        r.look = look;
        r.view.setLook({ skin: p.skin, hat: p.hat, fur: p.fur, trail: p.trail });
      }
    });
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        dropRemote(r, this.host.scene);
        this.remotes.delete(id);
      }
    }
  }

  // ---------- Per-frame hooks (called by the main loop) ----------

  input(move: Input): Input {
    return this.racing && !this.spectating ? move : { x: 0, z: 0 };
  }

  /** Before each physics step: other balls to bump into. */
  beforeStep(sim: Simulation) {
    if (!this.net) return;
    sim.setOthers(this.phase === 'racing' || this.phase === 'countdown' ? this.net.others(this.net.serverNow() - INTERP_DELAY_MS) : []);
  }

  /** After stepping: send our ball while it's in the race. */
  afterSteps(sim: Simulation) {
    const net = this.net;
    const me = net?.me();
    if (!net || !me || me.spectator || me.dnf || me.finishTime >= 0) return;
    if (this.phase === 'countdown' || this.phase === 'racing') net.sendBall(sim);
  }

  private quickCountdownText(prefix: string, suffix: string): string {
    const net = this.net;
    if (!net?.state.autoStartAt) return suffix;
    const secs = Math.max(0, Math.ceil((net.state.autoStartAt - net.serverNow()) / 1000));
    return `${prefix} ${secs}s. ${suffix}`;
  }

  /** Draws other balls and the live positions list. */
  render(dt: number) {
    const net = this.net;
    if (!net) return;
    if (net.state.quick && this.phase === 'lobby' && this.host.screens.current === 'lobby') {
      $('lobby-hint').textContent = this.quickCountdownText('Starts in', 'Bots fill any empty spots.');
    }
    if (this.phase === 'countdown' || this.phase === 'racing') this.host.session().levelView.setActiveZone(net.state.activeZone);
    const t = net.serverNow() - INTERP_DELAY_MS;
    for (const [id, r] of this.remotes) {
      const s = net.sample(id, t);
      const p = net.state.players.get(id);
      // Finished players roll "through" the goal and vanish, so they don't block it.
      const shown = !!s && !!p?.connected && p.finishTime < 0 && !p.dnf;
      r.view.setVisible(shown);
      if (!s) continue;
      // Roll the ball visually from its velocity (spin isn't sent over the network).
      const [vx, , vz] = s.velocity;
      const speed = Math.hypot(vx, vz);
      if (speed > 0.01) {
        const axis = new THREE.Vector3(vz, 0, -vx).normalize();
        r.rot.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, speed * dt));
      }
      r.view.update(s.position, [r.rot.x, r.rot.y, r.rot.z, r.rot.w], s.velocity, dt);
      const c = net.carrierAt(id, t);
      if (c && !r.iron) {
        const solid = this.host.session().level.solids.find((x) => x.role === 'carrier');
        r.iron = ironBallMesh(solid?.shape.kind === 'sphere' ? solid.shape.radius : 3);
        this.host.scene.add(r.iron);
      }
      if (r.iron) {
        r.iron.visible = !!c && shown;
        if (c) r.iron.position.set(...c);
      }
    }
    this.renderPositions();
  }

  /** Spectators follow the race leader. */
  follow(own: Follow): Follow {
    const net = this.net;
    if (!net || !this.spectating) return own;
    const leader = [...net.state.players.entries()]
      .filter(([id, p]) => id !== net.id && !p.spectator && p.place > 0)
      .sort(([, a], [, b]) => a.place - b.place)[0];
    const s = leader && net.sample(leader[0], net.serverNow() - INTERP_DELAY_MS);
    return s ? { position: s.position, velocity: s.velocity, grounded: true, lastGroundY: s.position[1] - 1 } : own;
  }

  private renderPositions() {
    const el = $('positions');
    const net = this.net;
    if (!net || (this.phase !== 'racing' && this.phase !== 'countdown')) {
      el.replaceChildren();
      return;
    }
    const racers = [...net.state.players.entries()]
      .filter(([, p]) => (!p.spectator || p.out) && p.place > 0)
      .sort(([, a], [, b]) => a.place - b.place);
    // Top 6, plus you if you're further back.
    const shown = racers.filter(([id], i) => i < 6 || id === net.id);
    const key = shown.map(([id, p]) => `${id}${p.place}${p.finishTime}${p.out}${p.score.toFixed(1)}`).join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.replaceChildren(...shown.map(([id, p]) => {
      const row = document.createElement('div');
      row.className = `pos${id === net.id ? ' me' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PLAYER_COLORS[p.color];
      const extra = this.mode === 'hill' ? ` ${p.score.toFixed(1)}s`
        : p.out ? ' OUT' : p.finishTime >= 0 ? ` ${formatTime(p.finishTime)}` : p.dnf ? ' DNF' : '';
      const text = `${p.place}. ${p.name}${p.bot ? ' 🤖' : ''}${extra}`;
      row.append(dot, text);
      return row;
    }));
  }
}
