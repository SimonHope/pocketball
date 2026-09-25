import { parseLevel } from '../src/levels/schema';

/** A short straight course (~3 s for the autopilot) so network tests run quickly. */
export const SPRINT = parseLevel({
  format: 1,
  name: 'Sprint',
  medals: { gold: 3, silver: 4, bronze: 6 },
  start: { position: [0, 1, 2], yaw: 0 },
  pieces: [
    { type: 'pad', center: [0, 0, 0], w: 12, d: 12 },
    { type: 'path', from: [0, 0, -5], to: [0, 0, -25], width: 8, rails: true },
    { type: 'checkpoint', position: [0, 0, -15] },
    { type: 'pad', center: [0, 0, -30], w: 10, d: 10 },
    { type: 'goal', position: [0, 0, -31] },
  ],
  route: [{ p: [0, 0, -20] }, { p: [0, 0, -31], speed: 6 }],
});

/** A small square arena with one hill zone, for party-mode tests. */
export const PIT = parseLevel({
  format: 1,
  name: 'Pit',
  kind: 'arena',
  start: { position: [0, 1, 7], yaw: 0 },
  pieces: [
    { type: 'pad', center: [0, 0, 0], w: 22, d: 22 },
    { type: 'zone', position: [0, 0, -4], radius: 4 },
  ],
});
