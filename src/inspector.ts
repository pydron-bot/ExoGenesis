/**
 * The story inspector: an overlay for play tests (`?preview=1`, the editor's
 * ▶ Play test; or `?inspect=1`). It shows the story's state as the sim has it
 * (missions and their objectives, events fired / waiting / not yet, flags,
 * counters, countdowns, locks) and drives it: fire an event, start, finish or
 * fail a mission, tick an objective, set or clear a flag, change a counter, run
 * a countdown out, jump the clock. ` (backquote) shows or hides it.
 *
 * In dev it also takes story edits live: saving a story event, mission,
 * character or cinematic in the editor swaps it into the running game instead
 * of reloading the page (src/content/index.ts `onContentHot`).
 */
import type { ContentDb } from './content/db';
import type { Condition, ConditionDef } from './content/defs';
import { condText } from './editor/flow';
import type { Command, Snapshot } from './sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Collections a live edit can swap in without restarting (the rest reload the page). */
export const LIVE_COLLECTIONS = ['story', 'missions', 'characters', 'cinematics', 'chapters', 'lore'] as const;

export interface InspectorDeps {
  content: ContentDb;
  cur(): Snapshot | null;
  command(c: Command): void;
  log(text: string, level?: 'info' | 'warn' | 'bad'): void;
  /** Campaign travel: save this region and go to that one. */
  travel?(region: string): void;
}

export class Inspector {
  readonly el = document.createElement('div');
  private btn = document.createElement('button');
  private key = '';
  private last = 0;
  private filter = '';
  private live = '';

