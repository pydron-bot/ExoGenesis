/**
 * The landing's sound (v0.80.4): synthesised like the rest (src/audio/synth.ts), driven each frame by the set piece
 * (src/landing.ts) through `update()` and its one-shots. Continuous layers follow the picture: the entry plasma's
 * roar (heat), the retro burn's rumble (throttle, rougher close to the ground) and air rushing past (speed). One-shots:
 * ignition, touchdown, each petal's clank, the dissolve's shimmer, the Core powering up, the hatch and the drone.
 * Everything goes to the Events channel (`GameAudio.sfxOut`), so the volume settings apply; silent until sound is on.
 */
import { boom, click, crackle, hiss, noise, note, tone } from './synth';

type Out = { c: AudioContext; out: AudioNode };

/** A looping noise through a filter, with a gain we steer. */
interface Bed { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }

export class LandingSound {
  private o: Out | null = null;
  private bus: GainNode | null = null;
  private roar: Bed | null = null;
  private burn: Bed | null = null;
  private rumble: { osc: OscillatorNode; gain: GainNode } | null = null;
  private air: Bed | null = null;
  private shimmer: Bed | null = null;
  private stopped = false;

  constructor(private out: () => Out | null) {}

  /** The sound is on (lazily: the first frame sound is allowed builds the beds). */
  private ready(): Out | null {
    if (this.stopped) return null;
    const o = this.out();
    if (!o) return null;
    if (this.o?.c !== o.c) this.build(o);
    return this.o;
  }

