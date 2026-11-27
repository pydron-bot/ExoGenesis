/**
 * Game sound: one AudioContext, a small mixer (category gains → master →
 * limiter), synthesised sounds (./synth.ts) or audio assets named in
 * content/rules/sound.json, a wind bed that follows day and night, and music
 * (moods in content/music, played by ./music.ts; `musicFor()` picks which).
 *
 * Kept deliberately small. Loudness is tuned in content (Sound rules in the
 * editor); the player's own on/off and volume live in localStorage.
 *
 * iOS: the context can only start inside a user gesture, so it is created and
 * resumed from pointerdown/touchend/click/keydown listeners that stay attached
 * (iOS also suspends it again after calls, Siri, backgrounding...). Web Audio
 * is silent while the ringer switch is on silent; nothing can be done about that.
 */
import { SOUND_CATS, SOUNDS, mediaUrl, type AssetDef, type MusicDef, type MusicUse, type SoundCat, type SoundId, type SoundRules } from '../content/defs';
import { RECIPES, STEADY } from './synth';
import { AmbientMusic } from './music';

/** Shortest gap between two plays of the same sound (s). Fights fire hundreds of shots a minute. */
const MIN_GAP: Record<SoundId, number> = {
  turretShot: 0.11, roverShot: 0.09, tankShot: 0.22, bite: 0.14, deathSmall: 0.08, deathBig: 0.25,
  shell: 0.3, arc: 0.12, pdShot: 0.07, rail: 0.25, spit: 0.2, emerge: 0.6, repair: 0.35, shieldHit: 0.15,
  placed: 0.08, online: 0.4, unitReady: 0.4, droneReady: 0.4, packCleared: 1.5, lost: 0.8,
  birth: 1, death: 1.5, research: 1, confirm: 0.15, recycle: 0.2, mission: 1, objective: 0.4, missionDone: 1.5,
  victory: 3, discovery: 1, friend: 1, exhausted: 1, message: 0.5,
  warning: 2, alarm: 3, missionFail: 2, defeat: 3, tap: 0.04, deny: 0.3, select: 0.05, order: 0.08,
  wind: 0, surf: 0, camp: 0, build: 0.12, critter: 0.8,
};
/** Most sounds playing at once (alerts always get through). */
const MAX_VOICES = 14;
const MAX_COMBAT = 10;
/** Random pitch spread (±). */
const PITCH_SPREAD = 0.05;
/** Quieter than this after distance and zoom: don't bother. */
const MIN_GAIN = 0.04;
/** Loudest the surf and a camp's voices get, right on top of them (before the Ambient category). */
const SURF_PEAK = 0.4;
const CAMP_PEAK = 0.22;

const PREF_KEY = 'exo.sound';

/** World FX kinds (skirmish/types FX) → sound. */
const FX_SOUND: Record<number, SoundId | undefined> = {
  0: 'roverShot', 1: 'tankShot', 2: 'bite', 3: 'deathSmall', 4: 'deathBig', 6: 'turretShot',
  7: 'shell', 8: 'arc', 9: 'spit', 10: 'emerge', 11: 'repair', 12: 'pdShot', 13: 'rail', 14: 'shieldHit',
};

/** FX kinds that mean a fight is on (everything but repair beams). */
const FIGHT_FX = new Set([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14]);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export type Spatial = (x: number, z: number) => { gain: number; pan: number } | null;

