/**
 * Music: generative ambient, synthesised live (no files). It never repeats
 * exactly. A mood (content/music/*.json, editor: Rules → Music) gives the
 * chords and how they're played: slow pad chords that drift from one to the
 * next (a random walk that keeps coming home to the first), a soft bass on
 * each chord's root, sparse FM bells picking chord tones through a ping-pong
 * echo, an optional low heartbeat pulse, step-sequenced drums, and a faint band of
 * filtered noise; all into one long synthetic hall reverb. Other styles add: a
 * sequencer arpeggio and bassline (electronic), a lead playing written phrases
 * (melodic), string and choir pads (cinematic), and sliding, detuned, warbling
 * pads with creature-like calls (alien), organ and brass pads, plucked
 * strings and mallets, odd time signatures, chords in order (a progression),
 * sections that bring parts in and out, a room size, and grit and wear on the
 * whole sound.
 *
 * The mood is read through a getter every time something is scheduled, so the
 * editor's ▶ Listen picks up edits as they're made (at the next chord or bell).
 *
 * Scheduling: a 200 ms timer queues notes about a second ahead on the audio
 * clock, so it keeps time even when frames stall. While the context is
 * suspended (tab hidden, sound off) the clock stops and nothing piles up.
 */
import type { MusicChord, MusicDef } from '../content/defs';
import { midiHz, noteMidi, parseNotes } from './notes';
import { HITS, parseSteps } from './drums';
import { noise } from './synth';

/**
 * Where random choices come from: Math.random, or, while a written score is being scheduled, that
 * score's own seeded source for the part being scheduled (see AmbientMusic.run), so it plays the same every time.
 */
