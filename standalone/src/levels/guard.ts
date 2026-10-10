import { resolveLevel } from '../sim/geometry';
import type { Vec3 } from '../sim/math';
import { Simulation } from '../sim/simulation';
import { GUARD_COLOR, type BlockPiece, type LevelData, type Piece } from './schema';

// Safety walls: a low wall along every floor edge a ball could roll off, except where the
// course means you to leave the floor (the route or star route crosses the edge: jump lips,
// drops, stairs, gaps to movers, lifts and updrafts). Edges that already have a rail, wall, or
// more floor next to them are left alone, and so are pieces marked `open` (risky lines). Run by `npm run add-walls` and by the course generator.
// Needs initPhysics() first (it asks the physics world what's beyond each edge).

export { GUARD_COLOR };
const THICK = 0.3, HEIGHT = 1.2, STEP = 0.5;
/** Half-width of the gap left where the route crosses an edge (lanes ±2.5 + ball + margin). */
const OPENING = 6;

interface Edge { a: Vec3; b: Vec3; out: [number, number] } // floor-top points; `out` = outward (x, z)

function edgesOf(p: Piece): Edge[] {
  const rect = (c: Vec3, hw: number, hd: number): Edge[] => {
    const [x, y, z] = c;
    return [
      { a: [x - hw, y, z - hd], b: [x + hw, y, z - hd], out: [0, -1] },
      { a: [x - hw, y, z + hd], b: [x + hw, y, z + hd], out: [0, 1] },
      { a: [x - hw, y, z - hd], b: [x - hw, y, z + hd], out: [-1, 0] },
      { a: [x + hw, y, z - hd], b: [x + hw, y, z + hd], out: [1, 0] },
    ];
  };
  switch (p.type) {
    case 'pad': case 'crumble': return rect(p.center, p.w / 2, p.d / 2);
    case 'path': case 'conveyor': {
      const dx = p.to[0] - p.from[0], dz = p.to[2] - p.from[2], len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len, rx = -uz, rz = ux, h = p.width / 2;
      const side = (s: number): Vec3[] => [[p.from[0] + rx * h * s, p.from[1], p.from[2] + rz * h * s], [p.to[0] + rx * h * s, p.to[1], p.to[2] + rz * h * s]];
      const [l0, l1] = side(-1), [r0, r1] = side(1);
      return [
        { a: l0, b: l1, out: [-rx, -rz] },
        { a: r0, b: r1, out: [rx, rz] },
        { a: l0, b: r0, out: [-ux, -uz] },
        { a: l1, b: r1, out: [ux, uz] },
      ];
    }
    default: return [];
  }
}