  constructor(private d: InspectorDeps) {
    this.el.id = 'inspector';
    this.btn.id = 'inspector-btn';
    this.btn.textContent = '🔍 Story';
    this.btn.title = 'Story inspector (`)';
    this.btn.onclick = () => this.toggle();
    document.getElementById('hud')!.append(this.el, this.btn);
    let open = true;
    try { open = localStorage.getItem('exo.inspector') !== '0'; } catch { /* private mode */ }
    this.toggle(open);
    addEventListener('keydown', (e) => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); this.toggle(); }
    });
    this.el.addEventListener('click', (e) => this.act(e));
    this.el.addEventListener('change', (e) => this.change(e));
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here isn't a game shortcut
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.dataset.add) this.add(e.target);
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.filter !== undefined) { this.filter = t.value; this.key = ''; this.render(true); }
    });
  }

  toggle(on = !this.el.classList.contains('on')) {
    this.el.classList.toggle('on', on);
    this.btn.classList.toggle('on', on);
    try { localStorage.setItem('exo.inspector', on ? '1' : '0'); } catch { /* private mode */ }
    if (on) { this.key = ''; this.render(true); }
  }

  /** A live edit came in: say what changed. */
  liveEdit(what: string[]) {
    this.live = `Live: ${what.join(', ')} updated ${new Date().toLocaleTimeString()}`;
    this.key = '';
    this.d.log(`Story inspector: ${what.join(', ')} edited, swapped in live`, 'info');
  }

  /** Every frame; redraws twice a second (not while typing in it). */
  update(now: number) {
    if (!this.el.classList.contains('on') || now - this.last < 500) return;
    this.last = now;
    this.render(false);
  }

  private render(force: boolean) {
    const s = this.d.cur();
    if (!s) return;
    const a = document.activeElement;
    if (!force && a instanceof HTMLInputElement && this.el.contains(a)) return;
    const C = this.d.content, st = s.story, m = s.missions;
    const sol = C.colony.solSeconds;
    const key = JSON.stringify([Math.floor(s.secs), st, m, s.alloys | 0, this.filter, this.live, s.over, s.campaign]);
    if (key === this.key) return;
    this.key = key;
    const btn = (act: string, label: string, title = '') => `<button data-act="${esc(act)}" title="${esc(title)}">${esc(label)}</button>`;
    const cond = (kind: Condition, c: ConditionDef) => esc(condText(kind, c));
    const out: string[] = [];
    out.push(`<div class="in-head"><b>STORY INSPECTOR</b> <span>Sol ${(s.secs / sol + 1).toFixed(2)}</span><button data-act="close" title="Hide (\`)">✕</button></div>`);
    out.push(`<div class="in-row">${btn('skip:60', '+1 min', 'Move the clock on a minute')}${btn('skip:600', '+10 min')}${btn(`skip:${sol}`, '+1 sol')}${btn('wave', 'Pack now')}${btn('alloys', '+500 ◆')}</div>`);
    if (this.live) out.push(`<div class="in-note">${esc(this.live)}</div>`);
    if (s.over) out.push(`<div class="in-note bad">Game over: ${esc(s.over)}${s.overText ? ` · ${esc(s.overText)}` : ''}</div>`);

    // ---- missions
    const started = new Set([...m.active.map((x) => x.id), ...m.done, ...m.failed]);
    out.push('<details open><summary>Missions</summary>');
    for (const a of m.active) {
      const def = C.missions[a.id];
      if (!def) continue;
      out.push(`<div class="in-m"><div class="in-t">▶ ${esc(def.title)} ${btn(`finish:${a.id}`, 'Finish', 'Complete it now: rewards run, the next one starts')}${def.fails?.length ? btn(`fail:${a.id}`, 'Fail') : ''}</div>`);
      def.objectives.forEach((o, i) => out.push(`<label class="in-o${a.marks[i] ? ' done' : ''}"><input type="checkbox" data-obj="${esc(a.id)}:${i}" ${a.marks[i] ? 'checked disabled' : ''}> ${esc(o.text)} <small>${cond(o.kind, o)}</small></label>`));
      out.push('</div>');
    }
    const next = Object.entries(C.missions).filter(([id]) => !started.has(id));
    if (next.length) out.push(`<div class="in-sub">Not started</div>${next.map(([id, d]) => `<div class="in-li">${esc(d.title)} <small>${d.after ? `after ${esc(d.after)}` : 'at deploy'}</small> ${btn(`mission:${id}`, 'Start', 'Jump to it: the missions before it count as done')}</div>`).join('')}`);
    if (m.done.length) out.push(`<div class="in-sub">Done</div><div class="in-chips">${m.done.map((id) => `<span class="chip ok">${esc(C.missions[id]?.title ?? id)}</span>`).join('')}</div>`);
    if (m.failed.length) out.push(`<div class="in-sub">Failed</div><div class="in-chips">${m.failed.map((id) => `<span class="chip bad">${esc(C.missions[id]?.title ?? id)}</span>`).join('')}</div>`);
    out.push('</details>');

    // ---- events
    out.push('<details open><summary>Story events</summary>');
    if (st.inbox.length) out.push(`<div class="in-sub">Showing / waiting to be answered</div>${st.inbox.map((id) => `<div class="in-li">${esc(C.story[id]?.title ?? id)}</div>`).join('')}`);
    if (st.timers.length) out.push(`<div class="in-sub">Triggered, waiting out their delay</div>${st.timers.map((t) => `<div class="in-li">${esc(C.story[t.id]?.title ?? t.id)} <small>in ${mmss(t.left)}</small></div>`).join('')}`);
    const f = this.filter.trim().toLowerCase();
    const waiting = Object.entries(C.story).filter(([id, e]) => !st.fired.includes(id) && (!f || `${id} ${e.title}`.toLowerCase().includes(f)));
    out.push(`<div class="in-sub">Not fired yet (${waiting.length}) <input data-filter placeholder="filter" value="${esc(this.filter)}"></div>`);
    for (const [id, e] of waiting.slice(0, 40)) out.push(`<div class="in-li">${esc(e.title)} <small>${cond(e.trigger, e)}${e.unless ? ` · unless ${esc(e.unless)}` : ''}</small> ${btn(`fire:${id}`, 'Fire', 'Fire it now, whatever its trigger')}</div>`);
    if (st.fired.length) out.push(`<details><summary class="in-sub">Fired (${st.fired.length})</summary>${st.fired.map((id) => `<div class="in-li">${esc(C.story[id]?.title ?? id)}${st.answered.includes(id) ? ' <small>answered</small>' : ''}</div>`).join('')}</details>`);
    out.push('</details>');

    // ---- state
    out.push('<details open><summary>Flags, counters, countdowns</summary>');
    out.push(`<div class="in-chips">${st.flags.map((x) => `<span class="chip">${esc(x)} <button data-act="unflag:${esc(x)}" title="Clear">×</button></span>`).join('') || '<small>no flags</small>'}</div>`);
    out.push('<div class="in-row"><input data-add="flag" placeholder="set a flag…"></div>');
    for (const [k, v] of Object.entries(st.counters)) out.push(`<label class="in-li">${esc(k)} <input type="number" data-counter="${esc(k)}" value="${v}"></label>`);
    out.push('<div class="in-row"><input data-add="counter" placeholder="new counter name…"></div>');
    for (const c of st.countdowns) out.push(`<div class="in-li">⏱ ${esc(c.id)} <small>${mmss(c.left)} left${c.text ? ` · ${esc(c.text)}` : ''}</small> ${btn(`expire:${c.id}`, 'Run out')}</div>`);
    if (st.expired.length) out.push(`<div class="in-li"><small>run out: ${st.expired.map(esc).join(', ')}</small></div>`);
    if (st.locked.length) out.push(`<div class="in-sub">Locked</div><div class="in-chips">${st.locked.map((x) => `<span class="chip">${esc(C.buildings[x]?.name ?? C.units[x]?.name ?? x)} <button data-act="unlock:${esc(x)}" title="Unlock">×</button></span>`).join('')}</div>`);
    if (st.hint) out.push(`<div class="in-li">Hint at ${esc(st.hint.target)}: <small>${esc(st.hint.text)}</small></div>`);
    if (st.marks.length) out.push(`<div class="in-li">Waypoints: <small>${st.marks.map((x) => esc(x.site)).join(', ')}</small></div>`);
    out.push('</details>');

    // ---- campaign travel
    const c = s.campaign;
    if (c) {
      const name = (id: string) => esc(C.regions[id]?.name ?? id);
      out.push('<details open><summary>Campaign</summary>');
      out.push(`<div class="in-li">Here: <b>${name(c.here)}</b>${c.expedition ? ' <small>expedition, no colonists</small>' : ''}${c.here === c.home ? ' <small>home</small>' : ''}</div>`);
      out.push(`<div class="in-li">Visited: <small>${c.visited.map(name).join(', ') || 'none'}</small></div>`);
      out.push(`<div class="in-sub">Routes</div><div class="in-chips">${c.routes.map((id) => `<span class="chip">${name(id)} <button data-act="unroute:${esc(id)}" title="Take the route off">×</button></span>`).join('') || '<small>no routes</small>'}</div>`);
      out.push('<div class="in-sub">Travel</div>');
      for (const id of Object.keys(C.regions).filter((x) => x !== c.here)) {
        out.push(`<div class="in-li">${name(id)}${c.visited.includes(id) ? ' <small>visited</small>' : ''} ${c.routes.includes(id) ? '' : btn(`route:${id}`, 'Route', 'Add it to the routes')}${btn(`travel:${id}`, 'Travel', 'Save this region and go there now')}</div>`);
      }
      out.push('</details>');
    }
    const open = [...this.el.querySelectorAll('details')].map((x) => x.open);
    const scroll = this.el.scrollTop;
    this.el.innerHTML = out.join('');
    // keep folded sections folded across redraws
    this.el.querySelectorAll('details').forEach((x, i) => { if (open[i] !== undefined) x.open = open[i]; });
    this.el.scrollTop = scroll;
    if (force && a instanceof HTMLInputElement && a.dataset.filter !== undefined) {
      const fi = this.el.querySelector<HTMLInputElement>('[data-filter]');
      fi?.focus();
      fi?.setSelectionRange(fi.value.length, fi.value.length);
    }
  }

  private send(c: Extract<Command, { type: 'inspect' }>) { this.d.command(c); this.key = ''; }

  private act(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    e.preventDefault();
    const [act, ...rest] = (t.dataset.act ?? '').split(':');
    const arg = rest.join(':');
    switch (act) {
      case 'close': this.toggle(false); return;
      case 'skip': this.send({ type: 'inspect', skip: Number(arg) }); return;
      case 'wave': this.d.command({ type: 'debug', wave: true }); return;
      case 'alloys': this.d.command({ type: 'debug', alloys: 500 }); return;
      case 'finish': this.send({ type: 'inspect', finish: arg }); return;
      case 'fail': this.send({ type: 'inspect', fail: arg }); return;
      case 'mission': this.d.command({ type: 'debug', mission: arg }); this.key = ''; return;
      case 'fire': this.d.command({ type: 'debug', story: arg }); this.key = ''; return;
      case 'unflag': this.send({ type: 'inspect', unflag: arg }); return;
      case 'expire': this.send({ type: 'inspect', expire: arg }); return;
      case 'unlock': this.send({ type: 'inspect', unlock: arg }); return;
      case 'route': this.send({ type: 'inspect', route: arg }); return;
      case 'unroute': this.send({ type: 'inspect', unroute: arg }); return;
      case 'travel': this.d.travel?.(arg); return;
    }
  }

  private change(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.obj) {
      const [mission, i] = t.dataset.obj.split(':');
      this.send({ type: 'inspect', objective: { mission, index: Number(i) } });
    } else if (t.dataset.counter) this.send({ type: 'inspect', counter: { id: t.dataset.counter, value: Number(t.value) || 0 } });
  }

  private add(t: HTMLInputElement) {
    const v = t.value.trim();
    if (!v) return;
    if (t.dataset.add === 'flag') this.send({ type: 'inspect', flag: v });
    if (t.dataset.add === 'counter') this.send({ type: 'inspect', counter: { id: v, value: 0 } });
    t.value = '';
    t.blur();
  }
}
