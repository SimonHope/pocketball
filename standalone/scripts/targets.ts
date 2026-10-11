import type { GenOptions } from '../src/levels/generator';
import type { MazeOptions } from '../src/levels/maze';
import type { Piece } from '../src/levels/schema';

// The generated courses: one target each (used by generate-levels.ts, and by the mechanics
// catalog test, which checks MECHANICS.md's "Courses" column against these).

export type Target = {
  file: string;
  firstSeed: number;
  /** Downhill: the goal must be at least this far below the start. */
  minDrop?: number;
  /** The course's signature mechanic: keep only layouts containing these pieces. */
  needs?: Piece['type'][];
  /** How many of each needed piece (default 1). */
  needCount?: number;
} & (
  | ({ maze?: false; /** Continue this hand-made course (src/levels/bases/<file>.json) past its finish. */ extend?: boolean } & Omit<GenOptions, 'seed'>)
  | ({ maze: true } & Omit<MazeOptions, 'seed'>)
);

export const TARGETS: Target[] = [
  // Each course has a signature mechanic (`needs`: the layout must contain those pieces). Race
  // courses are paced in acts: the signature mechanic gently (intro), mixed with `weights` as it
  // gets harder (build-up), combos and a risk/reward fork (twist), and at its hardest (finale).
  // Meadow
  { extend: true, file: 'warm-up', name: 'Warm-Up', theme: 'meadow', length: 6, firstSeed: 4000, needs: ['boost', 'spring'], weights: { springUp: 2, curve: 2, boostRamp: 1, slalom: 2, straight: 1, turn: 1 }, acts: { intro: ['springUp'], twist: ['boostSpring'], finale: ['boostRamp'] } },
  { extend: true, file: 'zig-zag', name: 'Zig-Zag', theme: 'meadow', length: 7, firstSeed: 4100, needs: ['wind'], weights: { zigzag: 3, windBridge: 2, curve: 2, bridge: 1, rampDown: 1, turn: 1 }, acts: { intro: ['windBridge'], twist: ['windCrumble'], finale: ['windBridge'] } },
  { extend: true, file: 'sweeper-alley', name: 'Sweeper Alley', theme: 'meadow', length: 7, firstSeed: 4200, needs: ['conveyor', 'crumble'], weights: { sweeper: 3, gauntlet: 2, conveyor: 2, crumbleBridge: 1, straight: 1, turn: 1 }, acts: { intro: ['sweeper'], twist: ['sweeperBelt'], finale: ['gauntlet'] } },
  { file: 'rolling-hills', name: 'Rolling Hills', theme: 'meadow', length: 15, firstSeed: 1000, needs: ['spring'], weights: { springUp: 3, curve: 3, stairs: 2, boostRamp: 1, split: 1 }, acts: { intro: ['springUp'], twist: ['boostSpring'], finale: ['springUp'] } },
  { file: 'switchback-ridge', name: 'Switchback Ridge', theme: 'meadow', length: 15, firstSeed: 1100, needs: ['mover'], weights: { lift: 3, hairpin: 3, curve: 2, split: 1, slalom: 1 }, acts: { intro: ['lift'], twist: ['liftWind'], finale: ['lift'] } },
  { file: 'summit-run', name: 'Summit Run', theme: 'meadow', length: 19, firstSeed: 3000, downhill: true, minDrop: 80, needs: ['boost'], weights: { boostJump: 3, steep: 2, spiral: 1, drop: 2, cascade: 2, hairpin: 2, curve: 1 }, acts: { intro: ['boostJump'], twist: ['crumbleJump'], finale: ['boostJump'] } },
  { maze: true, file: 'hedge-maze', name: 'Hedge Maze', theme: 'meadow', firstSeed: 2000, needs: ['spring'], needCount: 3, cols: 8, rows: 9, loops: 4, bumpers: 3, bridges: 2, holes: 3, springs: 6, palette: 'green', wallColor: '#2e5e27' },

  // Candy
  { file: 'candy-hop', name: 'Candy Hop', theme: 'candy', length: 12, firstSeed: 100, needs: ['spring'], weights: { springUp: 3, slalom: 2, turn: 2, zigzag: 1, straight: 1 }, acts: { intro: ['springUp'], twist: ['boostSpring'], finale: ['springUp'] } },
  { file: 'gumdrop-gauntlet', name: 'Gumdrop Gauntlet', theme: 'candy', length: 14, firstSeed: 200, needs: ['crumble'], weights: { crumbleBridge: 3, slalom: 2, sweeper: 2, turn: 2, sideMover: 1 }, acts: { intro: ['crumbleBridge'], twist: ['windCrumble', 'crumbleJump'], finale: ['crumbleBridge'] } },
  { file: 'sugar-rush', name: 'Sugar Rush', theme: 'candy', length: 14, firstSeed: 300, needs: ['boost', 'conveyor'], weights: { boostRamp: 2, boostJump: 2, conveyor: 2, turn: 2, sweeper: 1, zigzag: 1 }, acts: { intro: ['boostRamp', 'conveyor'], twist: ['sweeperBelt'], finale: ['boostJump'] } },
  { file: 'taffy-twist', name: 'Taffy Twist', theme: 'candy', length: 17, firstSeed: 1200, needs: ['conveyor'], weights: { conveyor: 2, treadmill: 3, curve: 3, gauntlet: 1, split: 1 }, acts: { intro: ['conveyor'], twist: ['bumperTreadmill', 'sweeperBelt'], finale: ['treadmill'] } },
  { file: 'lollipop-leap', name: 'Lollipop Leap', theme: 'candy', length: 17, firstSeed: 1300, needs: ['spring', 'mover'], weights: { springUp: 3, lift: 2, jump: 2, curve: 2, stairs: 1 }, acts: { intro: ['springUp', 'lift'], twist: ['boostSpring', 'liftWind'], finale: ['springUp'] } },
  { maze: true, file: 'candy-labyrinth', name: 'Candy Labyrinth', theme: 'candy', firstSeed: 2100, needs: ['conveyor'], needCount: 3, cols: 8, rows: 10, loops: 5, rooms: 2, bumpers: 3, bridges: 2, holes: 4, conveyors: 6, palette: 'blue', wallColor: '#ff6fb5' },
  { file: 'sugar-mountain', name: 'Sugar Mountain', theme: 'candy', length: 20, firstSeed: 3100, downhill: true, minDrop: 70, needs: ['spring', 'boost'], weights: { spiral: 2, steep: 2, cascade: 2, drop: 2, curve: 2, boostJump: 2, springUp: 2 }, acts: { intro: ['boostJump'], twist: ['boostSpring'], finale: ['boostJump'] } },

  // Ice
  { file: 'frosty-slide', name: 'Frosty Slide', theme: 'ice', length: 10, firstSeed: 400, maxSpeed: 12, needs: ['boost'], weights: { boostRamp: 3, rampDown: 3, turn: 2, straight: 1 }, acts: { intro: ['boostRamp'], twist: ['crumbleJump'], finale: ['boostRamp'] } },
  { file: 'glacier-run', name: 'Glacier Run', theme: 'ice', length: 12, firstSeed: 500, maxSpeed: 11, needs: ['mover', 'crumble'], weights: { lift: 3, crumbleBridge: 2, rampDown: 2, turn: 2, straight: 1 }, acts: { intro: ['lift'], twist: ['liftWind', 'windCrumble'], finale: ['crumbleBridge'] } },
  { file: 'polar-plunge', name: 'Polar Plunge', theme: 'ice', length: 14, firstSeed: 600, maxSpeed: 11, needs: ['crumble'], weights: { crumbleBridge: 3, drop: 2, rampDown: 2, turn: 2, slalom: 1 }, acts: { intro: ['crumbleBridge'], twist: ['crumbleJump'], finale: ['crumbleBridge'] } },
  { file: 'avalanche', name: 'Avalanche', theme: 'ice', length: 15, firstSeed: 1400, maxSpeed: 11, needs: ['wind'], weights: { windBridge: 3, hairpin: 3, stairs: 2, curve: 2, rampDown: 1 }, acts: { intro: ['windBridge'], twist: ['windCrumble'], finale: ['windBridge'] } },
  { file: 'crystal-caverns', name: 'Crystal Caverns', theme: 'ice', length: 17, firstSeed: 1500, maxSpeed: 11, needs: ['mover', 'wind'], weights: { lift: 2, updraft: 3, curve: 2, split: 1, stairs: 1 }, acts: { intro: ['updraft'], twist: ['liftWind'], finale: ['updraft'] } },
  { maze: true, file: 'ice-catacombs', name: 'Ice Catacombs', theme: 'ice', firstSeed: 2200, needs: ['crumble'], cols: 8, rows: 10, loops: 5, rooms: 2, bumpers: 3, bridges: 2, holes: 4, crumbles: 5, maxSpeed: 10, bridgeWidth: 5, palette: 'blue', wallColor: '#f4fbff' },
  { file: 'frozen-falls', name: 'Frozen Falls', theme: 'ice', length: 19, firstSeed: 3200, downhill: true, minDrop: 80, maxSpeed: 11, needs: ['wind'], weights: { cascade: 3, drop: 2, windBridge: 2, steep: 2, hairpin: 2, curve: 1 }, acts: { intro: ['windBridge'], twist: ['windCrumble'], finale: ['windBridge'] } },

  // Night
  { file: 'moonlit-path', name: 'Moonlit Path', theme: 'night', length: 12, firstSeed: 700, bridgeWidth: 4.5, needs: ['lowgrav'], weights: { moonJump: 3, bridge: 2, turn: 2, straight: 1 }, acts: { intro: ['moonJump'], twist: ['crumbleJump'], finale: ['moonJump'] } },
  { file: 'starlight-circuit', name: 'Starlight Circuit', theme: 'night', length: 14, firstSeed: 800, bridgeWidth: 4, needs: ['mover', 'boost'], weights: { lift: 2, boostRamp: 2, bridge: 2, turn: 2, mover: 1 }, acts: { intro: ['lift'], twist: ['boostSpring', 'liftWind'], finale: ['boostRamp'] } },
  { file: 'midnight-maze', name: 'Midnight Maze', theme: 'night', length: 15, firstSeed: 900, bridgeWidth: 4, needs: ['wind', 'crumble'], weights: { windBridge: 3, crumbleBridge: 2, bridge: 2, zigzag: 1, turn: 2 }, acts: { intro: ['windBridge'], twist: ['windCrumble'], finale: ['crumbleBridge'] } },
  { file: 'comet-jump', name: 'Comet Jump', theme: 'night', length: 17, firstSeed: 1600, bridgeWidth: 4, needs: ['lowgrav', 'boost'], weights: { moonJump: 2, boostJump: 2, curve: 2, bridge: 1, gauntlet: 1 }, acts: { intro: ['moonJump'], twist: ['crumbleJump'], finale: ['moonJump'] } },
  { file: 'nebula-spiral', name: 'Nebula Spiral', theme: 'night', length: 19, firstSeed: 1700, bridgeWidth: 4, needs: ['wind'], weights: { updraft: 3, spiral: 2, hairpin: 2, curve: 2, bridge: 1 }, acts: { intro: ['updraft'], twist: ['liftWind'], finale: ['updraft'] } },
  { maze: true, file: 'night-vault', name: 'Night Vault', theme: 'night', firstSeed: 2300, needs: ['spring'], needCount: 2, cols: 9, rows: 11, loops: 4, rooms: 2, bumpers: 4, bridges: 3, holes: 5, springs: 5, springPower: 11, springPush: 5, lowGravity: 0.5, palette: 'purple', wallColor: '#ffd166' },
  { file: 'starfall-peak', name: 'Starfall Peak', theme: 'night', length: 20, firstSeed: 3300, downhill: true, minDrop: 90, bridgeWidth: 4.5, needs: ['lowgrav'], weights: { moonJump: 2, spiral: 2, drop: 2, steep: 2, cascade: 2, hairpin: 1 }, acts: { intro: ['moonJump'], twist: ['crumbleJump'], finale: ['moonJump'] } },
];