/** Where (0..1 along the edge) the route crosses it at about the edge's height. */
function crossings(e: Edge, line: Vec3[]): number[] {
  const out: number[] = [];
  const ex = e.b[0] - e.a[0], ez = e.b[2] - e.a[2];
  for (let i = 0; i < line.length - 1; i++) {
    const p = line[i], q = line[i + 1];
    const rx = q[0] - p[0], rz = q[2] - p[2];
    const den = ex * rz - ez * rx;
    if (Math.abs(den) < 1e-9) continue;
    const wx = p[0] - e.a[0], wz = p[2] - e.a[2];
    const t = (wx * rz - wz * rx) / den; // along the edge
    const u = (wx * ez - wz * ex) / den; // along the route segment
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const routeY = p[1] + (q[1] - p[1]) * u, edgeY = e.a[1] + (e.b[1] - e.a[1]) * t;
    if (Math.abs(routeY - edgeY) < 4) out.push(t);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Returns the level with guard walls rebuilt (race courses only; arenas are left open). */
export function addSafetyWalls(level: LevelData): LevelData {
  const pieces = level.pieces.filter((p) => !(p.type === 'block' && p.color === GUARD_COLOR));
  const base: LevelData = { ...level, pieces };
  if ((level.kind ?? 'race') !== 'race') return base;

  // What's beyond an edge is asked of a world without moving or knocking pieces, so a
  // sweeper arm or platform that happens to be there at time 0 doesn't count as floor.
  const still = pieces.filter((p) => p.type !== 'mover' && p.type !== 'sweeper' && p.type !== 'bumper');
  const sim = new Simulation(resolveLevel({ ...base, pieces: still }));
  const startFloor: Vec3 = [level.start.position[0], level.start.position[1] - 1, level.start.position[2]];
  const lines: Vec3[][] = [level.route, level.starRoute].filter((r) => r?.length).map((r) => [startFloor, ...r!.map((w) => w.p)]);
  const walls: BlockPiece[] = [];
  sim.step({ x: 0, z: 0 }); // physics queries only see colliders after the first step
  try {
    for (const piece of pieces) {
      if ((piece.type === 'path' || piece.type === 'conveyor') && piece.rails) continue;
      if ((piece.type === 'path' || piece.type === 'pad' || piece.type === 'crumble' || piece.type === 'conveyor') && piece.open) continue;
      for (const e of edgesOf(piece)) {
        const len = Math.hypot(e.b[0] - e.a[0], e.b[2] - e.a[2]);
        if (len < 0.5) continue;
        const n = Math.max(1, Math.round(len / STEP));
        const exposed: boolean[] = [];
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const y = e.a[1] + (e.b[1] - e.a[1]) * t;
          const outside: Vec3 = [e.a[0] + (e.b[0] - e.a[0]) * t + e.out[0] * 0.2, y, e.a[2] + (e.b[2] - e.a[2]) * t + e.out[1] * 0.2];
          exposed.push(!sim.floorAt(outside));
        }
        // Leave a gap where the route leaves the floor here (a jump, drop, or gap to cross).
        // Where it just carries on onto more floor, the edge there is covered anyway.
        for (const t of lines.flatMap((line) => crossings(e, line))) {
          const at = Math.min(n - 1, Math.floor(t * n));
          if (!exposed[at]) continue;
          for (let i = 0; i < n; i++) if (Math.abs((i + 0.5) / n - t) * len < OPENING) exposed[i] = false;
        }
        // Contiguous exposed runs become walls; sloped runs are cut into short steps.
        for (let i = 0; i < n;) {
          if (!exposed[i]) { i++; continue; }
          let j = i;
          while (j + 1 < n && exposed[j + 1]) j++;
          const t0 = i / n, t1 = (j + 1) / n;
          const dy = Math.abs(e.b[1] - e.a[1]);
          const pieces = dy < 0.05 ? 1 : Math.max(1, Math.ceil(((t1 - t0) * len) / 2));
          for (let k = 0; k < pieces; k++) {
            const a = t0 + ((t1 - t0) * k) / pieces, b = t0 + ((t1 - t0) * (k + 1)) / pieces;
            const at = (t: number): Vec3 => [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t, e.a[2] + (e.b[2] - e.a[2]) * t];
            const pa = at(a), pb = at(b);
            const hi = Math.max(pa[1], pb[1]), lo = Math.min(pa[1], pb[1]);
            const segLen = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
            walls.push({
              type: 'block',
              position: [round((pa[0] + pb[0]) / 2 + e.out[0] * THICK / 2), round((lo - 0.05 + hi + HEIGHT) / 2), round((pa[2] + pb[2]) / 2 + e.out[1] * THICK / 2)],
              size: [THICK, round(hi - lo + HEIGHT + 0.05), round(segLen + THICK)],
              yaw: round((Math.atan2(pb[0] - pa[0], pb[2] - pa[2]) * 180) / Math.PI),
              color: GUARD_COLOR,
            });
          }
          i = j + 1;
        }
      }
    }
  } finally {
    sim.dispose();
  }
  return { ...base, pieces: [...pieces, ...walls] };
}
