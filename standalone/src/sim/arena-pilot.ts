import type { PilotStyle } from './autopilot';
import type { Vec3 } from './math';
import type { Input, Simulation } from './simulation';

// Arena bot: heads for a target (the hill zone, or an opponent to knock off) and backs away
// from edges. Used by server bots in King of the Hill and Bumper Arena.

/** Where to go: `charge` rams through it (a rival); otherwise arrive and stay (a zone). */
export interface ArenaTarget {
  at: Vec3;
  charge: boolean;
}

export class ArenaPilot {
  private center: Vec3;

  constructor(private sim: Simulation, private style: PilotStyle, private target: (self: Vec3) => ArenaTarget | null) {
    // Middle of the arena floor, to retreat toward when near an edge.
    const floors = sim.level.solids.filter((s) => s.role === 'floor');
    const n = Math.max(1, floors.length);
    this.center = [
      floors.reduce((a, s) => a + s.position[0], 0) / n,
      sim.level.start.position[1] - 1,
      floors.reduce((a, s) => a + s.position[2], 0) / n,
    ];
  }

  input(): Input {
    const pos = this.sim.position();
    const vel = this.sim.velocity();
    const feet: Vec3 = [pos[0], pos[1] - 1, pos[2]];
    const target = this.target(pos) ?? { at: this.center, charge: false };
    const goal = target.at;

    let dx = goal[0] - pos[0], dz = goal[2] - pos[2];
    const dist = Math.hypot(dx, dz) || 1e-6;
    dx /= dist; dz /= dist;
    // Charge through rivals (no slowing at the end, so hits knock); ease into zones.
    const pace = this.style.pace ?? 1;
    const speed = target.charge ? Math.min(18 * pace, 6 + dist * 2) : Math.min(14 * pace, dist * 1.5);
    let want: [number, number] = [dx * speed, dz * speed];

    // Edge safety: if we'd run out of floor soon (where we're heading, or where momentum is
    // taking us), turn back toward the middle.
    const ahead: Vec3 = [feet[0] + vel[0] * 0.45, feet[1], feet[2] + vel[2] * 0.45];
    const next: Vec3 = [feet[0] + dx * 2.2, feet[1], feet[2] + dz * 2.2];
    if (!this.sim.floorAt(ahead) || !this.sim.floorAt(next)) {
      const cx = this.center[0] - pos[0], cz = this.center[2] - pos[2];
      const cd = Math.hypot(cx, cz) || 1;
      want = [(cx / cd) * 12, (cz / cd) * 12];
    }

    const sx = want[0] - vel[0], sz = want[1] - vel[2];
    const m = Math.hypot(sx, sz);
    if (m < 0.3) return { x: 0, z: 0 };
    const k = Math.min(1, m / 2) / m;
    return { x: sx * k, z: sz * k };
  }
}
