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
  // loop, so a tail that starts late in the 1 s of noise doesn't run off its end
  s.loop = true;
  s.start(t, Math.random() * 0.8);
  s.stop(t + dur + 0.02);
}

/** A soft note with a little harmonic (for chimes and alerts). */
function note(c: AudioContext, out: AudioNode, t: number, f: number, dur: number, peak: number, type: OscillatorType = 'triangle') {
  tone(c, out, t, type, f, f, dur, peak, 0.012);
  tone(c, out, t, 'sine', f * 2, f * 2, dur * 0.6, peak * 0.18, 0.012);
}

/** Soft-clipping saturation into `out` (cached curves): gives booms weight without more volume. */
const curves = new Map<number, Float32Array<ArrayBuffer>>();
function drive(c: AudioContext, out: AudioNode, amount: number) {
  let curve = curves.get(amount);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    curves.set(amount, curve);
  }
  const w = c.createWaveShaper();
  w.curve = curve;
  w.oversample = '2x';
  w.connect(out);
  return w;
}

/** A broadband click a few ms long: the leading edge that makes a shot read as a shot. */
function click(c: AudioContext, out: AudioNode, t: number, f: number, peak: number, dur = 0.012) {
  hiss(c, out, t, 'highpass', f, f, dur, peak, 0.7, 0.0008);
}

/** Debris: `n` little ticks scattered over `dur` s, getting quieter (shrapnel, gravel, crackle). */
function crackle(c: AudioContext, out: AudioNode, t: number, dur: number, n: number, peak: number, f: number, p: number) {
  for (let i = 0; i < n; i++) {
    const k = Math.random();
    const dt = k * k * dur;
    hiss(c, out, t + dt, 'bandpass', f * p * (0.6 + Math.random() * 0.9), f * p * 0.7, 0.012 + Math.random() * 0.02, peak * (1 - k * 0.8), 3 + Math.random() * 4, 0.001);
  }
}

/** A deep boom: a pitch-dropping sine through saturation, plus a filtered noise body. */
function boom(c: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number, body: number, bodyF: number, sat = 2.5) {
  const d = drive(c, out, sat);
  tone(c, d, t, 'sine', f0, f1, dur, peak, 0.002);
  hiss(c, d, t, 'lowpass', bodyF, bodyF * 0.12, dur * 0.9, body, 0.7, 0.002);
}

/** Sounds that loop (made in ./index.ts, not here). */
export type LoopId = 'wind' | 'surf' | 'camp';

