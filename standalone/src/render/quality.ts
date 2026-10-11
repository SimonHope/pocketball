// Graphics quality tiers and "Auto": start from a sensible tier for the device, then step down
// if the frame rate drops (and back up once, if there's plenty of headroom).

export type QualityTier = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityTier;

export interface TierSettings { pixelRatio: number; shadows: boolean; shadowMap: number; trails: boolean; motes: boolean; particles: number }

export const TIERS: Record<QualityTier, TierSettings> = {
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, trails: true, motes: true, particles: 1 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, trails: true, motes: true, particles: 1 },
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, trails: false, motes: false, particles: 0.5 },
};

const ORDER: QualityTier[] = ['low', 'medium', 'high'];
const SLOW_MS = 25;     // average frame slower than this (< 40 fps): step down
const FAST_MS = 11;     // this fast (> 90 fps) for a long while: step up (once)
const WINDOW = 90;      // frames per average
const WARMUP = 120;     // ignore the first frames (shader compiles, loading)

export class AutoQuality {
  private samples: number[] = [];
  private seen = 0;
  private fastFrames = 0;
  private steppedUp = false;

  constructor(public tier: QualityTier, private onChange: (tier: QualityTier) => void) {}

  /** Starting tier: phones and tablets start lower. */
  static initialTier(coarsePointer: boolean): QualityTier {
    return coarsePointer ? 'medium' : 'high';
  }

  /** Feed one frame's duration (ms). */
  sample(ms: number) {
    if (ms > 100) return; // tab was hidden or a hiccup: not representative
    if (++this.seen < WARMUP) return;
    this.samples.push(ms);
    if (this.samples.length < WINDOW) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    const i = ORDER.indexOf(this.tier);
    if (avg > SLOW_MS && i > 0) {
      this.set(ORDER[i - 1]);
    } else if (avg < FAST_MS && i < ORDER.length - 1 && !this.steppedUp) {
      this.fastFrames += WINDOW;
      if (this.fastFrames >= WINDOW * 8) {
        this.steppedUp = true;
        this.set(ORDER[i + 1]);
      }
    } else {
      this.fastFrames = 0;
    }
  }

  private set(tier: QualityTier) {
    this.tier = tier;
    this.seen = 0; // settle again after a change
    this.onChange(tier);
  }
}
