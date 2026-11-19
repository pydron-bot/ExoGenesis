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
 * pads with creature-like calls (alien).
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

const rand = (a: number, b: number) => a + Math.random() * (b - a);
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
/** Makeup gain for the choir's narrow vowel filters, and the strings' many voices. */
const CHOIR_GAIN = 4.5;
/** Vowel formants: [Hz, Q, level]. */
const VOWELS: Record<'choir-ah' | 'choir-oo', [number, number, number][]> = {
  'choir-ah': [[800, 7, 1], [1150, 8, 0.6], [2900, 14, 0.25], [3900, 18, 0.1]],
  'choir-oo': [[330, 5, 1], [700, 7, 0.45], [2500, 12, 0.1]],
};
const STEPS_PER_BEAT = { '4ths': 1, '8ths': 2, triplets: 3, '16ths': 4 } as const;
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
  strings: [['sawtooth', -13, 0.3, 0], ['sawtooth', -6, 0.3, 0], ['sawtooth', 0, 0.3, 0], ['sawtooth', 7, 0.3, 0], ['sawtooth', 12, 0.3, 0], ['sawtooth', 3, 0.12, -1]],
  'choir-ah': [['sawtooth', -9, 0.45, 0], ['sawtooth', 0, 0.45, 0], ['sawtooth', 8, 0.45, 0]],
  'choir-oo': [['sawtooth', -9, 0.45, 0], ['sawtooth', 0, 0.45, 0], ['sawtooth', 8, 0.45, 0]],
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
  /** Drums: the next step's time and its number (each track loops on its own length). */
  private nextStep = 0;
  private step = 0;
  private drumBus: GainNode;
  private arpBus: GainNode;
  private leadBus: GainNode;
  private nextArp = 0;
  private arpN = 0;
  private nextCall = 0;
  private phraseN = 0;
  /** Chords already queued, with their start times (bells and pulse follow whichever is sounding). */
  private queue: { t: number; c: Chord; i: number }[] = [];
  /** The chord being played and when it ends (its pads release then). */
  private chordEnd: { t: number; nodes: GainNode[] } | null = null;
  /** Test and editor hook: what has been queued, and the chord now sounding (index into the mood's chords). */
  played = { chords: 0, bells: 0, pulses: 0, hits: 0, arps: 0, leads: 0, calls: 0, chord: -1 };

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

    this.airGain = c.createGain();
    this.airGain.connect(this.pads);
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
    while (this.nextStep < ahead) this.nextStep += this.drumStep(this.nextStep);
    while (this.nextArp < ahead) this.nextArp += this.arpStep(this.nextArp);
    while (this.nextCall < ahead) this.nextCall += this.call(this.nextCall);
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
    const lo = Math.max(1, fin(m.chordMin, 12));
    let len = rand(lo, Math.max(lo, fin(m.chordMax, lo)));
    // anything on the beat (arpeggio, bassline, melody, drums): chords change on bar lines
    const bar = 4 * 60 / Math.max(20, fin(m.pulseRate, 70));
    if (fin(m.arp, 0) > 0 || m.bassline || fin(m.lead, 0) > 0 || (fin(m.drums, 0) > 0 && m.drumTracks?.length)) len = Math.max(1, Math.round(len / bar)) * bar;
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
    // a choir singing the chord's top notes over the pad
    if (fin(m.choir, 0) > 0) {
      const top = ch.pad.slice(-3);
      const sing = { ...m, padTone: m.choirVowel === 'oo' ? 'choir-oo' : 'choir-ah', pad: m.choir!, vibrato: Math.max(0.3, fin(m.vibrato, 0)), glide: 0 } as MusicDef;
      top.forEach((n, k) => gains.push(this.padVoice(midiHz(n), t + 0.3 + k * rand(0.2, 0.8) * stagger, end, release, swell * 1.2, sing, top.length > 1 ? (k / (top.length - 1)) * 0.9 - 0.45 : 0)));
    }
    if (m.bass > 0) gains.push(this.bass(midiHz(ch.bass), t, end, release, swell, m.bass));
    this.chordEnd = { t: end, nodes: gains };
    // melody: a phrase at the start of every Nth chord, from the second on
    const every = Math.max(1, fin(m.leadEvery, 2));
    if (fin(m.lead, 0) > 0 && m.melody?.length && this.played.chords >= 2 && (this.played.chords - 2) % every === 0) {
      this.phrase(m.melody[this.phraseN++ % m.melody.length]?.notes, t + 0.05, m);
    }
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

  /**
   * One pad note: a few oscillators softened by a slowly breathing low-pass (or,
   * for a choir, a bank of vowel filters). Options: vibrato, detune spread, a
   * slide into pitch, and a slow warble.
   */
  private padVoice(f: number, t: number, end: number, release: number, swell: number, m: MusicDef, pan: number): GainNode {
    const c = this.c, tone = m.padTone ?? 'warm';
    const choir = tone === 'choir-ah' || tone === 'choir-oo';
    const peak = PAD_PEAK * m.pad * (choir ? CHOIR_GAIN : tone === 'strings' ? 1.5 : 1);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + swell);
    g.gain.setValueAtTime(peak, Math.max(t + swell, end));
    g.gain.linearRampToValueAtTime(0, Math.max(t + swell, end) + release);
    const stopAt = Math.max(t + swell, end) + release + 0.1;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.value = Math.min(choir ? 5000 : 6000, (380 + f * 0.9) * Math.max(0.1, fin(m.brightness, 1)) * (choir ? 3 : 1));
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = rand(0.03, 0.09);
    depth.gain.value = lp.frequency.value * (choir ? 0.15 : 0.45);
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
    // pitch movement shared by the note's oscillators (in cents): vibrato and warble
    const mods: AudioNode[] = [];
    const vib = fin(m.vibrato, 0), wob = fin(m.warble, 0);
    const pitchMods: [number, number][] = [];
    if (vib > 0) pitchMods.push([rand(4.8, 5.8), vib * 22]);
    if (wob > 0) pitchMods.push([rand(0.15, 0.7), wob * 80]);
    const spread = fin(m.detune, 0), glide = fin(m.glide, 0);
    const from = glide > 0 ? 2 ** ((Math.random() < 0.5 ? -1 : 1) * glide * rand(0.6, 1) / 1200) : 1;
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
    }
    for (const [rate, cents] of pitchMods) {
      const l = c.createOscillator(), d = c.createGain();
      l.frequency.value = rate;
      d.gain.value = cents;
      l.connect(d);
      for (const o of oscs.slice(1)) d.connect(o.detune);
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

  /** Play drum step `this.step` at `t` (every track's hit on it); returns the time to the next step. */
  private drumStep(t: number): number {
    const m = this.mood(), dur = 60 / Math.max(20, fin(m.pulseRate, 70)) / 4;
    const n = this.step++;
    if (m.bassline && fin(m.basslineLevel, 0.7) > 0) this.basslineStep(t, n, dur, m);
    const level = fin(m.drums, 0);
    if (!(level > 0) || !m.drumTracks?.length || this.played.chords <= fin(m.drumsIn, 0)) return dur;
    // swing: every other step a little late
    const at = t + (n % 2 ? dur * Math.min(0.5, fin(m.swing, 0)) : 0);
    for (const tr of m.drumTracks) {
      const hit = HITS[tr?.sound];
      const { steps } = parseSteps(tr?.steps);
      if (!hit || !steps.length) continue;
      const v = steps[n % steps.length];
      if (!v) continue;
      // a touch of human: velocity and timing vary slightly
      const peak = DRUM_PEAK * level * fin(tr.level, 0.7) * v * rand(0.88, 1.06);
      let out: AudioNode = this.drumBus;
      if (tr.pan) {
        const p = this.c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, tr.pan));
        p.connect(this.drumBus);
        out = p;
        setTimeout(() => p.disconnect(), (at - this.c.currentTime + 2) * 1000);
      }
      hit(this.c, out, at + rand(0, 0.006), peak);
      this.played.hits++;
    }
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
    const g = c.createGain();
    const peak = BASSLINE_PEAK * fin(m.basslineLevel, 0.7) * rand(0.9, 1.05);
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
    const ch = this.sounding(t);
    if (!(level > 0) || !ch) return dur;
    const shift = 12 * fin(m.arpShift, 1), octs = Math.max(1, Math.min(3, fin(m.arpOctaves, 1)));
    const up: number[] = [];
    for (let o = 0; o < octs; o++) for (const n of ch.pad) up.push(n + shift + 12 * o);
    const mode = m.arpMode ?? 'up';
    const i = this.arpN++;
    let notes: number[];
    if (mode === 'chord') notes = ch.pad.map((n) => n + shift);
    else if (mode === 'random') notes = [up[Math.floor(Math.random() * up.length)]];
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

  private leadNote(f: number, t: number, len: number, from: number | null, m: MusicDef) {
    const c = this.c, tone = m.leadTone ?? 'flute';
    const peak = LEAD_PEAK * fin(m.lead, 0) * rand(0.92, 1.03);
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
      nz.start(t, Math.random() * 0.5);
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
    if (!(level > 0) || !ch) return gap;
    const c = this.c;
    const base = ch.bells[Math.floor(Math.random() * ch.bells.length)] - 12 * Math.floor(rand(0, 2));
    const f = midiHz(base), bend = rand(2, 9) * (Math.random() < 0.5 ? -1 : 1);
    const shape = Math.floor(Math.random() * 3); // 0 rises into the note, 1 falls away from it, 2 trills
    const n = Math.random() < 0.4 ? Math.floor(rand(2, 4)) : 1;
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
