/**
 * Plays a cinematic (content/cinematics/<id>.json): the clock, the camera
 * through its keys, captions, spoken lines, sound and music cues, letterbox
 * bars and fades. Skippable at any point.
 *
 * A world cinematic plays over the game as it stands (main.ts pauses the game
 * while it runs) and hands the camera back where it found it. The landing adds
 * a set piece (src/landing.ts: the probe's descent), which the camera can look
 * at and which hands over to the normal view at the end.
 *
 * Camera: each channel (focus x/y/z, log distance, pitch, yaw) is a monotone
 * cubic through the keys (src/world/curve.ts), so it never overshoots a key; a
 * key that looks at something moving (the probe) follows it live.
 */
import * as THREE from 'three';
import type { ZoomCamera } from './camera';
import type { CameraKeyDef, CinematicDef } from './content/defs';
import { pchip } from './world/curve';
import { voices } from './voice';
import { E, U, regionDir, regionToWorld } from './world/planet';

/** Something a cinematic animates besides the camera (the landing's probe). */
export interface SetPiece {
  frame(t: number, dt: number, day: number): void;
  /** Where `probe` camera keys look (world space), and its altitude for their pull-back. */
  readonly probe: THREE.Vector3;
  readonly alt: number;
  /** Fill caption placeholders ({alt}, {speed}, {shield}). */
  fill(text: string, t: number): string;
  /** End or skip: clean up and hand over. */
  finish(): void;
}

export interface CineHooks {
  caption(title: string, sub: string): void;
  /** A spoken line (null: none showing). */
  line(l: { name: string; role?: string; color?: string; text: string } | null): void;
  /** 0 = clear, 1 = black. */
  fade(a: number): void;
  /** Start a sound or music cue; returns a stopper (fade-out seconds), if it started. */
  sound(asset: string, volume: number, music: boolean): ((fade: number) => void) | null;
  /** Where a building / story site / camp key looks, on the ground (region x, z); null = not there. */
  target(k: CameraKeyDef): { x: number; z: number } | null;
  /** Where a body in the sky is (world space), for `body` keys; null = not in the sky here. */
  bodyPos?(id: string): THREE.Vector3 | null;
  /** A character's name and colour; {first} filled in. */
  speaker(character?: string, speaker?: string): { name: string; role?: string; color?: string };
  fillText(text: string): string;
  done(): void;
}

export class Cinematic {
  t = 0;
  done = false;
  private lastCaption = '\u0000';
  private lastLine = '\u0000';
  private cue = 0;
  private playing: ((fade: number) => void)[] = [];
  private saved: { fx: number; fz: number; dist: number; targetDist: number; pitch: number; targetPitch: number; yaw: number };
  private keys: CameraKeyDef[];

  constructor(readonly id: string, readonly def: CinematicDef, private cam: ZoomCamera, private hooks: CineHooks, private piece: SetPiece | null = null) {
    const c = cam;
    this.saved = { fx: c.fx, fz: c.fz, dist: c.dist, targetDist: c.targetDist, pitch: c.pitch, targetPitch: c.targetPitch, yaw: c.yaw };
    this.keys = def.camera?.length ? def.camera : [{ at: 0, target: 'site', x: c.fx, z: c.fz, lift: 0, dist: c.targetDist, pitch: c.targetPitch, yaw: c.yaw }];
    c.freePitch = true;
    c.overrideW = 1;
    this.frame(0, 1);
  }

  get length() { return this.def.length; }
  get world() { return !this.piece; }

  update(dt: number, day: number) {
    if (this.done) return;
    this.t += dt;
    if (this.t >= this.length) { this.finish(); return; }
    this.frame(dt, day);
  }

  skip() {
    if (this.done) return;
    this.t = this.length;
    this.finish();
  }

  /** Jump to a moment (the editor's "play from the playhead"): cues before it are skipped, but music already playing then starts. */
  seek(t: number) {
    this.t = Math.max(0, Math.min(this.length - 0.01, t));
    const sounds = this.def.sounds ?? [];
    this.cue = sounds.findIndex((s) => s.at >= this.t);
    if (this.cue < 0) this.cue = sounds.length;
    const music = sounds.slice(0, this.cue).filter((s) => s.music).pop();
    if (music) this.startSound(music);
    this.frame(0, 1);
  }

  private frame(dt: number, day: number) {
    const t = this.t;
    this.piece?.frame(t, dt, day);
    this.direct(t);
    this.captions(t);
    this.lines(t);
    this.sounds(t);
    const d = this.def, len = this.length;
    const fin = d.fadeIn ? 1 - Math.min(1, t / d.fadeIn) : 0;
    const fout = d.fadeOut ? Math.min(1, Math.max(0, (t - (len - d.fadeOut)) / d.fadeOut)) : 0;
    this.hooks.fade(Math.max(fin, fout));
  }

  /** The focus point a key looks at (world space). */
  private focus(k: CameraKeyDef): THREE.Vector3 {
    if (k.target === 'probe' && this.piece) return this.piece.probe.clone().addScaledVector(regionDir(0, 0), k.lift);
    let x = k.x ?? 0, z = k.z ?? 0;
    if (k.target !== 'site' && k.target !== 'probe') {
      const p = this.hooks.target(k);
      if (p) ({ x, z } = p);
    }
    return regionToWorld(x, z, k.lift);
  }