export class GameAudio {
  ctx: AudioContext | null = null;
  /** Player preference (⋯ menu), remembered. */
  on = true;
  volume = 0.8;
  /**
   * iPhone ring/silent switch: Safari mutes web audio while it's on, unless the page asks for a
   * 'playback' audio session (iOS 16.4+, `navigator.audioSession`). On by default; with sound off or
   * the volume at 0 the session drops back to 'ambient', so it never stops the player's own music.
   */
  throughSilent = true;
  /** The player's own music volume (0 = no music), on top of the rest. */
  musicVolume = 1;
  /** The player's effects volume: everything but music and voices (combat, events, alerts, the interface, ambience). */
  effectsVolume = 1;
  /** The player's volume for spoken lines (src/voice.ts). */
  voiceVolume = 1;
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
  private musicOut!: GainNode;
  private fxOut!: GainNode;
  private voiceOut!: GainNode;
  /** The music playing now: which use and mood, and how to stop it. */
  private music: { use: MusicUse; mood: string; stop: (fade: number) => void; played?: AmbientMusic['played'] } | null = null;
  /** A cinematic's music, held until it ends (`holdMusic`). */
  private held: string | null = null;
  /** In play: music comes in stretches with quiet spells between (s left in this one). */
  private stretch: { play: boolean; left: number } | null = null;
  private night = false;
  /** Wall-clock seconds of recent ticks with fighting, and when tension music may stop. */
  private fights: number[] = [];
  private tenseUntil = -1;
  /** The mood last played for each use (so the next is a different one). */
  private lastMood: Partial<Record<MusicUse, string>> = {};
  /** Beds that loop near things (`beds()`): their level, pan, and for the surf the wave swell and its filter. */
  private loops: Partial<Record<'surf' | 'camp', { gain: GainNode; pan: StereoPannerNode; swell?: GainNode; filter?: BiquadFilterNode }>> = {};
  private nextWave = 0;
  private nextCritter = 4;

  constructor(private rules: SoundRules, private assets: Record<string, AssetDef>, readonly disabled: boolean, private moods: Record<string, MusicDef> = {}) {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null');
      if (p && typeof p.on === 'boolean') this.on = p.on;
      if (p && typeof p.vol === 'number') this.volume = Math.min(1, Math.max(0, p.vol));
      if (p && typeof p.music === 'number') this.musicVolume = Math.min(1, Math.max(0, p.music));
      if (p && typeof p.fx === 'number') this.effectsVolume = Math.min(1, Math.max(0, p.fx));
      if (p && typeof p.voice === 'number') this.voiceVolume = Math.min(1, Math.max(0, p.voice));
      if (p && typeof p.silent === 'boolean') this.throughSilent = p.silent;
    } catch { /* private mode / bad JSON */ }
    this.applySession();
    if (disabled) return;
    if (this.on) this.tryAutoplay();
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

  /** Whether this browser has an audio session to set (Safari 16.4+): the Options row shows only then. */
  static get hasSession() { return typeof navigator !== 'undefined' && 'audioSession' in navigator; }

  /** Play through the iPhone's silent switch (or not), remembered. */
  setThroughSilent(on: boolean) {
    this.throughSilent = on;
    this.save();
    this.applySession();
  }

  /** The audio session for the current settings (see `throughSilent`); the session type in use, for tests. */
  applySession(): string | null {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (!nav.audioSession) return null;
    const type = this.throughSilent && !this.muted ? 'playback' : 'ambient';
    try { if (nav.audioSession.type !== type) nav.audioSession.type = type; } catch { /* unsupported value: keep the default */ }
    return nav.audioSession.type;
  }

  /**
   * Browsers only let sound start after a tap or key, unless they allow autoplay for the site (Chrome does for
   * sites you use a lot; Firefox when autoplay is allowed). So at load, try: a context that's running (or
   * soon is) is kept, and the title music plays straight away; otherwise it's closed and the first tap makes
   * the context as before (iOS wants it made inside the gesture). The title says to click while it's locked.
   */
  private tryAutoplay() {
    const policy = (navigator as Navigator & { getAutoplayPolicy?: (kind: string) => string }).getAutoplayPolicy?.('audiocontext');
    if (policy === 'disallowed' || policy === 'allowed-muted') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let c: AudioContext;
    try { c = new AC(); } catch { return; }
    const settle = () => {
      if (this.ctx) { if (c !== this.ctx) void c.close().catch(() => {}); return; }
      if (c.state === 'running') { this.ctx = c; this.build(); this.autoplayed = true; }
      else void c.close().catch(() => {});
    };
    if (c.state === 'running' || policy === 'allowed') settle();
    else setTimeout(settle, 300);
  }
  /** Test hook: sound started at load, without a tap. */
  autoplayed = false;

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
    for (let i = 0; i < fx.length; i += 5) if (FIGHT_FX.has(fx[i])) { this.fought(); break; }
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
      // far away (or zoomed out) is duller and more echo than dry sound
      this.play(id, g, s!.pan, Math.max(0, Math.min(1, 1 - s!.gain / 0.75)));
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

