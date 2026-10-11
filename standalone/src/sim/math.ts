// Minimal vector/quaternion helpers. The simulation deliberately avoids Three.js so it can
// run unchanged in tests and on a game server.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const IDENTITY: Quat = [0, 0, 0, 1];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function mulQuat(a: Quat, b: Quat): Quat {
  const [x1, y1, z1, w1] = a;
  const [x2, y2, z2, w2] = b;
  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
}

export function rotate(v: Vec3, q: Quat): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** Rotation about +Y by `yaw`, then about the local +X by `pitch` (Euler order YXZ). */
export function yawPitch(yaw: number, pitch = 0): Quat {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}

export const degToRad = (d: number) => (d * Math.PI) / 180;

/** The inverse of a unit quaternion. */
export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Rotation by `angle` radians about the unit vector `axis`. */
export function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
