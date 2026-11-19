/**
 * Music percussion, synthesised (no files). Each drum schedules its nodes into
 * `out` at time `t` with peak gain `v` and returns how long it rings (s).
 * Kept soft and a little distant: these sit inside ambient music, not a dance
 * track. Step patterns ("x...o...") are parsed by `parseSteps`.
 */
import { noise } from './synth';

export const DRUMS = ['kick', 'thud', 'tom', 'snare', 'rim', 'hat', 'shaker', 'clank', 'taiko', 'hand', 'clap', 'block', 'zap'] as const;
export type Drum = (typeof DRUMS)[number];

/** What each drum sounds like, for the editor's help. */
export const DRUM_HELP: Record<Drum, string> = {
  kick: 'Deep, round kick drum.',
  thud: 'A muffled boom, felt more than heard: distant impacts.',
  tom: 'Low tom: a pitched, hollow drum.',
  snare: 'Soft snare: a brushed crack.',
  rim: 'Rim click: short, woody, bright.',
  hat: 'Closed hi-hat: a tiny tick of noise.',
  shaker: 'Shaker: a soft rattle, good for steady eighths or sixteenths.',
  clank: 'Metallic clank, like a struck pipe: industrial, uneasy.',
  taiko: 'A huge war drum: a deep boom with a hard skin slap. Cinematic.',
  hand: 'A hand drum: x a sharp slap, o a round open tone. Folk, earthy.',
  clap: 'A hand clap: a few quick bursts and a short tail.',
  block: 'Wood block: a dry, hollow knock. Mechanical, clockwork.',
  zap: 'A falling laser blip: retro sci-fi.',
};

/** A step pattern: x = hit, o = soft hit (ghost note), . or - = rest; spaces and | are ignored. */
export function parseSteps(s: string | undefined): { steps: number[]; bad: string[] } {
  const steps: number[] = [], bad: string[] = [];
  for (const ch of (s ?? '').replace(/[\s|]/g, '')) {
    if (ch === 'x' || ch === 'X') steps.push(1);
    else if (ch === 'o' || ch === 'O') steps.push(0.45);
    else if (ch === '.' || ch === '-') steps.push(0);
    else bad.push(ch);
  }
  return { steps, bad };
}

/** `step` is the pattern's mark: 1 for x, under 1 for o (a drum may play its soft hit differently). */
type Hit = (c: BaseAudioContext, out: AudioNode, t: number, v: number, step?: number) => number;

function env(c: BaseAudioContext, out: AudioNode, t: number, peak: number, attack: number, dur: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}

function osc(c: BaseAudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, dur: number, attack = 0.002) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  const g = env(c, out, t, peak, attack, dur);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
  o.onended = () => { o.disconnect(); g.disconnect(); };
  return o;
}

function hiss(c: BaseAudioContext, out: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, peak: number, dur: number, attack = 0.001) {
  const s = c.createBufferSource();
  s.buffer = noise(c as AudioContext);
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = env(c, out, t, peak, attack, dur);
  s.connect(flt).connect(g);
  s.start(t, Math.random() * 0.8);
  s.stop(t + dur + 0.02);
  s.onended = () => { s.disconnect(); flt.disconnect(); g.disconnect(); };
}

