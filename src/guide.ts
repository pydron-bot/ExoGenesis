/**
 * The Field Guide (content/guide/<id>.json, TECH.md "Field Guide"): a page on every part of the game, in sections.
 *
 * - `openGuide`: the panel (the game menu, the title screen, Controls, What's new links, a tip's Read): sections,
 *   search, a page with See also links and Back, NEW / UPDATED badges against the version the guide was last
 *   opened at (`exo.guide.seen`), "Show me" (points at the page's HUD element) and "Show me around" (the tour).
 * - `GuideTour`: the first-game orientation (orientation.json's `tour`), one HUD element at a time with the story
 *   hint bubble (src/story-hud.ts `point`), the game paused. Offered once per player (`exo.guide.toured`).
 * - `GuideTips`: when a page's tip trigger first holds in play (the sim watches the conditions and lists the pages
 *   in the story snapshot's `tips`), a small note offers it, once per player (`exo.guide.tipped`), one at a time.
 *
 * DOM only. Everything from content is escaped; page text allows **bold** and "- " bullets and nothing else.
 */
import { content } from './content';
import { GUIDE_SECTIONS, GUIDE_SECTION_NAMES, seeAlso, type GuideDef } from './content/defs';
import { VERSION } from './changelog';
import { hintElement, type HintAction } from './story-hud';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const SEEN_KEY = 'exo.guide.seen', TOURED_KEY = 'exo.guide.toured', TIPPED_KEY = 'exo.guide.tipped', TIPS_KEY = 'exo.guide.tips';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// ---------- pages ----------
const semver = (v?: string) => (v && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
/** a newer than b (both x.y.z). */
export function newer(a?: string, b?: string) {
  const x = semver(a), y = semver(b);
  if (!x || !y) return false;
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) > 0;
}
/** The version a page last changed in. */
export const pageVersion = (g: GuideDef) => g.updated ?? g.since;
/** Every page, by section (GUIDE_SECTIONS order), then order, then title. */
export function guidePages(): [string, GuideDef][] {
  const sec = (g: GuideDef) => GUIDE_SECTIONS.indexOf(g.section);
  return Object.entries(content.guide ?? {}).sort(([, a], [, b]) => sec(a) - sec(b) || a.order - b.order || a.title.localeCompare(b.title));
}
/** NEW (added since `seen`), UPDATED (changed since `seen`) or nothing. No badges for someone who never opened it. */
export function badge(g: GuideDef, seen: string | null): 'new' | 'updated' | null {
  if (!seen || !newer(pageVersion(g), seen)) return null;
  return newer(g.since, seen) ? 'new' : 'updated';
}

/** Page text as HTML: escaped, then paragraphs (blank lines), "- " bullets and **bold**. */
export function renderText(text: string): string {
  const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return text.replace(/\r/g, '').split(/\n\s*\n/).map((para) => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    let html = '', words: string[] = [], items: string[] = [];
    const flush = () => {
      if (words.length) { html += `<p>${bold(words.join(' '))}</p>`; words = []; }
      if (items.length) { html += `<ul>${items.map((i) => `<li>${bold(i)}</li>`).join('')}</ul>`; items = []; }
    };
    for (const l of lines) {
      if (l.startsWith('- ')) { if (words.length) flush(); items.push(l.slice(2)); }
      else { if (items.length) flush(); words.push(l); }
    }
    flush();
    return html;
  }).join('');
}