export const RECIPES: Record<Exclude<SoundId, LoopId>, Recipe> = {
  // ----- combat -----
  // Each shot: a click (the leading edge), a body (its pitch says the calibre) and a short tail.
  // index.ts adds distance (duller, more echo far away) on top.
  turretShot(c, o, t, p) {
    // a heavy autocannon: crack, thump, and the clack of the breech cycling
    click(c, o, t, 3500 * p, 0.5);
    boom(c, o, t, 210 * p, 70 * p, 0.16, 0.5, 0.35, 2600 * p, 2);
    hiss(c, o, t + 0.005, 'bandpass', 1900 * p, 700 * p, 0.12, 0.28, 1.2);
    hiss(c, o, t + 0.11, 'bandpass', 3200 * p, 3000 * p, 0.018, 0.12, 8, 0.001);
    return 0.2;
  },
  roverShot(c, o, t, p) {
    // a plasma bolt: a bright falling zip with a short buzz
    click(c, o, t, 5000 * p, 0.22, 0.006);
    tone(c, o, t, 'sawtooth', 1900 * p, 420 * p, 0.07, 0.07);
    tone(c, o, t, 'sine', 1400 * p, 300 * p, 0.09, 0.16);
    hiss(c, o, t, 'bandpass', 4200 * p, 1600 * p, 0.06, 0.14, 2);
    return 0.11;
  },
  tankShot(c, o, t, p) {
    // a main gun: sharp report, saturated low boom, a rolling tail
    click(c, o, t, 2500 * p, 0.7, 0.015);
    boom(c, o, t, 150 * p, 38 * p, 0.38, 0.7, 0.55, 1800 * p, 3);
    hiss(c, o, t + 0.01, 'bandpass', 1300 * p, 380 * p, 0.2, 0.3, 1);
    hiss(c, o, t + 0.08, 'lowpass', 600 * p, 120 * p, 0.45, 0.16, 0.7, 0.04);
    return 0.55;
  },
  rail(c, o, t, p) {
    // a capacitor whine snapping into a supersonic crack, a thud and a metallic ring
    tone(c, o, t, 'sawtooth', 1800 * p, 6200 * p, 0.07, 0.07, 0.04);
    tone(c, o, t, 'sine', 3000 * p, 7000 * p, 0.07, 0.05, 0.04);
    click(c, o, t + 0.07, 6000 * p, 0.6, 0.01);
    hiss(c, o, t + 0.07, 'highpass', 6000 * p, 2200 * p, 0.16, 0.38, 0.8, 0.001);
    boom(c, o, t + 0.07, 180 * p, 45 * p, 0.3, 0.5, 0.2, 1200 * p, 2);
    tone(c, o, t + 0.07, 'sine', 2350 * p, 2330 * p, 0.5, 0.035, 0.002);
    tone(c, o, t + 0.07, 'sine', 3710 * p, 3700 * p, 0.35, 0.02, 0.002);
    return 0.6;
  },
  shieldHit(c, o, t, p) {
    // a glassy ping that rings off, with a soft electric fizz and a flutter
    tone(c, o, t, 'sine', 880 * p, 660 * p, 0.4, 0.2, 0.003);
    tone(c, o, t, 'sine', 1320 * p, 1180 * p, 0.3, 0.1, 0.003);
    tone(c, o, t, 'triangle', 220 * p, 180 * p, 0.25, 0.08, 0.003);
    hiss(c, o, t, 'bandpass', 5200 * p, 3600 * p, 0.12, 0.12, 2);
    crackle(c, o, t + 0.02, 0.2, 4, 0.06, 6000, p);
    return 0.42;
  },
  shell(c, o, t, p) {
    // artillery: the thoomp of the gun, the round's falling whistle, and the blast when it lands
    // (the battle effects keep a shell in the air SHELL_FLIGHT = 0.5 s; this lands with it)
    const land = t + 0.5;
    click(c, o, t, 1800 * p, 0.35, 0.02);
    boom(c, o, t, 110 * p, 45 * p, 0.25, 0.45, 0.3, 900 * p, 2);
    tone(c, o, t + 0.15, 'sine', 2200 * p, 900 * p, 0.37, 0.03, 0.15);
    click(c, o, land, 1500 * p, 0.6, 0.02);
    boom(c, o, land, 95 * p, 26 * p, 0.8, 0.8, 0.7, 1400 * p, 3.5);
    hiss(c, o, land + 0.02, 'bandpass', 2200 * p, 500 * p, 0.2, 0.25, 1);
    hiss(c, o, land + 0.15, 'lowpass', 500 * p, 80 * p, 0.9, 0.2, 0.7, 0.1);
    crackle(c, o, land + 0.15, 0.7, 10, 0.12, 2400, p);
    return 1.75;
  },
  arc(c, o, t, p) {
    // a crackling zap: buzzy saws with a wobble, a hum, and sparks spitting off
    tone(c, o, t, 'sawtooth', 1600 * p, 380 * p, 0.14, 0.11);
    tone(c, o, t + 0.02, 'square', 900 * p, 2400 * p, 0.06, 0.05);
    tone(c, o, t, 'sawtooth', 120 * p, 100 * p, 0.18, 0.08, 0.002);
    hiss(c, o, t, 'highpass', 4200 * p, 2400 * p, 0.16, 0.2, 0.8);
    crackle(c, o, t, 0.22, 9, 0.18, 4500, p);
    return 0.26;
  },
  pdShot(c, o, t, p) {
    // a short burst of three hard ticks with a little body each
    for (let i = 0; i < 3; i++) {
      click(c, o, t + i * 0.022, 4200 * p, 0.25, 0.008);
      hiss(c, o, t + i * 0.022, 'bandpass', 2600 * p, 1500 * p, 0.03, 0.22, 2);
    }
    return 0.1;
  },
  spit(c, o, t, p) {
    // a wet hock, a gurgle, and the acid fizzing where it lands
    hiss(c, o, t, 'bandpass', 600 * p, 1400 * p, 0.09, 0.6, 3);
    tone(c, o, t + 0.02, 'sine', 300 * p, 520 * p, 0.12, 0.12);
    for (let i = 0; i < 3; i++) tone(c, o, t + 0.05 + i * 0.03, 'sine', (400 + Math.random() * 300) * p, 250 * p, 0.03, 0.06);
    hiss(c, o, t + 0.18, 'highpass', 3000 * p, 6000 * p, 0.35, 0.12, 0.7, 0.03);
    return 0.55;
  },
  emerge(c, o, t, p) {
    // ground breaking open: rumble rising into a crunch, and stones falling back
    hiss(c, o, t, 'lowpass', 120 * p, 700 * p, 0.45, 0.5, 1, 0.08);
    tone(c, o, t, 'sine', 40 * p, 70 * p, 0.5, 0.4, 0.08);
    boom(c, o, t + 0.33, 80 * p, 35 * p, 0.35, 0.4, 0.4, 1000 * p, 2.5);
    hiss(c, o, t + 0.35, 'bandpass', 1500 * p, 600 * p, 0.2, 0.4, 1.5);
    crackle(c, o, t + 0.45, 0.6, 12, 0.14, 1600, p);
    return 1.1;
  },
  repair(c, o, t, p) {
    // a soft rising whirr and a tiny weld fizz
    tone(c, o, t, 'triangle', 600 * p, 1100 * p, 0.25, 0.07, 0.04);
    tone(c, o, t + 0.05, 'sine', 1200 * p, 1800 * p, 0.2, 0.04, 0.04);
    hiss(c, o, t + 0.05, 'highpass', 7000 * p, 6000 * p, 0.18, 0.04, 0.8, 0.02);
    return 0.3;
  },
  bite(c, o, t, p) {
    // a snarl and two snaps of the jaws
    tone(c, o, t, 'sawtooth', 140 * p, 95 * p, 0.16, 0.12, 0.01);
    tone(c, o, t, 'sawtooth', 147 * p, 92 * p, 0.16, 0.08, 0.01);
    click(c, o, t + 0.02, 1800 * p, 0.5, 0.02);
    hiss(c, o, t + 0.02, 'bandpass', 900 * p, 500 * p, 0.05, 1.2, 2);
    click(c, o, t + 0.09, 1500 * p, 0.4, 0.02);
    hiss(c, o, t + 0.09, 'bandpass', 760 * p, 420 * p, 0.06, 1.0, 2);
    return 0.18;
  },
  deathSmall(c, o, t, p) {
    // a crunching pop and bits pattering down
    click(c, o, t, 2000 * p, 0.5, 0.015);
    boom(c, o, t, 220 * p, 60 * p, 0.22, 0.4, 0.4, 2400 * p, 2.5);
    crackle(c, o, t + 0.05, 0.45, 7, 0.12, 2800, p);
    return 0.55;
  },
  deathBig(c, o, t, p) {
    // a blast: crack, a saturated boom that rolls on, a second pop, and debris raining down
    click(c, o, t, 1500 * p, 0.8, 0.02);
    boom(c, o, t, 85 * p, 24 * p, 0.9, 0.85, 0.75, 1600 * p, 4);
    hiss(c, o, t + 0.01, 'bandpass', 1800 * p, 400 * p, 0.25, 0.35, 1);
    hiss(c, o, t + 0.12, 'lowpass', 400 * p, 60 * p, 1.1, 0.25, 0.7, 0.12);
    boom(c, o, t + 0.16 + Math.random() * 0.1, 160 * p, 50 * p, 0.25, 0.3, 0.25, 2200 * p, 2);
    crackle(c, o, t + 0.1, 1.0, 16, 0.14, 2200, p);
    return 1.4;
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
  birth(c, o, t, p) {
    // a music-box rise, soft and warm
    [659, 784, 988, 1319].forEach((f, i) => note(c, o, t + i * 0.11, f * p, 0.8 - i * 0.08, 0.12, 'sine'));
    return 1.15;
  },
  death(c, o, t) {
    // a slow fall of a minor third over a low hum: someone the colony knew
    tone(c, o, t, 'sine', 110, 110, 2.2, 0.08, 0.3);
    note(c, o, t, 220, 1.4, 0.15, 'sine');
    note(c, o, t + 0.5, 185, 1.8, 0.15, 'sine');
    return 2.3;
  },
  research(c, o, t, p) {
    // a quick bright climb and a shimmer: something learned
    [523, 659, 784, 988, 1046].forEach((f, i) => note(c, o, t + i * 0.06, f * p, 0.5, 0.11, 'sine'));
    tone(c, o, t + 0.3, 'sine', 2093 * p, 2637 * p, 0.6, 0.035, 0.05);
    return 0.95;
  },
  confirm(c, o, t, p) {
    tone(c, o, t, 'sine', 700 * p, 700 * p, 0.05, 0.13, 0.003);
    tone(c, o, t + 0.06, 'sine', 1050 * p, 1050 * p, 0.08, 0.11, 0.003);
    return 0.16;
  },
  recycle(c, o, t, p) {
    // placed, backwards, and the chink of alloys coming back
    note(c, o, t, 780 * p, 0.08, 0.17, 'sine');
    note(c, o, t + 0.07, 520 * p, 0.12, 0.17, 'sine');
    hiss(c, o, t + 0.15, 'bandpass', 6200 * p, 5800 * p, 0.03, 0.12, 6);
    hiss(c, o, t + 0.21, 'bandpass', 7000 * p, 6600 * p, 0.03, 0.09, 6);
    return 0.3;
  },
  mission(c, o, t, p) {
    // a radio squelch, then new orders: a rising fifth
    hiss(c, o, t, 'bandpass', 1800, 1800, 0.06, 0.12, 2);
    note(c, o, t + 0.08, 523 * p, 0.2, 0.15);
    note(c, o, t + 0.26, 784 * p, 0.4, 0.15);
    return 0.7;
  },
  objective(c, o, t, p) {
    note(c, o, t, 1175 * p, 0.25, 0.11, 'sine');
    note(c, o, t + 0.06, 1568 * p, 0.3, 0.1, 'sine');
    return 0.38;
  },
  missionDone(c, o, t, p) {
    // a short fanfare: up the chord, then all of it
    [392, 523, 659].forEach((f, i) => note(c, o, t + i * 0.1, f * p, 0.3, 0.14));
    [523, 659, 784, 1046].forEach((f) => note(c, o, t + 0.32, f * p, 1.2, 0.09));
    return 1.55;
  },
  victory(c, o, t) {
    // brassy fanfare (saws through a low-pass), ending on a long major chord
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.connect(o);
    [[392, 0], [523, 0.16], [659, 0.32], [784, 0.48]].forEach(([fr, dt]) => tone(c, f, t + dt, 'sawtooth', fr, fr, 0.3, 0.09, 0.02));
    [523, 659, 784, 1046].forEach((fr) => tone(c, f, t + 0.72, 'sawtooth', fr, fr, 2.4, 0.06, 0.06));
    tone(c, o, t + 0.72, 'sine', 131, 131, 2.4, 0.12, 0.1);
    return 3.2;
  },
  discovery(c, o, t, p) {
    // something strange: a slow whole-tone shimmer and a rising breath
    [587, 659, 740, 831].forEach((f, i) => tone(c, o, t + i * 0.14, 'sine', f * p, f * p, 1.1, 0.07, 0.15));
    hiss(c, o, t, 'bandpass', 900 * p, 4000 * p, 1, 0.05, 3, 0.4);
    return 1.6;
  },
  friend(c, o, t, p) {
    // a warm open fifth, then the octave above
    note(c, o, t, 392 * p, 0.9, 0.12);
    note(c, o, t, 587 * p, 0.9, 0.1);
    note(c, o, t + 0.22, 784 * p, 0.7, 0.08, 'sine');
    return 1.0;
  },
  exhausted(c, o, t, p) {
    // a hollow clunk, running down
    tone(c, o, t, 'sine', 300 * p, 120 * p, 0.25, 0.25, 0.003);
    hiss(c, o, t, 'lowpass', 700 * p, 300 * p, 0.08, 0.2, 1);
    tone(c, o, t + 0.12, 'triangle', 200 * p, 170 * p, 0.3, 0.09);
    return 0.45;
  },
  message(c, o, t, p) {
    // a comms blip: a breath of static and two quick tones
    hiss(c, o, t, 'bandpass', 2400, 2400, 0.04, 0.07, 3);
    tone(c, o, t + 0.03, 'sine', 1320 * p, 1320 * p, 0.06, 0.09, 0.003);
    tone(c, o, t + 0.1, 'sine', 1760 * p, 1760 * p, 0.06, 0.07, 0.003);
    return 0.18;
  },
  missionFail(c, o, t) {
    [440, 370, 311].forEach((f, i) => note(c, o, t + i * 0.26, f, i === 2 ? 0.9 : 0.24, 0.17));
    return 1.4;
  },
  defeat(c, o, t) {
    // slow, low tolls going down, and a long dark drone
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(o);
    [220, 196, 165, 147].forEach((fr, i) => tone(c, f, t + i * 0.55, 'sawtooth', fr, fr, 1, 0.13, 0.02));
    tone(c, o, t + 2.2, 'sine', 73, 73, 2.2, 0.16, 0.2);
    return 4.4;
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
  select(c, o, t, p) {
    tone(c, o, t, 'sine', 1300 * p, 1650 * p, 0.035, 0.09, 0.002);
    return 0.04;
  },
  order(c, o, t, p) {
    // acknowledged: a rising two-step chirp
    tone(c, o, t, 'triangle', 600 * p, 900 * p, 0.06, 0.1, 0.003);
    tone(c, o, t + 0.06, 'sine', 900 * p, 1250 * p, 0.06, 0.08, 0.003);
    return 0.13;
  },
  // ----- ambient spots (beds that loop are made in ./index.ts) -----
  build(c, o, t, p) {
    // drones at work: a ratchet, a clank or a welding fizz
    const k = Math.random();
    if (k < 0.4) for (let i = 0; i < 3; i++) hiss(c, o, t + i * 0.035, 'bandpass', 2600 * p, 2200 * p, 0.02, 0.22, 4);
    else if (k < 0.75) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500 * p;
      f.connect(o);
      tone(c, f, t, 'square', 523 * p, 515 * p, 0.12, 0.16, 0.001);
      tone(c, f, t, 'square', 787 * p, 780 * p, 0.09, 0.1, 0.001);
    } else hiss(c, o, t, 'highpass', 6000 * p, 4000 * p, 0.2, 0.13, 0.8, 0.01);
    return 0.22;
  },
  critter(c, o, t, p) {
    // something out there: a trill, a warble or a pair of hoots
    const k = Math.random(), q = p * (0.85 + Math.random() * 0.3);
    if (k < 0.4) {
      for (let i = 0; i < 5; i++) tone(c, o, t + i * 0.05, 'sine', 2600 * q, 3100 * q, 0.04, 0.09, 0.004);
      return 0.3;
    }
    if (k < 0.75) {
      tone(c, o, t, 'sine', 900 * q, 1350 * q, 0.18, 0.12, 0.03);
      tone(c, o, t + 0.18, 'sine', 1350 * q, 780 * q, 0.25, 0.1, 0.01);
      return 0.45;
    }
    tone(c, o, t, 'sine', 330 * q, 300 * q, 0.22, 0.16, 0.04);
    tone(c, o, t + 0.32, 'sine', 330 * q, 280 * q, 0.3, 0.14, 0.04);
    return 0.65;
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
export const STEADY: ReadonlySet<SoundId> = new Set(['warning', 'alarm', 'deny', 'death', 'victory', 'missionFail', 'defeat']);
