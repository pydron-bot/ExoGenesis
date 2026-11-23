/**
 * Editor: a visual editor for a music mood (Rules → Music), inside the ▶ Listen panel.
 *
 * - **Arrangement:** the score's form as a strip of section blocks (drag to reorder, × to drop one, + to add),
 *   the section playing lit while it plays; a double-click plays from there.
 * - **Sections:** tabs, with name, layers (chips), bar count, duplicate, delete, ▶ Loop.
 * - **Piano roll** for the section shown: chords, bass, bells and melody on one pitch grid, the lane picked
 *   editable and the others faint. Rows of the chord sounding are tinted, so a tune can be written to it.
 *   Click a bar's header for its chord and bass as text, and to insert, duplicate or delete bars.
 * - **Step sequencer** (any mood, written or free): the drum tracks and the bassline as grids of cells.
 *
 * Everything reads and writes the draft directly in the mood's own notation (music.ts plays it live), and
 * rewrites only the bars it touched, so files stay diffable.
 */
import type { MusicDef } from '../content/defs';
import { MUSIC_LAYERS } from '../content/defs';
import { DRUMS } from '../audio/drums';
import { parsePhrase } from '../audio/music';
import { parseNotes } from '../audio/notes';

type Sec = NonNullable<MusicDef['score']>[number];
type Bar = Sec['bars'][number];
type Track = NonNullable<MusicDef['drumTracks']>[number];
export type Lane = 'melody' | 'bells' | 'chord' | 'bass';

/** What the editor needs from its panel. */
export interface ScoreHost {
  draft(): MusicDef;
  /** A small edit made (typing): refresh the form's flags, note it for undo. */
  changed(): void;
  /** An edit finished: rebuild the form's fields from the draft (and note it for undo). */
  rerender(): void;
  /** Hear a note now. */
  audition(midi: number, lane: Lane): void;
  /** Hear a drum now. */
  drum(sound: string, soft: boolean): void;
  /** Play from a place in the form (an index into `formSections`), or loop that one section. */
  playFrom(pos: number, loop: boolean): void;
  /** What's playing: the form place, the section, its bar, how far through it (0–1), the drum step; null when stopped. */
  position(): { pos: number; sec: number; bar: number; frac: number; step: number } | null;
}

const LANES: { id: Lane; label: string; color: string; help: string }[] = [
  { id: 'melody', label: 'Melody', color: '#ffb547', help: 'Click to write a note, drag its right edge to hold it longer, drag it to move it. Right-click or Delete removes it; arrows nudge (Shift: an octave).' },
  { id: 'bells', label: 'Bells', color: '#3fd6ff', help: 'Click to strike a bell (they ring on by themselves), drag to move. Right-click or Delete removes it.' },
  { id: 'chord', label: 'Chord', color: '#b48cff', help: 'Click a row to add or remove a note in the chord you see there; drag a note to move it. Shift+click starts a new chord in that bar. Click a bar number for the chord as text.' },
  { id: 'bass', label: 'Bass', color: '#5be3a0', help: 'Click to set the bass under the chord there; right-click clears it (the lowest chord note, an octave down).' },
];
const LANE_COLOR = Object.fromEntries(LANES.map((l) => [l.id, l.color])) as Record<Lane, string>;
const SEC_COLORS = ['#3fd6ff', '#ffb547', '#b48cff', '#5be3a0', '#ff6f61', '#f78fd0', '#9fd356', '#6f9bff'];
const STEPS_PER_BEAT: Record<string, number> = { '4ths': 1, '8ths': 2, '16ths': 4 };
const LO = 24, HI = 96, ROW = 10, KEY_W = 46, HEAD_H = 26;
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const CHORDS: [string, number[]][] = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]],
  ['5', [0, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['m7♭5', [0, 3, 6, 10]],
  ['dim7', [0, 3, 6, 9]], ['mMaj7', [0, 3, 7, 11]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['add9', [0, 2, 4, 7]],
  ['m(add9)', [0, 2, 3, 7]], ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]],
  ['7sus4', [0, 5, 7, 10]], ['maj7♯11', [0, 4, 6, 7, 11]], ['(no3)add9', [0, 2, 7]],
];

// ---------- notation helpers (pure) ----------

const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const words = (s: string | undefined) => (s ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);

/** The sections the form plays, as indices into the score, as music.ts's scoreBars reads it. */
export function formSections(m: MusicDef): number[] {
  const secs = m.score ?? [];
  const byName = new Map(secs.map((s, i) => [(s?.name ?? '').trim().toLowerCase(), i]));
  const f = words(m.form).map((w) => byName.get(w)).filter((i): i is number => i !== undefined);
  return f.length ? f : secs.map((_, i) => i);
}

/** A bar's length in seconds (Steps a bar at the tempo). */
export function barSeconds(m: MusicDef): number {
  const steps = cl(Math.round(Number.isFinite(m.barSteps) ? m.barSteps! : 16), 4, 32);
  return steps / 4 * 60 / Math.max(20, Number.isFinite(m.pulseRate) ? m.pulseRate! : 70);
}