  /**
   * Sounds of the place, every frame (all quiet outside play): surf when there's water near the camera
   * focus (`water` 0..1, already lowered for zoom), drones at work at building sites, now and then a call
   * from wildlife in earshot (calm animals in `fauna`, stride 4: x, z, heading, species × 4 + state), and
   * voices from the nearest camp the colony has met. Placed with `spatial`, like the fighting.
   */
  beds(b: { water: number; sites: { x: number; z: number }[]; fauna?: Float32Array; camps: { x: number; z: number }[]; dt: number; spatial: Spatial }) {
    if (!this.live()) return;
    const t = this.ctx!.currentTime;
    // surf: a loop under waves that swell and break every 5–9 s
    const surf = this.quiet ? 0 : SURF_PEAK * Math.min(1, b.water);
    if (surf > 0.002 || this.loops.surf) {
      const s = (this.loops.surf ??= this.makeLoop('surf'));
      s.gain.gain.setTargetAtTime(surf, t, 0.5);
      if (t >= this.nextWave && s.swell && s.filter) {
        const up = rand(1.2, 2.2);
        s.swell.gain.setTargetAtTime(rand(0.85, 1), t, up / 2.5);
        s.swell.gain.setTargetAtTime(0.22, t + up, rand(1.2, 2));
        s.filter.frequency.setTargetAtTime(rand(1700, 2400), t, up / 2.5);
        s.filter.frequency.setTargetAtTime(650, t + up, 1.5);
        this.nextWave = t + rand(5, 9);
      }
    }
    // a camp's voices: the nearest (loudest) one met
    let best: { gain: number; pan: number } | null = null;
    if (!this.quiet) for (const cp of b.camps) { const sp = b.spatial(cp.x, cp.z); if (sp && (!best || sp.gain > best.gain)) best = sp; }
    const camp = best ? CAMP_PEAK * best.gain : 0;
    if (camp > 0.002 || this.loops.camp) {
      const l = (this.loops.camp ??= this.makeLoop('camp'));
      l.gain.gain.setTargetAtTime(camp, t, 0.6);
      if (best) l.pan.pan.setTargetAtTime(best.pan, t, 0.3);
    }
    if (this.quiet) return;
    // drones at work: each site now and then (the sound's own gap keeps a big build from rattling)
    for (const s of b.sites) {
      if (Math.random() > b.dt * 2.5) continue;
      const sp = b.spatial(s.x, s.z);
      if (sp && sp.gain > MIN_GAIN) this.play('build', sp.gain, sp.pan);
    }
    // wildlife: every few seconds, a call from a calm animal in earshot (the loudest of a few tried)
    if ((this.nextCritter -= b.dt) <= 0) {
      this.nextCritter = rand(3, 9);
      const f = b.fauna, n = f ? f.length / 4 : 0;
      let pick: { gain: number; pan: number } | null = null;
      for (let k = 0; k < Math.min(8, n); k++) {
        const i = Math.floor(Math.random() * n) * 4;
        if (f![i + 3] % 4 !== 0) continue; // running or hidden: no calls
        const sp = b.spatial(f![i], f![i + 1]);
        if (sp && (!pick || sp.gain > pick.gain)) pick = sp;
      }
      if (pick && pick.gain > 0.1) this.play('critter', pick.gain, pick.pan);
    }
  }

