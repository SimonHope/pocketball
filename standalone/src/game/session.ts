import * as THREE from 'three';
import type { LevelData } from '../levels/schema';
import { BallView } from '../render/ball-view';
import type { Follow } from '../render/camera';
import { LevelView } from '../render/level-view';
import { addClouds, addValley } from '../render/scene';
import { addScenery, type Scenery } from '../render/backdrop';
import { Effects } from '../render/effects';
import { THEMES } from '../levels/themes';
import { resolveLevel, type ResolvedLevel } from '../sim/geometry';
import { lerp, type Quat, type Vec3 } from '../sim/math';
import { SIM } from '../config';
import { Simulation, type Input } from '../sim/simulation';
import type { BallUpdate } from '../net/protocol';

// One level being played: its simulation plus everything drawn for it, kept in a single
// group so switching levels (or returning to the menu) cleanly removes it all.

export class RaceSession {
  readonly data: LevelData;
  readonly level: ResolvedLevel;
  readonly sim: Simulation;
  readonly levelView: LevelView;
  readonly ballView: BallView;
  /** Dust, sparks, sparkles and confetti for this level (see render/effects.ts). */
  readonly effects: Effects;
  /** A log broke up (main.ts plays the crack when it's near). */
  onLogBreak?: (at: Vec3) => void;
  private group = new THREE.Group();
  private prevPos: Vec3;
  private prevRot: Quat;
  /** The run's path at 20 Hz (t = ms since GO), sent to the server to verify solo times. */
  trace: BallUpdate[] = [];
  private stepsSinceGo = 0;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  /** Themes with a look: specks drifting around the ball (and the night's aurora). */
  private scenery: Scenery | null = null;

  constructor(private parent: THREE.Object3D, data: LevelData) {
    this.data = data;
    this.level = resolveLevel(data);
    this.sim = new Simulation(this.level);
    const theme = THEMES[this.level.theme];
    if (theme.look) this.scenery = addScenery(this.group, theme.look);
    else {
      addClouds(this.group, this.level);
      addValley(this.group, this.level);
    }
    this.levelView = new LevelView(this.group, this.level);
    this.ballView = new BallView(this.group);
    this.effects = new Effects(this.group, theme.look?.dust);
    // Logs from a launcher break up when they reach the end of their run.
    this.levelView.onBreak = (at, dir) => {
      this.effects.burst('splinters', at, { dir });
      this.onLogBreak?.(at);
    };
    parent.add(this.group);
    this.prevPos = this.sim.position();
    this.prevRot = this.sim.rotation();
  }

  step(input: Input) {
    this.prevPos = this.sim.position();
    this.prevRot = this.sim.rotation();
    const wasPlaying = this.sim.phase === 'playing';
    this.sim.step(input);
    if (wasPlaying) {
      this.stepsSinceGo++;
      const done = (this.sim.phase as string) === 'finished';
      if ((this.stepsSinceGo % 6 === 0 || done) && this.trace.length < 6500) {
        this.trace.push({ t: this.stepsSinceGo * SIM.dt * 1000, p: this.sim.position(), v: this.sim.velocity() });
      }
    }
  }

  /** Back to the start. Multiplayer passes the server's countdown and a starting-grid spot. */
  restart(countdown?: number, start?: Vec3) {
    this.sim.restart(countdown, start);
    this.stepsSinceGo = 0;
    this.trace = [{ t: -20, p: this.sim.position(), v: [0, 0, 0] }];
    this.level.checkpoints.forEach((_, i) => this.levelView.setCheckpoint(i, false));
    this.level.stars.forEach((_, i) => this.levelView.setStar(i, false));
    this.prevPos = this.sim.position();
    this.prevRot = this.sim.rotation();
  }

  /** Updates visuals, drawing the ball `alpha` of the way between the last two physics steps. */
  render(alpha: number, dt: number): Vec3 {
    const pos = lerp(this.prevPos, this.sim.position(), alpha);
    const rot = this.qa.set(...this.prevRot).slerp(this.qb.set(...this.sim.rotation()), alpha);
    this.ballView.update(pos, [rot.x, rot.y, rot.z, rot.w], this.sim.velocity(), dt, { grounded: this.sim.grounded });
    this.effects.update(dt);
    this.levelView.update(this.sim, dt);
    this.scenery?.update(pos, dt);
    return pos;
  }

  follow(position: Vec3 = this.sim.position()): Follow {
    return {
      position,
      velocity: this.sim.velocity(),
      grounded: this.sim.grounded,
      lastGroundY: this.sim.lastGroundY,
    };
  }

  dispose() {
    this.effects.dispose();
    this.parent.remove(this.group);
    const seen = new Set<object>();
    const free = (d: { dispose(): void }) => {
      if (!seen.has(d)) { seen.add(d); d.dispose(); }
    };
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Points)) return;
      free(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if ('map' in m && m.map instanceof THREE.Texture) free(m.map);
        free(m);
      }
    });
    this.sim.dispose();
  }
}