  /**
   * A `body` key: the camera stands at X, Z (Lift up) and looks toward the body, so the focus is Distance along
   * that line and the pitch and yaw are what put the camera back at the standpoint (as camera.ts frames a view:
   * from the focus out along up·sin(pitch) − forward(yaw)·cos(pitch)). Null when the body isn't in the sky.
   */
  private skyLook(k: CameraKeyDef, prevYaw: number): { f: THREE.Vector3; pitch: number; yaw: number } | null {
    const at = k.body ? this.hooks.bodyPos?.(k.body) : null;
    if (!at) return null;
    const stand = regionToWorld(k.x ?? 0, k.z ?? 0, Math.max(2, k.lift));
    const d = at.clone().sub(stand).normalize();
    const up = U, ef = E.clone().addScaledVector(up, -E.dot(up)).normalize(), nf = new THREE.Vector3().crossVectors(up, ef);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -d.dot(up))));
    let yaw = Math.atan2(d.dot(ef), d.dot(nf));
    // the nearest turn to the key before, so the camera doesn't spin the long way round
    while (yaw - prevYaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - prevYaw < -Math.PI) yaw += Math.PI * 2;
    return { f: stand.addScaledVector(d, Math.min(k.dist, 2000)), pitch, yaw };
  }

  private direct(t: number) {
    const keys = this.keys, X = keys.map((k) => k.at);
    const F = keys.map((k) => this.focus(k));
    const P = keys.map((k) => k.pitch), Y = keys.map((k) => k.yaw), D = keys.map((k) => k.dist);
    keys.forEach((k, i) => {
      if (k.target !== 'body') return;
      const s = this.skyLook(k, i ? Y[i - 1] : this.saved.yaw);
      if (!s) return;
      F[i] = s.f; P[i] = s.pitch; Y[i] = s.yaw; D[i] = Math.min(k.dist, 2000);
    });
    const f = new THREE.Vector3(pchip(X, F.map((v) => v.x), t), pchip(X, F.map((v) => v.y), t), pchip(X, F.map((v) => v.z), t));
    const alt = this.piece?.alt ?? 0;
    const ld = pchip(X, keys.map((k, i) => Math.log(D[i] + (k.target === 'probe' ? (k.follow ?? 0) * alt : 0))), t);
    const c = this.cam;
    c.focusOverride.copy(f);
    c.overrideW = 1;
    c.dist = c.targetDist = Math.exp(ld);
    c.pitch = c.targetPitch = pchip(X, P, t);
    c.yaw = pchip(X, Y, t);
  }

  private captions(t: number) {
    let cap: NonNullable<CinematicDef['captions']>[number] | undefined;
    for (const c of this.def.captions ?? []) if (c.at <= t) cap = c;
    const fill = (x: string) => this.hooks.fillText(this.piece ? this.piece.fill(x, t) : x);
    const title = cap ? fill(cap.title) : '', sub = cap?.sub ? fill(cap.sub) : '';
    const key = `${title}\n${sub}`;
    if (key !== this.lastCaption) { this.lastCaption = key; this.hooks.caption(title, sub); }
  }

  private lines(t: number) {
    const ls = this.def.lines ?? [];
    let n = -1;
    for (let i = 0; i < ls.length; i++) if (ls[i].at <= t) n = i;
    const l = n >= 0 ? ls[n] : undefined;
    const until = l ? l.at + (l.for ?? (ls[n + 1] ? ls[n + 1].at - l.at : 5)) : 0;
    const show = l && t < until ? l : undefined;
    const key = show ? `${n}` : '';
    if (key === this.lastLine) return;
    this.lastLine = key;
    // its recording, if it has one, from the moment the subtitle comes up (a line runs on past its subtitle)
    if (show) voices.say(show.character ?? show.speaker, show.text, show.fx);
    this.hooks.line(show ? { ...this.hooks.speaker(show.character, show.speaker), text: this.hooks.fillText(show.text) } : null);
  }

  private sounds(t: number) {
    const ss = this.def.sounds ?? [];
    while (this.cue < ss.length && ss[this.cue].at <= t) this.startSound(ss[this.cue++]);
  }

  private startSound(s: NonNullable<CinematicDef['sounds']>[number]) {
    const stop = this.hooks.sound(s.sound, s.volume ?? 1, !!s.music);
    if (stop && s.music) this.playing.push(stop);
  }

  private finish() {
    this.done = true;
    for (const stop of this.playing.splice(0)) stop(1.2);
    voices.hush(0.6);
    this.hooks.caption('', '');
    this.hooks.line(null);
    this.hooks.fade(0);
    const c = this.cam;
    if (this.piece) this.piece.finish();
    else {
      // a world cinematic hands the camera back where it found it
      Object.assign(c, this.saved);
      c.overrideW = 0;
      c.freePitch = false;
      c.shake = 0;
    }
    this.hooks.done();
  }
}