/** Pages matching every word of a search (title, summary, text, section name). */
export function searchGuide(q: string): [string, GuideDef][] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return guidePages();
  return guidePages().filter(([id, g]) => {
    const hay = `${id} ${g.title} ${g.summary} ${g.text} ${GUIDE_SECTION_NAMES[g.section] ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------- the panel ----------
export interface GuideDeps {
  /** A short sound for taps. */
  tap(): void;
  /** Point at part of the HUD (null clears), with buttons on the bubble (src/story-hud.ts). */
  point(target: string | null, text?: string, actions?: HintAction[]): void;
  /** Hold the game paused (on) and let it go again (off), as it was. */
  hold(on: boolean): void;
  /** Can the tour run now (a colony on screen: deployed, no cinematic, not the title)? */
  canTour(): boolean;
}
let deps: GuideDeps | null = null;
/** main.ts: what the guide needs from the game. Without it (the title screen before a game) the guide only reads. */
export function configureGuide(d: GuideDeps) { deps = d; }

export interface OpenGuide {
  /** Open on this page. */
  page?: string;
  /** In a game, with the HUD there to point at: Show me and Show me around. */
  inGame?: boolean;
  /** Pause the game while it is open (opened from a tip during play). */
  hold?: boolean;
  /** Closed: by the player, or to show something on the HUD ('showme') or start the tour ('tour'). */
  onClose?: (why: 'closed' | 'showme' | 'tour') => void;
}

export const guideOpen = () => !!document.getElementById('guide');

export function openGuide(o: OpenGuide = {}) {
  if (guideOpen()) return;
  const seen = get(SEEN_KEY);
  put(SEEN_KEY, VERSION);
  const inGame = !!o.inGame && !!deps;
  const el = document.createElement('div');
  el.id = 'guide';
  el.innerHTML = `
    <div class="gd-panel" role="dialog" aria-label="Field Guide">
      <div class="gd-head"><b>FIELD GUIDE</b><span>v${esc(VERSION)}</span><button class="gd-x" aria-label="Close">✕</button></div>
      <div class="gd-tools">
        ${inGame && content.guide.orientation?.tour?.length ? '<button class="gd-tour">▸ Show me around</button>' : ''}
        <input class="gd-q" type="search" placeholder="Search the guide" aria-label="Search the guide" autocomplete="off" spellcheck="false">
      </div>
      <div class="gd-body"></div>
    </div>`;
  const body = el.querySelector<HTMLElement>('.gd-body')!, q = el.querySelector<HTMLInputElement>('.gd-q')!;
  const stack: string[] = [];
  if (o.hold) deps?.hold(true);
  let closed = false;
  const close = (why: 'closed' | 'showme' | 'tour' = 'closed') => {
    if (closed) return;
    closed = true;
    el.remove();
    removeEventListener('keydown', key, true);
    if (o.hold) deps?.hold(false);
    o.onClose?.(why);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (stack.length) back(); else close();
  };
  const tag = (g: GuideDef) => {
    const b = badge(g, seen);
    return b ? `<i class="gd-badge ${b}">${b === 'new' ? 'NEW' : 'UPDATED'}</i>` : '';
  };
  const row = ([id, g]: [string, GuideDef]) => `<button class="gd-row" data-page="${esc(id)}"><span><b>${esc(g.title)}</b>${tag(g)}</span><small>${esc(g.summary)}</small></button>`;
  const list = () => {
    const query = q.value.trim();
    if (query) {
      const hits = searchGuide(query);
      body.innerHTML = hits.length ? `<div class="gd-sec">${hits.length} page${hits.length > 1 ? 's' : ''}</div>${hits.map(row).join('')}` : `<p class="gd-none">Nothing in the guide matches "${esc(query)}".</p>`;
    } else {
      const all = guidePages();
      body.innerHTML = GUIDE_SECTIONS.map((s) => {
        const in_ = all.filter(([, g]) => g.section === s);
        return in_.length ? `<div class="gd-sec">${esc(GUIDE_SECTION_NAMES[s])}</div>${in_.map(row).join('')}` : '';
      }).join('');
    }
    body.scrollTop = 0;
  };
  const page = (id: string) => {
    const g = content.guide[id];
    if (!g) return;
    const see = seeAlso(g).filter((x) => content.guide[x]);
    body.innerHTML = `
      <div class="gd-page" data-id="${esc(id)}">
        <button class="gd-back">← Back</button>
        <div class="gd-where">${esc(GUIDE_SECTION_NAMES[g.section] ?? '')}${tag(g)}</div>
        <h2>${esc(g.title)}</h2>
        <div class="gd-text">${renderText(g.text)}</div>
        ${inGame && g.points ? '<button class="gd-show">◎ Show me</button>' : ''}
        ${id === 'orientation' && inGame && g.tour?.length ? '<button class="gd-show gd-tour2">▸ Show me around</button>' : ''}
        ${see.length ? `<div class="gd-see"><span>See also</span>${see.map((x) => `<button data-page="${esc(x)}">${esc(content.guide[x].title)}</button>`).join('')}</div>` : ''}
      </div>`;
    body.scrollTop = 0;
    const show = body.querySelector<HTMLButtonElement>('.gd-show:not(.gd-tour2)');
    if (show) show.onclick = () => { deps?.tap(); close('showme'); showMe(g); };
    const t2 = body.querySelector<HTMLButtonElement>('.gd-tour2');
    if (t2) t2.onclick = startTour;
  };
  const open = (id: string) => { stack.push(id); page(id); };
  const back = () => { stack.pop(); if (stack.length) page(stack[stack.length - 1]); else list(); };
  const startTour = () => { deps?.tap(); close('tour'); setTimeout(() => runTour(), 0); };
  body.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('button');
    if (!t || !body.contains(t)) return;
    if (t.classList.contains('gd-back')) { deps?.tap(); back(); return; }
    if (t.dataset.page) { deps?.tap(); open(t.dataset.page); }
  });
  q.oninput = () => { stack.length = 0; list(); };
  el.querySelector<HTMLButtonElement>('.gd-tour')?.addEventListener('click', startTour);
  el.querySelector<HTMLButtonElement>('.gd-x')!.onclick = () => close();
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  addEventListener('keydown', key, true);
  document.body.appendChild(el);
  list();
  if (o.page && content.guide[o.page]) open(o.page);
  (o.page ? el.querySelector<HTMLElement>('.gd-back') : q)?.focus({ preventScroll: true });
  return { el, close };
}

/** Point at a page's HUD element for a few seconds. */
function showMe(g: GuideDef) {
  if (!deps || !g.points) return;
  const d = deps;
  let done = false;
  const clear = () => { if (done) return; done = true; d.point(null); };
  d.point(g.points, `${g.title}: ${g.summary}`, [{ label: 'OK', primary: true, run: clear }]);
  setTimeout(clear, 9000);
}

// ---------- the orientation ----------
let touring: GuideTour | null = null;
export const tourActive = () => !!touring;

/** Play orientation.json's tour (from the first-game offer or Show me around). */
export function runTour() {
  if (touring || !deps || !deps.canTour()) return;
  const steps = (content.guide.orientation?.tour ?? []).filter((s) => s.target && s.text);
  if (!steps.length) return;
  touring = new GuideTour(deps, steps, () => { touring = null; put(TOURED_KEY, '1'); });
}

class GuideTour {
  private i = -1;
  constructor(private d: GuideDeps, private steps: { target: string; text: string }[], private done: () => void) {
    d.hold(true);
    addEventListener('keydown', this.key, true);
    this.go(1);
  }
  private key = (e: KeyboardEvent) => {
    const k = e.key;
    if (k !== 'Enter' && k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Escape') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (k === 'Escape') this.end(); else this.go(k === 'ArrowLeft' ? -1 : 1);
  };
  /** The next (or previous) step whose target is on screen. */
  private go(dir: 1 | -1) {
    let j = this.i + dir;
    while (j >= 0 && j < this.steps.length && !hintElement(this.steps[j].target)) j += dir;
    if (j >= this.steps.length) { this.end(); return; }
    if (j < 0) return;
    this.i = j;
    this.d.tap();
    const last = !this.steps.slice(j + 1).some((s) => hintElement(s.target));
    const s = this.steps[j];
    this.d.point(s.target, `${s.text}`, [
      ...(j > 0 ? [{ label: '← Back', run: () => this.go(-1) }] : []),
      { label: last ? 'Done' : 'Next →', primary: true, run: () => this.go(1) },
      ...(last ? [] : [{ label: 'Skip', run: () => this.end() }]),
    ]);
  }
  private end() {
    removeEventListener('keydown', this.key, true);
    this.d.point(null);
    this.d.hold(false);
    this.done();
  }
}

/** The first-game offer: a small card, once the colony's HUD is up. */
export function offerTour(onAnswer?: () => void) {
  if (document.getElementById('gd-offer')) return;
  const el = document.createElement('div');
  el.id = 'gd-offer';
  el.className = 'gd-note';
  el.innerHTML = `<div class="gd-note-k">Field Guide</div><b>First time? A two-minute look around.</b><div class="gd-note-acts"><button class="primary gd-yes">Show me around</button><button class="gd-no">Skip</button></div>`;
  const answer = (yes: boolean) => {
    el.remove();
    put(TOURED_KEY, yes ? 'started' : 'skipped');
    deps?.tap();
    onAnswer?.();
    if (yes) runTour();
  };
  el.querySelector<HTMLButtonElement>('.gd-yes')!.onclick = () => answer(true);
  el.querySelector<HTMLButtonElement>('.gd-no')!.onclick = () => answer(false);
  document.getElementById('hud')!.appendChild(el);
}
export const toured = () => !!get(TOURED_KEY);

// ---------- tips ----------
/** A tip stays this long (s), comes at least TIP_GAP s after the last one, and only once the screen has been free (no card, cinematic or panel) for TIP_CALM s. */
export const TIP_SECS = 12, TIP_GAP = 60, TIP_CALM = 4;
/** A tip still waiting this long (s) after its trigger held is dropped, not marked: a later game offers it again. */
export const TIP_STALE = 180;
/**
 * When tips whose triggers held at these times (s) would show, one at a time, spaced as GuideTips spaces them
 * (with the screen free the whole time): for measuring how many land in a stretch of play.
 */
export function tipSchedule(hits: { id: string; t: number }[]) {
  let next = -Infinity;
  const out: { id: string; t: number }[] = [];
  for (const h of hits) {
    const t = Math.max(h.t + TIP_CALM, next);
    if (t - h.t > TIP_STALE) continue;
    out.push({ id: h.id, t });
    next = t + TIP_GAP;
  }
  return out;
}
export function tippedPages(): string[] {
  try { const v = JSON.parse(get(TIPPED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
/** Options → Field Guide tips: on unless turned off (`def`: the default, off in play tests). */
export const tipsWanted = (def: boolean) => { const v = get(TIPS_KEY); return v ? v === 'on' : def; };
export const setTipsWanted = (on: boolean) => put(TIPS_KEY, on ? 'on' : 'off');

/**
 * Tips in play: which pages the sim should watch (pages with a trigger not tipped yet) and the note itself.
 * `update` every frame with the snapshot's `tips` and whether a note may show now (no card, cinematic or panel).
 */
export class GuideTips {
  private el = document.createElement('div');
  private queue: { id: string; age: number }[] = [];
  private shown: string | null = null;
  private left = 0;
  /** Seconds the screen has been free, and since the last tip showed. */
  private calm = 0;
  private since = TIP_GAP;
  private handled = new Set<string>();
  constructor(private open: (page: string) => void, private tap: () => void) {
    this.el.id = 'gd-tip';
    this.el.className = 'gd-note';
    document.getElementById('hud')!.appendChild(this.el);
  }
  /** The pages to watch for tips. */
  watch(): string[] {
    const done = new Set(tippedPages());
    return Object.entries(content.guide ?? {}).filter(([id, g]) => g.trigger && !done.has(id)).map(([id]) => id).sort();
  }
  get showing() { return this.shown; }
  update(tips: string[] | undefined, free: boolean, on: boolean, dt: number) {
    if (!on) { this.queue.length = 0; this.hide(); }
    for (const id of tips ?? []) {
      if (this.handled.has(id)) continue;
      this.handled.add(id);
      if (on && content.guide[id] && !tippedPages().includes(id)) this.queue.push({ id, age: 0 });
    }
    this.el.classList.toggle('on', !!this.shown && free);
    this.calm = free ? this.calm + dt : 0;
    if (!free) return;
    // (time counts while the player can see the game: not under cards, cinematics, panels or the title)
    this.since += dt;
    for (const q of this.queue) q.age += dt;
    this.queue = this.queue.filter((q) => q.age <= TIP_STALE);
    if (this.shown) { if ((this.left -= dt) <= 0) this.hide(); return; }
    // one at a time: a few seconds after a card or panel closes, and well apart
    if (this.calm < TIP_CALM || this.since < TIP_GAP) return;
    const next = this.queue.shift();
    if (next) this.show(next.id);
  }
  private show(id: string) {
    const g = content.guide[id];
    if (!g) return;
    put(TIPPED_KEY, JSON.stringify([...new Set([...tippedPages(), id])]));
    this.shown = id;
    this.left = TIP_SECS;
    this.since = 0;
    this.el.dataset.page = id;
    this.el.innerHTML = `<div class="gd-note-k">Field Guide</div><b>${esc(g.title)}</b><p>${esc(g.summary)}</p><div class="gd-note-acts"><button class="primary gd-read">Read</button><button class="gd-x" aria-label="Dismiss">×</button></div>`;
    this.el.querySelector<HTMLButtonElement>('.gd-read')!.onclick = () => { this.tap(); this.hide(); this.open(id); };
    this.el.querySelector<HTMLButtonElement>('.gd-x')!.onclick = () => { this.tap(); this.hide(); };
    this.el.classList.add('on');
  }
  private hide() { this.shown = null; this.el.classList.remove('on'); }
}