function noteName(m: number, flats: boolean) {
  return `${(flats ? FLAT : SHARP)[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Whether the piece is written in flats (more flats than sharps in it). */
function prefersFlats(m: MusicDef): boolean {
  const s = JSON.stringify(m.score ?? m.chords ?? '');
  return (s.match(/[A-G]b-?\d/g)?.length ?? 0) > (s.match(/[A-G]#-?\d/g)?.length ?? 0);
}

/** A chord's name from its notes ("Dm", "B♭maj7/D"), or its notes if it's nothing common. */
export function chordName(notes: number[], bass: number | null, flats: boolean): string {
  if (!notes.length) return '';
  const pcs = [...new Set(notes.map((n) => n % 12))];
  const names = flats ? FLAT : SHARP;
  const pretty = (pc: number) => names[pc].replace('b', '♭').replace('#', '♯');
  const low = bass !== null ? bass % 12 : Math.min(...notes) % 12;
  const roots = [low, ...pcs.filter((p) => p !== low)];
  for (const r of roots) {
    const rel = pcs.map((p) => (p - r + 12) % 12).sort((a, b) => a - b).join(',');
    const hit = CHORDS.find(([, iv]) => iv.join(',') === rel);
    if (hit) return `${pretty(r)}${hit[0]}${r !== low ? `/${pretty(low)}` : ''}`;
  }
  if (pcs.length === 1) return pretty(pcs[0]);
  return notes.map((n) => noteName(n, flats)).join(' ');
}

interface Tok { midi: number; at: number; len: number }
const readLine = (s: string | undefined): Tok[] => parsePhrase(s).map((n) => ({ midi: n.midi, at: n.at, len: n.steps }));

/** Notes → a line in the score's notation: one token per step, at least `min` tokens (a bar). Empty if no notes. */
function writeLine(notes: Tok[], min: number, flats: boolean): string {
  if (!notes.length) return '';
  const len = Math.max(min, ...notes.map((n) => n.at + n.len));
  const t: string[] = new Array(len).fill('.');
  for (const n of [...notes].sort((a, b) => a.at - b.at)) {
    t[n.at] = noteName(n.midi, flats);
    for (let k = 1; k < n.len; k++) if (t[n.at + k] === '.') t[n.at + k] = '-';
  }
  return t.join(' ');
}

/** Put a note in a line, cutting short or removing what it lands on (a line plays one note at a time). */
function placeTok(notes: Tok[], n: Tok): Tok[] {
  const out: Tok[] = [];
  for (const o of notes) {
    if (o.at >= n.at && o.at < n.at + n.len) continue;
    if (o.at < n.at && o.at + o.len > n.at) out.push({ ...o, len: n.at - o.at });
    else out.push(o);
  }
  out.push(n);
  return out.sort((a, b) => a.at - b.at);
}

function setKey(b: Bar, k: keyof Bar, v: string) {
  if (v.trim()) b[k] = v;
  else delete b[k];
}

/** Which bar's chord is sounding in bar `i` of a section (that bar, or the last one before it with a chord), or -1. */
function ownerOf(sec: Sec, i: number): number {
  for (let j = Math.min(i, (sec.bars?.length ?? 0) - 1); j >= 0; j--) if (sec.bars[j]?.chord?.trim()) return j;
  return -1;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { cls?: string; style?: string } = {}, ...kids: (Node | string | null)[]) {
  const e = document.createElement(tag);
  const { cls, style, ...rest } = props;
  if (cls) e.className = cls;
  if (style) e.setAttribute('style', style);
  Object.assign(e, rest);
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

// ---------- the editor ----------

type Drag =
  | { kind: 'note'; lane: 'melody' | 'bells'; snap: string; from: { bar: number; tok: Tok }; grab: number; resize: boolean; moved: boolean; x0: number; y0: number; heard: number }
  | { kind: 'chord'; lane: 'chord' | 'bass'; snap: string; owner: number; midi: number; moved: boolean; fresh: boolean; y0: number; heard: number };

export class ScoreEditor {
  readonly el: HTMLElement;
  private sec = 0;
  private lane: Lane = 'melody';
  private col = 14;
  private holdLen = 2;
  private sel: { bar: number; at: number; lane: 'melody' | 'bells' } | null = null;
  private drag: Drag | null = null;
  private pop: HTMLElement | null = null;
  private follow = true;
  private raf = 0;
  private lastPos = '';
  private scrolled = false;

  private strip = h('div', { cls: 'se-strip' });
  private tabs = h('div', { cls: 'se-tabs' });
  private tools = h('div', { cls: 'se-tools' });
  private lanes = h('div', { cls: 'se-lanes' });
  private scroll = h('div', { cls: 'se-scroll' });
  private head = h('canvas', { cls: 'se-head' });
  private keys = h('canvas', { cls: 'se-keys' });
  private roll = h('canvas', { cls: 'se-roll', tabIndex: 0 });
  private seq = h('div', { cls: 'se-seq' });
  private scoreBox = h('div', { cls: 'se-score' });
  private hint = h('div', { cls: 'note se-hint' });

  constructor(private host: ScoreHost) {
    const grid = h('div', { cls: 'se-grid' }, h('div', { cls: 'se-corner' }), this.head, this.keys, this.roll);
    this.scroll.append(grid);
    this.scoreBox.append(
      h('div', { cls: 'se-label', textContent: 'Arrangement' }), this.strip,
      h('div', { cls: 'se-label', textContent: 'Sections' }), this.tabs, this.tools, this.lanes, this.scroll, this.hint,
    );
    this.el = h('div', { cls: 'score-editor' }, this.scoreBox, this.seq);
    this.bindRoll();
    this.sync();
  }

  private get d() { return this.host.draft(); }
  private get flats() { return prefersFlats(this.d); }
  private get barSteps() { return cl(Math.round(Number.isFinite(this.d.barSteps) ? this.d.barSteps! : 16), 4, 32); }
  private tokW(lane: 'melody' | 'bells') { return 4 / (STEPS_PER_BEAT[(lane === 'melody' ? this.d.leadStep : this.d.bellStep) ?? '8ths'] ?? 2); }
  private tokPerBar(lane: 'melody' | 'bells') { return Math.max(1, Math.floor(this.barSteps / this.tokW(lane))); }
  private section(): Sec | null { return this.d.score?.[this.sec] ?? null; }

  /** Edited in place: redraw, and tell the form (for undo too). */
  private edited(final = true) {
    if (final) {
      const sl = this.scroll.scrollLeft, st = this.scroll.scrollTop;
      this.host.rerender();
      this.scroll.scrollLeft = sl;
      this.scroll.scrollTop = st;
    }
    this.sync();
  }

  /** Redraw everything from the draft (the form or undo may have changed it). */
  sync() {
    const d = this.d, has = !!d.score?.length;
    this.scoreBox.style.display = has ? '' : 'none';
    if (has) {
      this.sec = cl(this.sec, 0, d.score!.length - 1);
      this.drawStrip();
      this.drawTabs();
      this.drawTools();
      this.drawLanes();
      this.draw();
      if (!this.scrolled && this.scroll.clientHeight) this.centre();
    }
    this.drawSeq();
  }

  /** Scroll the roll to the notes written. */
  private centre() {
    const ns: number[] = [];
    for (const s of this.d.score ?? []) for (const b of s?.bars ?? []) for (const k of ['chord', 'bass', 'bells', 'melody'] as const) ns.push(...parseNotes((b?.[k] ?? '').replace(/[-.|]/g, ' ')).notes);
    const mid = ns.length ? (Math.min(...ns) + Math.max(...ns)) / 2 : 60;
    this.scroll.scrollTop = (HI - mid) * ROW - this.scroll.clientHeight / 2 + HEAD_H;
    this.scrolled = true;
  }

  // ---------- arrangement ----------

  private formTokens(): string[] {
    const d = this.d, w = (d.form ?? '').split(/[\s,]+/).filter(Boolean);
    return w.length ? w : (d.score ?? []).map((s) => s?.name ?? '');
  }
  private setForm(toks: string[]) { this.d.form = toks.join(' '); }
  private secIndex(name: string) {
    const secs = this.d.score ?? [];
    let at = -1;
    secs.forEach((s, i) => { if ((s?.name ?? '').trim().toLowerCase() === name.toLowerCase()) at = i; });
    return at;
  }

  private drawStrip() {
    const d = this.d, toks = this.formTokens(), barS = barSeconds(d);
    const pos = this.host.position();
    let valid = -1, total = 0;
    const blocks = toks.map((t, i) => {
      const si = this.secIndex(t);
      if (si >= 0) valid++;
      const myPos = si >= 0 ? valid : -1;
      const n = si >= 0 ? d.score![si].bars?.length ?? 0 : 0;
      total += n;
      const b = h('div', {
        cls: `se-block${si < 0 ? ' bad' : ''}${si === this.sec ? ' sel' : ''}${pos && myPos === pos.pos ? ' on' : ''}`,
        draggable: true, title: si < 0 ? `No section is called "${t}"` : `${t}: ${n} bars. Click to edit, double-click to play from here, drag to move.`,
        style: `--c:${si >= 0 ? SEC_COLORS[si % SEC_COLORS.length] : '#ff6f61'}; flex-grow:${Math.max(1, n)}`,
      }, h('b', { textContent: t }), h('small', { textContent: si >= 0 ? `${n}` : '?' }));
      const x = h('button', { cls: 'se-x', textContent: '×', title: 'Take it out of the form' });
      x.onclick = (e) => { e.stopPropagation(); const f = this.formTokens(); f.splice(i, 1); this.setForm(f); this.edited(); };
      b.append(x);
      b.onclick = () => { if (si >= 0) { this.sec = si; if (this.host.position()) this.follow = false; this.sync(); } };
      b.ondblclick = () => { if (myPos >= 0) this.host.playFrom(myPos, false); };
      b.ondragstart = (e) => { e.dataTransfer!.setData('text/x-form', String(i)); e.dataTransfer!.effectAllowed = 'move'; };
      b.ondragover = (e) => { e.preventDefault(); b.classList.add('over'); };
      b.ondragleave = () => b.classList.remove('over');
      b.ondrop = (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer!.getData('text/x-form'));
        const add = e.dataTransfer!.getData('text/x-sec');
        const f = this.formTokens();
        if (add) f.splice(i, 0, add);
        else if (Number.isInteger(from) && from !== i) { const [m] = f.splice(from, 1); f.splice(i, 0, m); }
        else return;
        this.setForm(f);
        this.edited();
      };
      return b;
    });
    const add = h('select', { cls: 'se-add', title: 'Add a section to the end of the form' });
    add.append(h('option', { value: '', textContent: '+ add' }), ...(d.score ?? []).map((s) => h('option', { value: s?.name ?? '', textContent: s?.name || '(unnamed)' })));
    add.onchange = () => { if (add.value) { this.setForm([...this.formTokens(), add.value]); this.edited(); } };
    const secs = Math.round(total * barS);
    const info = h('span', { cls: 'note', textContent: `${total} bars · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · then ${d.scoreThen === 'drift' ? 'drifts' : 'repeats'}` });
    const row = h('div', { cls: 'se-blocks' }, ...blocks);
    this.strip.replaceChildren(row, h('div', { cls: 'se-strip-end' }, add, info));
  }

  // ---------- sections ----------

  private drawTabs() {
    const secs = this.d.score ?? [];
    const tabs = secs.map((s, i) => {
      const b = h('button', { cls: `se-tab${i === this.sec ? ' sel' : ''}`, draggable: true, style: `--c:${SEC_COLORS[i % SEC_COLORS.length]}`, textContent: s?.name || '(unnamed)', title: 'Drag onto the arrangement to add it there' });
      b.onclick = () => { this.sec = i; if (this.host.position()) this.follow = false; this.sel = null; this.sync(); };
      b.ondragstart = (e) => { e.dataTransfer!.setData('text/x-sec', s?.name ?? ''); e.dataTransfer!.effectAllowed = 'copy'; };
      return b;
    });
    const add = h('button', { cls: 'se-tab new', textContent: '+ New section' });
    add.onclick = () => {
      const sc = this.d.score!, prev = sc[this.sec];
      const taken = new Set(sc.map((s) => (s?.name ?? '').toLowerCase()));
      let name = 'A';
      for (let c = 65; c < 91; c++) { name = String.fromCharCode(c); if (!taken.has(name.toLowerCase())) break; }
      const held = prev ? ownerOf(prev, prev.bars.length - 1) : -1;
      const first: Bar = held >= 0 ? { chord: prev.bars[held].chord, ...(prev.bars[held].bass ? { bass: prev.bars[held].bass } : {}) } : {};
      sc.push({ name, layers: prev?.layers ?? '', bars: [first, {}, {}, {}] });
      this.sec = sc.length - 1;
      this.edited();
    };
    this.tabs.replaceChildren(...tabs, add);
  }

  private drawTools() {
    const s = this.section();
    if (!s) { this.tools.replaceChildren(); return; }
    const name = h('input', { value: s.name ?? '', cls: 'se-name', title: 'Its name (the form uses it); renaming updates the form' });
    name.onchange = () => {
      const old = (s.name ?? '').trim().toLowerCase(), nu = name.value.trim();
      if (!nu) { name.value = s.name ?? ''; return; }
      s.name = nu;
      if (old) this.setForm(this.formTokens().map((t) => (t.toLowerCase() === old ? nu : t)));
      this.edited();
    };
    const on = new Set(words(s.layers));
    const chips = MUSIC_LAYERS.map((l) => {
      const c = h('button', { cls: `se-chip${!on.size || on.has(l) ? ' on' : ''}${!on.size ? ' all' : ''}`, textContent: l, title: on.size ? `Click to ${on.has(l) ? 'leave out' : 'bring in'} ${l} in this section` : 'Every layer plays (no list): click to leave this one out' });
      c.onclick = () => {
        const now = on.size ? new Set(on) : new Set<string>(MUSIC_LAYERS);
        if (now.has(l)) now.delete(l); else now.add(l);
        s.layers = MUSIC_LAYERS.filter((x) => now.has(x)).join(' ');
        this.edited();
      };
      return c;
    });
    const n = s.bars?.length ?? 0;
    const less = h('button', { textContent: '−', title: 'Remove the last bar', disabled: n <= 1 });
    const more = h('button', { textContent: '+', title: 'Add a bar at the end', disabled: n >= 64 });
    less.onclick = () => { s.bars.pop(); this.edited(); };
    more.onclick = () => { (s.bars ??= []).push({}); this.edited(); };
    const dup = h('button', { textContent: 'Duplicate', title: 'A copy of this section (add it to the form from the tabs or + add)' });
    dup.onclick = () => {
      const sc = this.d.score!;
      const taken = new Set(sc.map((x) => (x?.name ?? '').toLowerCase()));
      let k = 2, nm = `${s.name}${k}`;
      while (taken.has(nm.toLowerCase())) nm = `${s.name}${++k}`;
      sc.splice(this.sec + 1, 0, { ...structuredClone(s), name: nm });
      this.sec++;
      this.edited();
    };
    const del = h('button', { cls: 'danger', textContent: 'Delete', title: 'Delete this section (and take it out of the form)', disabled: (this.d.score?.length ?? 0) <= 1 });
    del.onclick = () => {
      if (!confirm(`Delete section "${s.name}" and take it out of the form?`)) return;
      const nm = (s.name ?? '').toLowerCase();
      this.d.score!.splice(this.sec, 1);
      if (this.d.form?.trim()) this.setForm(this.formTokens().filter((t) => t.toLowerCase() !== nm));
      this.sec = Math.max(0, this.sec - 1);
      this.edited();
    };
    const loop = h('button', { textContent: '🔁 Loop it', title: 'Play this section over and over' });
    loop.onclick = () => {
      const p = formSections(this.d).indexOf(this.sec);
      if (p < 0) { alert('Add this section to the form first.'); return; }
      this.host.playFrom(p, true);
    };
    this.tools.replaceChildren(
      h('span', { cls: 'se-dot', style: `--c:${SEC_COLORS[this.sec % SEC_COLORS.length]}` }), name,
      h('span', { cls: 'se-group' }, h('span', { cls: 'note', textContent: 'Bars' }), less, h('b', { textContent: String(n) }), more),
      dup, del, loop,
      h('div', { cls: 'se-chips' }, h('span', { cls: 'note', textContent: 'Plays:' }), ...chips),
    );
  }

  private drawLanes() {
    const btns = LANES.map((l) => {
      const b = h('button', { cls: `se-lane${l.id === this.lane ? ' sel' : ''}`, style: `--c:${l.color}`, textContent: l.label });
      b.onclick = () => { this.lane = l.id; this.sel = null; this.sync(); };
      return b;
    });
    const len = h('select', { title: 'How long a new melody note is' });
    for (const [v, t] of [[1, '1 step'], [2, '2 steps'], [4, '4 steps'], [8, '8 steps']] as const) len.append(h('option', { value: String(v), textContent: t, selected: v === this.holdLen }));
    len.onchange = () => { this.holdLen = Number(len.value); };
    const zoom = h('input', { type: 'range', min: '6', max: '30', value: String(this.col), title: 'Zoom' });
    zoom.oninput = () => { this.col = Number(zoom.value); this.draw(); };
    const fol = h('label', { cls: 'se-follow', title: 'Show the section playing' }, h('input', { type: 'checkbox', checked: this.follow }), ' follow');
    (fol.firstChild as HTMLInputElement).onchange = (e) => { this.follow = (e.target as HTMLInputElement).checked; };
    this.lanes.replaceChildren(
      h('span', { cls: 'note', textContent: 'Write' }), ...btns,
      ...(this.lane === 'melody' ? [h('span', { cls: 'note', textContent: 'new notes' }), len] : []),
      h('span', { cls: 'se-flex' }), fol, h('span', { cls: 'note', textContent: 'zoom' }), zoom,
    );
    const step = this.lane === 'melody' ? this.d.leadStep ?? '8ths' : this.lane === 'bells' ? this.d.bellStep ?? '8ths' : '';
    this.hint.textContent = `${LANES.find((l) => l.id === this.lane)!.help}${step ? ` One step is ${step === '4ths' ? 'a beat' : `an ${step.slice(0, -1)}`} (${this.lane === 'melody' ? 'Melody · step' : 'Score · bell step'}).` : ''} Ctrl+Z undoes.`;
  }

  // ---------- the roll ----------

  /** Every note of a lane in the section shown, placed in 16th steps from the section's start. */
  private lineNotes(lane: 'melody' | 'bells', s: Sec) {
    const w = this.tokW(lane), bs = this.barSteps;
    return (s.bars ?? []).flatMap((b, bar) => readLine(b?.[lane]).map((t) => ({ bar, tok: t, x: bar * bs + t.at * w, w: t.len * w })));
  }

  /** The chords as blocks: from the bar with the chord to the next chord or the section's end. */
  private chordBlocks(s: Sec) {
    const bars = s.bars ?? [], out: { owner: number; from: number; to: number; notes: number[]; bass: number | null }[] = [];
    bars.forEach((b, i) => {
      if (!b?.chord?.trim()) return;
      let j = i + 1;
      while (j < bars.length && !bars[j]?.chord?.trim()) j++;
      const notes = parseNotes(b.chord).notes.sort((a, z) => a - z);
      out.push({ owner: i, from: i, to: j, notes, bass: parseNotes(b.bass).notes[0] ?? null });
    });
    return out;
  }

  private draw() {
    const s = this.section();
    if (!s) return;
    const bs = this.barSteps, nb = s.bars?.length ?? 0, col = this.col;
    const W = Math.max(1, nb * bs * col), H = (HI - LO + 1) * ROW, dpr = devicePixelRatio || 1;
    const fit = (c: HTMLCanvasElement, w: number, hh: number) => {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); c.style.width = `${w}px`; c.style.height = `${hh}px`; }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return g;
    };
    const y = (m: number) => (HI - m) * ROW;
    const blocks = this.chordBlocks(s), flats = this.flats;
    const pos = this.host.position(), playing = pos && pos.sec === this.sec ? pos : null;

    // keys
    const k = fit(this.keys, KEY_W, H);
    for (let m = LO; m <= HI; m++) {
      const blk = BLACK.has(m % 12);
      k.fillStyle = blk ? '#1a2330' : '#c9d4df';
      k.fillRect(0, y(m), KEY_W, ROW - 1);
      if (m % 12 === 0) { k.fillStyle = '#05080d'; k.font = '9px ui-monospace, monospace'; k.fillText(`C${m / 12 - 1}`, KEY_W - 22, y(m) + 8); }
    }

    // grid
    const g = fit(this.roll, W, H);
    g.fillStyle = '#070b11';
    g.fillRect(0, 0, W, H);
    for (let m = LO; m <= HI; m++) {
      if (BLACK.has(m % 12)) { g.fillStyle = '#0b1119'; g.fillRect(0, y(m), W, ROW); }
      if (m % 12 === 0) { g.fillStyle = '#1d2a3a'; g.fillRect(0, y(m) + ROW - 1, W, 1); }
    }
    // the chord sounding: its notes' rows tinted, every octave
    for (const b of blocks) {
      const pcs = new Set(b.notes.map((n) => n % 12));
      g.fillStyle = 'rgba(180,140,255,0.07)';
      for (let m = LO; m <= HI; m++) if (pcs.has(m % 12)) g.fillRect(b.from * bs * col, y(m), (b.to - b.from) * bs * col, ROW);
    }
    for (let st = 0; st <= nb * bs; st++) {
      g.fillStyle = st % bs === 0 ? '#3a5068' : st % 4 === 0 ? '#1a2636' : '#0f1720';
      g.fillRect(st * col, 0, st % bs === 0 ? 1.5 : 1, H);
    }

    const note = (lane: Lane, x: number, m: number, w: number, a: number, sel = false, ring = false) => {
      const c = LANE_COLOR[lane];
      g.globalAlpha = a;
      if (ring) {
        const gr = g.createLinearGradient(x, 0, x + w + col * 6, 0);
        gr.addColorStop(0, `${c}66`);
        gr.addColorStop(1, `${c}00`);
        g.fillStyle = gr;
        g.fillRect(x, y(m) + 2, w + col * 6, ROW - 4);
      }
      g.fillStyle = c;
      g.fillRect(x + 1, y(m) + 1, Math.max(3, w - 2), ROW - 2);
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y(m) + 0.5, Math.max(3, w - 1), ROW - 1); }
      g.globalAlpha = 1;
    };
    const dim = (l: Lane) => (this.lane === l ? 1 : 0.3);
    for (const b of blocks) {
      const x = b.from * bs * col, w = (b.to - b.from) * bs * col;
      for (const n of b.notes) note('chord', x, n, w, dim('chord') * 0.85);
      note('bass', x, b.bass ?? b.notes[0] - 12, w, dim('bass') * (b.bass === null ? 0.45 : 0.85));
    }
    for (const lane of ['bells', 'melody'] as const) {
      for (const n of this.lineNotes(lane, s)) {
        const sel = this.sel?.lane === lane && this.sel.bar === n.bar && this.sel.at === n.tok.at;
        note(lane, n.x * col, n.tok.midi, lane === 'bells' ? this.tokW(lane) * col : n.w * col, dim(lane), sel, lane === 'bells');
      }
    }
    if (playing) {
      const px = (playing.bar + playing.frac) * bs * col;
      g.fillStyle = '#ffffff';
      g.fillRect(px, 0, 1.5, H);
    }

    // header: bar numbers and chord names
    const hd = fit(this.head, W, HEAD_H);
    hd.fillStyle = '#0b1119';
    hd.fillRect(0, 0, W, HEAD_H);
    hd.font = '11px system-ui, sans-serif';
    for (let i = 0; i < nb; i++) {
      const x = i * bs * col, own = blocks.find((b) => b.owner === i);
      if (playing && playing.bar === i) { hd.fillStyle = 'rgba(63,214,255,0.18)'; hd.fillRect(x, 0, bs * col, HEAD_H); }
      hd.fillStyle = '#3a5068';
      hd.fillRect(x, 0, 1, HEAD_H);
      hd.fillStyle = '#7f93a8';
      hd.fillText(String(i + 1), x + 4, 11);
      if (own) {
        hd.fillStyle = '#d8c6ff';
        hd.font = 'bold 11px system-ui, sans-serif';
        hd.fillText(chordName(own.notes, own.bass, flats), x + 4, 23, bs * col - 6);
        hd.font = '11px system-ui, sans-serif';
      } else if (ownerOf(s, i) >= 0) { hd.fillStyle = '#4a5a6e'; hd.fillText('·', x + 4, 23); }
    }
  }

  /** Grid place under the pointer: 16th step from the section start, bar, MIDI note. */
  private at(e: PointerEvent | MouseEvent) {
    const r = this.roll.getBoundingClientRect();
    const x = e.clientX - r.left, yy = e.clientY - r.top;
    const st = Math.max(0, Math.floor(x / this.col));
    const nb = this.section()?.bars?.length ?? 1;
    return { x, st, bar: cl(Math.floor(st / this.barSteps), 0, nb - 1), midi: cl(HI - Math.floor(yy / ROW), LO, HI) };
  }

  private bindRoll() {
    const c = this.roll;
    c.oncontextmenu = (e) => e.preventDefault();
    c.onpointerdown = (e) => {
      const s = this.section();
      if (!s) return;
      c.focus();
      const p = this.at(e), right = e.button === 2;
      if (this.lane === 'melody' || this.lane === 'bells') {
        const lane = this.lane, w = this.tokW(lane);
        const hit = this.lineNotes(lane, s).find((n) => n.tok.midi === p.midi && p.st >= n.x && p.st < n.x + (lane === 'bells' ? w : n.w));
        if (right) {
          if (hit) { this.removeTok(s, lane, hit.bar, hit.tok); this.sel = null; this.edited(); }
          return;
        }
        const snap = JSON.stringify(s.bars);
        if (hit) {
          const endPx = (hit.x + hit.w) * this.col;
          this.sel = { bar: hit.bar, at: hit.tok.at, lane };
          this.drag = { kind: 'note', lane, snap, from: { bar: hit.bar, tok: hit.tok }, grab: Math.floor((p.st - hit.x) / w), resize: lane === 'melody' && p.x > endPx - 6, moved: false, x0: e.clientX, y0: e.clientY, heard: hit.tok.midi };
          this.host.audition(hit.tok.midi, lane);
        } else {
          // a new note, then drag to hold it longer (melody) or move it
          const tok = { midi: p.midi, at: Math.floor((p.st - p.bar * this.barSteps) / w), len: lane === 'melody' ? this.holdLen : 1 };
          this.putTok(s, lane, p.bar, tok);
          this.sel = { bar: p.bar, at: tok.at, lane };
          this.drag = { kind: 'note', lane, snap, from: { bar: p.bar, tok }, grab: 0, resize: lane === 'melody', moved: true, x0: e.clientX, y0: e.clientY, heard: p.midi };
          this.host.audition(p.midi, lane);
        }
      } else {
        const lane = this.lane, own = ownerOf(s, p.bar);
        const snap = JSON.stringify(s.bars);
        if (right) {
          if (own < 0) return;
          if (lane === 'bass') delete s.bars[own].bass;
          else this.chordToggle(s, own, p.midi, false);
          this.edited();
          return;
        }
        if (own < 0 || e.shiftKey) {
          // a new chord here, from the one sounding (if any)
          const b = (s.bars[p.bar] ??= {});
          b.chord = own >= 0 ? s.bars[own].chord : lane === 'bass' ? noteName(p.midi + 12, this.flats) + ' ' + noteName(p.midi + 19, this.flats) : '';
          if (lane === 'bass') b.bass = noteName(p.midi, this.flats);
          else this.chordToggle(s, p.bar, p.midi, true);
          this.drag = { kind: 'chord', lane, snap, owner: p.bar, midi: p.midi, moved: true, fresh: true, y0: e.clientY, heard: p.midi };
        } else if (lane === 'bass') {
          s.bars[own].bass = noteName(p.midi, this.flats);
          this.drag = { kind: 'chord', lane, snap, owner: own, midi: p.midi, moved: true, fresh: true, y0: e.clientY, heard: p.midi };
        } else {
          const has = parseNotes(s.bars[own].chord).notes.includes(p.midi);
          if (!has) this.chordToggle(s, own, p.midi, true);
          this.drag = { kind: 'chord', lane, snap, owner: own, midi: p.midi, moved: false, fresh: !has, y0: e.clientY, heard: p.midi };
        }
        this.host.audition(p.midi, lane);
      }
      c.setPointerCapture(e.pointerId);
      this.draw();
    };
    c.onpointermove = (e) => {
      const dr = this.drag, s = this.section();
      if (!dr || !s) {
        // a resize cursor on a melody note's right edge
        if (s && this.lane === 'melody') {
          const p = this.at(e);
          const hit = this.lineNotes('melody', s).find((n) => n.tok.midi === p.midi && p.st >= n.x && p.st < n.x + n.w);
          c.style.cursor = hit && p.x > (hit.x + hit.w) * this.col - 6 ? 'ew-resize' : hit ? 'grab' : 'crosshair';
        } else c.style.cursor = 'crosshair';
        return;
      }
      const p = this.at(e);
      if (dr.kind === 'note') {
        if (!dr.moved && Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) < 4) return;
        dr.moved = true;
        s.bars = JSON.parse(dr.snap);
        const w = this.tokW(dr.lane), bs = this.barSteps, nb = s.bars.length;
        const f = dr.from;
        if (dr.resize) {
          const start = f.bar * bs + f.tok.at * w;
          const maxLen = Math.floor((nb * bs - start) / w);
          const len = cl(Math.floor((p.st - start) / w) + 1, 1, maxLen);
          this.removeTok(s, dr.lane, f.bar, f.tok);
          this.putTok(s, dr.lane, f.bar, { ...f.tok, len });
        } else {
          const tokAbs = Math.floor(p.st / w) - dr.grab;
          const perBar = this.tokPerBar(dr.lane);
          const abs = cl(tokAbs, 0, nb * perBar - 1);
          const bar = Math.floor(abs / perBar), at = abs - bar * perBar;
          const midi = p.midi;
          this.removeTok(s, dr.lane, f.bar, f.tok);
          this.putTok(s, dr.lane, bar, { ...f.tok, at, midi });
          this.sel = { bar, at, lane: dr.lane };
          if (midi !== dr.heard) { dr.heard = midi; this.host.audition(midi, dr.lane); }
        }
      } else {
        if (p.midi === dr.midi && !dr.moved) return;
        if (Math.abs(e.clientY - dr.y0) < 4 && !dr.moved) return;
        dr.moved = true;
        s.bars = JSON.parse(dr.snap);
        if (dr.lane === 'bass') {
          const b = (s.bars[dr.owner] ??= {});
          if (dr.fresh && !b.chord) b.chord = noteName(p.midi + 12, this.flats) + ' ' + noteName(p.midi + 19, this.flats);
          b.bass = noteName(p.midi, this.flats);
        } else {
          const b = (s.bars[dr.owner] ??= {});
          const own = ownerOf(s, dr.owner);
          if (own !== dr.owner) b.chord = own >= 0 ? s.bars[own].chord : '';
          if (!dr.fresh) this.chordToggle(s, dr.owner, dr.midi, false);
          this.chordToggle(s, dr.owner, p.midi, true);
        }
        if (p.midi !== dr.heard) { dr.heard = p.midi; this.host.audition(p.midi, dr.lane); }
      }
      this.draw();
    };
    c.onpointerup = () => {
      const dr = this.drag, s = this.section();
      this.drag = null;
      if (!dr || !s) return;
      // a click on a chord note that didn't move: take it out
      if (dr.kind === 'chord' && !dr.moved && !dr.fresh) this.chordToggle(s, dr.owner, dr.midi, false);
      if (JSON.stringify(s.bars) !== dr.snap) this.edited();
      else this.draw();
    };
    c.onkeydown = (e) => {
      const s = this.section(), sel = this.sel;
      if (!s || !sel) return;
      const tok = readLine(s.bars[sel.bar]?.[sel.lane]).find((t) => t.at === sel.at);
      if (!tok) return;
      let nu: Tok | null = null, bar = sel.bar;
      if (e.key === 'Delete' || e.key === 'Backspace') { this.removeTok(s, sel.lane, sel.bar, tok); this.sel = null; e.preventDefault(); this.edited(); return; }
      if (e.key === 'Escape') { this.sel = null; this.draw(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') nu = { ...tok, midi: cl(tok.midi + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1), LO, HI) };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const per = this.tokPerBar(sel.lane), abs = cl(sel.bar * per + tok.at + (e.key === 'ArrowRight' ? 1 : -1), 0, s.bars.length * per - 1);
        bar = Math.floor(abs / per);
        nu = { ...tok, at: abs - bar * per };
      }
      if (!nu) return;
      e.preventDefault();
      this.removeTok(s, sel.lane, sel.bar, tok);
      this.putTok(s, sel.lane, bar, nu);
      this.sel = { bar, at: nu.at, lane: sel.lane };
      this.host.audition(nu.midi, sel.lane);
      this.edited();
    };
    this.head.onclick = (e) => {
      const s = this.section();
      if (!s) return;
      const r = this.head.getBoundingClientRect();
      const bar = Math.floor((e.clientX - r.left) / this.col / this.barSteps);
      const er = this.el.getBoundingClientRect();
      if (bar >= 0 && bar < (s.bars?.length ?? 0)) this.openBar(bar, e.clientX - er.left, r.bottom - er.top + 4);
    };
  }

  private putTok(s: Sec, lane: 'melody' | 'bells', bar: number, t: Tok) {
    const b = (s.bars[bar] ??= {});
    setKey(b, lane, writeLine(placeTok(readLine(b[lane]), t), this.tokPerBar(lane), this.flats));
  }
  private removeTok(s: Sec, lane: 'melody' | 'bells', bar: number, t: Tok) {
    const b = s.bars[bar];
    if (!b) return;
    setKey(b, lane, writeLine(readLine(b[lane]).filter((o) => o.at !== t.at), this.tokPerBar(lane), this.flats));
  }
  /** Add (or take out) a note in bar `i`'s chord; an empty chord goes, with its bass. */
  private chordToggle(s: Sec, i: number, midi: number, add: boolean) {
    const b = (s.bars[i] ??= {});
    const ns = new Set(parseNotes(b.chord).notes);
    if (add) ns.add(midi); else ns.delete(midi);
    const out = [...ns].sort((a, z) => a - z).map((n) => noteName(n, this.flats)).join(' ');
    setKey(b, 'chord', out);
    if (!out) delete b.bass;
  }

  // ---------- a bar's popover ----------

  private openBar(i: number, left: number, top: number) {
    this.pop?.remove();
    const s = this.section()!;
    const b = (s.bars[i] ??= {});
    const close = () => { this.pop?.remove(); this.pop = null; this.edited(); };
    const field = (k: 'chord' | 'bass' | 'bells' | 'melody', label: string, ph: string) => {
      const inp = h('input', { value: b[k] ?? '', placeholder: ph, spellcheck: false });
      inp.oninput = () => {
        setKey(b, k, inp.value);
        inp.classList.toggle('bad', parseNotes(inp.value.replace(/(^|\s)[-.|](?=\s|$)/g, ' ')).bad.length > 0);
        this.host.changed();
        this.draw();
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') close(); };
      const row = h('label', {}, h('span', { textContent: label }), inp);
      row.dataset.item = `score-bar.${k}`;
      return row;
    };
    const act = (t: string, f: () => void, cls = '') => { const x = h('button', { textContent: t, cls }); x.onclick = () => { f(); close(); }; return x; };
    const held = ownerOf(s, i);
    const pop = h('div', { cls: 'se-pop', style: `left:${Math.max(0, Math.min(left - 20, this.el.clientWidth - 380))}px; top:${top}px` },
      h('div', { cls: 'se-pop-h' }, h('b', { textContent: `Bar ${i + 1}` }), h('span', { cls: 'note', textContent: !b.chord && held >= 0 ? ` holds bar ${held + 1}'s chord` : '' }), h('span', { cls: 'se-flex' }), act('✕', () => {})),
      field('chord', 'Chord', held >= 0 && held !== i ? `(held) ${s.bars[held].chord}` : 'e.g. D3 A3 F4'),
      field('bass', 'Bass', 'e.g. D2 (empty = lowest, octave down)'),
      field('bells', 'Bells', 'tokens: note or .'),
      field('melody', 'Melody', 'tokens: note, - hold, . rest'),
      h('div', { cls: 'se-pop-a' },
        act('Insert before', () => { s.bars.splice(i, 0, {}); }),
        act('Insert after', () => { s.bars.splice(i + 1, 0, {}); }),
        act('Duplicate', () => { s.bars.splice(i + 1, 0, structuredClone(b)); }),
        act('Clear', () => { for (const k of Object.keys(b)) delete (b as Record<string, unknown>)[k]; }),
        act('Delete bar', () => { if (s.bars.length > 1) s.bars.splice(i, 1); }, 'danger'),
      ),
    );
    this.pop = pop;
    this.el.append(pop);
    (pop.querySelector('input') as HTMLInputElement).focus();
  }

  // ---------- drums and bassline ----------

  private drawSeq() {
    const d = this.d, tracks = d.drumTracks ?? [];
    const rows = tracks.map((tr, ti) => this.seqRow(
      tr.steps, (v) => { tr.steps = v; }, ['.', 'x', 'o'],
      (k) => this.host.drum(tr.sound, k === 'o'),
      [
        (() => { const s = h('select', { title: 'Drum' }); for (const x of DRUMS) s.append(h('option', { value: x, textContent: x, selected: x === tr.sound })); s.onchange = () => { tr.sound = s.value as Track['sound']; this.host.drum(tr.sound, false); this.edited(); }; return s; })(),
        (() => { const n = h('input', { type: 'number', min: '0', max: '1', step: '0.05', value: String(tr.level ?? 0.7), title: 'Level', cls: 'se-lvl' }); n.onchange = () => { tr.level = cl(Number(n.value) || 0, 0, 1); this.edited(); }; return n; })(),
      ],
      () => { tracks.splice(ti, 1); this.edited(); },
    ));
    const bl = this.seqRow(d.bassline ?? '', (v) => { if (v) d.bassline = v; else delete d.bassline; }, ['.', 'x', 'o', '5'],
      null, [h('span', { cls: 'se-seq-name', textContent: 'bassline', title: 'x root · o octave up · 5 fifth · . rest (on the chord sounding)' })], null);
    const add = h('button', { textContent: '+ Drum track', disabled: tracks.length >= 8 });
    add.onclick = () => { (d.drumTracks ??= []).push({ sound: 'kick', steps: 'x... .... x... ....', level: 0.7 }); if (!(d.drums! > 0)) d.drums = 0.8; this.edited(); };
    this.seq.replaceChildren(
      h('div', { cls: 'se-label', textContent: 'Step sequencer' }),
      h('div', { cls: 'note', textContent: `Click a cell: hit → soft → rest (bassline: root → octave → fifth → rest). 16 steps to a bar; each row loops on its own length, so rows of different lengths drift. ${(d.drums ?? 0) > 0 ? '' : 'Drums level is 0: raise it below to hear them.'}` }),
      ...rows, bl, h('div', { cls: 'actions' }, add),
    );
  }

  /** One row of cells for a step pattern (spaces and | ignored; written back in groups of four). */
  private seqRow(text: string, set: (v: string) => void, cycle: string[], hear: ((k: string) => void) | null, lead: HTMLElement[], remove: (() => void) | null) {
    const cells = (text ?? '').replace(/[\s|]/g, '').split('');
    const write = (cs: string[]) => set(cs.join('').replace(/(.{4})(?=.)/g, '$1 '));
    const grid = h('div', { cls: 'se-cells' });
    cells.forEach((ch, i) => {
      const c = h('button', { cls: `se-cell v-${ch === '.' ? 'r' : ch === 'o' || ch === 'O' ? 'o' : ch === '5' ? 'f' : 'x'}${i % 4 === 0 ? ' beat' : ''}${i % 16 === 0 ? ' bar' : ''}`, textContent: ch === '.' ? '' : ch, title: `Step ${i + 1}` });
      c.dataset.step = String(i);
      c.onclick = () => {
        const k = cycle[(cycle.indexOf(ch.toLowerCase()) + 1) % cycle.length];
        cells[i] = k;
        write(cells);
        if (k !== '.') hear?.(k);
        this.edited();
      };
      grid.append(c);
    });
    const less = h('button', { textContent: '−', title: 'One step shorter', disabled: cells.length <= 1 });
    const more = h('button', { textContent: '+', title: 'One step longer', disabled: cells.length >= 64 });
    const dbl = h('button', { textContent: '×2', title: 'Repeat it (twice as long)', disabled: !cells.length || cells.length > 32 });
    less.onclick = () => { cells.pop(); write(cells); this.edited(); };
    more.onclick = () => { cells.push('.'); write(cells); this.edited(); };
    dbl.onclick = () => { write([...cells, ...cells]); this.edited(); };
    const x = remove ? h('button', { cls: 'danger', textContent: '×', title: 'Remove this track' }) : null;
    if (x) x.onclick = remove;
    const row = h('div', { cls: 'se-seq-row' }, h('div', { cls: 'se-seq-l' }, ...lead), grid, h('div', { cls: 'se-seq-r' }, h('small', { textContent: String(cells.length) }), less, more, dbl, x));
    row.dataset.len = String(cells.length);
    return row;
  }

  // ---------- following the music ----------

  /** Called every frame while the music plays (and once when it stops). */
  tick() {
    const p = this.host.position();
    const key = p ? `${p.pos}/${p.sec}/${p.bar}` : '';
    if (p && this.follow && p.sec !== this.sec && !this.drag && !this.pop) { this.sec = p.sec; this.sel = null; this.sync(); }
    if (key !== this.lastPos) { this.lastPos = key; if (this.d.score?.length) this.drawStrip(); }
    if (this.d.score?.length && (p?.sec === this.sec || !p)) this.draw();
    // follow the bar playing across the roll
    if (p && p.sec === this.sec && this.follow && !this.drag) {
      const x = (p.bar + p.frac) * this.barSteps * this.col, vw = this.scroll.clientWidth - KEY_W;
      if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + vw - 40) this.scroll.scrollLeft = Math.max(0, x - 40);
    }
    for (const row of this.seq.querySelectorAll<HTMLElement>('.se-seq-row')) {
      const len = Number(row.dataset.len);
      const on = p && p.step >= 0 && len ? p.step % len : -1;
      for (const c of row.querySelectorAll<HTMLElement>('.se-cell')) c.classList.toggle('now', Number(c.dataset.step) === on);
    }
  }

  start() { cancelAnimationFrame(this.raf); const f = () => { this.tick(); this.raf = requestAnimationFrame(f); }; this.raf = requestAnimationFrame(f); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.tick(); }
  dispose() { this.stop(); this.pop?.remove(); }
}

/** A score to start from, for a mood without one: its chords in order, two bars each, as section A. */
export function starterScore(m: MusicDef): NonNullable<MusicDef['score']> {
  const chords = (m.chords ?? []).filter((c) => c?.notes?.trim());
  const bars: Bar[] = chords.length
    ? chords.flatMap((c) => [{ chord: c.notes, ...(c.bass?.trim() ? { bass: c.bass } : {}) }, {}])
    : [{ chord: 'C3 G3 E4', bass: 'C2' }, {}, { chord: 'A2 E3 C4', bass: 'A1' }, {}];
  return [{ name: 'A', layers: '', bars }];
}

