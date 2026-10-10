import type { LevelData, Piece } from '../levels/schema';
import { THEMES } from '../levels/themes';
import type { Vec3 } from '../sim/math';

// A small top-down map of a course (level select cards). Drawn straight from the level's
// pieces on a 2D canvas: floors shaded by height, walls, bumpers, sweeper circles, movers,
// checkpoints, stars, start and goal. The course runs up the map (-z is up).

type XZ = [number, number];

function corners(piece: Piece): XZ[] | null {
  const rect = (cx: number, cz: number, hw: number, hd: number, yaw = 0): XZ[] => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
  };
  switch (piece.type) {
    case 'pad': return rect(piece.center[0], piece.center[2], piece.w / 2, piece.d / 2);
    case 'block': return rect(piece.position[0], piece.position[2], piece.size[0] / 2, piece.size[2] / 2, ((piece.yaw ?? 0) * Math.PI) / 180);
    case 'crumble': return rect(piece.center[0], piece.center[2], piece.w / 2, piece.d / 2);
    case 'boost': return rect(piece.position[0], piece.position[2], (piece.w ?? 4) / 2, (piece.d ?? 3) / 2, ((piece.yaw ?? 0) * Math.PI) / 180);
    case 'wind':
    case 'lowgrav': return rect(piece.center[0], piece.center[2], piece.size[0] / 2, piece.size[2] / 2);
    case 'path':
    case 'conveyor': {
      const [ax, , az] = piece.from, [bx, , bz] = piece.to;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / len) * (piece.width / 2), nz = ((bx - ax) / len) * (piece.width / 2);
      return [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
    }
    case 'mover': return rect(piece.from[0], piece.from[2], piece.w / 2, piece.d / 2);
    default: return null;
  }
}

const height = (p: Piece): number => {
  switch (p.type) {
    case 'pad': case 'crumble': return p.center[1];
    case 'path': case 'conveyor': return Math.max(p.from[1], p.to[1]);
    case 'block': return p.position[1] + p.size[1] / 2;
    case 'mover': return p.from[1];
    default: return 0;
  }
};