let random: () => number = Math.random;
const rand = (a: number, b: number) => a + random() * (b - a);
/** A small seeded random source (mulberry32): the same seed, the same numbers. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A mood number, or `d` while it's blank or half-typed in the editor. */
const fin = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Peak gains at level 1 (before the mood's overall level and the Music volume). */
const PAD_PEAK = 0.045;
const BASS_PEAK = 0.09;
const BELL_PEAK = 0.07;
const PULSE_PEAK = 0.11;
const DRUM_PEAK = 0.35;
const ARP_PEAK = 0.09;
const BASSLINE_PEAK = 0.18;
const LEAD_PEAK = 0.1;
const CALL_PEAK = 0.05;
/** Makeup gain for the choir's vowel filters. */
const CHOIR_GAIN = 3.3;
/** Vowel formants: [Hz, Q, level]. Wide enough to sound smooth rather than nasal. */
const VOWELS: Record<'choir-ah' | 'choir-oo', [number, number, number][]> = {
  'choir-ah': [[780, 3.0, 1], [1180, 3.5, 0.55], [2600, 4.5, 0.18]],
  'choir-oo': [[320, 2.6, 1], [720, 3.2, 0.4], [2200, 4.5, 0.08]],
};
const STEPS_PER_BEAT = { '4ths': 1, '8ths': 2, triplets: 3, '16ths': 4 } as const;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const AIR_PEAK = 0.011;
const LOOKAHEAD = 1.2;

interface Chord { pad: number[]; bass: number; bells: number[] }
/** A queued chord: when it starts, which of the mood's chords, and (with sections) which layers play under it. */
interface Queued { t: number; c: Chord; i: number; on: Set<string> | null; section: number; gains: GainNode[] }
/** A written score's bar, flattened from its sections in the order the form plays them. */
interface ScoreBar { chord: Chord | null; bells?: string; melody?: string; section: number; on: Set<string> | null }

/**
 * A mood's written score as the bars it plays, in order (its form, or the sections as written), or null
 * when it has none. A bar with no chord keeps the one before sounding.
 */
export function scoreBars(m: MusicDef): ScoreBar[] | null {
  const secs = m.score ?? [];
  if (!secs.length) return null;
  const byName = new Map(secs.map((sec, i) => [(sec?.name ?? '').trim().toLowerCase(), i]));
  const form = (m.form ?? '').split(/[\s,]+/).filter(Boolean).map((w) => byName.get(w.toLowerCase())).filter((i): i is number => i !== undefined);
  const out: ScoreBar[] = [];
  for (const i of form.length ? form : secs.map((_, k) => k)) {
    const sec = secs[i];
    const words = (sec?.layers ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const on = words.length ? new Set(words) : null;
    for (const b of sec?.bars ?? []) {
      const chord = b?.chord?.trim() ? chordOf({ notes: b.chord, bass: b.bass ?? '', bells: '' }) : null;
      out.push({ chord: chord && chord.pad.length ? chord : null, bells: b?.bells, melody: b?.melody, section: i, on });
    }
  }
  return out.length ? out : null;
}


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
  strings: [['sawtooth', -13, 0.3, 0], ['sawtooth', -6, 0.3, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 7, 0.3, 0], ['sawtooth', 12, 0.3, 0], ['sawtooth', 3, 0.12, -1]],
  'choir-ah': [['sawtooth', -9, 0.45, 0], ['sawtooth', 0, 0.45, 0], ['sawtooth', 8, 0.45, 0]],
  'choir-oo': [['sawtooth', -9, 0.45, 0], ['sawtooth', 0, 0.45, 0], ['sawtooth', 8, 0.45, 0]],
  // drawbars: the note, its octave, the twelfth and two octaves up
  organ: [['sine', 0, 0.75, 0], ['sine', 1, 0.45, 1], ['sine', -1, 0.3, Math.log2(3)], ['sine', 2, 0.16, 2]],
  brass: [['sawtooth', -6, 0.45, 0], ['sawtooth', 5, 0.45, 0], ['sawtooth', 0, 0.3, -1]],
};
/**
 * Bell tones: FM ratio, brightness at the strike, how fast it mellows (s), ring length (s), attack (s), and
 * extra sine partials [ratio, level, decay s] (mallets and tines). `harp` is a plucked string instead (`pluck()`).
 */
interface BellTone { ratio: number; index: number; mellow: number; ring: [number, number]; attack: number; partials?: [number, number, number][] }
const BELL_TONES: Record<MusicDef['bellTone'], BellTone> = {
  glass: { ratio: 3.507, index: 1.6, mellow: 1.6, ring: [4, 6.5], attack: 0.012 },
  soft: { ratio: 1, index: 0.9, mellow: 1.2, ring: [3, 5], attack: 0.03 },
  metal: { ratio: 1.414, index: 2.6, mellow: 3, ring: [5, 7.5], attack: 0.006 },
  pluck: { ratio: 2, index: 1.3, mellow: 0.18, ring: [0.8, 1.6], attack: 0.004 },
  marimba: { ratio: 1, index: 0, mellow: 0.1, ring: [0.6, 1], attack: 0.002, partials: [[3.93, 0.4, 0.09], [9.8, 0.12, 0.03]] },
  kalimba: { ratio: 1, index: 0, mellow: 0.1, ring: [1.3, 2], attack: 0.002, partials: [[5.4, 0.3, 0.07], [2.01, 0.12, 0.4]] },
  keys: { ratio: 1, index: 1.1, mellow: 0.7, ring: [2.4, 3.6], attack: 0.003, partials: [[14.02, 0.14, 0.05], [3, 0.08, 0.4]] },
  harp: { ratio: 1, index: 0, mellow: 0.1, ring: [2, 3], attack: 0.002 },
  // felt piano: a little hammer brightness that mellows fast, then a few harmonics, the higher ones dying first
  piano: { ratio: 1, index: 0.55, mellow: 0.25, ring: [3.2, 4.5], attack: 0.004, partials: [[2, 0.32, 1.4], [3, 0.14, 0.7], [4.01, 0.07, 0.35], [5.02, 0.035, 0.2]] },
};

/** Plucked-string samples (Karplus–Strong), made once per context and note. */
const PLUCKS = new WeakMap<BaseAudioContext, Map<number, { buf: AudioBuffer; rate: number }>>();
const PLUCK_RATE = 24000;
function pluckBuffer(c: BaseAudioContext, midi: number): { buf: AudioBuffer; rate: number } {
  let cache = PLUCKS.get(c);
  if (!cache) PLUCKS.set(c, (cache = new Map()));
  const hit = cache.get(midi);
  if (hit) return hit;
  const f = midiHz(midi), SR = PLUCK_RATE;
  // the loop is N samples plus half a sample for the averaging filter; playbackRate tunes out the rest
  const N = Math.max(2, Math.floor(SR / f - 0.5)), fl = SR / (N + 0.5);
  const secs = midi < 55 ? 3 : midi < 72 ? 2.2 : 1.5;
  const len = Math.floor(SR * secs);
  const buf = c.createBuffer(1, len, SR);
  const d = buf.getChannelData(0);
  // the pluck: one period of softened noise (a fingertip, not a pick), without DC
  let y = 0, mean = 0;
  for (let i = 0; i <= N; i++) { y += 0.55 * ((random() * 2 - 1) - y); d[i] = y; mean += y; }
  mean /= N + 1;
  for (let i = 0; i <= N; i++) d[i] -= mean;
  // extra loss per pass so it dies away in about `secs`
  const loss = Math.pow(0.001, 1 / (fl * secs * 1.4));
  for (let i = N + 1; i < len; i++) d[i] = loss * 0.5 * (d[i - N] + d[i - N - 1]);
  const tail = Math.floor(SR * 0.05);
  for (let i = 0; i < tail; i++) d[len - 1 - i] *= i / tail;
  const out = { buf, rate: f / fl };
  cache.set(midi, out);
  return out;
}

export class AmbientMusic {
  private out: GainNode;
  private lvl: GainNode;
  private pads: GainNode;
  private bellBus: GainNode;
  private wet: GainNode;
  private echoSend: GainNode;
  private airGain: GainNode;
  /** The whole piece's colour: grit (a waveshaper) and wear (high- and low-pass). */
  private shaper: WaveShaperNode;
  private wearLo: BiquadFilterNode;
  private wearHi: BiquadFilterNode;
  private gritNow = 0;
  private dl: DelayNode;
  private dr: DelayNode;
  private nodes: AudioNode[] = [];
  private timer = 0;
  private chord = -1;
  private nextChord = 0;
  private nextBell = 0;
  private nextPulse = 0;
  /** Drums: the next step's time and its number (each track loops on its own length). */
  private nextStep = 0;
  private step = 0;
  private drumBus: GainNode;
  private arpBus: GainNode;
  private leadBus: GainNode;
  private nextArp = 0;
  private arpN = 0;
  /** The chord the arpeggio is on: it starts its pattern again on each new chord, so it sits in the bar. */
  private arpOn: Queued | null = null;
  private nextCall = 0;
  /** Chords already queued, with their start times (bells and pulse follow whichever is sounding). */
  private queue: Queued[] = [];
  /** Panned drum tracks, one panner each (made on first use; let go with everything else on stop). */
  private drumPans: StereoPannerNode[] = [];
  /** Test and editor hook: what has been queued, and the chord now sounding (index into the mood's chords). */
  played = { chords: 0, bells: 0, pulses: 0, hits: 0, arps: 0, leads: 0, calls: 0, chord: -1, section: -1, drift: false, at: 0 };
  /** Editor hook: the last drum steps queued, [step number, audio time], so a step grid can follow along. */
  private stepLog: [number, number][] = [];
  /** A written score: a seeded random source for each part (null for a free-running mood). */
  private rngs: Record<string, () => number> | null = null;
  /** A written score set to drift afterwards: played through once, now drifting at random over its chords. */
  private drifting = false;
  /** A written score: the chord now held (bars without one keep it) and its voices. */
  private held: { c: Chord; gains: GainNode[] } | null = null;

  constructor(private c: AudioContext, dest: AudioNode, private mood: () => MusicDef, volume = 1, fadeIn = 6) {
    // a written score plays the same every time: each part draws from its own seeded source, so the
    // numbers don't depend on how the browser's timer happens to batch the parts
    if (scoreBars(mood())) {
      const seed = Math.round(fin(mood().seed, 1));
      this.rngs = Object.fromEntries(['setup', 'chord', 'bell', 'pulse', 'drum', 'arp', 'call'].map((k, i) => [k, seeded(seed * 7919 + i * 104729)]));
    }
    const prev = random;
    if (this.rngs) random = this.rngs.setup;
    const out = (this.out = c.createGain());
    out.gain.setValueAtTime(0, c.currentTime);
    out.gain.linearRampToValueAtTime(volume, c.currentTime + fadeIn);
    out.connect(dest);
    // the mood's overall level, live
    const lvl = (this.lvl = c.createGain());
    // then its colour: grit, then wear
    this.shaper = c.createWaveShaper();
    this.shaper.oversample = '2x';
    this.wearLo = c.createBiquadFilter();
    this.wearLo.type = 'highpass';
    this.wearLo.frequency.value = 20;
    this.wearHi = c.createBiquadFilter();
    this.wearHi.type = 'lowpass';
    this.wearHi.frequency.value = 20000;
    this.wearHi.Q.value = 0.9;
    lvl.connect(this.shaper).connect(this.wearLo).connect(this.wearHi).connect(out);

    // one room for everything (its size is set when the music starts), high-passed so the
    // low end never muddies the tail
    const verb = c.createBiquadFilter();
    verb.type = 'highpass';
    verb.frequency.value = 220;
    verb.Q.value = 0.7;
    const hallNode = c.createConvolver();
    hallNode.buffer = hall(c, clamp(fin(mood().room, 6.5), 0.4, 12));
    this.wet = c.createGain();
    verb.connect(hallNode).connect(this.wet).connect(lvl);

    // pads: dry plus a slow stereo chorus (two drifting delays, left and right); the two sends are set so pads
    // come out as loud as they did straight through before the chorus
    this.pads = c.createGain();
    const padDry = c.createGain();
    padDry.gain.value = 0.95;
    this.pads.connect(padDry).connect(lvl);
    padDry.connect(verb);
    const cL = c.createDelay(0.1), cR = c.createDelay(0.1);
    cL.delayTime.value = 0.018;
    cR.delayTime.value = 0.024;
    const cLfoL = c.createOscillator(), cLfoR = c.createOscillator();
    cLfoL.frequency.value = 0.17;
    cLfoR.frequency.value = 0.23;
    const cDepthL = c.createGain(), cDepthR = c.createGain();
    cDepthL.gain.value = 0.004;
    cDepthR.gain.value = 0.004;
    cLfoL.connect(cDepthL).connect(cL.delayTime);
    cLfoR.connect(cDepthR).connect(cR.delayTime);
    const cMerge = c.createChannelMerger(2);
    const cWet = c.createGain();
    cWet.gain.value = 0.8;
    this.pads.connect(cL);
    this.pads.connect(cR);
    cL.connect(cMerge, 0, 0);
    cR.connect(cMerge, 0, 1);
    cMerge.connect(cWet).connect(lvl);
    cWet.connect(verb);
    cLfoL.start();
    cLfoR.start();
    this.nodes.push(hallNode, padDry, cL, cR, cLfoL, cLfoR, cDepthL, cDepthR, cMerge, cWet);

    // bells: a stereo ping-pong echo (dark, so repeats sink back) into the reverb
    this.bellBus = c.createGain();
    const dry = c.createGain();
    dry.gain.value = 0.55;
    this.bellBus.connect(dry).connect(lvl);
    const send = c.createGain();
    send.gain.value = 1.1;
    this.bellBus.connect(send).connect(verb);
    const dl = (this.dl = c.createDelay(2)), dr = (this.dr = c.createDelay(2));
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

    // drums: mostly dry, a little of the hall so they sit in the same space
    this.drumBus = c.createGain();
    this.drumBus.connect(lvl);
    const drumVerb = c.createGain();
    drumVerb.gain.value = 0.3;
    this.drumBus.connect(drumVerb).connect(verb);
    this.nodes.push(this.drumBus, drumVerb);
    // arpeggio and melody: dry, with some hall and some of the echo
    this.arpBus = c.createGain();
    this.leadBus = c.createGain();
    for (const [bus, rv, ec] of [[this.arpBus, 0.35, 0.5], [this.leadBus, 0.55, 0.45]] as const) {
      bus.connect(lvl);
      const r = c.createGain(), e = c.createGain();
      r.gain.value = rv;
      e.gain.value = ec;
      bus.connect(r).connect(verb);
      bus.connect(e).connect(dl);
      this.nodes.push(bus, r, e);
    }

    // air: dry, outside the chorus and the hall
    this.airGain = c.createGain();
    this.airGain.connect(lvl);
    this.nodes.push(this.shaper, this.wearLo, this.wearHi);
    this.nodes.push(out, lvl, verb, this.wet, this.pads, this.bellBus, dry, send, dl, dr, fb, tone, merge, this.echoSend, this.airGain);
    this.air();
    this.levels(true);

    const t = c.currentTime + 0.1;
    this.nextChord = t;
    this.nextBell = t + rand(3, 5);
    // the beat starts with the first chord (chords on the beat change on bar lines)
    this.nextPulse = t;
    this.nextStep = t;
    this.nextArp = t;
    this.nextCall = t + rand(4, 8);
    random = prev;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  /** Run `f` with the part's seeded random source (a written score), or as is. */
  private run<T>(part: string, f: () => T): T {
    // the written part plays the same every time; the drift after it is random, like any free mood
    const r = this.drifting ? undefined : this.rngs?.[part];
    if (!r) return f();
    const prev = random;
    random = r;
    try { return f(); } finally { random = prev; }
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

  /**
   * Move on to the next chord now (the editor's ⏭). The next chord may already be queued (notes go out up
   * to LOOKAHEAD ahead): it's silenced and dropped, as if it never was, and the one sounding fades out.
   */
  skip() {
    const now = this.c.currentTime, t = now + 0.05;
    const later = this.queue.filter((q) => q.t >= t);
    for (const q of later) {
      for (const g of q.gains) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, now); }
    }
    this.queue = this.queue.filter((q) => q.t < t);
    this.played.chords -= later.length;
    const cur = this.queue[this.queue.length - 1];
    if (cur) { this.release(cur.gains, t); this.chord = cur.i; }
    this.nextChord = t;
    this.tick();
  }

  // ---------- internals ----------
  private chords(): Chord[] {
    const m = this.mood();
    if (m.chords?.length || !m.score?.length) return (m.chords ?? []).map(chordOf).filter((c): c is Chord => !!c);
    // a score drifting afterwards: its own chords, each once, in the order they first come
    const seen = new Map<string, Chord>();
    for (const b of scoreBars(m) ?? []) if (b.chord) seen.set(`${b.chord.pad.join(' ')}/${b.chord.bass}`, seen.get(`${b.chord.pad.join(' ')}/${b.chord.bass}`) ?? b.chord);
    return [...seen.values()];
  }

  /** The layers a score plays while it drifts afterwards. */
  private driftOn(m: MusicDef): Set<string> {
    const words = (m.scoreThenLayers ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    return new Set(words.length ? words : ['pad', 'choir', 'bass', 'bells']);
  }

  /** Bus levels from the mood (live: the editor tweaks them while it plays). */
  private levels(now = false) {
    const m = this.mood(), t = this.c.currentTime, k = now ? 0.001 : 0.3;
    this.lvl.gain.setTargetAtTime(fin(m.level, 1), t, k);
    this.wet.gain.setTargetAtTime(1.2 * fin(m.space, 0.6), t, k);
    this.echoSend.gain.setTargetAtTime(fin(m.echo, 0.35), t, k);
    this.airGain.gain.setTargetAtTime(AIR_PEAK * fin(m.air, 0), t, k);
    // echo: free-floating, or a dotted eighth (and a beat and a half on the right) at the tempo
    const beat = 60 / Math.max(20, fin(m.pulseRate, 70));
    const [l, r] = m.echoSync ? [Math.min(1.9, beat * 0.75), Math.min(1.9, beat * 0.75)] : [0.63, 0.95];
    this.dl.delayTime.setTargetAtTime(l, t, now ? 0.001 : 0.5);
    this.dr.delayTime.setTargetAtTime(r, t, now ? 0.001 : 0.5);
    // colour: wear narrows the range (an old radio at 1); grit saturates
    const wear = clamp(fin(m.lofi, 0), 0, 1);
    this.wearHi.frequency.setTargetAtTime(20000 * (1700 / 20000) ** wear, t, k);
    this.wearLo.frequency.setTargetAtTime(20 * (380 / 20) ** wear, t, k);
    const grit = clamp(fin(m.grit, 0), 0, 1);
    if (grit !== this.gritNow) {
      this.gritNow = grit;
      this.shaper.curve = grit > 0 ? saturation(1 + grit * 9) : null;
    }
  }

  private tick() {
    const now = this.c.currentTime, ahead = now + LOOKAHEAD;
    this.levels();
    const m = this.mood(), bars = scoreBars(m);
    while (this.nextChord < ahead) {
      // a score set to drift: once it has played through, it drifts on over its chords (and its bells come back)
      if (bars && !this.drifting && m.scoreThen === 'drift' && this.played.chords >= bars.length) {
        this.drifting = true;
        this.nextBell = this.nextChord + rand(2, 4);
      }
      this.nextChord += this.run('chord', () => (bars && !this.drifting ? this.playBar(this.nextChord, bars) : this.playChord(this.nextChord)));
    }
    this.played.drift = this.drifting;
    // a score writes its bells out bar by bar (playBar)
    while (this.nextBell < ahead) this.nextBell += bars && !this.drifting ? 60 : this.run('bell', () => this.bells(this.nextBell));
    while (this.nextPulse < ahead) this.nextPulse += this.run('pulse', () => this.pulse(this.nextPulse));
    while (this.nextStep < ahead) this.nextStep += this.run('drum', () => this.drumStep(this.nextStep));
    while (this.nextArp < ahead) this.nextArp += this.run('arp', () => this.arpStep(this.nextArp));
    while (this.nextCall < ahead) this.nextCall += this.run('call', () => this.call(this.nextCall));
    while (this.queue.length > 2 && this.queue[1].t < now) this.queue.shift();
    const q = [...this.queue].reverse().find((x) => x.t <= now);
    if (q) { this.played.chord = q.i; this.played.section = q.section; this.played.at = q.t; }
  }

  /** The queued chord sounding at `t`. */
  private at(t: number): Queued | null {
    return [...this.queue].reverse().find((q) => q.t <= t) ?? this.queue[0] ?? null;
  }

  private sounding(t: number): Chord | null {
    return this.at(t)?.c ?? null;
  }

  /** Whether a layer plays at `t` (sections can switch layers off; without sections, all play). */
  private on(layer: string, t: number): boolean {
    const q = this.at(t);
    return !q?.on || q.on.has(layer);
  }

  /** The section the `n`th chord (from 0) falls in: its index and layers, or null without sections. */
  private section(n: number, m: MusicDef): { i: number; on: Set<string> } | null {
    const secs = (m.sections ?? []).map((s, i) => ({ i, len: Math.round(fin(s?.chords, 0)), layers: s?.layers ?? '' })).filter((s) => s.len >= 1);
    const total = secs.reduce((a, s) => a + s.len, 0);
    if (!total) return null;
    let k = n % total;
    for (const s of secs) {
      if (k < s.len) return { i: s.i, on: new Set(s.layers.toLowerCase().split(/[\s,]+/).filter(Boolean)) };
      k -= s.len;
    }
    return null;
  }

  /** Queue the next chord at `t`; returns how long it holds. */
  private playChord(t: number): number {
    const m = this.mood(), all = this.chords();
    const lo = Math.max(1, fin(m.chordMin, 12));
    let len = rand(lo, Math.max(lo, fin(m.chordMax, lo)));
    // anything on the beat (arpeggio, bassline, melody, drums): chords change on bar lines
    const bar = clamp(Math.round(fin(m.barSteps, 16)), 4, 32) / 4 * 60 / Math.max(20, fin(m.pulseRate, 70));
    if (fin(m.arp, 0) > 0 || m.bassline || fin(m.lead, 0) > 0 || (fin(m.drums, 0) > 0 && m.drumTracks?.length)) len = Math.max(1, Math.round(len / bar)) * bar;
    if (!all.length) return len;
    // a random walk that keeps coming home to the first chord
    let i: number;
    if (this.chord < 0) i = 0;
    else if (m.order === 'cycle') i = (this.chord + 1) % all.length;
    else if (this.chord !== 0 && random() < fin(m.homePull, 0.3)) i = 0;
    else if (all.length === 1) i = 0;
    else { do i = Math.floor(random() * all.length); while (i === this.chord); }
    this.chord = i;
    const ch = all[i];
    const sec = this.drifting ? { i: -1, on: this.driftOn(m) } : this.section(this.played.chords, m);
    const on = (layer: string) => !sec || sec.on.has(layer);
    const gains: GainNode[] = [];
    this.queue.push({ t, c: ch, i, on: sec?.on ?? null, section: sec?.i ?? -1, gains });
    this.played.chords++;
    const swell = Math.max(0.02, Math.min(fin(m.swell, 4), len)), release = Math.max(0.05, fin(m.release, 6));
    const end = t + len;
    const stagger = Math.min(0.9, swell / 4);
    if (m.pad > 0 && on('pad')) ch.pad.forEach((n, k) => gains.push(this.padVoice(midiHz(n), t + k * rand(0.2, 1) * stagger, end, release, swell, m, ch.pad.length > 1 ? (k / (ch.pad.length - 1)) * 1.2 - 0.6 : 0)));
    // a choir singing the chord's top notes over the pad
    if (fin(m.choir, 0) > 0 && on('choir')) {
      const top = ch.pad.slice(-3);
      const sing = { ...m, padTone: m.choirVowel === 'oo' ? 'choir-oo' : 'choir-ah', pad: m.choir!, vibrato: Math.max(0.3, fin(m.vibrato, 0)), glide: 0 } as MusicDef;
      top.forEach((n, k) => gains.push(this.padVoice(midiHz(n), t + 0.3 + k * rand(0.2, 0.8) * stagger, end, release, swell * 1.2, sing, top.length > 1 ? (k / (top.length - 1)) * 0.9 - 0.45 : 0)));
    }
    if (m.bass > 0 && on('bass')) gains.push(this.bass(midiHz(ch.bass), t, end, release, swell, m.bass));
    // a section that asks for a crash: a reverse cymbal rising over this chord's last bar, the crash as the section starts
    const next = this.drifting ? null : this.section(this.played.chords, m);
    if (next && next.i !== sec?.i && next.on.has('crash') && fin(m.crash, 0) > 0) {
      const v = DRUM_PEAK * fin(m.crash, 0), at = t + len;
      HITS.swell(this.c, this.drumBus, Math.max(t, at - bar), v, 1, Math.min(bar, len));
      HITS.crash(this.c, this.drumBus, at, v);
      this.played.hits += 2;
    }
    // melody: a phrase at the start of every Nth chord, from the second on
    const every = Math.max(1, fin(m.leadEvery, 2));
    if (fin(m.lead, 0) > 0 && m.melody?.length && this.played.chords >= 2 && (this.played.chords - 2) % every === 0 && on('melody')) {
      // by position, so a tune written to a chord cycle stays lined up with it (even when a section skips it)
      this.phrase(m.melody[Math.floor((this.played.chords - 2) / every) % m.melody.length]?.notes, t + 0.05, m);
    }
    return len;
  }

  /** One bar's length at the mood's tempo and time signature. */
  /** Editor hook: the drum step sounding at audio time `t` (counted from the start), or -1 before the first. */
  stepAt(t: number): number {
    for (let i = this.stepLog.length - 1; i >= 0; i--) if (this.stepLog[i][1] <= t) return this.stepLog[i][0];
    return -1;
  }

  private barLen(m: MusicDef): number {
    return clamp(Math.round(fin(m.barSteps, 16)), 4, 32) / 4 * 60 / Math.max(20, fin(m.pulseRate, 70));
  }

  /**
   * A written score's next bar at `t`; returns its length. A chord sounds from its bar until the next chord
   * or the end of its section (a new section strikes the held chord again, with the new section's layers).
   */
  private playBar(t: number, bars: ScoreBar[]): number {
    const m = this.mood(), bar = this.barLen(m);
    const k = this.played.chords % bars.length, b = bars[k];
    const starts = (j: number) => j === 0 || bars[j].section !== bars[j - 1].section;
    const fresh = !!b.chord || starts(k) || !this.held;
    const ch = b.chord ?? this.held?.c ?? null;
    const on = (layer: string) => !b.on || b.on.has(layer);
    let gains: GainNode[] = fresh ? [] : this.held!.gains;
    if (ch && fresh) {
      // how many bars it holds for
      let n = 1;
      while (n < bars.length && !bars[(k + n) % bars.length].chord && !starts((k + n) % bars.length)) n++;
      const len = n * bar, end = t + len;
      const swell = Math.max(0.02, Math.min(fin(m.swell, 4), len)), release = Math.max(0.05, fin(m.release, 6));
      const stagger = Math.min(0.9, swell / 4);
      if (m.pad > 0 && on('pad')) ch.pad.forEach((nt, j) => gains.push(this.padVoice(midiHz(nt), t + j * rand(0.2, 1) * stagger, end, release, swell, m, ch.pad.length > 1 ? (j / (ch.pad.length - 1)) * 1.2 - 0.6 : 0)));
      if (fin(m.choir, 0) > 0 && on('choir')) {
        const top = ch.pad.slice(-3);
        const sing = { ...m, padTone: m.choirVowel === 'oo' ? 'choir-oo' : 'choir-ah', pad: m.choir!, vibrato: Math.max(0.3, fin(m.vibrato, 0)), glide: 0 } as MusicDef;
        top.forEach((nt, j) => gains.push(this.padVoice(midiHz(nt), t + 0.3 + j * rand(0.2, 0.8) * stagger, end, release, swell * 1.2, sing, top.length > 1 ? (j / (top.length - 1)) * 0.9 - 0.45 : 0)));
      }
      if (m.bass > 0 && on('bass')) gains.push(this.bass(midiHz(ch.bass), t, end, release, swell, m.bass));
      this.held = { c: ch, gains };
    }
    if (ch) this.queue.push({ t, c: ch, i: k, on: b.on, section: b.section, gains });
    this.played.chords++;
    // the bar's written lines
    if (b.bells && m.bells > 0 && on('bells')) this.scoreBells(b.bells, t, m);
    if (b.melody && fin(m.lead, 0) > 0 && on('melody')) this.phrase(b.melody, t + 0.02, m);
    // the next bar starts a section that asks for a crash: a reverse cymbal over this bar, the crash on its downbeat
    const nx = bars[(k + 1) % bars.length];
    if (starts((k + 1) % bars.length) && nx.on?.has('crash') && fin(m.crash, 0) > 0) {
      const v = DRUM_PEAK * fin(m.crash, 0);
      HITS.swell(this.c, this.drumBus, t, v, 1, bar);
      HITS.crash(this.c, this.drumBus, t + bar, v);
      this.played.hits += 2;
    }
    return bar;
  }

  /** A score's bell line from `t`: one token per step (the mood's bell step), a note or . (a rest; - holds, as bells ring anyway). */
  private scoreBells(text: string, t: number, m: MusicDef) {
    const step = 60 / Math.max(20, fin(m.pulseRate, 70)) / STEPS_PER_BEAT[m.bellStep ?? '8ths'];
    for (const nt of parsePhrase(text)) this.bell(midiHz(nt.midi), t + nt.at * step, rand(0.8, 1) * m.bells, rand(-0.6, 0.6), m);
  }

  /** Fade a sounding chord's voices out from `t` (used when skipping ahead), from wherever their swell has got to. */
  private release(gains: GainNode[], t: number) {
    const r = Math.max(0.5, Math.min(3, fin(this.mood().release, 2)));
    for (const g of gains) {
      // hold the level reached at t (Firefox lacks cancelAndHoldAtTime: there a swell still rising stops short)
      if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(t);
      else g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, r / 3);
    }
  }

  /**
   * One pad note: a few oscillators softened by a slowly breathing low-pass (or,
   * for a choir, a bank of vowel filters). Options: vibrato, detune spread, a
   * slide into pitch, and a slow warble.
   */
  private padVoice(f: number, t: number, end: number, release: number, swell: number, m: MusicDef, pan: number): GainNode {
    const c = this.c, tone = m.padTone ?? 'warm';
    const choir = tone === 'choir-ah' || tone === 'choir-oo';
    const peak = PAD_PEAK * m.pad * (choir ? CHOIR_GAIN : tone === 'strings' ? 1.5 : 1);
    // a linear swell in, an exponential fade out (time constant release / 3), stopped 6 of them later (−52 dB)
    const relAt = Math.max(t + swell, end);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell);
    g.gain.setValueAtTime(peak, relAt);
    g.gain.setTargetAtTime(0, relAt, Math.max(0.05, release / 3));
    const stopAt = relAt + Math.max(0.3, release * 2) + 0.1;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    const cut = Math.min(choir ? 2600 : tone === 'organ' ? 9000 : 6000, (380 + f * 0.9) * Math.max(0.1, fin(m.brightness, 1)) * (choir ? 2.2 : tone === 'organ' ? 2.5 : tone === 'brass' ? 1.8 : 1));
    lp.frequency.value = cut;
    if (tone === 'brass') {
      // horns open up as they swell
      lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(Math.max(60, f * 0.8), t);
      lp.frequency.exponentialRampToValueAtTime(cut, t + Math.max(0.08, swell * 0.8));
    }
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = rand(0.03, 0.09);
    depth.gain.value = cut * (choir || tone === 'organ' || tone === 'brass' ? 0.12 : 0.45);
    lfo.connect(depth).connect(lp.frequency);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    const extra: AudioNode[] = [];
    if (choir) {
      // the vowel: parallel band-passes at the formants
      for (const [ff, q, lv] of VOWELS[tone]) {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = ff * rand(0.97, 1.03);
        bp.Q.value = q;
        const bg = c.createGain();
        bg.gain.value = lv;
        lp.connect(bp).connect(bg).connect(g);
        extra.push(bp, bg);
      }
    } else if (tone === 'strings') {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 140;
      lp.connect(hp).connect(g);
      extra.push(hp);
    } else lp.connect(g);
    g.connect(p).connect(this.pads);
    const oscs: OscillatorNode[] = [lfo];
    /** The note's own oscillators: only these take the pitch movement (not the LFOs). */
    const voices: OscillatorNode[] = [];
    // pitch movement shared by the note's oscillators (in cents): vibrato and warble
    const mods: AudioNode[] = [];
    const vib = fin(m.vibrato, 0), wob = fin(m.warble, 0);
    const pitchMods: [number, number][] = [];
    if (vib > 0) pitchMods.push([rand(4.8, 5.8), vib * 22]);
    if (wob > 0) pitchMods.push([rand(0.15, 0.7), wob * 80]);
    const spread = fin(m.detune, 0), glide = fin(m.glide, 0);
    const from = glide > 0 ? 2 ** ((random() < 0.5 ? -1 : 1) * glide * rand(0.6, 1) / 1200) : 1;
    for (const [type, cents, lvl, oct] of PAD_TONES[tone] ?? PAD_TONES.warm) {
      const o = c.createOscillator();
      o.type = type;
      const fo = f * 2 ** oct;
      if (from !== 1) {
        o.frequency.setValueAtTime(fo * from, t);
        o.frequency.exponentialRampToValueAtTime(fo, t + Math.max(0.1, swell * 0.9));
      } else o.frequency.value = fo;
      o.detune.value = cents + rand(-2, 2) + rand(-spread, spread);
      const og = c.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lp);
      oscs.push(o);
      voices.push(o);
      extra.push(og);
    }
    for (const [rate, cents] of pitchMods) {
      const l = c.createOscillator(), d = c.createGain();
      l.frequency.value = rate;
      d.gain.value = cents;
      l.connect(d);
      for (const o of voices) d.connect(o.detune);
      oscs.push(l);
      mods.push(d);
    }
    for (const o of oscs) { o.start(t); o.stop(stopAt); }
    oscs[1].onended = () => { for (const n of [lfo, depth, lp, g, p, ...oscs, ...mods, ...extra]) n.disconnect(); };
    return g;
  }

  /** The chord's root, low and round: a sine with its octave above so small speakers still hear it. */
  private bass(f: number, t: number, end: number, release: number, swell: number, level: number): GainNode {
    const c = this.c, peak = BASS_PEAK * level;
    const relAt = Math.max(t + swell * 1.3, end);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell * 1.3);
    g.gain.setValueAtTime(peak, relAt);
    g.gain.setTargetAtTime(0, relAt, Math.max(0.05, release / 3));
    // dry: the low end stays tight, out of the chorus and the hall
    g.connect(this.lvl);
    const stopAt = relAt + Math.max(0.3, release * 2) + 0.1;
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
    if (!ch || !(m.bells > 0) || !this.on('bells', t)) return gap();
    const r = random();
    if (r < 0.12) return gap() * 1.5; // a rest
    const ph = fin(m.phrases, 0.4);
    const n = random() < ph ? (random() < 0.7 ? 2 : 3) : 1;
    let i = Math.floor(random() * ch.bells.length), at = t;
    const dir = random() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const note = ch.bells[Math.max(0, Math.min(ch.bells.length - 1, i))];
      // now and then an octave down, softer
      const low = random() < 0.15;
      this.bell(midiHz(low ? note - 12 : note), at, rand(0.5, 1) * (low ? 0.8 : 1) * (k ? 0.75 : 1) * m.bells, rand(-0.7, 0.7), m);
      i += dir * (1 + Math.floor(random() * 2));
      at += rand(0.35, 0.8);
    }
    return at - t + gap();
  }

  /** A bell (or mallet, tine or plucked string, by the mood's bell tone). */
  private bell(f: number, t: number, vel: number, pan: number, m: MusicDef) {
    const name = m.bellTone ?? 'glass';
    if (name === 'harp') this.pluck(f, t, BELL_PEAK * vel * 1.6, pan, this.bellBus, 99);
    else this.strike(f, t, BELL_PEAK * vel, Math.min(1, vel + 0.3), pan, this.bellBus, BELL_TONES[name] ?? BELL_TONES.glass);
    this.played.bells++;
  }

  /** An FM strike: a sine carrier with a brighter partial that fades first, plus any extra partials (mallets, tines). */
  private strike(f: number, t: number, peak: number, hard: number, pan: number, bus: AudioNode, tone: BellTone, maxDur = 99) {
    const c = this.c;
    const dur = Math.min(maxDur, rand(...tone.ring));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + tone.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(bus);
    const car = c.createOscillator();
    car.frequency.value = f;
    const nodes: AudioNode[] = [car, g, p];
    const oscs: OscillatorNode[] = [car];
    if (tone.index > 0) {
      const mod = c.createOscillator();
      mod.frequency.value = f * tone.ratio;
      const idx = c.createGain();
      idx.gain.setValueAtTime(f * tone.index * hard, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.02, t + tone.mellow);
      mod.connect(idx).connect(car.frequency);
      oscs.push(mod);
      nodes.push(mod, idx);
    }
    car.connect(g);
    for (const [ratio, lv, decay] of tone.partials ?? []) {
      if (f * ratio > 16000) continue;
      const o = c.createOscillator(), pg = c.createGain();
      o.frequency.value = f * ratio;
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.linearRampToValueAtTime(lv * hard, t + 0.001);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, decay));
      o.connect(pg).connect(g);
      oscs.push(o);
      nodes.push(o, pg);
    }
    for (const o of oscs) { o.start(t); o.stop(t + dur + 0.05); }
    car.onended = () => { for (const n of nodes) n.disconnect(); };
  }

  /** A plucked string at `t`; `damp` s later a finger stops it. */
  private pluck(f: number, t: number, peak: number, pan: number, bus: AudioNode, damp: number) {
    const c = this.c;
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    const { buf, rate } = pluckBuffer(c, midi);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const len = buf.duration / rate;
    const g = c.createGain();
    g.gain.value = peak;
    const end = Math.min(len, damp);
    if (end < len) g.gain.setTargetAtTime(0, t + end, 0.06);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(bus);
    src.start(t);
    src.stop(t + Math.min(len, end + 0.4));
    src.onended = () => { for (const n of [src, g, p]) n.disconnect(); };
  }

  /** A heartbeat on the chord's bass, an octave up: a strong beat and a softer one just after. */
  private pulse(t: number): number {
    const m = this.mood(), beat = 60 / Math.max(20, fin(m.pulseRate, 70));
    const ch = this.sounding(t);
    if (!ch || !(m.pulse > 0) || !this.on('pulse', t)) return beat;
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

  /** Play drum step `this.step` at `t` (every track's hit on it); returns the time to the next step. */
  private drumStep(t: number): number {
    const m = this.mood(), dur = 60 / Math.max(20, fin(m.pulseRate, 70)) / 4;
    const n = this.step++;
    this.stepLog.push([n, t]);
    if (this.stepLog.length > 48) this.stepLog.shift();
    if (m.bassline && fin(m.basslineLevel, 0.7) > 0 && this.on('bassline', t)) this.basslineStep(t, n, dur, m);
    const level = fin(m.drums, 0);
    if (!(level > 0) || !m.drumTracks?.length || this.played.chords <= fin(m.drumsIn, 0) || !this.on('drums', t)) return dur;
    // swing: every other step a little late
    const at = t + (n % 2 ? dur * Math.min(0.5, fin(m.swing, 0)) : 0);
    m.drumTracks.forEach((tr, k) => {
      const hit = HITS[tr?.sound];
      const { steps } = parseSteps(tr?.steps);
      if (!hit || !steps.length) return;
      const v = steps[n % steps.length];
      if (!v) return;
      // a touch of human: velocity and timing vary slightly
      const peak = DRUM_PEAK * level * fin(tr.level, 0.7) * v * rand(0.88, 1.06);
      let out: AudioNode = this.drumBus;
      if (tr.pan) {
        // one panner per track, kept (a timer to let go of a panner per hit fires even while the clock is stopped)
        let p = this.drumPans[k];
        if (!p) {
          p = this.drumPans[k] = this.c.createStereoPanner();
          p.connect(this.drumBus);
          this.nodes.push(p);
        }
        p.pan.setValueAtTime(clamp(tr.pan, -1, 1), at);
        out = p;
      }
      hit(this.c, out, at + rand(0, 0.006), peak, v, dur * clamp(Math.round(fin(m.barSteps, 16)), 4, 32));
      this.played.hits++;
    });
    return dur;
  }

  /** The sequenced bassline's step `n` at `t`: x root, o octave up, 5 fifth, . rest. */
  private basslineStep(t: number, n: number, dur: number, m: MusicDef) {
    const pat = (m.bassline ?? '').replace(/[\s|]/g, '');
    const ch = this.sounding(t);
    if (!pat || !ch) return;
    const k = pat[n % pat.length];
    const off = k === 'x' || k === 'X' ? 0 : k === 'o' || k === 'O' ? 12 : k === '5' ? 7 : null;
    if (off === null) return;
    // the root an octave up if the chord's bass is very low (small speakers)
    let root = ch.bass;
    while (root < 36) root += 12;
    const f = midiHz(root + off), c = this.c;
    const len = dur * 1.7;
    const peak = BASSLINE_PEAK * fin(m.basslineLevel, 0.7) * rand(0.9, 1.05);
    // cellos with the double basses an octave under
    if (m.basslineTone === 'strings') {
      this.bowed(f, t, len, peak * 0.9, rand(-0.15, 0.15), this.drumBus, 0.01, 0, 0.8);
      this.bowed(f / 2, t, len, peak * 0.8, 0, this.drumBus, 0.014, 0, 0.6);
      return;
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(peak * 0.6, t + 0.02, len * 0.4);
    g.gain.setTargetAtTime(0.0001, t + len, 0.03);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(f * 9, t);
    lp.frequency.exponentialRampToValueAtTime(f * 2.2, t + Math.min(0.25, len));
    lp.connect(g).connect(this.drumBus);
    const os = [['sawtooth', 1, 0.6], ['square', 0.5, 0.45]].map(([type, mul, lv]) => {
      const o = c.createOscillator();
      o.type = type as OscillatorType;
      o.frequency.value = f * (mul as number);
      const og = c.createGain();
      og.gain.value = lv as number;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + len + 0.2);
      return [o, og] as const;
    });
    os[0][0].onended = () => { for (const [o, og] of os) { o.disconnect(); og.disconnect(); } lp.disconnect(); g.disconnect(); };
  }

  /** One arpeggio step at `t`; returns the time to the next. */
  private arpStep(t: number): number {
    const m = this.mood();
    const dur = 60 / Math.max(20, fin(m.pulseRate, 70)) / STEPS_PER_BEAT[m.arpRate ?? '16ths'];
    const level = fin(m.arp, 0);
    const q = this.at(t), ch = q?.c;
    if (q?.c !== this.arpOn?.c) { this.arpOn = q; this.arpN = 0; }
    if (!(level > 0) || !ch || !this.on('arp', t)) return dur;
    const shift = 12 * fin(m.arpShift, 1), octs = Math.max(1, Math.min(3, fin(m.arpOctaves, 1)));
    const up: number[] = [];
    for (let o = 0; o < octs; o++) for (const n of ch.pad) up.push(n + shift + 12 * o);
    const mode = m.arpMode ?? 'up';
    const i = this.arpN++;
    let notes: number[];
    if (mode === 'chord') notes = ch.pad.map((n) => n + shift);
    else if (mode === 'random') notes = [up[Math.floor(random() * up.length)]];
    else {
      const seq = mode === 'down' ? [...up].reverse() : mode === 'updown' ? [...up, ...up.slice(1, -1).reverse()] : up;
      notes = [seq[i % seq.length]];
    }
    const gate = dur * Math.max(0.1, Math.min(1, fin(m.arpGate, 0.5)));
    // a little accent on each beat
    const accent = i % STEPS_PER_BEAT[m.arpRate ?? '16ths'] === 0 ? 1 : 0.75;
    for (const n of notes) this.arpNote(midiHz(n), t, gate, ARP_PEAK * level * accent / Math.sqrt(notes.length), m);
    this.played.arps++;
    return dur;
  }

  private arpNote(f: number, t: number, gate: number, peak: number, m: MusicDef) {
    const c = this.c, tone = m.arpTone ?? 'pluck', bright = Math.max(0.2, fin(m.arpBright, 1));
    // acoustic tones: a plucked string (let ring a while past the step) or a mallet
    if (tone === 'string') return this.pluck(f, t, peak * 1.8, rand(-0.3, 0.3), this.arpBus, gate * 2 + 0.15);
    if (tone === 'marimba') return this.strike(f, t, peak * 1.1, Math.min(1, bright), rand(-0.3, 0.3), this.arpBus, BELL_TONES.marimba, Math.max(0.25, gate * 3));
    // pedal down: each note rings well past its step
    if (tone === 'piano') return this.strike(f, t, peak * 1.3, Math.min(1, 0.6 * bright), rand(-0.3, 0.3), this.arpBus, BELL_TONES.piano, Math.max(1.2, gate * 8));
    if (tone === 'bowed') return this.bowed(f, t, gate, peak * 1.6, rand(-0.35, 0.35), this.arpBus, 0.012, 0, bright);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.setTargetAtTime(peak * (tone === 'pluck' ? 0.35 : 0.8), t + 0.01, 0.08);
    g.gain.setTargetAtTime(0.0001, t + gate, 0.04);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = tone === 'pluck' ? 9 : tone === 'saw' ? 4 : 1.5;
    const top = Math.min(16000, f * (tone === 'glass' ? 6 : 10) * bright);
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.6 * bright), t + (tone === 'pluck' ? 0.12 : 0.3));
    const p = c.createStereoPanner();
    p.pan.value = rand(-0.25, 0.25);
    lp.connect(g).connect(p).connect(this.arpBus);
    const shapes: [OscillatorType, number, number][] = tone === 'glass' ? [['sine', 0, 1], ['sine', 1200, 0.15]]
      : tone === 'square' ? [['square', 0, 0.5]] : tone === 'saw' ? [['sawtooth', -6, 0.45], ['sawtooth', 6, 0.45]] : [['sawtooth', 0, 0.6]];
    const os = shapes.map(([type, cents, lv]) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = cents;
      const og = c.createGain();
      og.gain.value = lv;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + gate + 0.3);
      return [o, og] as const;
    });
    os[0][0].onended = () => { for (const [o, og] of os) { o.disconnect(); og.disconnect(); } lp.disconnect(); g.disconnect(); p.disconnect(); };
  }

  /** Play a written phrase from `t`: one token per step, a note, - (hold) or . (rest). */
  private phrase(text: string | undefined, t: number, m: MusicDef) {
    const step = 60 / Math.max(20, fin(m.pulseRate, 70)) / STEPS_PER_BEAT[m.leadStep ?? '8ths'];
    const notes = parsePhrase(text);
    let prev: number | null = null, prevEnd = -1;
    for (const nt of notes) {
      const at = t + nt.at * step, len = nt.steps * step;
      const f = midiHz(nt.midi);
      // glide from the note before when they touch
      this.leadNote(f, at, len, prev !== null && Math.abs(prevEnd - nt.at) < 0.01 ? prev : null, m);
      prev = f;
      prevEnd = nt.at + nt.steps;
    }
    if (notes.length) this.played.leads++;
  }

  /**
   * A bowed string-section note: a few detuned saws (players never quite agree), the scrape of the bow
   * at the start, a body filter, vibrato that comes in on held notes. `len` s, then a short release.
   */
  private bowed(f: number, t: number, len: number, peak: number, pan: number, bus: AudioNode, attack: number, vib: number, bright: number) {
    const c = this.c, end = t + Math.max(attack + 0.02, len), stop = end + 0.25;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    // short notes dig in, then ease off a little
    g.gain.setTargetAtTime(peak * 0.7, t + attack, 0.09);
    g.gain.setTargetAtTime(0.0001, end, 0.06);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    const top = Math.min(9000, f * 7 * bright);
    lp.frequency.setValueAtTime(top * 1.5, t);
    lp.frequency.exponentialRampToValueAtTime(top, t + 0.08);
    // the wooden body: a broad bump, and the low end thinned so sections don't turn to mud
    const body = c.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = Math.min(3000, Math.max(250, f * 2.5));
    body.Q.value = 1.1;
    body.gain.value = 5;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = Math.max(30, f * 0.6);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    lp.connect(body).connect(hp).connect(g).connect(p).connect(bus);
    const nodes: AudioNode[] = [g, lp, body, hp, p];
    // vibrato once the note has settled
    const lfo = c.createOscillator(), vd = c.createGain();
    lfo.frequency.value = rand(5, 6);
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(vib * 18, t + Math.min(len, 0.3) + 0.2);
    lfo.connect(vd);
    lfo.start(t);
    lfo.stop(stop);
    nodes.push(lfo, vd);
    const oscs = [-9, -3, 4, 10].map((cents) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents + rand(-2, 2);
      vd.connect(o.detune);
      const og = c.createGain();
      og.gain.value = 0.28;
      o.connect(og).connect(lp);
      o.start(t + rand(0, 0.008));
      o.stop(stop);
      nodes.push(o, og);
      return o;
    });
    // bow scrape: a breath of noise at the start
    const n = c.createBufferSource();
    n.buffer = noise(c as AudioContext);
    const nb = c.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = Math.min(6000, f * 6);
    nb.Q.value = 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(peak * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nb).connect(ng).connect(g);
    n.start(t, random() * 0.5);
    n.stop(t + 0.06);
    nodes.push(n, nb, ng);
    oscs[0].onended = () => { for (const x of nodes) x.disconnect(); };
  }

  private leadNote(f: number, t: number, len: number, from: number | null, m: MusicDef) {
    const c = this.c, tone = m.leadTone ?? 'flute';
    const peak = LEAD_PEAK * fin(m.lead, 0) * rand(0.92, 1.03);
    // a struck note left to ring (a little past a long one, as if the pedal were down)
    if (tone === 'piano') return this.strike(f, t, peak, 0.6, rand(-0.12, 0.12), this.leadBus, BELL_TONES.piano, Math.max(1.5, len + 1.5));
    if (tone === 'violin') return this.bowed(f, t, len, peak * 1.2, rand(-0.15, 0.15), this.leadBus, 0.07, fin(m.leadVibrato, 0.3), 1.3);
    const attack = tone === 'flute' ? 0.07 : tone === 'glass' ? 0.005 : 0.035;
    const end = t + len, ring = tone === 'glass' ? Math.max(len, 0.6) + 0.8 : len + 0.18;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (tone === 'glass') g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    else {
      g.gain.setTargetAtTime(peak * 0.82, t + attack, 0.15);
      g.gain.setTargetAtTime(0.0001, end, 0.06);
    }
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(12000, f * (tone === 'saw' ? 5 : tone === 'soft' ? 3 : 8));
    lp.Q.value = tone === 'saw' ? 1.5 : 0.7;
    const p = c.createStereoPanner();
    p.pan.value = rand(-0.12, 0.12);
    lp.connect(g).connect(p).connect(this.leadBus);
    const shapes: [OscillatorType, number, number][] = tone === 'flute' ? [['sine', 1, 1], ['triangle', 2, 0.12]]
      : tone === 'soft' ? [['triangle', 1, 0.9], ['sine', 0.5, 0.3]]
      : tone === 'glass' ? [['sine', 1, 1], ['sine', 3, 0.08], ['sine', 4.01, 0.05]]
      : [['sawtooth', 1, 0.45], ['sawtooth', 1, 0.45]];
    // vibrato that comes in once the note has settled
    const vib = fin(m.leadVibrato, 0.3), glide = fin(m.leadGlide, 0);
    const lfo = c.createOscillator(), vd = c.createGain();
    lfo.frequency.value = rand(4.8, 5.6);
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(vib * 30, t + Math.min(len, 0.25) + 0.15);
    lfo.connect(vd);
    const os = shapes.map(([type, mul, lv], k) => {
      const o = c.createOscillator();
      o.type = type;
      if (from && glide > 0) {
        o.frequency.setValueAtTime(from * mul, t);
        o.frequency.exponentialRampToValueAtTime(f * mul, t + Math.min(glide, len * 0.8));
      } else o.frequency.value = f * mul;
      if (tone === 'saw') o.detune.value = k ? 6 : -6;
      vd.connect(o.detune);
      const og = c.createGain();
      og.gain.value = lv;
      o.connect(og).connect(lp);
      return [o, og] as const;
    });
    const nodes: AudioNode[] = [];
    if (tone === 'flute') {
      // breath: a little band-passed noise riding on the note
      const nz = c.createBufferSource();
      nz.buffer = noise(c as AudioContext);
      nz.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 2;
      bp.Q.value = 2;
      const ng = c.createGain();
      ng.gain.value = 0.12;
      nz.connect(bp).connect(ng).connect(lp);
      nz.start(t, random() * 0.5);
      nz.stop(t + ring);
      nodes.push(nz, bp, ng);
    }
    for (const [o] of os) { o.start(t); o.stop(t + ring); }
    lfo.start(t);
    lfo.stop(t + ring);
    os[0][0].onended = () => { for (const n of [...os.flat(), lfo, vd, lp, g, p, ...nodes]) n.disconnect(); };
  }

  /** A creature-like call from somewhere out there: a sliding, warbling cry, sometimes repeated. Returns the gap to the next. */
  private call(t: number): number {
    const m = this.mood(), level = fin(m.calls, 0);
    const lo = Math.max(0.5, fin(m.callGapMin, 4)), gap = rand(lo, Math.max(lo, fin(m.callGapMax, 12)));
    const ch = this.sounding(t);
    if (!(level > 0) || !ch || !this.on('calls', t)) return gap;
    const c = this.c;
    const base = ch.bells[Math.floor(random() * ch.bells.length)] - 12 * Math.floor(rand(0, 2));
    const f = midiHz(base), bend = rand(2, 9) * (random() < 0.5 ? -1 : 1);
    const shape = Math.floor(random() * 3); // 0 rises into the note, 1 falls away from it, 2 trills
    const n = random() < 0.4 ? Math.floor(rand(2, 4)) : 1;
    const pan = rand(-0.85, 0.85);
    let at = t;
    for (let k = 0; k < n; k++) {
      const dur = rand(0.5, 1.6) * (k ? 0.7 : 1);
      const g = c.createGain();
      const peak = CALL_PEAK * level * (k ? 0.7 : 1);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.08);
      g.gain.setTargetAtTime(peak * 0.6, at + 0.1, dur * 0.3);
      g.gain.setTargetAtTime(0.0001, at + dur * 0.8, 0.08);
      const p = c.createStereoPanner();
      p.pan.value = pan;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = f * 4;
      lp.connect(g).connect(p).connect(this.bellBus);
      const trill = c.createOscillator(), td = c.createGain();
      trill.frequency.value = shape === 2 ? rand(9, 16) : rand(5, 8);
      td.gain.value = shape === 2 ? rand(80, 200) : rand(15, 45);
      trill.connect(td);
      const os = [[1, 1], [1.5, 0.25], [2.01, 0.15]].map(([mul, lv]) => {
        const o = c.createOscillator();
        o.type = 'sine';
        const f1 = f * mul, f0 = f1 * 2 ** (bend / 12);
        if (shape === 0) { o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.5); }
        else if (shape === 1) { o.frequency.setValueAtTime(f1, at); o.frequency.exponentialRampToValueAtTime(f0, at + dur); }
        else o.frequency.value = f1;
        td.connect(o.detune);
        const og = c.createGain();
        og.gain.value = lv;
        o.connect(og).connect(lp);
        o.start(at);
        o.stop(at + dur + 0.3);
        return [o, og] as const;
      });
      trill.start(at);
      trill.stop(at + dur + 0.3);
      os[0][0].onended = () => { for (const nd of [...os.flat(), trill, td, lp, g, p]) nd.disconnect(); };
      at += dur * rand(0.6, 1.1);
    }
    this.played.calls++;
    return at - t + gap;
  }

  /** A faint, slowly sweeping band of noise: the hiss of distance. 11 s of it, played at a drifting speed, so it never audibly repeats. */
  private air() {
    const c = this.c;
    let b = AIRS.get(c);
    if (!b) {
      const n = Math.floor(c.sampleRate * 11);
      b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = random() * 2 - 1; }
      AIRS.set(c, b);
    }
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const drift = c.createOscillator(), dd = c.createGain();
    drift.frequency.value = 0.013;
    dd.gain.value = 0.06;
    drift.connect(dd).connect(src.playbackRate);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3800;
    bp.Q.value = 0.7;
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 0.021;
    depth.gain.value = 1200;
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

