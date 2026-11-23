/**
 * Editor: ▶ Listen for a music mood (Rules → Music). Plays the draft as it is
 * being edited: numbers and notes are read live, so a change is heard at the
 * next chord or bell (⏭ moves on now). Its own AudioContext, made on the click.
 * Under it, the visual score editor and step sequencer (score-editor.ts).
 */
import type { MusicDef, SoundRules } from '../content/defs';
import { AmbientMusic, scoreBars } from '../audio/music';
import { HITS } from '../audio/drums';
import { midiHz, parseNotes } from '../audio/notes';
import { ScoreEditor, barSeconds, formSections, starterScore, type Lane } from './score-editor';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

export interface MusicHost {
  /** A small edit (typing): refresh the form's flags and note it for undo. */
  changed(): void;
  /** Rebuild the form's fields from the draft. */
  rerender(): void;
}

export class MusicPanel {
  readonly el: HTMLElement;
  private music: AmbientMusic | null = null;
  private timer = 0;
  private btn: HTMLButtonElement;
  private skip: HTMLButtonElement;
  private now: HTMLElement;
  private chips: HTMLElement;
  private write: HTMLButtonElement;
  private editor: ScoreEditor;
  /** Playing from a place in the form (index into formSections), or looping that one section; null = from the top. */
  private mode: { pos: number; loop: boolean } | null = null;

  constructor(private draft: () => MusicDef, private rules: () => SoundRules | undefined, host: MusicHost) {
    this.el = document.createElement('div');
    this.el.className = 'story-panel music-panel';
    this.el.innerHTML = `
      <div class="actions"><button class="primary mp-play" title="Play or stop (Space)">▶ Listen</button><button class="mp-skip" disabled title="Next chord now">⏭ Next chord</button><button class="mp-write" title="Turn this mood into a written score: its chords in order, to edit bar by bar">✎ Write a score</button><span class="mp-now note"></span></div>
      <div class="mp-chords"></div>
      <div class="note">Plays this mood as you edit it (unsaved changes too): a change is heard from the next chord or bell. In the game it plays at the Music volume from Rules → Sound, and the player's own.</div>`;
    this.btn = this.el.querySelector('.mp-play')!;
    this.skip = this.el.querySelector('.mp-skip')!;
    this.now = this.el.querySelector('.mp-now')!;
    this.chips = this.el.querySelector('.mp-chords')!;
    this.write = this.el.querySelector('.mp-write')!;
    this.btn.onclick = () => this.toggle();
    this.skip.onclick = () => this.music?.skip();
    this.write.onclick = () => {
      if (!confirm('Write this mood out as a score? It will play the same every time, bar by bar, instead of drifting. (Undo takes it back.)')) return;
      this.draft().score = starterScore(this.draft());
      this.draft().form = 'A';
      host.rerender();
    };
    this.editor = new ScoreEditor({
      draft: this.draft,
      changed: () => host.changed(),
      rerender: () => host.rerender(),
      audition: (m, lane) => this.audition(m, lane),
      drum: (s, soft) => { const c = this.ctx(); HITS[s as keyof typeof HITS]?.(c, out!, c.currentTime + 0.01, 0.5, soft ? 0.5 : 1, 2); },
      playFrom: (pos, loop) => { this.stop(); this.mode = { pos, loop }; this.play(); },
      position: () => this.position(),
    });
    this.el.append(this.editor.el);
    this.refresh();
  }

  private ctx(): AudioContext {
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
    return ctx;
  }

  /** The draft as played: from a place in the form, or one section looped. */
  private view = (): MusicDef => {
    const d = this.draft(), mo = this.mode;
    if (!mo || !d.score?.length) return d;
    const order = formSections(d);
    if (!order.length) return d;
    const p = mo.pos % order.length;
    const pick = mo.loop ? [order[p]] : [...order.slice(p), ...order.slice(0, p)];
    return { ...d, form: pick.map((i) => d.score![i].name).join(' '), scoreThen: mo.loop ? 'repeat' : d.scoreThen };
  };

