import type { Palette } from './schema';
import { SIM } from '../config';

// World themes: look (sky, fog, light, floor colors) and one gameplay knob, floor grip.
// Placeholder art until the final theme art arrives; levels only store the theme's name.

export const THEME_NAMES = ['meadow', 'candy', 'ice', 'night'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** Procedural surfaces (drawn by src/render/surfaces.ts): what floors, rails and props are made of. */
export type SurfaceKind =
  | 'planks' | 'painted' | 'turf' | 'soil' | 'stone' | 'stick' | 'cracker' | 'rubber' | 'hedge'
  // The kitchen counter (candy):
  | 'counter' | 'cookie' | 'wafer' | 'frosting' | 'chocolate' | 'candycane'
  // The freezer (ice):
  | 'frost' | 'icecube' | 'peas' | 'breaded' | 'rime' | 'tray' | 'thinice'
  // The rooftop at night:
  | 'slate' | 'ridge' | 'moss' | 'felt' | 'brick' | 'lights' | 'zinc' | 'sticker';
export interface Surface { kind: SurfaceKind; base: string; accent: string }

/**
 * A theme's art direction: the hamster's world, built from things found around a house (this
 * theme's place: a garden, a kitchen counter, ...). Themes without one keep the plain look.
 */
export interface Look {
  floors: Record<Palette, Surface>;
  sides: Record<Palette, Surface>;
  /** Rails and walls the generator makes (`#f4f4f4`), and the safety walls (guard.ts). */
  rail: Surface;
  guard: Surface;
  /** Sweeper pivots. */
  post: string;
  /** Walls in other colours (maze walls): this surface, tinted with the wall's own colour. */
  wall: Surface['kind'];
  /** Bumpers: a cap with spots on a stem (toadstools in the garden); `glow`: the cap shines (a night-light). */
  bumper: {
    cap: string; spots: string; stem: string; glow?: string;
    /** Caps in several colours, one per bumper in turn (and their glow): night's glowing mushrooms. */
    colours?: { cap: string; glow: string }[];
  };
  /** Sweeper arms: a pencil. */
  pencil: { paint: string; wood: string; eraser: string };
  crumble: Surface;
  belt: Surface;
  /** World-locked sky: gradient, and a soft glow where the sun is (`sunHeight`: its elevation, degrees). */
  sky: { top: string; horizon: string; bottom: string; sun: string; sunHeight: number };
  /** Far below every course, fading into the haze. */
  ground: Surface;
  /** Giant soft shapes around the course (pre-blurred cut-outs): which set. */
  backdrop: 'livingroom' | 'kitchen' | 'freezer' | 'city';
  /** Live aurora curtains around the course: hem, middle and top colours. */
  aurora?: [string, string, string];
  /** Specks drifting in the light (off on the low graphics setting); `fall`: they drift down (frost flakes); `blow`: and are blown sideways this fast (a blizzard). */
  motes: { color: string; count: number; fall?: boolean; blow?: number };
  /** Puffs kicked up on landings and springs. */
  dust: string;
  /** Bumps throw these instead of sparks (sprinkles off a cupcake). */
  sprinkles?: string[];
  /** What crumbling floors break into (the crumbs' colour). */
  crumbs?: string;
  /** Ice only: shavings kicked up when you skid, and your breath in the cold. */
  cold?: boolean;
  /** Glints of light where you land (ice catching the light, stardust). */
  glints?: string;
  /** Stardust shed behind you when you're fast or flying. */
  trail?: string;
  /** Big landings and springs ring a soft chime. */
  chime?: boolean;
}

export interface Theme {
  label: string;
  sky: [string, string, string];      // gradient top → horizon → bottom
  fog: string;
  sun: { color: string; intensity: number };
  ambient: { sky: string; ground: string; intensity: number };
  clouds: string;
  /** Valley floor far below downhill courses. */
  ground: string;
  /** Floor colors per palette: [checker A, checker B, sides]. */
  palettes: Record<Palette, [string, string, string]>;
  /** Multiplies floor friction: ice is slippery. */
  grip: number;
  // A world's one physics rule (DESIGN.md → Worlds): ice has `grip`, the others one of these.
  /** Multiplies gravity: at night everything floats a little. */
  gravity?: number;
  /** Floors' restitution instead of `SIM.restitution`: candy floors are springy, so landings hop. */
  bounce?: number;
  /** Wind swells and eases on the clock, like a fan turning: its strength goes from `low`× to 1× and back every `period` s. */
  gust?: { period: number; low: number };
  /** One line under the world's name on the level select: what this part of the escape feels like. */
  tagline: string;
  look?: Look;
}

export const THEMES: Record<ThemeName, Theme> = {
  meadow: {
    label: 'Meadow',
    sky: ['#3d7fd9', '#9fd0ff', '#e6f4ff'],
    fog: '#c4e3ff',
    sun: { color: '#ffe3b8', intensity: 2.6 }, // late-afternoon garden light
    ambient: { sky: '#dcecff', ground: '#7a8f5a', intensity: 1.15 },
    clouds: '#ffffff',
    ground: '#6fb85e',
    palettes: {
      blue: ['#7fb4ff', '#5b93e6', '#3a5a8c'],
      green: ['#8fe07a', '#6cc25a', '#3f7a35'],
      orange: ['#ffc07a', '#f09c4a', '#8c5a2a'],
      purple: ['#c7a0ff', '#a47ae6', '#5c3f8c'],
      grey: ['#d8dde6', '#b8bfcc', '#6b7280'],
    },
    grip: 1,
    gust: { period: 4, low: 0.55 },
    tagline: 'Free at last… aren\'t we?',
    // The living room, seen as a meadow from very close up: a green shag rug for a lawn,
    // floorboards, toy boards and popsicle sticks, with the furniture and the desk fan behind.
    look: {
      floors: {
        grey: { kind: 'planks', base: '#d2c2a4', accent: '#a8957a' }, // whitewashed floorboards
        green: { kind: 'turf', base: '#6fb34f', accent: '#9bd166' },
        orange: { kind: 'planks', base: '#d9a066', accent: '#a8703c' },
        blue: { kind: 'painted', base: '#5a8fd6', accent: '#c9925a' },
        purple: { kind: 'painted', base: '#b07ad6', accent: '#c9925a' },
      },
      sides: {
        grey: { kind: 'planks', base: '#b3a284', accent: '#8a7a60' },
        green: { kind: 'soil', base: '#7a5236', accent: '#6fb34f' },
        orange: { kind: 'planks', base: '#b98450', accent: '#8a5a2e' },
        blue: { kind: 'painted', base: '#4373b3', accent: '#a8703c' },
        purple: { kind: 'painted', base: '#8f5cb8', accent: '#a8703c' },
      },
      rail: { kind: 'stick', base: '#e8c998', accent: '#c79d63' },
      guard: { kind: 'stick', base: '#f2e6cf', accent: '#d9c4a0' },
      post: '#7a4a2a',
      wall: 'hedge',
      bumper: { cap: '#e8483c', spots: '#fff6e8', stem: '#f3e7d0' },
      pencil: { paint: '#ffc93c', wood: '#e8c08a', eraser: '#ff8fa3' },
      crumble: { kind: 'cracker', base: '#e0b06a', accent: '#a8692e' },
      belt: { kind: 'rubber', base: '#3a3b40', accent: '#5a5c63' },
      sky: { top: '#6fa8e8', horizon: '#ffe9c4', bottom: '#f6d7a8', sun: '#fff1c9', sunHeight: 30 },
      ground: { kind: 'turf', base: '#5f9e45', accent: '#86c25a' },
      backdrop: 'livingroom',
      motes: { color: '#fff2c8', count: 70 },
      dust: '#c9a77c',
    },
  },
  candy: {
    label: 'Candy',
    sky: ['#ff8fc7', '#ffc6e4', '#fff0f8'],
    fog: '#ffd6ec',
    sun: { color: '#fff1dc', intensity: 2.3 }, // morning light through the kitchen window
    ambient: { sky: '#fff4e8', ground: '#b98a6a', intensity: 1.25 },
    clouds: '#fff3fa',
    ground: '#f5a8d0',
    palettes: {
      blue: ['#9fe8ff', '#6fd3f2', '#3a8fb0'],
      green: ['#b8f5a0', '#8ee07a', '#4f9a40'],
      orange: ['#ffd29a', '#ffb05c', '#b86b2a'],
      purple: ['#e6b3ff', '#cf8cff', '#7f45b0'],
      grey: ['#fff4fa', '#ffd9ec', '#c07ea0'],
    },
    grip: 1,
    bounce: 0.5,
    tagline: 'Everything is sweet',
    // The kitchen counter: worktop, biscuits, wafers, iced cake tops and chocolate, with candy
    // canes for rails and jars and kettles towering behind.
    look: {
      floors: {
        grey: { kind: 'counter', base: '#f1e9dc', accent: '#b8a48a' },
        green: { kind: 'frosting', base: '#a8e6c8', accent: '#ff5d8f' },
        orange: { kind: 'cookie', base: '#e9b872', accent: '#5a3420' },
        blue: { kind: 'wafer', base: '#c3c4f2', accent: '#8f8fd0' }, // a blueberry wafer
        purple: { kind: 'chocolate', base: '#7a4a32', accent: '#5a3322' },
      },
      sides: {
        grey: { kind: 'counter', base: '#d9cdb9', accent: '#9a876c' },
        green: { kind: 'wafer', base: '#e9cf9a', accent: '#c9a56a' },
        orange: { kind: 'cookie', base: '#d6a05c', accent: '#5a3420' },
        blue: { kind: 'wafer', base: '#e9cf9a', accent: '#c9a56a' },
        purple: { kind: 'chocolate', base: '#5f3826', accent: '#45281a' },
      },
      rail: { kind: 'candycane', base: '#fff8f2', accent: '#e8414f' },
      guard: { kind: 'candycane', base: '#fff8f2', accent: '#f8dbe5' }, // softer than the rails, so those stand out
      post: '#5a3420',
      wall: 'frosting',
      bumper: { cap: '#ff7fb0', spots: '#fff6e8', stem: '#f6e7cf' }, // cupcakes: iced tops on paper cases
      pencil: { paint: '#6b3a24', wood: '#e9c58a', eraser: '#f6e7cf' }, // a chocolate-dipped biscuit stick
      crumble: { kind: 'cracker', base: '#e6bb72', accent: '#a8692e' },
      belt: { kind: 'rubber', base: '#3b1a24', accent: '#5c2a38' }, // liquorice
      sky: { top: '#f0cfae', horizon: '#fff2dc', bottom: '#e8c49c', sun: '#fff8e4', sunHeight: 38 },
      ground: { kind: 'counter', base: '#dcb48e', accent: '#b8906a' }, // the kitchen floor, far below
      backdrop: 'kitchen',
      motes: { color: '#fffaf0', count: 60 }, // sugar in the air
      dust: '#f6ead6', // a puff of flour
      sprinkles: ['#ff5d8f', '#ffd23f', '#5ec8ff', '#8ee07a', '#ffffff'],
    },
  },
  ice: {
    label: 'Ice',
    sky: ['#7fb8e6', '#d6ecff', '#ffffff'],
    fog: '#e8f4ff',
    sun: { color: '#f2f9ff', intensity: 2.0 }, // the freezer lamp: cold, and not so bright that frost turns white
    ambient: { sky: '#d6ebfa', ground: '#6f88a3', intensity: 1.1 },
    clouds: '#ffffff',
    ground: '#e9f4ff',
    palettes: {
      blue: ['#dff3ff', '#b9e1fa', '#6f9fc2'],
      green: ['#e3fff6', '#bdf0df', '#6aa892'],
      orange: ['#fff4e6', '#ffe0bf', '#b89572'],
      purple: ['#eee8ff', '#d5cbff', '#8a7fc2'],
      grey: ['#ffffff', '#e4edf5', '#8fa3b8'],
    },
    grip: 0.3,
    tagline: 'Keep rolling. Don\'t stop.',
    // The freezer: frosted shelves, ice cubes, bags of peas and fish fingers, with ice-tray
    // plastic for rails and tubs of ice cream towering behind.
    look: {
      floors: {
        grey: { kind: 'frost', base: '#bcd4e6', accent: '#7fa3c0' },
        green: { kind: 'peas', base: '#7cc45a', accent: '#e8f4ff' },
        orange: { kind: 'breaded', base: '#e9a44c', accent: '#b8702a' }, // fish fingers
        blue: { kind: 'icecube', base: '#8fc6ea', accent: '#ffffff' },
        purple: { kind: 'icecube', base: '#b39ae6', accent: '#ffffff' }, // a grape ice cube
      },
      sides: {
        grey: { kind: 'rime', base: '#9fbad0', accent: '#f4fbff' },
        green: { kind: 'rime', base: '#5f9e48', accent: '#eef7ff' },
        orange: { kind: 'breaded', base: '#d48f3c', accent: '#9c5c22' },
        blue: { kind: 'icecube', base: '#9fcfee', accent: '#e8f7ff' },
        purple: { kind: 'icecube', base: '#b29ce0', accent: '#efe8ff' },
      },
      rail: { kind: 'tray', base: '#7fc8e8', accent: '#5aa8cf' }, // ice-cube-tray plastic
      guard: { kind: 'tray', base: '#b9d9ea', accent: '#94bfd6' }, // paler, so the rails stand out
      post: '#9fb8cc',
      wall: 'icecube',
      bumper: { cap: '#ffb3c7', spots: '#6b3a24', stem: '#e2b072' }, // strawberry scoops on wafer cones
      pencil: { paint: '#ff6b5a', wood: '#e9cf9a', eraser: '#fff3d6' }, // an ice lolly on its stick
      crumble: { kind: 'thinice', base: '#c4e2f4', accent: '#6f9fc2' },
      belt: { kind: 'rubber', base: '#2f3d4c', accent: '#4a5d70' }, // a freezer door seal
      sky: { top: '#7fb0d8', horizon: '#d4e6f2', bottom: '#a9c6da', sun: '#f4fbff', sunHeight: 55 }, // the freezer lamp
      ground: { kind: 'frost', base: '#b3cde0', accent: '#86a8c2' },
      backdrop: 'freezer',
      motes: { color: '#ffffff', count: 160, fall: true, blow: 3 }, // a blizzard of frost flakes
      dust: '#f4fbff', // a puff of snow
      sprinkles: ['#ffb3c7', '#fff3d6', '#6b3a24', '#ffffff'], // ice cream off a scoop
      crumbs: '#e3f3fc',
      cold: true,
      glints: '#ffffff',
    },
  },
  night: {
    label: 'Night',
    sky: ['#0b1030', '#26225a', '#4b3b7a'],
    fog: '#2a2550',
    sun: { color: '#c8d6ff', intensity: 1.7 }, // moonlight: bright enough that the slates still read
    ambient: { sky: '#7a74d0', ground: '#1c2448', intensity: 1.15 },
    clouds: '#3b3566',
    ground: '#1b2140',
    palettes: {
      blue: ['#3b5bdb', '#2f4ab8', '#18255c'],
      green: ['#2fb380', '#23916a', '#114a36'],
      orange: ['#f08c3a', '#c96f2a', '#5c3314'],
      purple: ['#9b5de5', '#7d45c4', '#3b1f63'],
      grey: ['#5c6280', '#474c66', '#242736'],
    },
    grip: 1,
    gravity: 0.85,
    tagline: 'Quiet now',
    // A heavenly night above the city: out of the window onto the roofs (slates, ridge tiles and a
    // painted sill strung with fairy lights), glowing mushrooms, the city far below, the Milky Way
    // and a live aurora. Maybe it's real; maybe it's a dream.
    look: {
      floors: {
        grey: { kind: 'slate', base: '#5d6684', accent: '#a9b6e0' },
        green: { kind: 'moss', base: '#566480', accent: '#6f9a58' },
        orange: { kind: 'ridge', base: '#b8613e', accent: '#7a3a24' }, // the ridge of a roof
        blue: { kind: 'painted', base: '#4f6fb8', accent: '#3a2a4a' }, // a painted windowsill
        purple: { kind: 'felt', base: '#5b4a86', accent: '#c9b8ff' }, // roofing felt with a glittery grit
      },
      sides: {
        grey: { kind: 'brick', base: '#7a4a48', accent: '#3b2a3a' },
        green: { kind: 'brick', base: '#6e4a4a', accent: '#3b2a3a' },
        orange: { kind: 'ridge', base: '#9c4f32', accent: '#6a3020' },
        blue: { kind: 'painted', base: '#3d5a9e', accent: '#2e2240' },
        purple: { kind: 'brick', base: '#6a4a6a', accent: '#35263f' },
      },
      rail: { kind: 'lights', base: '#ffcf6b', accent: '#2a2638' }, // fairy lights: warm bulbs on a dark cable
      guard: { kind: 'zinc', base: '#5a6276', accent: '#3e4558' }, // guttering, quiet so the lights stand out
      post: '#a85a3a', // chimney pots
      wall: 'brick',
      // Glowing mushrooms, in the soft colours of the aurora and the city lights.
      bumper: {
        cap: '#7ff0c8', spots: '#f2fff8', stem: '#e9e4f2', glow: '#3fffb0',
        colours: [
          { cap: '#7ff0c8', glow: '#3fffb0' }, // aurora green
          { cap: '#9fb8ff', glow: '#6f8cff' }, // moonlight blue
          { cap: '#ff9fd8', glow: '#ff6fc0' }, // pink
          { cap: '#ffd36b', glow: '#ffb347' }, // lamplight
        ],
      },
      pencil: { paint: '#3b4256', wood: '#c9ccd3', eraser: '#ffd36b' }, // a TV-aerial rod
      crumble: { kind: 'sticker', base: '#2c2f52', accent: '#c8ff8a' }, // glow-in-the-dark star stickers
      belt: { kind: 'rubber', base: '#1e2030', accent: '#34374c' },
      sky: { top: '#060a24', horizon: '#3a2f6e', bottom: '#14183a', sun: '#e8eeff', sunHeight: 32 }, // the moon
      ground: { kind: 'slate', base: '#1a1d36', accent: '#3a3f66' },
      backdrop: 'city',
      aurora: ['#6dffa6', '#1fff6e', '#0b9e6a'], // Lifestream green: a bright glowing hem, deepening to teal
      motes: { color: '#ffe9a8', count: 60 }, // star specks drifting up
      dust: '#4a5280',
      crumbs: '#c8ff8a',
      glints: '#ffd96b',
      trail: '#fff1b8',
      chime: true,
    },
  },
};

/** Gravity in this world (its rule may lighten it). */
export const gravityOf = (theme: ThemeName) => SIM.gravity * (THEMES[theme].gravity ?? 1);

/** How strong this world's wind is at `time` (1 = full): a pure function of the clock, so every player, replay and bot agrees. */
export function gustAt(theme: ThemeName, time: number): number {
  const g = THEMES[theme].gust;
  return g ? g.low + (1 - g.low) * (0.5 - 0.5 * Math.cos((2 * Math.PI * time) / g.period)) : 1;
}
