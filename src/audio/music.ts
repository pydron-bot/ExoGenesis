/**
 * Title music: generative ambient, synthesised live (no files). It never
 * repeats exactly: slow pad chords drift through D Lydian (the raised fourth
 * gives it that open, "out in space" colour), a soft bass holds each chord's
 * root, sparse glassy bells pick out chord tones through a ping-pong echo, and
 * a faint band of filtered noise breathes behind it all. Everything runs into
 * one long synthetic hall reverb.
 *
 * Scheduling: a 200 ms timer queues notes about a second ahead on the audio
 * clock, so it keeps time even when frames stall. While the context is
 * suspended (tab hidden, sound off) the clock stops and nothing piles up.
 *
 * Tuning: chord voicings are MIDI note numbers (60 = middle C); gains are peaks
 * before the Music category volume (Rules → Sound in the editor).
 */

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

interface Chord { name: string; pad: number[]; bass: number; bells: number[] }

/** D Lydian (D E F♯ G♯ A B C♯). */
const CHORDS: Chord[] = [
  { name: 'Dmaj9', pad: [50, 57, 61, 64, 66], bass: 38, bells: [78, 80, 81, 85, 88, 90] },
  { name: 'E/D', pad: [50, 59, 64, 68, 71], bass: 38, bells: [76, 80, 83, 86, 88, 90] },
  { name: 'Bm9', pad: [47, 54, 57, 61, 62], bass: 35, bells: [74, 78, 81, 83, 85, 86] },
  { name: 'F♯m7', pad: [54, 57, 61, 64, 69], bass: 42, bells: [78, 81, 85, 88, 90] },
  { name: 'Amaj9', pad: [45, 52, 59, 61, 68], bass: 33, bells: [80, 83, 85, 88, 92] },
];
/** Where each chord can go next (indices into CHORDS); home (Dmaj9) comes round often. */
const NEXT: number[][] = [[1, 2, 3, 4], [0, 0, 2, 4], [0, 1, 4], [0, 2, 1], [0, 0, 1, 2]];

const CHORD_LEN: [number, number] = [14, 22]; // seconds each chord holds
const PAD_ATTACK = 6, PAD_RELEASE = 8; // long swells: chords cross-fade
const PAD_PEAK = 0.045;
const BASS_PEAK = 0.09;
const BELL_PEAK = 0.07;
const FADE_IN = 6;
const LOOKAHEAD = 1.2;

export class AmbientMusic {
  private out: GainNode;
  private pads: GainNode;
  private bellBus: GainNode;
  private nodes: AudioNode[] = [];
  private timer = 0;
  private chord = 0;
  private nextChord = 0;
  private nextBell = 0;
  /** Chords already queued, with their start times (bells follow whichever is sounding). */
  private queue: { t: number; c: Chord }[] = [];
  /** Test hook: how many chords and bells have been queued. */
  played = { chords: 0, bells: 0 };

  constructor(private c: AudioContext, dest: AudioNode, volume = 1) {
    const out = (this.out = c.createGain());
    out.gain.setValueAtTime(0, c.currentTime);
    out.gain.linearRampToValueAtTime(volume, c.currentTime + FADE_IN);
    out.connect(dest);

    // one big hall for everything
    const verb = c.createConvolver();
    verb.buffer = hall(c, 6.5);
    const wet = c.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet).connect(out);

    // pads: mostly dry, plenty of reverb
    this.pads = c.createGain();
    this.pads.connect(out);
    this.pads.connect(verb);

    // bells: a stereo ping-pong echo (dark, so repeats sink back) into the reverb
    this.bellBus = c.createGain();
    const dry = c.createGain();
    dry.gain.value = 0.55;
    this.bellBus.connect(dry).connect(out);
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
    const echo = c.createGain();
    echo.gain.value = 0.35;
    this.bellBus.connect(echo).connect(dl);
    dl.connect(merge, 0, 0);
    dl.connect(dr);
    dr.connect(merge, 0, 1);
    dr.connect(tone).connect(fb).connect(dl);
    merge.connect(out);
    merge.connect(verb);

    this.nodes.push(out, verb, wet, this.pads, this.bellBus, dry, send, dl, dr, fb, tone, merge, echo);
    this.air();

    const t = c.currentTime + 0.1;
    this.nextChord = t;
    this.nextBell = t + rand(3, 5);
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

  private tick() {
    const ahead = this.c.currentTime + LOOKAHEAD;
    while (this.nextChord < ahead) {
      const len = rand(...CHORD_LEN);
      this.playChord(this.nextChord, len);
      this.nextChord += len;
    }
    while (this.nextBell < ahead) {
      this.nextBell += this.bells(this.nextBell);
    }
    while (this.queue.length > 2 && this.queue[1].t < this.c.currentTime) this.queue.shift();
  }

