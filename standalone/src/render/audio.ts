// Tiny synthesized sound effects so there are no asset files to manage.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 1;

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
}

/** Browsers only allow audio after a user gesture; call this from input handlers. */
export function unlockAudio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return; }
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

interface Tone {
  freq?: number;
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ freq = 440, to = freq, dur = 0.15, type = 'sine', gain = 0.2, delay = 0 }: Tone) {
  if (!ctx || !master || volume === 0) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  bump: () => tone({ freq: 220, to: 660, dur: 0.12, type: 'square', gain: 0.12 }),
  thud: (strength: number) => tone({ freq: 90, to: 50, dur: 0.1, type: 'triangle', gain: Math.min(0.25, strength * 0.02) }),
  checkpoint: () => {
    tone({ freq: 660, dur: 0.12, gain: 0.15 });
    tone({ freq: 880, dur: 0.18, gain: 0.15, delay: 0.1 });
  },
  fall: () => tone({ freq: 600, to: 80, dur: 0.6, type: 'sawtooth', gain: 0.1 }),
  beep: (high: boolean) => tone({ freq: high ? 880 : 440, dur: high ? 0.4 : 0.15, type: 'square', gain: 0.1 }),
  boost: () => tone({ freq: 300, to: 1400, dur: 0.25, type: 'sawtooth', gain: 0.07 }),
  spring: () => {
    tone({ freq: 180, to: 720, dur: 0.18, type: 'triangle', gain: 0.18 });
    tone({ freq: 720, to: 540, dur: 0.12, type: 'triangle', gain: 0.08, delay: 0.16 });
  },
  crumble: () => tone({ freq: 140, to: 60, dur: 0.25, type: 'square', gain: 0.06 }),
  click: () => tone({ freq: 1200, to: 900, dur: 0.06, type: 'square', gain: 0.1 }), // a switch star's button
  tick: () => tone({ freq: 1500, dur: 0.04, type: 'square', gain: 0.07 }),
  star: () => [988, 1319, 1976].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.13, delay: i * 0.06 })),
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.25, gain: 0.15, delay: i * 0.12 })),
};
