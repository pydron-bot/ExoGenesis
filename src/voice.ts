/**
 * Spoken lines (docs/VOICE.md): recordings of story cards and cinematic lines, made offline by
 * tools/voice/lines.mjs. public/media/voice/index.json maps each line's key, a hash of who says it (the
 * character id, else the speaker name) and the line's text as written (before {first} is filled), to its file
 * and length. A line with no recording stays silent; editing a line's text silences it until it is
 * generated again, so a stale take never plays. One voice at a time: a new line cuts the last.
 */
import type { GameAudio } from './audio';
import { mediaUrl } from './content/defs';

/** FNV-1a, 32 bits, as hex: the same in tools/voice/lines.mjs. */
export function voiceKey(who: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${who}\n${text.trim()}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** How a line is voiced: through a radio, or clean. */
export type VoiceFx = 'radio' | 'clean';

class Voices {
  private audio: GameAudio | null = null;
  private index: Record<string, { f: string; s: number }> = {};
  private stop: ((fade?: number) => void) | null = null;
  private loading: Promise<void> | null = null;
  /** Player setting: voices on (default) or off, kept in this browser. */
  on = true;

  attach(audio: GameAudio) {
    this.audio = audio;
    try { this.on = localStorage.getItem('exo.voices') !== '0'; } catch { /* private mode */ }
    this.load();
  }

  setOn(on: boolean) {
    this.on = on;
    try { localStorage.setItem('exo.voices', on ? '1' : '0'); } catch { /* private mode */ }
    if (!on) this.hush();
  }

  load(): Promise<void> {
    this.loading ??= fetch(mediaUrl({ kind: 'voice', file: 'index.json' }), { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => { this.index = j as typeof this.index; }, () => { /* no voices yet */ });
    return this.loading;
  }

  /** The recording of a line, if there is one: its URL and length (s). */
  find(who: string | undefined, text: string | undefined): { url: string; secs: number } | null {
    if (!who || !text) return null;
    const e = this.index[voiceKey(who, text)];
    return e ? { url: mediaUrl({ kind: 'voice', file: e.f }), secs: e.s } : null;
  }

  /** Say a line (cutting the one playing); returns its length in seconds, or 0 if it has no recording. */
  say(who: string | undefined, text: string | undefined, fx: VoiceFx = 'clean'): number {
    this.hush();
    const v = this.on ? this.find(who, text) : null;
    if (!v || !this.audio) return 0;
    this.stop = this.audio.speak(v.url, fx === 'radio');
    return this.stop ? v.secs + (fx === 'radio' ? 0.25 : 0) : 0;
  }

  /** Stop whatever is being said. */
  hush(fade = 0.15) {
    this.stop?.(fade);
    this.stop = null;
  }
}

export const voices = new Voices();
