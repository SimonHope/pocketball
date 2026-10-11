import type { CameraMode } from './camera';
import type { QualitySetting } from './quality';
import { load, save } from './storage';

// Player settings, persisted in localStorage.

export interface Settings {
  volume: number;            // 0..1
  cameraMode: CameraMode;
  cameraSensitivity: number; // multiplier for Q/E, drag, and right stick
  quality: QualitySetting;   // 'auto' adapts to the device (see quality.ts)
  showHelp: boolean;
  /** Anonymous stats: asked once ('unset' shows the notice). */
  analytics: 'unset' | 'yes' | 'no';
  /** Motion effects: 'reduced' turns off camera shake, FOV kicks and hit-stop, and halves particles. */
  effects: 'full' | 'reduced';
}

const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const KEY = 'hamball.settings';
const DEFAULTS: Settings = {
  volume: 0.8, cameraMode: 'dynamic', cameraSensitivity: 1, quality: 'auto', showHelp: true, analytics: 'unset',
  effects: prefersReducedMotion ? 'reduced' : 'full',
};

export class SettingsStore {
  private value: Settings;
  private listeners: ((s: Settings) => void)[] = [];

  constructor() {
    let stored: Partial<Settings> = {};
    try { stored = JSON.parse(load(KEY) ?? '{}') as Partial<Settings>; } catch { /* corrupt: use defaults */ }
    this.value = { ...DEFAULTS, ...stored };
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch };
    save(KEY, JSON.stringify(this.value));
    for (const fn of this.listeners) fn(this.value);
  }

  /** Calls `fn` now and on every change. */
  subscribe(fn: (s: Settings) => void) {
    this.listeners.push(fn);
    fn(this.value);
  }
}