  /** A looping bed into the Ambient category: an audio file when the sound rules name one, else synthesised. */
  private makeLoop(id: 'surf' | 'camp') {
    const c = this.ctx!;
    const gain = c.createGain();
    gain.gain.value = 0;
    const pan = c.createStereoPanner();
    gain.connect(pan).connect(this.cats.ambient);
    const file = this.buffers.get(id);
    if (file) {
      const src = c.createBufferSource();
      src.buffer = file;
      src.loop = true;
      src.connect(gain);
      src.start();
      return { gain, pan };
    }
    if (id === 'surf') {
      // 5 s of stereo noise, low-passed; the waves move the filter and a swell gain
      const n = c.sampleRate * 5, buf = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); let y = 0; for (let i = 0; i < n; i++) { y = 0.7 * y + 0.3 * (Math.random() * 2 - 1); d[i] = y * 1.6; } }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 120;
      const swell = c.createGain();
      swell.gain.value = 0.22;
      src.connect(hp).connect(filter).connect(swell).connect(gain);
      src.start();
      return { gain, pan, swell, filter };
    }
    // a camp: low, wordless voices on an open fifth, through "oo" formants, breathing slowly
    const vowel = c.createGain();
    for (const [f, q, lv] of [[420, 4, 1], [880, 6, 0.4]]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = c.createGain();
      g.gain.value = lv * 3;
      vowel.connect(bp).connect(g).connect(gain);
    }
    for (const [f, det] of [[110, -6], [165, 4], [220, 9], [110, 7]]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const vib = c.createOscillator(), vd = c.createGain();
      vib.frequency.value = rand(4.5, 5.5);
      vd.gain.value = 9;
      vib.connect(vd).connect(o.detune);
      const og = c.createGain();
      og.gain.value = 0.25;
      o.connect(og).connect(vowel);
      o.start();
      vib.start();
    }
    const breath = c.createOscillator(), bd = c.createGain();
    breath.frequency.value = 0.09;
    bd.gain.value = 0.35;
    breath.connect(bd).connect(vowel.gain);
    breath.start();
    return { gain, pan };
  }

  /** Effects (everything but music and voices), 0..1, remembered. */
  setEffectsVolume(v: number) {
    this.effectsVolume = Math.min(1, Math.max(0, v));
    this.save();
    if (this.ctx) this.fxOut.gain.setTargetAtTime(this.effectsVolume, this.ctx.currentTime, 0.05);
  }
  /** Spoken lines, 0..1, remembered. */
  setVoiceVolume(v: number) {
    this.voiceVolume = Math.min(1, Math.max(0, v));
    this.save();
    if (this.ctx) this.voiceOut.gain.setTargetAtTime(this.voiceVolume, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v: number) {
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.save();
    if (this.ctx) this.musicOut.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
    // at 0, stop it rather than synthesising into silence (`musicFor` starts it again when it comes up)
    if (this.musicVolume <= 0) this.stopMusic(0.3);
  }

  /**
   * Music, every frame. `where`: 'title' on the title screen; 'play' in the
   * game proper; null in cinematics and the landing (music fades out and the
   * stretch clock waits). In play the director picks: tension while there's
   * fighting (and `tensionHold` s after), otherwise day or night music in
   * stretches of `playMin`–`playMax` minutes with `restMin`–`restMax` minutes
   * of only wind between, the first after `firstMusic` s. Changes cross-fade.
   * Nothing starts before the context runs (the first tap).
   */
  musicFor(where: 'title' | 'play' | null, daylight: number, dt: number) {
    // a cinematic's own music: the director waits until it's handed back
    if (this.held) { if (!this.music && this.live() && this.musicVolume > 0) this.startHeld(this.held); return; }
    const r = this.rules, now = performance.now() / 1000;
    let want: MusicUse | null = null;
    if (where === 'title') want = 'title';
    else if (where === 'play') {
      // day / night with a little hysteresis, so dusk doesn't flip it back and forth
      if (daylight < 0.3) this.night = true;
      else if (daylight > 0.5) this.night = false;
      const st = (this.stretch ??= { play: false, left: r.firstMusic });
      if ((st.left -= dt) <= 0) {
        st.play = !st.play || r.restMax <= 0;
        st.left = 60 * (st.play ? rand(r.playMin, r.playMax) : rand(r.restMin, r.restMax));
      }
      want = now < this.tenseUntil ? 'tension' : st.play ? (this.night ? 'night' : 'day') : null;
    }
    if (this.musicVolume <= 0) want = null;
    if (want === (this.music?.use ?? null) || !this.live()) return;
    // cross-fade: quick into a fight, slow out of one
    const fade = want === 'tension' ? 2.5 : this.music?.use === 'tension' ? 8 : 6;
    this.stopMusic(fade);
    if (want) this.startMusic(want, want === 'title' ? 6 : fade);
  }

  /**
   * A cinematic's music (its `music`): a piece from content/music by id, or a use (day, night, tension, title)
   * for one of those, played until `releaseMusic`; the director stands aside meanwhile.
   */
  holdMusic(id: string) {
    this.held = id;
    this.stopMusic(1.5);
    if (this.live() && this.musicVolume > 0) this.startHeld(id);
  }
  /** The cinematic is over: its music fades and the director picks up again. */
  releaseMusic(fade = 3) {
    if (!this.held) return;
    this.held = null;
    this.stopMusic(fade);
  }
  private startHeld(id: string) {
    if (this.moods[id]) { this.playMood(id, () => this.moods[id], 2); return; }
    if ((['day', 'night', 'tension', 'title'] as string[]).includes(id)) this.startMusic(id as MusicUse, 2);
  }

  /** Play a mood now, whatever the director wants (the editor's ▶ Listen). Stops whatever was playing. */
  playMood(id: string, mood: () => MusicDef, fadeIn = 1.5): AmbientMusic | null {
    if (!this.live()) return null;
    this.stopMusic(1.5);
    const m = new AmbientMusic(this.ctx!, this.cats.music, mood, 1, fadeIn);
    this.music = { use: mood().use, mood: id, stop: (f) => m.stop(f), played: m.played };
    return m;
  }

  stopMusic(fade = 4) {
    this.music?.stop(fade);
    this.music = null;
  }

  private startMusic(use: MusicUse, fadeIn: number) {
    const a = use === 'title' && this.rules.titleMusic ? this.assets[this.rules.titleMusic] : undefined;
    const stop = a ? this.clip(a, 1, true, this.cats.music) : null;
    if (stop) { this.music = { use, mood: `file:${a!.file}`, stop }; return; }
    const all = Object.keys(this.moods).filter((id) => this.moods[id].use === use);
    if (!all.length) return;
    // a different piece from last time, when there's a choice
    const ids = all.length > 1 ? all.filter((id) => id !== this.lastMood[use]) : all;
    const id = ids[Math.floor(Math.random() * ids.length)];
    this.lastMood[use] = id;
    const m = new AmbientMusic(this.ctx!, this.cats.music, () => this.moods[id], 1, fadeIn);
    this.music = { use, mood: id, stop: (f) => m.stop(f), played: m.played };
  }

  /** A tick with fighting in it (shots, bites, deaths): enough of them close together and tension music comes in. */
  private fought() {
    const now = performance.now() / 1000;
    if (this.fights.length && now - this.fights[this.fights.length - 1] < 0.3) return;
    this.fights.push(now);
    while (this.fights.length && now - this.fights[0] > 8) this.fights.shift();
    if (this.fights.length >= 3) this.tenseUntil = now + this.rules.tensionHold;
  }

  /** Test hook. */
  stats() {
    return { state: this.state, autoplayed: this.autoplayed, beds: { surf: this.loops.surf?.gain.gain.value ?? 0, camp: this.loops.camp?.gain.gain.value ?? 0 }, on: this.on, volume: this.volume, muted: this.muted, quiet: this.quiet, counts: { ...this.counts }, dropped: this.dropped, voices: this.voices, wind: !!this.wind, musicVolume: this.musicVolume,
      music: this.music ? { use: this.music.use, mood: this.music.mood, ...(this.music.played ?? {}) } : null, held: this.held,
      stretch: this.stretch ? { ...this.stretch } : null, tense: performance.now() / 1000 < this.tenseUntil };
  }

  /**
   * Play a sound now. `gain` 0..1 on top of the mixer, `pan` −1..1; `far` 0..1 (combat): how distant it
   * is, which takes the top end off it and sends more of it to the echo.
   */
  play(id: SoundId, gain = 1, pan = 0, far = 0) {
    if (!this.live()) return;
    const c = this.ctx!, now = c.currentTime;
    const cat = SOUNDS[id].cat;
    if (now - (this.last[id] ?? -1e9) < MIN_GAP[id]) { this.dropped++; return; }
    if (cat !== 'alerts' && (this.voices >= MAX_VOICES || (cat === 'combat' && this.combatVoices >= MAX_COMBAT))) { this.dropped++; return; }
    this.last[id] = now;
    let out: AudioNode = this.cats[cat];
    let pn: StereoPannerNode | null = null;
    if (pan && c.createStereoPanner) {
      pn = c.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan));
      pn.connect(out);
      out = pn;
    }
    let lp: BiquadFilterNode | null = null;
    if (far > 0.05) {
      lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 16000 * Math.pow(1100 / 16000, far);
      lp.connect(out);
      out = lp;
    }
    const g = c.createGain();
    g.gain.value = gain;
    g.connect(out);
    let send: GainNode | null = null;
    if (cat === 'combat' && this.echo) {
      send = c.createGain();
      send.gain.value = 0.18 + 0.5 * far;
      g.connect(send).connect(this.echo);
    }
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
    } else if (id in RECIPES) dur = RECIPES[id as keyof typeof RECIPES](c, g, t, p);
    else return;
    this.voices++;
    if (cat === 'combat') this.combatVoices++;
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    setTimeout(() => {
      this.voices--;
      if (cat === 'combat') this.combatVoices--;
      g.disconnect();
      pn?.disconnect();
      lp?.disconnect();
      send?.disconnect();
    }, (dur + 0.1) * 1000);
  }

  /**
   * Play an audio asset (a cinematic's sound or music cue) straight to the
   * master (or `out`), past the mixer's categories and caps. Music loops. Returns a stopper
   * that fades it out over `fade` seconds; null if sound is off or it isn't audio.
   * A file not loaded yet starts as soon as it is.
   */
  clip(a: AssetDef | undefined, volume = 1, loop = false, out?: AudioNode): ((fade: number) => void) | null {
    if (!a || a.kind !== 'audio' || !this.live()) return null;
    const c = this.ctx!, g = c.createGain();
    g.gain.value = volume;
    g.connect(out ?? this.master);
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

  /**
   * A spoken line (src/voice.ts): an audio file by URL, straight to the master. `radio` puts it through a
   * transmission: band-limited to a radio's range, driven a little, with hiss and crackle under it. A file not
   * loaded yet starts as soon as it is. Returns a stopper (fade seconds); null while sound is off.
   */
  speak(url: string, radio = false, volume = 1): ((fade?: number) => void) | null {
    if (!this.live()) return null;
    const c = this.ctx!, out = c.createGain();
    out.gain.value = volume;
    out.connect(this.voiceOut);
    let src: AudioBufferSourceNode | null = null, hiss: AudioBufferSourceNode | null = null, stopped = false;
    const nodes: AudioNode[] = [out];
    const start = (buf: AudioBuffer) => {
      if (stopped) return;
      src = c.createBufferSource();
      src.buffer = buf;
      if (radio) {
        const hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), mid = c.createBiquadFilter(), drive = c.createWaveShaper();
        hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.8;
        lp.type = 'lowpass'; lp.frequency.value = 2900; lp.Q.value = 0.9;
        mid.type = 'peaking'; mid.frequency.value = 1500; mid.gain.value = 5; mid.Q.value = 1.2;
        const k = 2.2, curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
        drive.curve = curve;
        src.connect(hp).connect(mid).connect(drive).connect(lp).connect(out);
        nodes.push(hp, lp, mid, drive);
        // hiss and crackle: band-passed noise with sparse clicks, a little longer than the line
        const len = Math.ceil((buf.duration + 0.6) * c.sampleRate), nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.05 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.7 : 0);
        const nf = c.createBiquadFilter(), ng = c.createGain();
        nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 0.6;
        ng.gain.value = 0.5;
        hiss = c.createBufferSource();
        hiss.buffer = nb;
        hiss.connect(nf).connect(ng).connect(out);
        nodes.push(nf, ng);
        hiss.start();
        src.start(c.currentTime + 0.25);
      } else {
        src.connect(out);
        src.start();
      }
      this.counts['voice'] = (this.counts['voice'] ?? 0) + 1;
      src.onended = () => { try { hiss?.stop(); } catch { /* already stopped */ } setTimeout(() => nodes.forEach((n) => n.disconnect()), 400); };
    };
    const have = this.clips.get(url);
    if (have instanceof AudioBuffer) start(have);
    else {
      const p = have ?? fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))).then((b) => c.decodeAudioData(b));
      this.clips.set(url, p);
      p.then((buf) => { this.clips.set(url, buf); start(buf); }, (e) => { this.clips.delete(url); console.warn(`voice ${url} failed to load`, e); });
    }
    return (fade = 0.15) => {
      if (stopped) return;
      stopped = true;
      out.gain.setTargetAtTime(0, c.currentTime, Math.max(0.01, fade / 3));
      setTimeout(() => { try { src?.stop(); hiss?.stop(); } catch { /* already stopped */ } nodes.forEach((n) => n.disconnect()); }, (fade + 0.2) * 1000);
    };
  }
  /** Combat's echo: an outdoor slap off hills and a short tail (a convolver on a made-up impulse). */
  private echo: AudioNode | null = null;

  // ---------- internals ----------
  private live() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  /** Where a set piece's own sounds go (the landing's, src/audio/landing.ts): the Events channel, or null while silent. */
  sfxOut(): { c: AudioContext; out: AudioNode } | null {
    return this.live() ? { c: this.ctx!, out: this.cats.events } : null;
  }

  private save() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ on: this.on, vol: this.volume, music: this.musicVolume, fx: this.effectsVolume, voice: this.voiceVolume, silent: this.throughSilent })); } catch { /* private mode */ }
  }

  private applyVolume() {
    this.applySession();
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
    // the player's music volume sits between the Music category and the master
    this.musicOut = c.createGain();
    this.musicOut.gain.value = this.musicVolume;
    this.musicOut.connect(this.master);
    // and the effects and voice volumes, the same way
    this.fxOut = c.createGain();
    this.fxOut.gain.value = this.effectsVolume;
    this.fxOut.connect(this.master);
    this.voiceOut = c.createGain();
    this.voiceOut.gain.value = this.voiceVolume;
    this.voiceOut.connect(this.master);
    for (const k of SOUND_CATS) {
      const g = c.createGain();
      g.gain.value = this.rules[k];
      g.connect(k === 'music' ? this.musicOut : this.fxOut);
      this.cats[k] = g;
    }
    this.applyVolume();
    this.echo = this.makeEcho(c);
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

  /** A stereo impulse: a few discrete slaps (40–260 ms) over a darkening 1.4 s noise tail. */
  private makeEcho(c: AudioContext): AudioNode | null {
    try {
      const len = Math.round(c.sampleRate * 1.4), ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const k = i / len;
          lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * k); // duller as it dies away
          d[i] = lp * Math.pow(1 - k, 3) * 0.5;
        }
        for (const [ms, a] of [[45, 0.5], [110, 0.35], [170, 0.25], [260, 0.18]]) {
          const at = Math.round(((ms + (ch ? 13 : 0)) / 1000) * c.sampleRate);
          for (let j = 0; j < 60 && at + j < len; j++) d[at + j] += (Math.random() * 2 - 1) * a * (1 - j / 60);
        }
      }
      const conv = c.createConvolver();
      conv.buffer = ir;
      const tone = c.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 3500;
      const level = c.createGain();
      level.gain.value = 0.5;
      conv.connect(tone).connect(level).connect(this.cats.combat);
      return conv;
    } catch { return null; }
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
