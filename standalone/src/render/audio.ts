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

// ---------- Noise: rolling, wind, landings ----------

let white: AudioBuffer | null = null;
let brown: AudioBuffer | null = null;

/** Two seconds of noise: white (wind, puffs) or brown (a low rumble, for rolling). */
function noiseBuffer(kind: 'white' | 'brown'): AudioBuffer | null {
  if (!ctx) return null;
  if (kind === 'white' && white) return white;
  if (kind === 'brown' && brown) return brown;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else {
      last = (last + 0.02 * w) / 1.02; // brown noise: integrated white noise
      d[i] = last * 3.5;
    }
  }
  if (kind === 'white') white = buf;
  else brown = buf;
  return buf;
}

/** A short filtered noise burst (a puff of sand, a thump's texture). */
function puff(dur: number, freq: number, gain: number, q = 0.8) {
  if (!ctx || !master || volume === 0) return;
  const buf = noiseBuffer('white');
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.02);
}

interface Loop { gain: GainNode; filter: BiquadFilterNode }
let roll: Loop | null = null;
let wind: Loop | null = null;
let scrape: Loop | null = null;

function loop(kind: 'white' | 'brown', type: BiquadFilterType): Loop | null {
  const buf = noiseBuffer(kind);
  if (!ctx || !master || !buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  return { gain, filter };
}

/**
 * The continuous sound of moving, set every frame: a rumble while rolling (brighter and
 * quieter on slippery ice), wind when flying fast, and a hiss of scraped ice while you skid
 * (`slip`, 0..1). `active` false fades them out (menus, pause, the finish).
 */
export function motion(speed: number, grounded: boolean, slippery: boolean, active: boolean, slip = 0) {
  if (!ctx || !master) return;
  roll ??= loop('brown', 'lowpass');
  wind ??= loop('white', 'bandpass');
  scrape ??= loop('white', 'highpass');
  if (!roll || !wind || !scrape) return;
  const t = ctx.currentTime;
  const rolling = active && grounded ? Math.min(1, speed / 20) * (slippery ? 0.05 : 0.11) : 0;
  roll.gain.gain.setTargetAtTime(rolling, t, 0.06);
  roll.filter.frequency.setTargetAtTime(160 + speed * 45 + (slippery ? 900 : 0), t, 0.06);
  const air = active ? Math.min(1, Math.max(0, speed - (grounded ? 14 : 5)) / 20) * (grounded ? 0.025 : 0.07) : 0;
  wind.gain.gain.setTargetAtTime(air, t, 0.1);
  wind.filter.frequency.setTargetAtTime(350 + speed * 35, t, 0.1);
  scrape.gain.gain.setTargetAtTime(active && grounded ? slip * 0.06 : 0, t, 0.05);
  scrape.filter.frequency.setTargetAtTime(3000 + speed * 60, t, 0.05);
}

export const sfx = {
  /** Touching down: a soft thump with a puff of sand, louder for harder landings. */
  land: (strength: number, chime = false) => {
    const k = Math.min(1, strength / 20);
    tone({ freq: 120, to: 55, dur: 0.12, type: 'sine', gain: 0.12 + k * 0.12 });
    puff(0.18 + k * 0.12, 900, 0.05 + k * 0.1);
    if (chime && strength > 10) sfx.chime(k);
  },
  /** A soft two-note chime (the night: big landings and springs). */
  chime: (k = 0.6) => {
    tone({ freq: 1568, dur: 0.5, type: 'sine', gain: 0.04 * k });
    tone({ freq: 2349, dur: 0.6, type: 'sine', gain: 0.03 * k, delay: 0.07 });
  },
  /** Back at a checkpoint after a fall. */
  respawn: () => {
    tone({ freq: 320, to: 880, dur: 0.12, type: 'sine', gain: 0.12 });
    puff(0.15, 2400, 0.04, 1.2);
  },
  /** The finish: a sparkly run on top of the fanfare. */
  confetti: () => [1568, 1760, 2093, 2349, 2637].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.05, delay: 0.35 + i * 0.05 })),
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
  /** A tile giving way: a crunch; thin ice (`brittle`) crackles; a star sticker peels with a soft sparkle. */
  crumble: (sound: 'crunch' | 'brittle' | 'sparkle' = 'crunch') => {
    if (sound === 'crunch') return tone({ freq: 140, to: 60, dur: 0.25, type: 'square', gain: 0.06 });
    if (sound === 'sparkle') {
      puff(0.18, 3500, 0.05, 1);
      [1760, 2093, 2637].forEach((f, i) => tone({ freq: f, dur: 0.08, type: 'sine', gain: 0.03, delay: i * 0.05 }));
      return;
    }
    puff(0.1, 5000, 0.08, 2);
    [2400, 1700, 2900].forEach((f, i) => tone({ freq: f, to: f * 0.6, dur: 0.05, type: 'square', gain: 0.03, delay: i * 0.045 }));
  },
  /** A log breaking up at the bottom of a slope: a dry crack and a thud. */
  crack: () => {
    puff(0.12, 1800, 0.09, 1.4);
    tone({ freq: 160, to: 70, dur: 0.18, type: 'triangle', gain: 0.1 });
  },
  /** Touching spikes: a sharp "ow". */
  spike: () => {
    tone({ freq: 1100, to: 420, dur: 0.14, type: 'square', gain: 0.07 });
    puff(0.08, 4000, 0.05, 1.5);
  },
  /** Tearing through a paper wall: a papery rip. */
  tear: () => {
    puff(0.22, 3200, 0.12, 0.7);
    tone({ freq: 520, to: 180, dur: 0.12, type: 'sawtooth', gain: 0.035 });
  },
  click: () => tone({ freq: 1200, to: 900, dur: 0.06, type: 'square', gain: 0.1 }), // a switch star's button
  tick: () => tone({ freq: 1500, dur: 0.04, type: 'square', gain: 0.07 }),
  star: () => [988, 1319, 1976].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.13, delay: i * 0.06 })),
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.25, gain: 0.15, delay: i * 0.12 })),
};
