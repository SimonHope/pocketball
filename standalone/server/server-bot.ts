import { SIM } from '../src/config';
import type { BallUpdate } from '../src/net/protocol';
import type { GameMode } from '../src/net/modes';
import { ArenaPilot, type ArenaTarget } from '../src/sim/arena-pilot';
import { Autopilot, type PilotStyle } from '../src/sim/autopilot';
import { gridSpot, type ResolvedLevel } from '../src/sim/geometry';
import type { Vec3 } from '../src/sim/math';
import { Simulation, type OtherBall } from '../src/sim/simulation';

// A bot that lives inside a room on the server: the real simulation driven by the racing
// autopilot (race modes) or the arena pilot (King of the Hill, Bumper Arena). Its updates
// go through the same checks as a human's.

const UPDATE_MS = 50;

export function randomStyle(rand: () => number = Math.random): PilotStyle {
  return { lane: (rand() * 2 - 1) * 2.4, pace: 0.82 + rand() * 0.16, avoid: true };
}

export interface BotOptions {
  mode: GameMode;
  /** Arena modes: where this bot wants to go right now. */
  target?: (self: Vec3) => ArenaTarget | null;
}

export class ServerBot {
  private sim: Simulation;
  private pilot: { input(): ReturnType<Autopilot['input']> };
  private acc = 0;
  private lastUpdate = 0;

  constructor(level: ResolvedLevel, slot: number, countdownSeconds: number, style: PilotStyle, opts: BotOptions) {
    this.sim = new Simulation(level);
    this.sim.respawnOnFall = opts.mode !== 'arena';
    this.sim.restart(countdownSeconds, gridSpot(level, slot));
    this.pilot = level.kind === 'arena'
      ? new ArenaPilot(this.sim, style, opts.target ?? (() => null))
      : new Autopilot(this.sim, 16, style);
  }

  /** Advances by `dt` seconds of real time. Returns an update to report every 50 ms. */
  advance(dt: number, now: number, others: OtherBall[]): BallUpdate | null {
    this.acc += Math.min(dt, 0.25);
    this.sim.setOthers(others);
    while (this.acc >= SIM.dt) {
      this.sim.step(this.pilot.input());
      this.sim.drainEvents();
      this.acc -= SIM.dt;
    }
    if (now - this.lastUpdate < UPDATE_MS) return null;
    this.lastUpdate = now;
    return { t: now, p: this.sim.position(), v: this.sim.velocity() };
  }

  dispose() {
    this.sim.dispose();
  }
}
