import type { Vec3 } from '../sim/math';
import { rng } from './generator';
import type { LevelData, Palette, Piece, RoutePoint } from './schema';
import type { ThemeName } from './themes';

// Maze courses built for the top-down camera: a grid of cells carved by a recursive
// backtracker, with a few extra openings (loops) and open rooms so there's more than one way
// through. Hazards: narrow bridges over pits, bumpers, sweeper rooms, and dead ends with no
// floor. Mechanics: belt corridors, crumbling floors, low gravity, and springs that hop a wall
// as a shortcut. The bot route is the shortest path through the cells.

export interface MazeOptions {
  seed: number;
  name: string;
  theme: ThemeName;
  cols: number;
  rows: number;
  /** Extra walls knocked out, so the maze has loops. */
  loops?: number;
  /** 2×2 open rooms with a sweeper in the middle. */
  rooms?: number;
  /** Straight corridor cells on the solution replaced by a narrow bridge over a pit. */
  bridges?: number;
  /** Straight corridor cells on the solution with a bumper to steer around. */
  bumpers?: number;
  /** Dead ends off the solution with no floor. */
  holes?: number;
  /** Straight corridors on the solution with a belt that carries you along. */
  conveyors?: number;
  /** Straight corridors on the solution whose floor crumbles behind you. */
  crumbles?: number;
  /** Springs that hop you over a wall to a cell further along: shortcuts. */
  springs?: number;
  springPower?: number;
  springPush?: number;
  /** Gravity scale over the whole maze (e.g. 0.5), if set. */
  lowGravity?: number;
  /** Floor colour. */
  palette?: Palette;
  wallColor?: string;
  /** Cap on bot speeds (lower on ice). */
  maxSpeed?: number;
  bridgeWidth?: number;
}

const S = 10;          // cell size
const T = 0.8;         // wall thickness
const H = 2.5;         // wall height
const TOP = -6;        // z of the maze's near edge (the start pad is 12×12 at the origin)
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const; // [dc, dr]: +r runs away from the start (-z)

interface Cell { c: number; r: number }