  private play() {
    const c = this.ctx();
    this.music = new AmbientMusic(c, out!, this.view, 1, 1.5);
    this.btn.textContent = '■ Stop';
    this.skip.disabled = false;
    this.timer = window.setInterval(() => this.refresh(), 250);
    this.editor.start();
  }

  stop() {
    this.music?.stop(1.5);
    this.music = null;
    this.mode = null;
    clearInterval(this.timer);
    this.btn.textContent = '▶ Listen';
    this.skip.disabled = true;
    this.editor.stop();
    this.refresh();
  }

  toggle() { if (this.music) this.stop(); else this.play(); }

  /** Where a written score is: its place in the form, section, bar, how far through the bar; and the drum step. */
  private position() {
    const mu = this.music;
    if (!mu || !ctx) return null;
    const p = mu.played, step = mu.stepAt(ctx.currentTime);
    const d = this.draft();
    if (!d.score?.length || p.chord < 0 || p.drift) return step >= 0 ? { pos: -1, sec: -1, bar: -1, frac: 0, step } : null;
    const v = this.view(), order = formSections(v), full = formSections(d).length;
    // the flattened bar index → which form place and which bar of its section
    let k = p.chord;
    for (let j = 0; j < order.length; j++) {
      const n = v.score![order[j]]?.bars?.length ?? 0;
      if (k < n) {
        const pos = this.mode ? (this.mode.loop ? this.mode.pos : (this.mode.pos + j) % Math.max(1, full)) : j;
        return { pos, sec: order[j], bar: k, frac: Math.max(0, Math.min(1, (ctx.currentTime - p.at) / barSeconds(v))), step };
      }
      k -= n;
    }
    return null;
  }

  /** A short note to hear what's being written (a soft triangle; bells ring a little longer). */
  private audition(midi: number, lane: Lane) {
    const c = this.ctx(), t = c.currentTime + 0.01;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = lane === 'bells' ? 'sine' : 'triangle';
    o.frequency.value = midiHz(midi);
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const len = lane === 'bells' ? 1.2 : lane === 'melody' ? 0.5 : 0.8;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lane === 'bass' ? 0.5 : 0.3, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.05, len / 4);
    o.connect(f).connect(g).connect(out!);
    o.start(t);
    o.stop(t + len * 1.5);
  }

  /** Chord chips (the one sounding lit) and what's playing. */
  refresh() {
    const d = this.draft(), at = this.music?.played.chord ?? -1;
    const chords = d.chords ?? [], bars = scoreBars(d), vbars = scoreBars(this.view());
    this.write.style.display = d.score?.length ? 'none' : '';
    this.chips.replaceChildren(...(bars ? [] : chords).map((c, i) => {
      const s = document.createElement('span');
      s.className = `mp-chip${i === at ? ' on' : ''}${parseNotes(c?.notes).bad.length || !parseNotes(c?.notes).notes.length ? ' bad' : ''}`;
      s.textContent = `${i === 0 ? '⌂ ' : ''}${c?.notes || '—'}`;
      s.title = i === 0 ? 'Home chord' : `Chord ${i + 1}`;
      return s;
    }));
    const p = this.music?.played;
    const where = !p ? '' : bars && p.drift ? `drifting after the score · chord ${p.chord + 1}`
      : vbars ? `${this.mode?.loop ? 'looping · ' : ''}bar ${p.chord + 1} of ${vbars.length}${p.section >= 0 ? ` · ${d.score?.[p.section]?.name || `section ${p.section + 1}`}` : ''}`
      : `chord ${p.chord + 1} of ${chords.length}${p.section >= 0 ? ` · section ${p.section + 1} of ${d.sections?.length ?? 0}` : ''}`;
    this.now.textContent = p ? `${where} · ${p.bells} bells${p.pulses ? ` · ${p.pulses} beats` : ''}${p.hits ? ` · ${p.hits} drum hits` : ''}${p.arps ? ` · ${p.arps} arp steps` : ''}${p.leads ? ` · ${p.leads} phrases` : ''}${p.calls ? ` · ${p.calls} calls` : ''}` : '';
  }

  /** The draft changed (the form, undo): redraw. */
  sync() { this.refresh(); this.editor.sync(); }

  dispose() { this.stop(); this.editor.dispose(); }
}
