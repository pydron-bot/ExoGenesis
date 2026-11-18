/**
 * Game sound: one AudioContext, a small mixer (category gains → master →
 * limiter), synthesised sounds (./synth.ts) or audio assets named in
 * content/rules/sound.json, and a wind bed that follows day and night.
 *
 * Kept deliberately small. Loudness is tuned in content (Sound rules in the
 * editor); the player's own on/off and volume live in localStorage.
 *
 * iOS: the context can only start inside a user gesture, so it is created and
 * resumed from pointerdown/touchend/click/keydown listeners that stay attached
 * (iOS also suspends it again after calls, Siri, backgrounding...). Web Audio
 * is silent while the ringer switch is on silent; nothing can be done about that.
 */
import { SOUND_CATS, SOUNDS, mediaUrl, type AssetDef, type SoundCat, type SoundId, type SoundRules } from '../content/defs';
import { RECIPES, STEADY } from './synth';

/** Shortest gap between two plays of the same sound (s). Fights fire hundreds of shots a minute. */
const MIN_GAP: Record<SoundId, number> = {
  turretShot: 0.11, roverShot: 0.09, tankShot: 0.22, bite: 0.14, deathSmall: 0.08, deathBig: 0.25,
  shell: 0.3, arc: 0.12, pdShot: 0.07, rail: 0.25, spit: 0.2, emerge: 0.6, repair: 0.35,
  placed: 0.08, online: 0.4, unitReady: 0.4, droneReady: 0.4, packCleared: 1.5, lost: 0.8,
  warning: 2, alarm: 3, tap: 0.04, deny: 0.3, wind: 0,
};
/** Most sounds playing at once (alerts always get through). */
const MAX_VOICES = 12;
const MAX_COMBAT = 7;
/** Random pitch spread (±). */
const PITCH_SPREAD = 0.05;
/** Quieter than this after distance and zoom: don't bother. */
const MIN_GAIN = 0.04;

const PREF_KEY = 'exo.sound';

/** World FX kinds (skirmish/types FX) → sound. */
const FX_SOUND: Record<number, SoundId | undefined> = {
  0: 'roverShot', 1: 'tankShot', 2: 'bite', 3: 'deathSmall', 4: 'deathBig', 6: 'turretShot',
  7: 'shell', 8: 'arc', 9: 'spit', 10: 'emerge', 11: 'repair', 12: 'pdShot', 13: 'rail',
};

export type Spatial = (x: number, z: number) => { gain: number; pan: number } | null;

export class GameAudio {
  ctx: AudioContext | null = null;
  /** Player preference (⋯ menu), remembered. */
  on = true;
  volume = 0.8;
  /** No world or event sounds (landing cinematic); the ambient bed keeps going. */
  quiet = false;
  /** Test hook: sounds actually started, by id; and ones dropped by caps or distance. */
  counts: Record<string, number> = {};
  dropped = 0;

