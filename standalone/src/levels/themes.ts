import type { Palette } from './schema';

// World themes: look (sky, fog, light, floor colors) and one gameplay knob, floor grip.
// Placeholder art until the final theme art arrives; levels only store the theme's name.

export const THEME_NAMES = ['meadow', 'candy', 'ice', 'night'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** Procedural surfaces (drawn by src/render/surfaces.ts): what floors, rails and props are made of. */
export type SurfaceKind = 'planks' | 'painted' | 'turf' | 'soil' | 'stone' | 'stick' | 'cracker' | 'rubber' | 'hedge';
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
  /** Bumpers: a cap with spots on a stem (toadstools in the garden). */
  bumper: { cap: string; spots: string; stem: string };
  /** Sweeper arms: a pencil. */
  pencil: { paint: string; wood: string; eraser: string };
  crumble: Surface;
  belt: Surface;
  /** World-locked sky: gradient, and a soft glow where the sun is (`sunHeight`: its elevation, degrees). */
  sky: { top: string; horizon: string; bottom: string; sun: string; sunHeight: number };
  /** Far below every course, fading into the haze. */
  ground: Surface;
  /** Giant soft shapes around the course (pre-blurred cut-outs): which set. */
  backdrop: 'garden';
  /** Specks drifting in the light (off on the low graphics setting). */
  motes: { color: string; count: number };
  /** Puffs kicked up on landings and springs. */
  dust: string;
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
    // The garden: stepping stones, lawn, deck boards and toy blocks left out on the grass.
    look: {
      floors: {
        grey: { kind: 'stone', base: '#cfc6b6', accent: '#9c917e' },
        green: { kind: 'turf', base: '#6fb34f', accent: '#9bd166' },
        orange: { kind: 'planks', base: '#d9a066', accent: '#a8703c' },
        blue: { kind: 'painted', base: '#5a8fd6', accent: '#c9925a' },
        purple: { kind: 'painted', base: '#b07ad6', accent: '#c9925a' },
      },
      sides: {
        grey: { kind: 'stone', base: '#a89e8c', accent: '#7f7564' },
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
      backdrop: 'garden',
      motes: { color: '#fff2c8', count: 70 },
      dust: '#c9a77c',
    },
  },
  candy: {
    label: 'Candy',
    sky: ['#ff8fc7', '#ffc6e4', '#fff0f8'],
    fog: '#ffd6ec',
    sun: { color: '#fff0f6', intensity: 2.0 },
    ambient: { sky: '#ffffff', ground: '#b57aa0', intensity: 1.3 },
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
  },
  ice: {
    label: 'Ice',
    sky: ['#7fb8e6', '#d6ecff', '#ffffff'],
    fog: '#e8f4ff',
    sun: { color: '#ffffff', intensity: 2.4 },
    ambient: { sky: '#e8f6ff', ground: '#7d95b0', intensity: 1.3 },
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
  },
  night: {
    label: 'Night',
    sky: ['#0b1030', '#26225a', '#4b3b7a'],
    fog: '#2a2550',
    sun: { color: '#b8c8ff', intensity: 1.2 },
    ambient: { sky: '#6070c0', ground: '#201830', intensity: 1.0 },
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
  },
};