export function generateMaze(opts: MazeOptions): LevelData | null {
  const rand = rng(opts.seed);
  const { cols, rows } = opts;
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const idx = (c: number, r: number) => r * cols + c;
  const inside = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows;
  // open[i][d]: no wall between cell i and its neighbour in direction d.
  const open = Array.from({ length: cols * rows }, () => [false, false, false, false]);
  const connect = (c: number, r: number, d: number) => {
    const [dc, dr] = DIRS[d];
    open[idx(c, r)][d] = true;
    open[idx(c + dc, r + dr)][(d + 2) % 4] = true;
  };

  // Recursive backtracker (iterative).
  const entryCol = Math.floor(cols / 2);
  const seen = new Set([idx(entryCol, 0)]);
  const stack: Cell[] = [{ c: entryCol, r: 0 }];
  while (stack.length) {
    const { c, r } = stack[stack.length - 1];
    const next = [0, 1, 2, 3].filter((d) => inside(c + DIRS[d][0], r + DIRS[d][1]) && !seen.has(idx(c + DIRS[d][0], r + DIRS[d][1])));
    if (!next.length) { stack.pop(); continue; }
    const d = pick(next);
    connect(c, r, d);
    seen.add(idx(c + DIRS[d][0], r + DIRS[d][1]));
    stack.push({ c: c + DIRS[d][0], r: r + DIRS[d][1] });
  }

  // Open rooms (2×2, not touching the outer rows so the entrance and exit stay corridors).
  const roomCells = new Set<number>();
  const roomCentres: Cell[] = [];
  for (let n = 0, tries = 0; n < (opts.rooms ?? 0) && tries < 50; tries++) {
    const c = 1 + Math.floor(rand() * (cols - 3)), r = 1 + Math.floor(rand() * (rows - 3));
    const cells = [idx(c, r), idx(c + 1, r), idx(c, r + 1), idx(c + 1, r + 1)];
    const near = (i: number) => roomCells.has(i) || [0, 1, 2, 3].some((d) => {
      const cc = (i % cols) + DIRS[d][0], rr = Math.floor(i / cols) + DIRS[d][1];
      return inside(cc, rr) && roomCells.has(idx(cc, rr));
    });
    if (cells.some(near)) continue;
    connect(c, r, 0); connect(c, r, 1); connect(c + 1, r, 0); connect(c, r + 1, 1);
    cells.forEach((i) => roomCells.add(i));
    roomCentres.push({ c, r });
    n++;
  }

  // Loops: knock out random interior walls.
  for (let n = 0, tries = 0; n < (opts.loops ?? 0) && tries < 200; tries++) {
    const c = Math.floor(rand() * cols), r = Math.floor(rand() * rows), d = Math.floor(rand() * 4);
    if (!inside(c + DIRS[d][0], r + DIRS[d][1]) || open[idx(c, r)][d]) continue;
    connect(c, r, d);
    n++;
  }

  // Shortest path from the entrance; the exit is the far-row cell that's furthest away.
  const dist = new Array<number>(cols * rows).fill(-1);
  const prev = new Array<number>(cols * rows).fill(-1);
  const queue = [idx(entryCol, 0)];
  dist[queue[0]] = 0;
  while (queue.length) {
    const i = queue.shift()!;
    const c = i % cols, r = Math.floor(i / cols);
    for (let d = 0; d < 4; d++) {
      if (!open[i][d]) continue;
      const j = idx(c + DIRS[d][0], r + DIRS[d][1]);
      if (dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      prev[j] = i;
      queue.push(j);
    }
  }
  let exit = idx(0, rows - 1);
  for (let c = 0; c < cols; c++) if (dist[idx(c, rows - 1)] > dist[exit]) exit = idx(c, rows - 1);
  if (roomCells.has(exit)) return null;
  const path: number[] = [];
  for (let i = exit; i >= 0; i = prev[i]) path.unshift(i);
  if (path.length < cols * rows * 0.4) return null; // too direct: try another seed
  const onPath = new Set(path);

  // Geometry helpers. Column c spans x0 + c·S … x0 + (c+1)·S; row r spans TOP - r·S … TOP - (r+1)·S.
  const x0 = -(entryCol + 0.5) * S;
  const centre = (i: number): Vec3 => [x0 + ((i % cols) + 0.5) * S, 0, TOP - (Math.floor(i / cols) + 0.5) * S];
  const stepDir = (a: number, b: number): [number, number] => {
    const dc = (b % cols) - (a % cols), dr = Math.floor(b / cols) - Math.floor(a / cols);
    return [dc, -dr]; // world x/z direction
  };
  // Walking direction into and out of each path cell (the entrance comes from +z, the exit leaves to -z).
  const inDir = (k: number): [number, number] => (k === 0 ? [0, -1] : stepDir(path[k - 1], path[k]));
  const outDir = (k: number): [number, number] => (k === path.length - 1 ? [0, -1] : stepDir(path[k], path[k + 1]));
  const straight = (k: number) => {
    const a = inDir(k), b = outDir(k);
    return a[0] === b[0] && a[1] === b[1];
  };
  const openNeighbours = (i: number) => [0, 1, 2, 3].filter((d) => open[i][d]).map((d) => idx((i % cols) + DIRS[d][0], Math.floor(i / cols) + DIRS[d][1]));

  // Hazards on the solution. Keep them off rooms and away from each other.
  type Special = 'bridge' | 'bumper' | 'conveyor' | 'crumble';
  const special = new Map<number, Special>();
  const candidates = path.map((_, k) => k).filter((k) =>
    k >= 2 && k < path.length - 2 && !roomCells.has(path[k]) && straight(k)
    && openNeighbours(path[k]).length === 2 && !openNeighbours(path[k]).some((j) => roomCells.has(j)));
  const place = (kind: Special, count: number) => {
    for (let n = 0, tries = 0; n < count && tries < 40; tries++) {
      const k = pick(candidates);
      // Keep hazards apart, except belts, which can run on into a longer belt corridor.
      const clash = (j: number) => special.has(path[j]) && !(kind === 'conveyor' && special.get(path[j]) === 'conveyor' && j !== k);
      if (k === undefined || [k - 2, k - 1, k, k + 1, k + 2].some(clash)) continue;
      special.set(path[k], kind);
      n++;
    }
  };
  place('conveyor', opts.conveyors ?? 0); // mechanics first: they're the maze's signature
  place('crumble', opts.crumbles ?? 0);
  place('bridge', opts.bridges ?? 0);
  place('bumper', opts.bumpers ?? 0);

  // Holes: dead ends off the solution. Not next to a room or hazard (a knock could send a ball
  // in), and not straight ahead of a turn on the solution (a fast ball could overshoot into it).
  const holes = new Set<number>();
  const safeHole = (i: number) => {
    if (onPath.has(i) || roomCells.has(i) || openNeighbours(i).length !== 1) return false;
    const n = openNeighbours(i)[0];
    if (roomCells.has(n) || special.has(n)) return false;
    const k = path.indexOf(n);
    if (k < 0) return true;
    const [dx, dz] = stepDir(n, i);
    const [ix, iz] = inDir(k);
    return !(dx === ix && dz === iz) && k > 0;
  };
  const deadEnds = [...open.keys()].filter(safeHole);
  for (let n = 0; n < (opts.holes ?? 0) && deadEnds.length; n++) {
    holes.add(deadEnds.splice(Math.floor(rand() * deadEnds.length), 1)[0]);
  }

  const pieces: Piece[] = [{ type: 'pad', center: [0, 0, 0], w: 12, d: 12, palette: 'grey' }];
  const palette = opts.palette ?? 'blue';
  const wallColor = opts.wallColor ?? '#f4f4f4';

  // Floor: greedy rectangles over the solid cells (fewer seams and draw calls).
  const solid = (c: number, r: number) =>
    inside(c, r) && !holes.has(idx(c, r)) && !['bridge', 'conveyor', 'crumble'].includes(special.get(idx(c, r)) ?? '');
  const used = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (used.has(idx(c, r)) || !solid(c, r)) continue;
      let w = 1;
      while (c + w < cols && solid(c + w, r) && !used.has(idx(c + w, r))) w++;
      let h = 1;
      while (r + h < rows && [...Array(w).keys()].every((k) => solid(c + k, r + h) && !used.has(idx(c + k, r + h)))) h++;
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used.add(idx(cc, rr));
      pieces.push({ type: 'pad', center: [x0 + (c + w / 2) * S, 0, TOP - (r + h / 2) * S], w: w * S, d: h * S, palette });
    }
  }

  // Walls, merged into long runs. Horizontal lines j = 0..rows (z = TOP - j·S), vertical lines i = 0..cols.
  const wall = (x: number, z: number, sx: number, sz: number) =>
    pieces.push({ type: 'block', position: [x, H / 2, z], size: [sx, H, sz], color: wallColor });
  for (let j = 0; j <= rows; j++) {
    const closed = (c: number) => {
      if (j === 0) return c !== entryCol;
      if (j === rows) return idx(c, rows - 1) !== exit;
      return !open[idx(c, j - 1)][0];
    };
    for (let c = 0; c < cols;) {
      if (!closed(c)) { c++; continue; }
      let e = c;
      while (e + 1 < cols && closed(e + 1)) e++;
      const a = x0 + c * S - T / 2, b = x0 + (e + 1) * S + T / 2;
      wall((a + b) / 2, TOP - j * S, b - a, T);
      c = e + 1;
    }
  }
  for (let i = 0; i <= cols; i++) {
    const closed = (r: number) => (i === 0 || i === cols ? true : !open[idx(i - 1, r)][1]);
    for (let r = 0; r < rows;) {
      if (!closed(r)) { r++; continue; }
      let e = r;
      while (e + 1 < rows && closed(e + 1)) e++;
      const a = TOP - r * S + T / 2, b = TOP - (e + 1) * S - T / 2;
      wall(x0 + i * S, (a + b) / 2, T, a - b);
      r = e + 1;
    }
  }

  // Rooms: a sweeper in the middle.
  for (const { c, r } of roomCentres) {
    const speed = Math.round((0.8 + rand() * 0.4) * (rand() < 0.5 ? -1 : 1) * 10) / 10;
    pieces.push({ type: 'sweeper', position: [x0 + (c + 1) * S, 0, TOP - (r + 1) * S], length: 8, speed });
  }

  // Route, hazards and checkpoints along the solution.
  const maxSpeed = opts.maxSpeed ?? 14;
  const route: RoutePoint[] = [];
  const wp = (p: Vec3, extra: Omit<RoutePoint, 'p'> = {}) => {
    if (extra.speed) extra.speed = Math.min(extra.speed, maxSpeed);
    route.push({ p, ...extra });
  };
  let sinceCheckpoint = 0;
  const bridgeWidth = opts.bridgeWidth ?? 4.5;
  const gateCells = new Set<number>();
  path.forEach((cell, k) => {
    const p = centre(cell);
    const [dx, dz] = outDir(k);
    const [rx, rz] = [-dz, dx];
    const at = (ahead: number, side = 0): Vec3 => [p[0] + dx * ahead + rx * side, 0, p[2] + dz * ahead + rz * side];
    const kind = special.get(cell);
    sinceCheckpoint++;
    if (kind === 'bridge') {
      pieces.push({ type: 'path', from: at(-S / 2), to: at(S / 2), width: bridgeWidth, palette: 'orange' });
      wp(at(-S / 2 - 1), { speed: 7, lane: 0 });
      wp(at(S / 2 + 0.5), { speed: 8, lane: 0 });
      return;
    }
    if (kind === 'conveyor') {
      pieces.push({ type: 'conveyor', from: at(-S / 2), to: at(S / 2), width: S, speed: 7 });
      return;
    }
    if (kind === 'crumble') {
      // Four strips across the corridor; each gives way half a second after you touch it.
      for (let i = 0; i < 4; i++) {
        const c = at(-S / 2 + 1.25 + i * 2.5);
        pieces.push({ type: 'crumble', center: c, w: dx !== 0 ? 2.5 : S, d: dx !== 0 ? S : 2.5, delay: 0.5, respawn: 3 });
      }
      return;
    }
    if (kind === 'bumper') {
      const side = rand() < 0.5 ? 1 : -1;
      pieces.push({ type: 'bumper', position: at(0, side * 3) });
      wp(at(0, -side * 1.5), { speed: 10, lane: 0 });
      return;
    }
    const next = path[k + 1];
    const beforeBridge = next !== undefined && (special.get(next) === 'bridge' || special.get(next) === 'crumble');
    if ((sinceCheckpoint >= 5 || beforeBridge) && straight(k) && !roomCells.has(cell) && k > 0 && k < path.length - 1) {
      // A gate narrows the corridor so every ball passes over the checkpoint.
      for (const s of [-1, 1]) {
        const g = at(0, s * 4);
        pieces.push({ type: 'block', position: [g[0], 0.75, g[2]], size: dx !== 0 ? [1, 1.5, 1.6] : [1.6, 1.5, 1], color: wallColor });
      }
      pieces.push({ type: 'checkpoint', position: p, yaw: Math.round((Math.atan2(-dx, -dz) * 180) / Math.PI) });
      wp(p, { speed: 9, lane: 1.5 });
      gateCells.add(cell);
      sinceCheckpoint = 0;
      return;
    }
    if (!straight(k) || k === 0) wp(p, { speed: 8, lane: 1.5 });
  });

  // Shortcut springs: in a straight corridor on the solution, beside a side wall with a cell
  // further along the solution behind it. Off the racing line, so bots (who follow the
  // route) never touch them; the longest shortcuts first.
  const pathIndex = new Map(path.map((c, k) => [c, k]));
  const spots: { c: number; d: number; n: number; gain: number }[] = [];
  path.forEach((c, k) => {
    if (k === 0 || !straight(k) || roomCells.has(c) || special.has(c) || gateCells.has(c)) return;
    for (let d = 0; d < 4; d++) {
      if (open[c][d]) continue;
      const nc = (c % cols) + DIRS[d][0], nr = Math.floor(c / cols) + DIRS[d][1];
      if (!inside(nc, nr)) continue;
      const n = idx(nc, nr), m = pathIndex.get(n);
      if (m === undefined || m < k + 3 || holes.has(n) || ['bridge', 'crumble', 'conveyor'].includes(special.get(n) ?? '')) continue;
      spots.push({ c, d, n, gain: m - k });
    }
  });
  spots.sort((a, b) => b.gain - a.gain);
  const springCells = new Set<number>();
  for (const { c, d, n } of spots) {
    if (springCells.size >= (opts.springs ?? 0) * 2) break;
    if (springCells.has(c) || springCells.has(n)) continue;
    const [wx, wz] = [DIRS[d][0], -DIRS[d][1]]; // world direction of the wall
    const p = centre(c);
    pieces.push({
      type: 'spring', position: [p[0] + wx * 3.2, 0, p[2] + wz * 3.2], radius: 1.3,
      power: opts.springPower ?? 15, push: opts.springPush ?? 7, yaw: Math.round((Math.atan2(-wx, -wz) * 180) / Math.PI),
    });
    springCells.add(c).add(n);
  }

  if (opts.lowGravity) {
    pieces.push({ type: 'lowgrav', center: [x0 + (cols * S) / 2, 5, TOP - (rows * S) / 2], size: [cols * S, 30, rows * S], scale: opts.lowGravity });
  }

  // Goal pad beyond the exit, with a back wall.
  const exitC = centre(exit);
  const goal: Vec3 = [exitC[0], 0, TOP - rows * S - 6];
  pieces.push({ type: 'pad', center: goal, w: 12, d: 12, palette: 'green' });
  pieces.push({ type: 'block', position: [goal[0], 1.5, goal[2] - 6.25], size: [12, 3, 0.5], color: wallColor });
  for (const s of [-1, 1]) pieces.push({ type: 'block', position: [goal[0] + s * 6.25, 1.5, goal[2]], size: [0.5, 3, 12], color: wallColor });
  pieces.push({ type: 'goal', position: goal });
  wp(goal, { speed: 6 });

  return {
    format: 1,
    name: opts.name,
    theme: opts.theme,
    camera: 'topdown',
    start: { position: [0, 1, 2], yaw: 0 },
    pieces,
    route,
  };
}
