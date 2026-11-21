/**
 * Editor: ▶ Listen for a music mood (Rules → Music). Plays the draft as it is
 * being edited: numbers and notes are read live, so a change is heard at the
 * next chord or bell (⏭ moves on now). Its own AudioContext, made on the click.
 */
import type { MusicDef, SoundRules } from '../content/defs';
import { AmbientMusic, scoreBars } from '../audio/music';
import { parseNotes } from '../audio/notes';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

export class MusicPanel {
  readonly el: HTMLElement;
  private music: AmbientMusic | null = null;
  private timer = 0;
  private btn: HTMLButtonElement;
  private skip: HTMLButtonElement;
  private now: HTMLElement;
  private chips: HTMLElement;

  constructor(private draft: () => MusicDef, private rules: () => SoundRules | undefined) {
    this.el = document.createElement('div');
    this.el.className = 'story-panel music-panel';
    this.el.innerHTML = `
      <div class="actions"><button class="primary mp-play">▶ Listen</button><button class="mp-skip" disabled title="Next chord now">⏭ Next chord</button><span class="mp-now note"></span></div>
      <div class="mp-chords"></div>
      <div class="note">Plays this mood as you edit it (unsaved changes too): a change is heard from the next chord or bell. In the game it plays at the Music volume from Rules → Sound, and the player's own.</div>`;
    this.btn = this.el.querySelector('.mp-play')!;
    this.skip = this.el.querySelector('.mp-skip')!;
    this.now = this.el.querySelector('.mp-now')!;
    this.chips = this.el.querySelector('.mp-chords')!;
    this.btn.onclick = () => (this.music ? this.stop() : this.play());
    this.skip.onclick = () => this.music?.skip();
    this.refresh();
  }

  private play() {
    if (!ctx) {
      ctx = new AudioContext();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -14;
      lim.ratio.value = 6;
      lim.connect(ctx.destination);
      out = ctx.createGain();
      out.connect(lim);
    }
    void ctx.resume();
    const r = this.rules();
    out!.gain.value = (r?.master ?? 0.8) * (r?.music ?? 0.6);
    this.music = new AmbientMusic(ctx, out!, this.draft, 1, 1.5);
    this.btn.textContent = '■ Stop';
    this.skip.disabled = false;
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  stop() {
    this.music?.stop(1.5);
    this.music = null;
    clearInterval(this.timer);
    this.btn.textContent = '▶ Listen';
    this.skip.disabled = true;
    this.refresh();
  }

  /** Chord chips (the one sounding lit) and what's playing. */
  refresh() {
    const d = this.draft(), at = this.music?.played.chord ?? -1;
    const chords = d.chords ?? [];
    this.chips.replaceChildren(...chords.map((c, i) => {
      const s = document.createElement('span');
      s.className = `mp-chip${i === at ? ' on' : ''}${parseNotes(c?.notes).bad.length || !parseNotes(c?.notes).notes.length ? ' bad' : ''}`;
      s.textContent = `${i === 0 ? '⌂ ' : ''}${c?.notes || '—'}`;
      s.title = i === 0 ? 'Home chord' : `Chord ${i + 1}`;
      return s;
    }));
    const p = this.music?.played, bars = scoreBars(d);
    const where = !p ? '' : bars && p.drift ? `drifting after the score · chord ${p.chord + 1}` : bars ? `bar ${p.chord + 1} of ${bars.length}${p.section >= 0 ? ` · ${d.score?.[p.section]?.name || `section ${p.section + 1}`}` : ''}`
      : `chord ${p.chord + 1} of ${chords.length}${p.section >= 0 ? ` · section ${p.section + 1} of ${d.sections?.length ?? 0}` : ''}`;
    this.now.textContent = p ? `${where} · ${p.bells} bells${p.pulses ? ` · ${p.pulses} beats` : ''}${p.hits ? ` · ${p.hits} drum hits` : ''}${p.arps ? ` · ${p.arps} arp steps` : ''}${p.leads ? ` · ${p.leads} phrases` : ''}${p.calls ? ` · ${p.calls} calls` : ''}` : '';
  }

  dispose() { this.stop(); }
}