  private playChord(t: number, len: number) {
    if (this.played.chords > 0) this.chord = pick(NEXT[this.chord]);
    const ch = CHORDS[this.chord];
    this.queue.push({ t, c: ch });
    this.played.chords++;
    const end = t + len + PAD_RELEASE;
    ch.pad.forEach((m, i) => this.padVoice(hz(m), t + i * rand(0.2, 0.9), end, (i / (ch.pad.length - 1)) * 1.2 - 0.6));
    this.bass(hz(ch.bass), t, end);
  }

  /** One pad note: two detuned saws and a triangle, softened by a slowly breathing low-pass. */
  private padVoice(f: number, t: number, end: number, pan: number) {
    const c = this.c;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(PAD_PEAK, t + PAD_ATTACK);
    g.gain.setValueAtTime(PAD_PEAK, end - PAD_RELEASE);
    g.gain.linearRampToValueAtTime(0, end);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.value = Math.min(1400, 380 + f * 0.9);
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = rand(0.03, 0.09);
    depth.gain.value = lp.frequency.value * 0.45;
    lfo.connect(depth).connect(lp.frequency);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    lp.connect(g).connect(p).connect(this.pads);
    const oscs = [lfo];
    for (const [type, cents, lvl] of [['sawtooth', -7, 0.5], ['sawtooth', 6, 0.5], ['triangle', 0, 0.9]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = cents + rand(-2, 2);
      const og = c.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lp);
      oscs.push(o);
    }
    for (const o of oscs) { o.start(t); o.stop(end + 0.1); }
    oscs[1].onended = () => { for (const n of [lfo, depth, lp, g, p, ...oscs]) n.disconnect(); };
  }

  /** The chord's root, low and round: a sine with its octave above so small speakers still hear it. */
  private bass(f: number, t: number, end: number) {
    const c = this.c;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(BASS_PEAK, t + PAD_ATTACK + 2);
    g.gain.setValueAtTime(BASS_PEAK, end - PAD_RELEASE);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(this.pads);
    const os = [[f, 1], [f * 2, 0.35]].map(([fr, lvl]) => {
      const o = c.createOscillator();
      o.frequency.value = fr;
      const og = c.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(end + 0.1);
      o.onended = () => { o.disconnect(); og.disconnect(); };
      return o;
    });
    os[0].addEventListener('ended', () => g.disconnect());
  }

  /** Queue a single bell or a short phrase at `t`; returns the gap to the next one. */
  private bells(t: number): number {
    const ch = [...this.queue].reverse().find((q) => q.t <= t)?.c ?? CHORDS[this.chord];
    const r = Math.random();
    if (r < 0.12) return rand(6, 10); // a rest
    const n = r < 0.6 ? 1 : r < 0.88 ? 2 : 3;
    let i = Math.floor(Math.random() * ch.bells.length), at = t;
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const m = ch.bells[Math.max(0, Math.min(ch.bells.length - 1, i))];
      // now and then an octave down, softer
      const low = Math.random() < 0.15;
      this.bell(hz(low ? m - 12 : m), at, rand(0.5, 1) * (low ? 0.8 : 1) * (k ? 0.75 : 1), rand(-0.7, 0.7));
      i += dir * (1 + Math.floor(Math.random() * 2));
      at += rand(0.35, 0.8);
    }
    return at - t + rand(2.5, 7);
  }

  /** Glassy FM bell: a sine carrier whose bright, slightly inharmonic shimmer fades first. */
  private bell(f: number, t: number, vel: number, pan: number) {
    const c = this.c;
    const dur = rand(4, 6.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(BELL_PEAK * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.bellBus);
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * 3.507;
    const idx = c.createGain();
    idx.gain.setValueAtTime(f * 1.6 * vel, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.02, t + 1.6);
    mod.connect(idx).connect(car.frequency);
    car.connect(g);
    for (const o of [car, mod]) { o.start(t); o.stop(t + dur + 0.05); }
    car.onended = () => { for (const n of [car, mod, idx, g, p]) n.disconnect(); };
    this.played.bells++;
  }

  /** A faint, slowly sweeping band of noise: the hiss of distance. */
  private air() {
    const c = this.c;
    const n = c.sampleRate * 3;
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2.5;
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 0.021;
    depth.gain.value = 900;
    lfo.connect(depth).connect(bp.frequency);
    const g = c.createGain();
    g.gain.value = 0.012;
    const swell = c.createOscillator(), sd = c.createGain();
    swell.frequency.value = 0.033;
    sd.gain.value = 0.008;
    swell.connect(sd).connect(g.gain);
    src.connect(bp).connect(g).connect(this.pads);
    src.start();
    lfo.start();
    swell.start();
    this.nodes.push(src, bp, lfo, depth, g, swell, sd);
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
  // keep the wet level sane whatever the length
  let e = 0;
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i += 4) e += d[i] * d[i]; }
  const k = 1 / Math.sqrt(e * 4 / 2) * 0.9;
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
  return b;
}