/** A tanh curve, unity gain for quiet signals, squashing and colouring the loud ones (more with `drive`). */
function saturation(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / drive;
  }
  return curve;
}

/**
 * Buffers made once per context and reused: building a hall takes 15–70 ms (by size) and the air 10 ms, a
 * dropped frame or four right when a fight starts and the music changes. Halls are kept by size (to 0.1 s).
 */
const HALLS = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const AIRS = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A synthetic stereo hall: decaying noise that darkens as it fades, slightly different per ear. */
function hall(c: BaseAudioContext, secs: number): AudioBuffer {
  secs = Math.round(secs * 10) / 10;
  let cache = HALLS.get(c);
  if (!cache) HALLS.set(c, (cache = new Map()));
  const have = cache.get(secs);
  if (have) return have;
  const b = makeHall(c, secs);
  cache.set(secs, b);
  return b;
}

function makeHall(c: BaseAudioContext, secs: number): AudioBuffer {
  const rate = c.sampleRate, n = Math.floor(rate * secs);
  const b = c.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // one-pole low-pass that closes over time: the tail loses its highs
      const a = 0.85 * (1 - u) + 0.04;
      y += a * ((random() * 2 - 1) - y);
      // short fade-in so there's no hard first reflection, then a smooth decay
      d[i] = y * Math.min(1, i / (rate * 0.03)) * Math.pow(1 - u, 2.2) * Math.exp(-u * 2.5);
    }
  }
  return b;
}

/** A melody phrase: tokens of a note name, - (hold the last note) or . (rest); | is ignored. */
export function parsePhrase(text: string | undefined): { midi: number; at: number; steps: number }[] {
  const out: { midi: number; at: number; steps: number }[] = [];
  let i = 0;
  for (const tok of (text ?? '').split(/\s+/).filter((w) => w && w !== '|')) {
    if (tok === '-') { if (out.length && out[out.length - 1].at + out[out.length - 1].steps === i) out[out.length - 1].steps++; }
    else if (tok !== '.') {
      const n = noteMidi(tok);
      if (n !== null) out.push({ midi: n, at: i, steps: 1 });
    }
    i++;
  }
  return out;
}
