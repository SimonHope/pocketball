import type { Palette } from './schema';

// World themes: look (sky, fog, light, floor colors) and one gameplay knob, floor grip.
// Placeholder art until the final theme art arrives; levels only store the theme's name.

export const THEME_NAMES = ['meadow', 'candy', 'ice', 'night'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

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
}

export const THEMES: Record<ThemeName, Theme> = {
  meadow: {
    label: 'Meadow',
    sky: ['#3d7fd9', '#9fd0ff', '#e6f4ff'],
    fog: '#c4e3ff',
    sun: { color: '#fff4e0', intensity: 2.2 },
    ambient: { sky: '#ffffff', ground: '#6a7a99', intensity: 1.2 },
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
