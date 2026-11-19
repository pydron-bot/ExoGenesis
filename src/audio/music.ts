/**
 * Music: generative ambient, synthesised live (no files). It never repeats
 * exactly. A mood (content/music/*.json, editor: Rules → Music) gives the
 * chords and how they're played: slow pad chords that drift from one to the
 * next (a random walk that keeps coming home to the first), a soft bass on
 * each chord's root, sparse FM bells picking chord tones through a ping-pong
 * echo, an optional low heartbeat pulse for tension, and a faint band of
 * filtered noise; all into one long synthetic hall reverb.
 *
 * The mood is read through a getter every time something is scheduled, so the
 * editor's ▶ Listen picks up edits as they're made (at the next chord or bell).
 *
 * Scheduling: a 200 ms timer queues notes about a second ahead on the audio
 * clock, so it keeps time even when frames stall. While the context is
 * suspended (tab hidden, sound off) the clock stops and nothing piles up.
 */
import type { MusicChord, MusicDef } from '../content/defs';
import { midiHz, parseNotes } from './notes';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** A mood number, or `d` while it's blank or half-typed in the editor. */
const fin = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Peak gains at level 1 (before the mood's overall level and the Music volume). */
const PAD_PEAK = 0.045;
const BASS_PEAK = 0.09;
const BELL_PEAK = 0.07;
const PULSE_PEAK = 0.11;
const AIR_PEAK = 0.024;
const LOOKAHEAD = 1.2;

interface Chord { pad: number[]; bass: number; bells: number[] }

/** A mood's chord, parsed (bad words are skipped; content checks flag them). */
function chordOf(c: MusicChord): Chord | null {
  const pad = parseNotes(c.notes).notes.sort((a, b) => a - b);
  if (!pad.length) return null;
  const bass = parseNotes(c.bass).notes[0] ?? pad[0] - 12;
  const bells = parseNotes(c.bells).notes;
  return { pad, bass, bells: bells.length ? bells : pad.map((n) => n + 24) };
}

/** Pad tones: oscillators per note as [type, detune in cents, level, octave]. */
const PAD_TONES: Record<MusicDef['padTone'], [OscillatorType, number, number, number][]> = {
  warm: [['sawtooth', -7, 0.5, 0], ['sawtooth', 6, 0.5, 0], ['triangle', 0, 0.9, 0]],
  soft: [['triangle', -4, 0.8, 0], ['triangle', 5, 0.8, 0], ['sine', 0, 0.5, -1]],
  hollow: [['square', -5, 0.3, 0], ['square', 4, 0.3, 0], ['triangle', 0, 0.7, 0]],
  glass: [['sine', -3, 0.9, 0], ['sine', 4, 0.9, 0], ['sine', 0, 0.2, 1]],
};
/** Bell tones: FM ratio, brightness at the strike, how fast it mellows (s), ring length (s), attack (s). */
const BELL_TONES: Record<MusicDef['bellTone'], { ratio: number; index: number; mellow: number; ring: [number, number]; attack: number }> = {
  glass: { ratio: 3.507, index: 1.6, mellow: 1.6, ring: [4, 6.5], attack: 0.012 },
  soft: { ratio: 1, index: 0.9, mellow: 1.2, ring: [3, 5], attack: 0.03 },
  metal: { ratio: 1.414, index: 2.6, mellow: 3, ring: [5, 7.5], attack: 0.006 },
  pluck: { ratio: 2, index: 1.3, mellow: 0.18, ring: [0.8, 1.6], attack: 0.004 },
};

export class AmbientMusic {
  private out: GainNode;
  private lvl: GainNode;
  private pads: GainNode;
  private bellBus: GainNode;
  private wet: GainNode;
  private echoSend: GainNode;
  private airGain: GainNode;
  private nodes: AudioNode[] = [];
  private timer = 0;
  private chord = -1;
  private nextChord = 0;
  private nextBell = 0;
  private nextPulse = 0;
  /** Chords already queued, with their start times (bells and pulse follow whichever is sounding). */
  private queue: { t: number; c: Chord; i: number }[] = [];
  /** The chord being played and when it ends (its pads release then). */
  private chordEnd: { t: number; nodes: GainNode[] } | null = null;
  /** Test and editor hook: what has been queued, and the chord now sounding (index into the mood's chords). */
  played = { chords: 0, bells: 0, pulses: 0, chord: -1 };

  constructor(private c: AudioContext, dest: AudioNode, private mood: () => MusicDef, volume = 1, fadeIn = 6) {
    const out = (this.out = c.createGain());
    out.gain.setValueAtTime(0, c.currentTime);
    out.gain.linearRampToValueAtTime(volume, c.currentTime + fadeIn);
    out.connect(dest);
    // the mood's overall level, live
    const lvl = (this.lvl = c.createGain());
    lvl.connect(out);

    // one big hall for everything
    const verb = c.createConvolver();
    verb.buffer = hall(c, 6.5);
    this.wet = c.createGain();
    verb.connect(this.wet).connect(lvl);

    this.pads = c.createGain();
    this.pads.connect(lvl);
    this.pads.connect(verb);

    // bells: a stereo ping-pong echo (dark, so repeats sink back) into the reverb
    this.bellBus = c.createGain();
    const dry = c.createGain();
    dry.gain.value = 0.55;
    this.bellBus.connect(dry).connect(lvl);
    const send = c.createGain();
    send.gain.value = 1.1;
    this.bellBus.connect(send).connect(verb);
    const dl = c.createDelay(2), dr = c.createDelay(2);
    dl.delayTime.value = 0.63;
    dr.delayTime.value = 0.95;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    const merge = c.createChannelMerger(2);
    this.echoSend = c.createGain();
    this.bellBus.connect(this.echoSend).connect(dl);
    dl.connect(merge, 0, 0);
    dl.connect(dr);
    dr.connect(merge, 0, 1);
    dr.connect(tone).connect(fb).connect(dl);
    merge.connect(lvl);
    merge.connect(verb);

    this.airGain = c.createGain();
    this.airGain.connect(this.pads);
    this.nodes.push(out, lvl, verb, this.wet, this.pads, this.bellBus, dry, send, dl, dr, fb, tone, merge, this.echoSend, this.airGain);
    this.air();
    this.levels(true);

    const t = c.currentTime + 0.1;
    this.nextChord = t;
    this.nextBell = t + rand(3, 5);
    this.nextPulse = t + 1;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  /** Fade out over `fade` seconds, then let go of everything. */
  stop(fade = 4) {
    clearInterval(this.timer);
    const t = this.c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { for (const n of this.nodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* not started */ } n.disconnect(); } }, (fade + 0.3) * 1000);
  }

  /** Move on to the next chord now (the editor's ⏭). */
  skip() {
    const t = this.c.currentTime + 0.05;
    if (this.chordEnd) this.release(this.chordEnd.nodes, t);
    this.nextChord = t;
    this.tick();
  }

  // ---------- internals ----------
  private chords(): Chord[] {
    return (this.mood().chords ?? []).map(chordOf).filter((c): c is Chord => !!c);
  }

  /** Bus levels from the mood (live: the editor tweaks them while it plays). */
  private levels(now = false) {
    const m = this.mood(), t = this.c.currentTime, k = now ? 0.001 : 0.3;
    this.lvl.gain.setTargetAtTime(fin(m.level, 1), t, k);
    this.wet.gain.setTargetAtTime(1.2 * fin(m.space, 0.6), t, k);
    this.echoSend.gain.setTargetAtTime(fin(m.echo, 0.35), t, k);
    this.airGain.gain.setTargetAtTime(AIR_PEAK * fin(m.air, 0), t, k);
  }

  private tick() {
    const now = this.c.currentTime, ahead = now + LOOKAHEAD;
    this.levels();
    while (this.nextChord < ahead) this.nextChord += this.playChord(this.nextChord);
    while (this.nextBell < ahead) this.nextBell += this.bells(this.nextBell);
    while (this.nextPulse < ahead) this.nextPulse += this.pulse(this.nextPulse);
    while (this.queue.length > 2 && this.queue[1].t < now) this.queue.shift();
    const q = [...this.queue].reverse().find((x) => x.t <= now);
    if (q) this.played.chord = q.i;
  }

  private sounding(t: number): Chord | null {
    return [...this.queue].reverse().find((q) => q.t <= t)?.c ?? this.queue[0]?.c ?? null;
  }

  /** Queue the next chord at `t`; returns how long it holds. */
  private playChord(t: number): number {
    const m = this.mood(), all = this.chords();
    const lo = Math.max(1, fin(m.chordMin, 12)), len = rand(lo, Math.max(lo, fin(m.chordMax, lo)));
    if (!all.length) return len;
    // a random walk that keeps coming home to the first chord
    let i: number;
    if (this.chord < 0) i = 0;
    else if (this.chord !== 0 && Math.random() < fin(m.homePull, 0.3)) i = 0;
    else if (all.length === 1) i = 0;
    else { do i = Math.floor(Math.random() * all.length); while (i === this.chord); }
    this.chord = i;
    const ch = all[i];
    this.queue.push({ t, c: ch, i });
    this.played.chords++;
    const swell = Math.max(0.02, Math.min(fin(m.swell, 4), len)), release = Math.max(0.05, fin(m.release, 6));
    const end = t + len;
    const gains: GainNode[] = [];
    const stagger = Math.min(0.9, swell / 4);
    if (m.pad > 0) ch.pad.forEach((n, k) => gains.push(this.padVoice(midiHz(n), t + k * rand(0.2, 1) * stagger, end, release, swell, m, ch.pad.length > 1 ? (k / (ch.pad.length - 1)) * 1.2 - 0.6 : 0)));
    if (m.bass > 0) gains.push(this.bass(midiHz(ch.bass), t, end, release, swell, m.bass));
    this.chordEnd = { t: end, nodes: gains };
    return len;
  }

  /** Fade a chord's voices out from `t` (used when skipping ahead). */
  private release(gains: GainNode[], t: number) {
    const r = Math.max(0.5, Math.min(3, fin(this.mood().release, 2)));
    for (const g of gains) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, r / 3);
    }
  }

  /** One pad note: a few oscillators softened by a slowly breathing low-pass. */
  private padVoice(f: number, t: number, end: number, release: number, swell: number, m: MusicDef, pan: number): GainNode {
    const c = this.c, peak = PAD_PEAK * m.pad;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell);
    g.gain.setValueAtTime(peak, Math.max(t + swell, end));
    g.gain.linearRampToValueAtTime(0, Math.max(t + swell, end) + release);
    const stopAt = Math.max(t + swell, end) + release + 0.1;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.value = Math.min(6000, (380 + f * 0.9) * Math.max(0.1, fin(m.brightness, 1)));
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = rand(0.03, 0.09);
    depth.gain.value = lp.frequency.value * 0.45;
    lfo.connect(depth).connect(lp.frequency);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(this.pads);
    const oscs: OscillatorNode[] = [lfo];
    for (const [type, cents, lvl, oct] of PAD_TONES[m.padTone] ?? PAD_TONES.warm) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * 2 ** oct;
      o.detune.value = cents + rand(-2, 2);
      const og = c.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lp);
      oscs.push(o);
    }
    for (const o of oscs) { o.start(t); o.stop(stopAt); }
    oscs[1].onended = () => { for (const n of [lfo, depth, lp, g, p, ...oscs]) n.disconnect(); };
    return g;
  }

  /** The chord's root, low and round: a sine with its octave above so small speakers still hear it. */
  private bass(f: number, t: number, end: number, release: number, swell: number, level: number): GainNode {
    const c = this.c, peak = BASS_PEAK * level;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell * 1.3);
    g.gain.setValueAtTime(peak, Math.max(t + swell * 1.3, end));
    g.gain.linearRampToValueAtTime(0, Math.max(t + swell * 1.3, end) + release);
    g.connect(this.pads);
    const stopAt = Math.max(t + swell * 1.3, end) + release + 0.1;
    let left = 2;
    for (const [fr, lvl] of [[f, 1], [f * 2, 0.35]]) {
      const o = c.createOscillator();
      o.frequency.value = fr;
      const og = c.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(stopAt);
      o.onended = () => { o.disconnect(); og.disconnect(); if (--left === 0) g.disconnect(); };
    }
    return g;
  }

  /** Queue a single bell or a short phrase at `t`; returns the gap to the next one. */
  private bells(t: number): number {
    const m = this.mood();
    const lo = Math.max(0.2, fin(m.bellGapMin, 3));
    const gap = () => rand(lo, Math.max(lo, fin(m.bellGapMax, lo)));
    const ch = this.sounding(t);
    if (!ch || !(m.bells > 0)) return gap();
    const r = Math.random();
    if (r < 0.12) return gap() * 1.5; // a rest
    const ph = fin(m.phrases, 0.4);
    const n = Math.random() < ph ? (Math.random() < 0.7 ? 2 : 3) : 1;
    let i = Math.floor(Math.random() * ch.bells.length), at = t;
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const note = ch.bells[Math.max(0, Math.min(ch.bells.length - 1, i))];
      // now and then an octave down, softer
      const low = Math.random() < 0.15;
      this.bell(midiHz(low ? note - 12 : note), at, rand(0.5, 1) * (low ? 0.8 : 1) * (k ? 0.75 : 1) * m.bells, rand(-0.7, 0.7), m);
      i += dir * (1 + Math.floor(Math.random() * 2));
      at += rand(0.35, 0.8);
    }
    return at - t + gap();
  }

  /** An FM bell: a sine carrier with a brighter partial that fades first. */
  private bell(f: number, t: number, vel: number, pan: number, m: MusicDef) {
    const c = this.c, tone = BELL_TONES[m.bellTone] ?? BELL_TONES.glass;
    const dur = rand(...tone.ring);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(BELL_PEAK * vel, t + tone.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.bellBus);
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * tone.ratio;
    const idx = c.createGain();
    idx.gain.setValueAtTime(f * tone.index * Math.min(1, vel + 0.3), t);
    idx.gain.exponentialRampToValueAtTime(f * 0.02, t + tone.mellow);
    mod.connect(idx).connect(car.frequency);
    car.connect(g);
    for (const o of [car, mod]) { o.start(t); o.stop(t + dur + 0.05); }
    car.onended = () => { for (const n of [car, mod, idx, g, p]) n.disconnect(); };
    this.played.bells++;
  }

  /** A heartbeat on the chord's bass, an octave up: a strong beat and a softer one just after. */
  private pulse(t: number): number {
    const m = this.mood(), beat = 60 / Math.max(20, fin(m.pulseRate, 70));
    const ch = this.sounding(t);
    if (!ch || !(m.pulse > 0)) return beat;
    const f = midiHz(ch.bass + 12);
    for (const [dt, v] of [[0, 1], [beat * 0.3, 0.55]]) {
      const at = t + dt, c = this.c;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(f * 6, at);
      lp.frequency.exponentialRampToValueAtTime(f * 1.2, at + 0.25);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(PULSE_PEAK * m.pulse * v, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(lp).connect(g).connect(this.pads);
      o.start(at);
      o.stop(at + 0.5);
      o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
    }
    this.played.pulses++;
    return beat;
  }

  /** A faint, slowly sweeping band of noise: the hiss of distance. 11 s of it, played at a drifting speed, so it never audibly repeats. */
  private air() {
    const c = this.c;
    const n = Math.floor(c.sampleRate * 11);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const drift = c.createOscillator(), dd = c.createGain();
    drift.frequency.value = 0.013;
    dd.gain.value = 0.06;
    drift.connect(dd).connect(src.playbackRate);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2.5;
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 0.021;
    depth.gain.value = 900;
    lfo.connect(depth).connect(bp.frequency);
    const g = c.createGain();
    g.gain.value = 0.5;
    const swell = c.createOscillator(), sd = c.createGain();
    swell.frequency.value = 0.033;
    sd.gain.value = 0.33;
    swell.connect(sd).connect(g.gain);
    src.connect(bp).connect(g).connect(this.airGain);
    for (const s of [src, lfo, swell, drift]) s.start();
    this.nodes.push(src, bp, lfo, depth, g, swell, sd, drift, dd);
  }
}

/** A synthetic stereo hall: decaying noise that darkens as it fades, slightly different per ear. */
function hall(c: AudioContext, secs: number): AudioBuffer {
  const rate = c.sampleRate, n = Math.floor(rate * secs);
  const b = c.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // one-pole low-pass that closes over time: the tail loses its highs
      const a = 0.85 * (1 - u) + 0.04;
      y += a * ((Math.random() * 2 - 1) - y);
      // short fade-in so there's no hard first reflection, then a smooth decay
      d[i] = y * Math.min(1, i / (rate * 0.03)) * Math.pow(1 - u, 2.2) * Math.exp(-u * 2.5);
    }
  }
  return b;
}