  private master!: GainNode;
  private cats = {} as Record<SoundCat, GainNode>;
  private voices = 0;
  private combatVoices = 0;
  private last: Partial<Record<SoundId, number>> = {};
  private buffers = new Map<SoundId, AudioBuffer>();
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; gust: number; gustTo: number } | null = null;
  private lastTick = -1;

  constructor(private rules: SoundRules, private assets: Record<string, AssetDef>, readonly disabled: boolean) {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null');
      if (p && typeof p.on === 'boolean') this.on = p.on;
      if (p && typeof p.vol === 'number') this.volume = Math.min(1, Math.max(0, p.vol));
    } catch { /* private mode / bad JSON */ }
    if (disabled) return;
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend().catch(() => {});
      else if (this.on) void this.ctx.resume().catch(() => {});
    });
  }

  get state() { return this.disabled ? 'disabled' : this.ctx?.state ?? 'locked'; }
  get muted() { return this.disabled || !this.on || this.volume <= 0; }

  /** Create/resume the context. Must run inside a user gesture the first time (iOS). */
  unlock() {
    if (this.disabled || !this.on) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.build();
    }
    const c = this.ctx;
    if (c.state !== 'running') {
      void c.resume().catch(() => {});
      // the classic iOS kick: play one silent sample inside the gesture
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(c.destination);
      s.start(0);
    }
  }

  setOn(on: boolean) {
    this.on = on;
    this.save();
    if (on) this.unlock();
    else if (this.ctx) void this.ctx.suspend().catch(() => {});
    this.applyVolume();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.save();
    this.applyVolume();
  }

  /** Sim event cue (placed, online, warning, alarm...). */
  event(id: SoundId) {
    if (!this.quiet) this.play(id);
  }

  /** World effects from a snapshot; each tick's effects are heard once (snapshots repeat while interpolating). */
  worldFx(fx: Float32Array, tick: number, focusX: number, focusZ: number, spatial: Spatial) {
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    if (this.quiet || !this.live()) return;
    // per kind: the one nearest the camera focus, plus how many there were
    const best = new Map<SoundId, { x: number; z: number; d: number; n: number }>();
    for (let i = 0; i < fx.length; i += 5) {
      const id = FX_SOUND[fx[i]];
      if (!id) continue;
      const x = fx[i + 1], z = fx[i + 2], d = (x - focusX) ** 2 + (z - focusZ) ** 2;
      const b = best.get(id);
      if (!b) best.set(id, { x, z, d, n: 1 });
      else { b.n++; if (d < b.d) Object.assign(b, { x, z, d }); }
    }
    for (const [id, b] of best) {
      const s = spatial(b.x, b.z);
      // a crowd of the same sound is a bit louder, never a wall of noise
      const g = s ? s.gain * Math.min(1.5, 1 + 0.2 * Math.log2(b.n)) : 0;
      if (g < MIN_GAIN) { this.dropped++; continue; }
      this.play(id, g, s!.pan);
    }
  }

  /** Per frame: wind follows daylight (0 night .. 1 day); `air` fades it out as the camera leaves the ground. */
  ambient(daylight: number, air: number, dt: number) {
    if (!this.live()) return;
    if (!this.wind) this.startWind();
    const w = this.wind!, c = this.ctx!;
    // gusts: a slow random walk
    if (Math.random() < dt * 0.4) w.gustTo = 0.55 + Math.random() * 0.6;
    w.gust += (w.gustTo - w.gust) * Math.min(1, dt * 0.5);
    const night = 1 - daylight;
    const t = c.currentTime;
    // day: brighter, breathier; night: lower, a touch more whistle, a little louder
    w.filter.frequency.setTargetAtTime((650 - 330 * night) * (0.8 + 0.4 * w.gust), t, 0.3);
    w.filter.Q.setTargetAtTime(0.7 + 1.6 * night, t, 0.5);
    w.gain.gain.setTargetAtTime(0.5 * (0.85 + 0.25 * night) * w.gust * air, t, 0.4);
  }

  /** Test hook. */
  stats() {
    return { state: this.state, on: this.on, volume: this.volume, muted: this.muted, quiet: this.quiet, counts: { ...this.counts }, dropped: this.dropped, voices: this.voices, wind: !!this.wind };
  }

  /** Play a sound now. `gain` 0..1 on top of the mixer, `pan` −1..1. */
  play(id: SoundId, gain = 1, pan = 0) {
    if (!this.live()) return;
    const c = this.ctx!, now = c.currentTime;
    const cat = SOUNDS[id].cat;
    if (now - (this.last[id] ?? -1e9) < MIN_GAP[id]) { this.dropped++; return; }
    if (cat !== 'alerts' && (this.voices >= MAX_VOICES || (cat === 'combat' && this.combatVoices >= MAX_COMBAT))) { this.dropped++; return; }
    this.last[id] = now;
    let out: AudioNode = this.cats[cat];
    if (pan && c.createStereoPanner) {
      const pn = c.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan));
      pn.connect(out);
      out = pn;
    }
    const g = c.createGain();
    g.gain.value = gain;
    g.connect(out);
    const p = STEADY.has(id) ? 1 : 1 + (Math.random() * 2 - 1) * PITCH_SPREAD;
    const t = now + 0.005;
    let dur: number;
    const buf = this.buffers.get(id);
    if (buf) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = p;
      s.connect(g);
      s.start(t);
      dur = buf.duration / p;
    } else if (id !== 'wind') dur = RECIPES[id](c, g, t, p);
    else return;
    this.voices++;
    if (cat === 'combat') this.combatVoices++;
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    setTimeout(() => {
      this.voices--;
      if (cat === 'combat') this.combatVoices--;
      g.disconnect();
    }, (dur + 0.1) * 1000);
  }

  /**
   * Play an audio asset (a cinematic's sound or music cue) straight to the
   * master, past the mixer's categories and caps. Music loops. Returns a stopper
   * that fades it out over `fade` seconds; null if sound is off or it isn't audio.
   * A file not loaded yet starts as soon as it is.
   */
  clip(a: AssetDef | undefined, volume = 1, loop = false): ((fade: number) => void) | null {
    if (!a || a.kind !== 'audio' || !this.live()) return null;
    const c = this.ctx!, g = c.createGain();
    g.gain.value = volume;
    g.connect(this.master);
    let src: AudioBufferSourceNode | null = null, stopped = false;
    const start = (buf: AudioBuffer) => {
      if (stopped) return;
      src = c.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.connect(g);
      src.start();
      this.counts[`clip:${a.file}`] = (this.counts[`clip:${a.file}`] ?? 0) + 1;
      if (!loop) src.onended = () => g.disconnect();
    };
    const have = this.clips.get(a.file);
    if (have instanceof AudioBuffer) start(have);
    else {
      const p = have ?? fetch(mediaUrl(a)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))).then((b) => c.decodeAudioData(b));
      this.clips.set(a.file, p);
      p.then((buf) => { this.clips.set(a.file, buf); start(buf); }, (e) => { this.clips.delete(a.file); console.warn(`sound ${a.file} failed to load`, e); });
    }
    return (fade: number) => {
      stopped = true;
      const t = c.currentTime;
      g.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 3));
      setTimeout(() => { try { src?.stop(); } catch { /* already stopped */ } g.disconnect(); }, (fade + 0.2) * 1000);
    };
  }
  private clips = new Map<string, AudioBuffer | Promise<AudioBuffer>>();

  // ---------- internals ----------
  private live() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  private save() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ on: this.on, vol: this.volume })); } catch { /* private mode */ }
  }

  private applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.rules.master * this.volume, this.ctx.currentTime, 0.03);
  }

  private build() {
    const c = this.ctx!;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);
    for (const k of SOUND_CATS) {
      const g = c.createGain();
      g.gain.value = this.rules[k];
      g.connect(this.master);
      this.cats[k] = g;
    }
    this.applyVolume();
    // audio files named in the sound rules replace the synthesised sounds once loaded
    for (const id of Object.keys(SOUNDS) as SoundId[]) {
      const a = this.rules[id] ? this.assets[this.rules[id]!] : undefined;
      if (a?.kind !== 'audio') continue;
      fetch(mediaUrl(a))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((b) => c.decodeAudioData(b))
        .then((buf) => {
          this.buffers.set(id, buf);
          if (id === 'wind' && this.wind) { this.wind.src.stop(); this.wind.src.disconnect(); this.wind = null; }
        })
        .catch((e) => console.warn(`sound ${id}: ${a.file} failed to load; using the built-in`, e));
    }
  }

  private startWind() {
    const c = this.ctx!;
    const file = this.buffers.get('wind');
    const src = c.createBufferSource();
    if (file) src.buffer = file;
    else {
      // brown-ish noise loop (integrated white noise) for a soft, low wind
      const n = c.sampleRate * 4, fade = 4000;
      const g = new Float32Array(n + fade);
      let v = 0;
      for (let i = 0; i < g.length; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; g[i] = v * 6; }
      const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      d.set(g.subarray(0, n));
      // the start blends in what would follow the end, so the loop doesn't click
      for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = g[i] * k + g[n + i] * (1 - k); }
      src.buffer = b;
    }
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = file ? 'lowpass' : 'bandpass';
    filter.frequency.value = 500;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.cats.ambient);
    src.start();
    this.wind = { src, filter, gain, gust: 0.8, gustTo: 0.8 };
  }
}