export const HITS: Record<Drum, Hit> = {
  kick: (c, out, t, v) => {
    osc(c, out, t, 'sine', 120, 42, 0.13, v, 0.5);
    hiss(c, out, t, 'highpass', 2500, 0.7, v * 0.12, 0.012);
    return 0.5;
  },
  thud: (c, out, t, v) => {
    osc(c, out, t, 'sine', 75, 38, 0.35, v * 0.9, 1.1, 0.01);
    hiss(c, out, t, 'lowpass', 180, 0.7, v * 0.5, 0.35, 0.008);
    return 1.1;
  },
  tom: (c, out, t, v) => {
    osc(c, out, t, 'triangle', 170, 112, 0.22, v * 0.8, 0.6);
    osc(c, out, t, 'sine', 340, 226, 0.15, v * 0.15, 0.25);
    hiss(c, out, t, 'bandpass', 900, 1, v * 0.08, 0.06);
    return 0.6;
  },
  snare: (c, out, t, v) => {
    hiss(c, out, t, 'bandpass', 1900, 0.8, v * 0.55, 0.24, 0.002);
    osc(c, out, t, 'triangle', 200, 160, 0.08, v * 0.35, 0.12);
    return 0.25;
  },
  rim: (c, out, t, v) => {
    osc(c, out, t, 'triangle', 1750, 1600, 0.03, v * 0.35, 0.05);
    hiss(c, out, t, 'bandpass', 3200, 2, v * 0.25, 0.03);
    return 0.06;
  },
  hat: (c, out, t, v) => {
    hiss(c, out, t, 'highpass', 7500, 0.7, v * 0.35, 0.05);
    return 0.06;
  },
  shaker: (c, out, t, v) => {
    hiss(c, out, t, 'bandpass', 5200, 1.4, v * 0.4, 0.09, 0.018);
    return 0.1;
  },
  clank: (c, out, t, v) => {
    // inharmonic partials, like a struck pipe or plate
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300;
    bp.Q.value = 0.9;
    bp.connect(out);
    let left = 4;
    for (const [f, lvl] of [[317, 0.5], [487, 0.4], [781, 0.35], [1129, 0.25]]) {
      osc(c, bp, t, 'square', f, f * 0.995, 0.4, v * lvl * 0.35, 0.45, 0.001).addEventListener('ended', () => { if (--left === 0) bp.disconnect(); });
    }
    hiss(c, out, t, 'highpass', 4000, 0.7, v * 0.12, 0.03);
    return 0.45;
  },
  taiko: (c, out, t, v) => {
    osc(c, out, t, 'sine', 95, 48, 0.4, v * 1.1, 1.6, 0.004);
    osc(c, out, t, 'triangle', 150, 82, 0.25, v * 0.35, 0.7, 0.003);
    hiss(c, out, t, 'lowpass', 900, 0.8, v * 0.45, 0.12, 0.002);
    hiss(c, out, t, 'bandpass', 2400, 1.2, v * 0.12, 0.04);
    return 1.6;
  },
  hand: (c, out, t, v, step = 1) => {
    // 'o' is a round open tone (played louder, since the pattern softens it); 'x' a slap with more skin
    const open = step < 1;
    osc(c, out, t, 'sine', open ? 230 : 260, open ? 205 : 215, 0.08, v * (open ? 1.6 : 0.6), open ? 0.35 : 0.18);
    hiss(c, out, t, 'bandpass', open ? 900 : 1700, open ? 1.5 : 1, v * (open ? 0.15 : 0.6), open ? 0.05 : 0.09, 0.001);
    return 0.35;
  },
  clap: (c, out, t, v) => {
    for (const dt of [0, 0.011, 0.023]) hiss(c, out, t + dt, 'bandpass', 1300, 1.1, v * 0.5, 0.025, 0.001);
    hiss(c, out, t + 0.03, 'bandpass', 1200, 0.9, v * 0.4, 0.2, 0.002);
    return 0.25;
  },
  block: (c, out, t, v) => {
    osc(c, out, t, 'sine', 980, 960, 0.02, v * 0.55, 0.09, 0.001);
    osc(c, out, t, 'sine', 1610, 1590, 0.02, v * 0.2, 0.05, 0.001);
    hiss(c, out, t, 'bandpass', 2500, 3, v * 0.1, 0.015);
    return 0.1;
  },
  zap: (c, out, t, v) => {
    osc(c, out, t, 'square', 2200, 160, 0.13, v * 0.16, 0.16, 0.001);
    osc(c, out, t, 'sine', 1100, 90, 0.16, v * 0.3, 0.2, 0.001);
    return 0.2;
  },
};