function shade(hex: string, amount: number): string {
  // amount -1 … 1: darker … lighter
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/** Where world points land on a drawn map (canvas pixels), and back: for marking spots on it. */
export interface MapTransform {
  /** Canvas pixels per world unit. */
  scale: number;
  toPx(x: number, z: number): [number, number];
  toWorld(px: number, py: number): [number, number];
}

/**
 * Draws `level` into `canvas`, fitted and centred. Uses the canvas's current pixel size.
 * `found`: indices of the level's stars already collected (drawn gold; the rest as outlines).
 */
export function drawCourseMap(canvas: HTMLCanvasElement, level: LevelData, found: Set<number> = new Set()): MapTransform | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const theme = THEMES[level.theme ?? 'meadow'];
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const floors = level.pieces.filter((p) => p.type === 'pad' || p.type === 'path' || p.type === 'conveyor' || p.type === 'crumble');
  const pts: XZ[] = [];
  for (const p of level.pieces) {
    const c = p.type === 'wind' || p.type === 'lowgrav' ? null : corners(p); // volumes don't widen the map
    if (c) pts.push(...c);
    if (p.type === 'mover') pts.push(...(corners({ ...p, from: p.to }) ?? []));
  }
  if (!pts.length) return null;
  // Long courses that run up the map are turned sideways (course runs left → right) so they
  // fill the landscape card instead of a thin strip down the middle.
  const spanX = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const spanZ = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  const sideways = spanZ > spanX * 1.3 && W > H;
  const plane = (x: number, z: number): XZ => (sideways ? [-z, x] : [x, z]);
  for (let i = 0; i < pts.length; i++) pts[i] = plane(pts[i][0], pts[i][1]);
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minZ = Math.min(...pts.map((p) => p[1])), maxZ = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(4, Math.min(W, H) * 0.06);
  const scale = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * scale) / 2, oz = (H - (maxZ - minZ) * scale) / 2;
  const toPx = (x: number, z: number): XZ => {
    const [u, v] = plane(x, z);
    return [ox + (u - minX) * scale, oz + (v - minZ) * scale];
  };
  const poly = (c: XZ[]) => {
    ctx.beginPath();
    c.forEach(([x, z], i) => { const [px, pz] = toPx(x, z); if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); });
    ctx.closePath();
  };
  const circle = (p: Vec3, r: number) => {
    const [x, z] = toPx(p[0], p[2]);
    ctx.beginPath();
    ctx.arc(x, z, Math.max(1.5, r * scale), 0, Math.PI * 2);
  };

  /** A small arrow from a toward b (mid-way), for belts, boosts and wind. */
  const arrow = (a: Vec3, b: Vec3, color: string) => {
    const [ax, az] = toPx(a[0], a[2]), [bx, bz] = toPx(b[0], b[2]);
    const len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, s = Math.max(3, Math.min(7, len * 0.3));
    ctx.beginPath();
    ctx.moveTo(mx + ux * s, mz + uz * s);
    ctx.lineTo(mx - ux * s - uz * s * 0.8, mz - uz * s + ux * s * 0.8);
    ctx.lineTo(mx - ux * s + uz * s * 0.8, mz - uz * s - ux * s * 0.8);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Floors, lowest first, lighter the higher they are.
  const ys = floors.map(height);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const tone = (y: number) => (hi - lo < 0.5 ? 0 : ((y - lo) / (hi - lo)) * 0.5 - 0.25);
  for (const p of [...floors].sort((a, b) => height(a) - height(b))) {
    const [a, , side] = p.type === 'conveyor' ? ['#5a5f73', '', '#2a2d38'] : p.type === 'crumble' ? ['#d9b48a', '', '#7a5230'] : theme.palettes[p.palette ?? 'grey'];
    poly(corners(p)!);
    ctx.fillStyle = shade(a, tone(height(p)));
    ctx.fill();
    ctx.strokeStyle = shade(side, 0);
    ctx.lineWidth = Math.max(0.5, scale * 0.15);
    ctx.stroke();
    if (p.type === 'crumble') {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = '#7a5230';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.type === 'conveyor') arrow(p.from, p.to, '#ffd166');
    if ((p.type === 'path' || p.type === 'conveyor') && p.rails) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, scale * 0.3);
      const [c0, c1, c2, c3] = corners(p)!;
      for (const [u, v] of [[c0, c1], [c3, c2]]) {
        ctx.beginPath();
        ctx.moveTo(...toPx(u[0], u[1]));
        ctx.lineTo(...toPx(v[0], v[1]));
        ctx.stroke();
      }
    }
  }

  for (const p of level.pieces) {
    switch (p.type) {
      case 'mover': {
        const [a] = theme.palettes[p.palette ?? 'orange'];
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(...toPx(p.from[0], p.from[2]));
        ctx.lineTo(...toPx(p.to[0], p.to[2]));
        ctx.stroke();
        ctx.setLineDash([]);
        poly(corners(p)!);
        ctx.fillStyle = shade(a, 0.1);
        ctx.fill();
        break;
      }
      case 'block':
        poly(corners(p)!);
        // Stroked in its own colour too, so thin maze walls still show at card size.
        ctx.fillStyle = ctx.strokeStyle = p.color ?? '#f4f4f4';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      case 'bumper':
        circle(p.position, p.radius ?? 1.2);
        ctx.fillStyle = '#ff5d73';
        ctx.fill();
        break;
      case 'sweeper':
        circle(p.position, p.length);
        ctx.strokeStyle = 'rgba(255,93,115,0.8)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        circle(p.position, 0.8);
        ctx.fillStyle = '#ff5d73';
        ctx.fill();
        break;
      case 'boost': {
        poly(corners(p)!);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
        arrow(p.position, [p.position[0] - Math.sin(yaw) * 3, 0, p.position[2] - Math.cos(yaw) * 3], '#fff3b0');
        break;
      }
      case 'spring':
        circle(p.position, (p.radius ?? 1.6) + 0.3);
        ctx.fillStyle = '#ffd166';
        ctx.fill();
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'wind':
      case 'lowgrav':
        poly(corners(p)!);
        ctx.fillStyle = p.type === 'wind' ? 'rgba(200,240,255,0.35)' : 'rgba(201,167,255,0.35)';
        ctx.fill();
        if (p.type === 'wind' && Math.hypot(p.dir[0], p.dir[2]) > 0.3) {
          arrow(p.center, [p.center[0] + p.dir[0] * 4, 0, p.center[2] + p.dir[2] * 4], 'rgba(255,255,255,0.9)');
        } else if (p.type === 'wind') {
          circle(p.center, 1.2); // an updraft, seen from above
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        break;
      case 'checkpoint':
        circle(p.position, 1.4);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'goal': {
        circle(p.position, (p.radius ?? 2) + 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  }

  // Stars on top of everything: gold once found, outlined until then.
  const glyph = Math.max(11, scale * 3.2);
  ctx.font = `${glyph}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2;
  level.pieces.filter((p) => p.type === 'star').forEach((p, i) => {
    if (p.button) {
      // A switch star's button: a red dot, joined to its star by a faint dashed line.
      const [bx, bz] = toPx(p.button[0], p.button[2]), [sx, sz] = toPx(p.position[0], p.position[2]);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(230,57,70,0.6)';
      ctx.beginPath();
      ctx.moveTo(bx, bz);
      ctx.lineTo(sx, sz);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.arc(bx, bz, Math.max(2.5, scale * 1.2), 0, Math.PI * 2);
      ctx.fill();
    }
    const [x, z] = toPx(p.position[0], p.position[2]);
    ctx.strokeStyle = 'rgba(27,27,27,0.8)';
    ctx.strokeText('★', x, z);
    ctx.fillStyle = found.has(i) ? '#ffd60a' : 'rgba(255,255,255,0.85)';
    ctx.fillText('★', x, z);
  });

  // Start: an arrow pointing along the start yaw.
  const s = level.start.position, yaw = level.start.yaw ?? 0;
  const [sx, sz] = toPx(s[0], s[2]);
  const r = Math.max(5, scale * 2.2);
  const [ax, az] = toPx(s[0] - Math.sin(yaw), s[2] - Math.cos(yaw)); // one unit ahead, on the map
  const al = Math.hypot(ax - sx, az - sz) || 1;
  const fx = (ax - sx) / al, fz = (az - sz) / al;
  ctx.beginPath();
  ctx.moveTo(sx + fx * r, sz + fz * r);
  ctx.lineTo(sx - fx * r * 0.6 + fz * r * 0.7, sz - fz * r * 0.6 - fx * r * 0.7);
  ctx.lineTo(sx - fx * r * 0.6 - fz * r * 0.7, sz - fz * r * 0.6 + fx * r * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#2ecc71';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return {
    scale,
    toPx,
    toWorld: (px, py) => {
      const u = (px - ox) / scale + minX, v = (py - oz) / scale + minZ;
      return sideways ? [v, -u] : [u, v];
    },
  };
}
