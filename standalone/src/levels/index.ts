import { parseLevel, type LevelData } from './schema';
import warmUp from './warm-up.json';
import zigZag from './zig-zag.json';
import sweeperAlley from './sweeper-alley.json';
import candyHop from './candy-hop.json';
import gumdropGauntlet from './gumdrop-gauntlet.json';
import sugarRush from './sugar-rush.json';
import frostySlide from './frosty-slide.json';
import glacierRun from './glacier-run.json';
import polarPlunge from './polar-plunge.json';
import moonlitPath from './moonlit-path.json';
import starlightCircuit from './starlight-circuit.json';
import midnightMaze from './midnight-maze.json';
import rollingHills from './rolling-hills.json';
import switchbackRidge from './switchback-ridge.json';
import hedgeMaze from './hedge-maze.json';
import taffyTwist from './taffy-twist.json';
import lollipopLeap from './lollipop-leap.json';
import candyLabyrinth from './candy-labyrinth.json';
import avalanche from './avalanche.json';
import crystalCaverns from './crystal-caverns.json';
import iceCatacombs from './ice-catacombs.json';
import cometJump from './comet-jump.json';
import nebulaSpiral from './nebula-spiral.json';
import nightVault from './night-vault.json';
import summitRun from './summit-run.json';
import sugarMountain from './sugar-mountain.json';
import frozenFalls from './frozen-falls.json';
import starfallPeak from './starfall-peak.json';
import candyBowl from './candy-bowl.json';
import nightSummit from './night-summit.json';

// Every race course, in order: 7 per theme (the level select groups them by theme). Add new
// JSON files here. Most were made with the level generator (npm run gen-levels) as starting
// layouts for designers to refine in the editor. Each theme ends with a top-down maze and a
// downhill course (a summit start, finishing 50+ units below).
export const LEVELS: LevelData[] = [
  warmUp, zigZag, sweeperAlley, rollingHills, switchbackRidge, hedgeMaze, summitRun,
  candyHop, gumdropGauntlet, sugarRush, taffyTwist, lollipopLeap, candyLabyrinth, sugarMountain,
  frostySlide, glacierRun, polarPlunge, avalanche, crystalCaverns, iceCatacombs, frozenFalls,
  moonlitPath, starlightCircuit, midnightMaze, cometJump, nebulaSpiral, nightVault, starfallPeak,
].map((json) => parseLevel(json));

/** Arenas for the party modes (King of the Hill, Bumper Arena). */
export const ARENAS: LevelData[] = [candyBowl, nightSummit].map((json) => parseLevel(json));

/** Stable id for a level (leaderboards, saves): its name as a slug, e.g. 'warm-up'. */
export function levelId(level: LevelData): string {
  return level.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** How far the goal is below the start (downhill courses drop 50+). */
export function courseDrop(level: LevelData): number {
  const goal = level.pieces.find((p) => p.type === 'goal');
  return goal ? level.start.position[1] - 1 - goal.position[1] : 0;
}

/** The special mechanics a course uses, in a fixed order, for the level select. */
export function courseMechanics(level: LevelData): string[] {
  const has = (test: (p: LevelData['pieces'][number]) => boolean) => level.pieces.some(test);
  return [
    has((p) => p.type === 'boost') && 'Boost pads',
    has((p) => p.type === 'spring') && 'Springs',
    has((p) => p.type === 'mover' && p.from[1] !== p.to[1]) && 'Lifts',
    has((p) => p.type === 'conveyor') && 'Belts',
    has((p) => p.type === 'crumble') && 'Crumbling floor',
    has((p) => p.type === 'wind' && p.dir[1] > 0.5) && 'Updrafts',
    has((p) => p.type === 'wind' && p.dir[1] <= 0.5) && 'Wind',
    has((p) => p.type === 'lowgrav') && 'Low gravity',
  ].filter((m): m is string => !!m);
}

export function findLevel(id: string): LevelData | undefined {
  return [...LEVELS, ...ARENAS].find((l) => levelId(l) === id);
}
