/**
 * Built-in sounds, synthesised with Web Audio (no files). Each recipe schedules
 * its nodes into `out` starting at time `t`, with every pitch multiplied by `p`
 * (a small random variation), and returns how long it lasts in seconds.
 *
 * Tuning: the numbers are peak gains (0..1, before the mixer) and Hz. Keep them
 * soft; the mixer adds category and master volume on top.
 */
import type { SoundId } from '../content/defs';

export type Recipe = (c: AudioContext, out: AudioNode, t: number, p: number) => number;

let noiseBuf: AudioBuffer | null = null;
/** One second of white noise, shared by every noisy sound. */
export function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}

/** Envelope: linear attack to `peak`, exponential decay to silence by t + dur. */
function env(c: AudioContext, out: AudioNode, t: number, dur: number, peak: number, attack = 0.004) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}

/** A tone gliding from f0 to f1 Hz. */
function tone(c: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(env(c, out, t, dur, peak, attack));
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered noise; the filter sweeps from f0 to f1 Hz. */
function hiss(c: AudioContext, out: AudioNode, t: number, filter: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1, attack?: number) {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  s.connect(f);
  f.connect(env(c, out, t, dur, peak, attack));
  s.start(t, Math.random() * 0.8);
  s.stop(t + dur + 0.02);
}

/** A soft note with a little harmonic (for chimes and alerts). */
function note(c: AudioContext, out: AudioNode, t: number, f: number, dur: number, peak: number, type: OscillatorType = 'triangle') {
  tone(c, out, t, type, f, f, dur, peak, 0.012);
  tone(c, out, t, 'sine', f * 2, f * 2, dur * 0.6, peak * 0.18, 0.012);
}

export const RECIPES: Record<Exclude<SoundId, 'wind'>, Recipe> = {
  // ----- combat -----
  turretShot(c, o, t, p) {
    hiss(c, o, t, 'bandpass', 2400 * p, 900 * p, 0.09, 0.45, 1.4);
    tone(c, o, t, 'triangle', 520 * p, 170 * p, 0.08, 0.35);
    return 0.1;
  },
  roverShot(c, o, t, p) {
    tone(c, o, t, 'square', 1100 * p, 620 * p, 0.045, 0.08);
    hiss(c, o, t, 'highpass', 3000 * p, 3000 * p, 0.03, 0.18);
    return 0.06;
  },
  tankShot(c, o, t, p) {
    tone(c, o, t, 'sine', 120 * p, 42 * p, 0.32, 0.55, 0.002);
    hiss(c, o, t, 'lowpass', 1400 * p, 160 * p, 0.28, 0.4, 0.7, 0.002);
    return 0.34;
  },
  shell(c, o, t, p) {
    // a deep thump and a rolling boom
    tone(c, o, t, 'sine', 95 * p, 30 * p, 0.6, 0.6, 0.002);
    hiss(c, o, t, 'lowpass', 900 * p, 90 * p, 0.55, 0.45, 0.6, 0.002);
    hiss(c, o, t + 0.04, 'bandpass', 2200 * p, 600 * p, 0.12, 0.2, 1.2);
    return 0.62;
  },
  arc(c, o, t, p) {
    // a crackling zap: buzzy saw with a fast wobble, plus sizzle
    tone(c, o, t, 'sawtooth', 1600 * p, 380 * p, 0.12, 0.12);
    tone(c, o, t + 0.03, 'square', 900 * p, 2400 * p, 0.06, 0.06);
    hiss(c, o, t, 'highpass', 4200 * p, 2400 * p, 0.14, 0.22, 0.8);
    return 0.16;
  },
  pdShot(c, o, t, p) {
    // a short burst of three ticks
    for (let i = 0; i < 3; i++) hiss(c, o, t + i * 0.022, 'bandpass', 3200 * p, 1800 * p, 0.02, 0.3, 2);
    return 0.08;
  },
  spit(c, o, t, p) {
    // a wet hock and a bubbling hiss
    hiss(c, o, t, 'bandpass', 600 * p, 1400 * p, 0.09, 0.6, 3);
    tone(c, o, t + 0.02, 'sine', 300 * p, 520 * p, 0.12, 0.12);
    hiss(c, o, t + 0.08, 'highpass', 2600 * p, 5000 * p, 0.2, 0.12, 0.7);
    return 0.3;
  },
  emerge(c, o, t, p) {
    // ground breaking open: rumble rising into a crunch
    hiss(c, o, t, 'lowpass', 120 * p, 700 * p, 0.45, 0.5, 1, 0.08);
    tone(c, o, t, 'sine', 40 * p, 70 * p, 0.5, 0.4, 0.08);
    hiss(c, o, t + 0.35, 'bandpass', 1500 * p, 600 * p, 0.2, 0.4, 1.5);
    return 0.6;
  },
  repair(c, o, t, p) {
    // a soft rising whirr
    tone(c, o, t, 'triangle', 600 * p, 1100 * p, 0.25, 0.07, 0.04);
    tone(c, o, t + 0.05, 'sine', 1200 * p, 1800 * p, 0.2, 0.04, 0.04);
    return 0.3;
  },
  bite(c, o, t, p) {
    hiss(c, o, t, 'bandpass', 900 * p, 500 * p, 0.05, 1.6, 2);
    hiss(c, o, t + 0.06, 'bandpass', 760 * p, 420 * p, 0.06, 1.3, 2);
    tone(c, o, t, 'sawtooth', 150 * p, 90 * p, 0.1, 0.1);
    return 0.13;
  },
  deathSmall(c, o, t, p) {
    hiss(c, o, t, 'lowpass', 1800 * p, 200 * p, 0.2, 0.35, 2);
    tone(c, o, t, 'sine', 340 * p, 70 * p, 0.18, 0.25);
    return 0.22;
  },
  deathBig(c, o, t, p) {
    hiss(c, o, t, 'lowpass', 1100 * p, 80 * p, 0.7, 0.45, 0.8, 0.003);
    tone(c, o, t, 'sine', 80 * p, 28 * p, 0.55, 0.5, 0.003);
    return 0.72;
  },
  // ----- colony events -----
  placed(c, o, t, p) {
    note(c, o, t, 520 * p, 0.09, 0.22, 'sine');
    note(c, o, t + 0.07, 780 * p, 0.12, 0.2, 'sine');
    return 0.2;
  },
  online(c, o, t, p) {
    [392, 523, 659].forEach((f, i) => note(c, o, t + i * 0.09, f * p, 0.32 - i * 0.04, 0.2));
    tone(c, o, t, 'sine', 90, 180, 0.3, 0.12, 0.05); // power-up swell
    return 0.5;
  },
  unitReady(c, o, t, p) {
    note(c, o, t, 587 * p, 0.12, 0.2, 'square');
    note(c, o, t + 0.11, 880 * p, 0.22, 0.2, 'square');
    return 0.36;
  },
  droneReady(c, o, t, p) {
    tone(c, o, t, 'sine', 800 * p, 1400 * p, 0.08, 0.2);
    tone(c, o, t + 0.1, 'sine', 900 * p, 1600 * p, 0.1, 0.2);
    return 0.22;
  },
  packCleared(c, o, t, p) {
    [523, 659, 784].forEach((f) => note(c, o, t, f * p, 0.8, 0.12, 'sine'));
    note(c, o, t + 0.12, 1046 * p, 0.6, 0.08, 'sine');
    return 0.85;
  },
  lost(c, o, t, p) {
    note(c, o, t, 440 * p, 0.14, 0.18);
    note(c, o, t + 0.13, 311 * p, 0.3, 0.18);
    return 0.45;
  },
  // ----- alerts (no pitch variation: they should be recognisable) -----
  warning(c, o, t) {
    for (let i = 0; i < 2; i++) {
      note(c, o, t + i * 0.3, 880, 0.12, 0.22);
      note(c, o, t + i * 0.3 + 0.13, 659, 0.14, 0.22);
    }
    return 0.6;
  },
  alarm(c, o, t) {
    // a klaxon: alternating saws through a low-pass, three times
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    f.connect(o);
    for (let i = 0; i < 3; i++) {
      tone(c, f, t + i * 0.36, 'sawtooth', 466, 466, 0.17, 0.28, 0.01);
      tone(c, f, t + i * 0.36 + 0.18, 'sawtooth', 349, 349, 0.17, 0.28, 0.01);
    }
    return 1.1;
  },
  // ----- interface -----
  tap(c, o, t, p) {
    tone(c, o, t, 'sine', 1900 * p, 1500 * p, 0.03, 0.12, 0.002);
    return 0.04;
  },
  deny(c, o, t) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(o);
    tone(c, f, t, 'square', 220, 220, 0.09, 0.18, 0.005);
    tone(c, f, t + 0.1, 'square', 175, 175, 0.14, 0.18, 0.005);
    return 0.26;
  },
};

/** Alerts keep their exact pitch. */
export const STEADY: ReadonlySet<SoundId> = new Set(['warning', 'alarm', 'deny']);