  private bed(c: AudioContext, type: BiquadFilterType, f: number, q: number): Bed {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.bus!);
    src.start(c.currentTime, Math.random() * 0.8);
    return { src, filter, gain };
  }

  private build(o: Out) {
    this.o = o;
    const c = o.c;
    this.bus = c.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(o.out);
    this.roar = this.bed(c, 'lowpass', 700, 0.8);
    this.burn = this.bed(c, 'lowpass', 260, 1.2);
    this.air = this.bed(c, 'bandpass', 900, 0.6);
    this.shimmer = this.bed(c, 'highpass', 5000, 0.7);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 38;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(lp).connect(gain).connect(this.bus);
    osc.start();
    this.rumble = { osc, gain };
  }

  /**
   * Every frame. `heat` entry plasma 0..1, `throttle` retro burn 0..1, `alt` units above the pad, `speed` units/s,
   * `dissolve` how fast the shell is being reclaimed now (0..1).
   */
  update(s: { heat: number; throttle: number; alt: number; speed: number; dissolve: number }) {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime, k = 0.08; // smoothing time constant (s)
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, k);
    // entry: a deep, tearing roar, with a little flutter
    const fl = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.1);
    set(this.roar!.gain.gain, 0.5 * s.heat * fl);
    set(this.roar!.filter.frequency, 380 + 900 * s.heat);
    // the burn: low and heavy, harsher (more top end) as the ground throws it back
    const near = Math.max(0, 1 - s.alt / 120);
    set(this.burn!.gain.gain, 0.55 * s.throttle * (0.9 + 0.1 * Math.random()));
    set(this.burn!.filter.frequency, 180 + 420 * s.throttle + 900 * near * s.throttle);
    set(this.rumble!.gain.gain, 0.22 * s.throttle * (0.6 + 0.4 * near));
    set(this.rumble!.osc.frequency, 34 + 10 * s.throttle + Math.random() * 3);
    // air rushing past: with speed, through the thin upper air to thicker low down
    const rush = Math.min(1, s.speed / 900) * (1 - s.heat * 0.6);
    set(this.air!.gain.gain, 0.12 * rush);
    set(this.air!.filter.frequency, 500 + 1400 * rush);
    // the shell dissolving: a faint, glassy fizz
    set(this.shimmer!.gain.gain, 0.05 * s.dissolve);
  }

  /** The retro thrusters light. */
  ignite() {
    const o = this.ready();
    if (!o) return;
    const t = o.c.currentTime + 0.01;
    boom(o.c, this.bus!, t, 90, 32, 1.2, 0.45, 0.35, 900);
    hiss(o.c, this.bus!, t, 'bandpass', 2400, 400, 0.5, 0.18, 0.8, 0.003);
  }

  /** The probe meets the ground: a heavy thud, gravel thrown out, the shell ringing a little. */
  touchdown() {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime + 0.01;
    boom(c, this.bus!, t, 70, 24, 1.6, 0.62, 0.5, 700, 3);
    click(c, this.bus!, t, 1800, 0.25);
    crackle(c, this.bus!, t + 0.05, 1.4, 38, 0.12, 2600, 1);
    hiss(c, this.bus!, t, 'lowpass', 1600, 200, 2.2, 0.22, 0.7, 0.01); // the dust blast
    // metal settling
    tone(c, this.bus!, t + 0.04, 'triangle', 212, 205, 1.3, 0.07, 0.003);
    tone(c, this.bus!, t + 0.04, 'sine', 341, 338, 1.0, 0.05, 0.003);
    // then the hot nozzles and shell ticking as they cool, in the quiet before the petals open
    for (let i = 0; i < 16; i++) {
      const at = t + 1.2 + Math.pow(Math.random(), 0.8) * 4.5, f = 2200 + Math.random() * 2600;
      tone(c, this.bus!, at, 'sine', f, f * 0.98, 0.05 + Math.random() * 0.05, 0.02 + Math.random() * 0.025, 0.001);
    }
  }

  /** A shell petal lands flat (`i` 0..5: each a little different). */
  petal(i: number) {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime + 0.01, p = 0.92 + (i % 3) * 0.05;
    boom(c, this.bus!, t, 120 * p, 45 * p, 0.45, 0.28, 0.2, 1100, 2);
    click(c, this.bus!, t, 2600, 0.12);
    // a struck plate: a few inharmonic partials, quickly gone
    for (const [f, a, d] of [[180, 0.07, 0.6], [467, 0.045, 0.45], [811, 0.03, 0.3], [1290, 0.018, 0.2]] as const) {
      tone(c, this.bus!, t, 'sine', f * p, f * p * 0.995, d, a, 0.002);
    }
    crackle(c, this.bus!, t + 0.03, 0.5, 10, 0.06, 3000, p);
  }

  /** The Command Core comes up: a rising hum and two chimes. */
  power() {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime + 0.01;
    tone(c, this.bus!, t, 'sawtooth', 55, 110, 1.6, 0.05, 0.4);
    tone(c, this.bus!, t, 'sine', 110, 220, 1.6, 0.09, 0.4);
    note(c, this.bus!, t + 1.1, 659, 0.9, 0.05);
    note(c, this.bus!, t + 1.35, 988, 1.2, 0.05);
  }

  /** The drone bay's door folds down. */
  hatch() {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime + 0.01;
    tone(c, this.bus!, t, 'sawtooth', 140, 95, 1.0, 0.03, 0.08); // servo
    hiss(c, this.bus!, t, 'bandpass', 1800, 900, 0.5, 0.05, 2, 0.02); // seals letting go
    boom(c, this.bus!, t + 1.0, 150, 70, 0.3, 0.14, 0.08, 1200, 1.5); // the ramp lands
  }

  /** The drone spins up and flies out. */
  drone() {
    const o = this.ready();
    if (!o) return;
    const c = o.c, t = c.currentTime + 0.01;
    tone(c, this.bus!, t, 'sawtooth', 90, 260, 1.2, 0.1, 0.3);
    tone(c, this.bus!, t + 0.2, 'square', 180, 520, 1.4, 0.035, 0.4);
    hiss(c, this.bus!, t, 'bandpass', 600, 1500, 2.2, 0.14, 1.5, 0.4);
    // rotors settling into a steady buzz as it flies to its post
    tone(c, this.bus!, t + 1.2, 'sawtooth', 260, 240, 1.8, 0.05, 0.2);
  }

  /** The end (or a skip): everything fades out. */
  stop(fade = 1.2) {
    if (this.stopped) return;
    this.stopped = true;
    const o = this.o, bus = this.bus;
    if (!o || !bus) return;
    const t = o.c.currentTime;
    bus.gain.setTargetAtTime(0, t, fade / 4);
    setTimeout(() => {
      for (const b of [this.roar, this.burn, this.air, this.shimmer]) b?.src.stop();
      this.rumble?.osc.stop();
      bus.disconnect();
    }, (fade + 0.3) * 1000);
  }
}
