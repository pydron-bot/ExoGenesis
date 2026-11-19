/**
 * Story events (content/story/<id>.json, STORY.md §8): each has a trigger, a
 * card (title, text, choices) and effects. Owned by the Sim (src/sim/core.ts).
 *
 * Every second the runner checks the triggers of events that haven't fired. A
 * firing event applies its "when it fires" effects, logs its title and puts its
 * card in the inbox; the HUD shows the inbox's first card. Answering (a choice,
 * or Continue) applies that choice's effects and lets "after" events follow.
 * Each event fires once per game. State (fired, answered, flags, inbox) is saved.
 *
 * Cinematics (content/cinematics) with a trigger are checked the same way and
 * play once; a `cinematic` effect plays one whatever its trigger. Playing is the
 * renderer's job: the queue is in the snapshot, and it says when one is done.
 */
import { content } from '../content';
import type { EffectDef, StoryDef } from '../content/defs';
import type { StorySnap } from './types';
import { conditionMet } from './conditions';
import type { Sim } from './core';
import { TICK_HZ, type StoryState } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Hints that clear themselves when the player uses what they point at (others stay until an unhint or the next hint). */
const HINT_DONE: Record<string, string> = { build: 'build', people: 'people', mood: 'mood', army: 'army', goals: 'goals', minimap: 'minimap', pause: 'speed', fast: 'speed' };

export class Story {
  constructor(private sim: Sim, readonly region: () => { id: string; sites: { id: string; x: number; z: number; r: number }[] }) {}

  get s(): StoryState { return (this.sim.s.story ??= { fired: [], answered: [], flags: [], inbox: [], timers: [] }); }

  init() { this.sim.s.story = { fired: [], answered: [], flags: [], inbox: [], timers: [] }; }

  load() {
    const st = this.s;
    st.inbox = st.inbox.filter((id) => content.story[id]);
    st.timers = st.timers.filter((t) => content.story[t.id]);
    if (st.cineQueue) st.cineQueue = st.cineQueue.filter((id) => content.cinematics[id]);
  }

  has(flag: string) { return this.s.flags.includes(flag); }

  step() {
    const sim = this.sim, st = this.s;
    // delayed events whose time has come
    for (let i = st.timers.length - 1; i >= 0; i--) {
      if (sim.s.tick >= st.timers[i].at) { const id = st.timers[i].id; st.timers.splice(i, 1); this.fire(id); }
    }
    // countdowns that have run out
    if (st.countdowns?.length) {
      for (const c of [...st.countdowns]) {
        if (sim.s.tick < c.at) continue;
        st.countdowns = st.countdowns.filter((x) => x !== c);
        if (!(st.expired ??= []).includes(c.id)) st.expired.push(c.id);
      }
    }
    if (sim.s.tick % TICK_HZ) return;
    for (const [id, ev] of Object.entries(content.story)) {
      if (st.fired.includes(id) || st.timers.some((t) => t.id === id)) continue;
      if (ev.region && ev.region !== this.region().id) continue;
      if (ev.unless && this.has(ev.unless)) continue;
      if (!this.met(ev)) continue;
      if (ev.delay) st.timers.push({ id, at: sim.s.tick + Math.round(ev.delay * TICK_HZ) });
      else this.fire(id);
    }
    for (const [id, cd] of Object.entries(content.cinematics)) {
      if (cd.scene === 'landing' || cd.trigger === 'never' || st.cines?.includes(id)) continue;
      if (cd.region && cd.region !== this.region().id) continue;
      if (cd.unless && this.has(cd.unless)) continue;
      if (!conditionMet(sim, cd.trigger, cd, { sites: this.region().sites })) continue;
      (st.cines ??= []).push(id);
      this.playCine(id);
    }
  }

  /** Queue a cinematic to play (its trigger met, a `cinematic` effect, or a play test). */
  playCine(id: string) {
    const cd = content.cinematics[id], st = this.s;
    if (!cd || cd.scene === 'landing' || st.cineQueue?.includes(id)) return;
    (st.cineQueue ??= []).push(id);
  }

  /** The renderer finished (or skipped) a cinematic. */
  cineDone(id: string) {
    const q = this.s.cineQueue;
    if (q) this.s.cineQueue = q.filter((x) => x !== id);
  }

  /** Is the event's trigger satisfied right now? */
  private met(ev: StoryDef): boolean {
    return conditionMet(this.sim, ev.trigger, ev, { sites: this.region().sites });
  }

  /** Fire an event now (its trigger met, an `event` effect, or a debug command). */
  fire(id: string) {
    const ev = content.story[id], st = this.s;
    if (!ev || st.fired.includes(id)) return;
    st.fired.push(id);
    // a radio message logs what was said; a card logs its title (the card shows the rest)
    this.sim.emit(ev.style === 'radio' ? `${this.fill(this.who(ev))}: ${this.fill(ev.text)}` : this.fill(ev.title), 'info', 'warning');
    st.inbox.push(id);
    this.apply(ev, 0);
  }

  /** The player answered a card: `choice` is the button's index (0 for Continue). */
  answer(id: string, choice: number) {
    const ev = content.story[id], st = this.s;
    const at = st.inbox.indexOf(id);
    if (!ev || at < 0) return;
    st.inbox.splice(at, 1);
    const ch = ev.choices?.[choice];
    if (ev.choices?.length) {
      if (!ch) return;
      if (ch.reply) this.sim.emit(this.fill(ch.reply), 'info');
      this.apply(ev, choice + 1);
    }
    if (!st.answered.includes(id)) st.answered.push(id);
  }

  private apply(ev: StoryDef, when: number) {
    for (const e of ev.effects ?? []) if ((e.after ?? 0) === when) this.effect(e);
  }

  /** Run one effect (story events, mission rewards). */
  effect(e: EffectDef) {
    const sim = this.sim, s = sim.s, st = this.s, n = e.amount ?? 0;
    const site = e.site ? this.region().sites.find((x) => x.id === e.site) : undefined;
    switch (e.kind) {
      case 'log': if (e.text) sim.emit(this.fill(e.text), 'info'); break;
      case 'alloys': s.alloys = Math.max(0, s.alloys + n); break;
      case 'isotopes': s.isotopes = Math.max(0, (s.isotopes ?? 0) + n); break;
      case 'biomass': if (s.people) sim.people.debug({ biomass: n }); break;
      case 'planet': sim.planet.adjust(n); break;
      case 'stance': for (const c of s.people?.colonists ?? []) c.stance = clamp(c.stance + n, 0, 100); break;
      case 'wellbeing': for (const c of s.people?.colonists ?? []) c.wb = clamp(c.wb + n, 0, 100); break;
      case 'regard':
        (s.camps ?? []).forEach((c, i) => { if (c.group === e.group && !c.gone) sim.inhabitants.setRegard(i, c.regard + n); });
        break;
      case 'flag': if (e.flag && !st.flags.includes(e.flag)) st.flags.push(e.flag); break;
      case 'unflag': if (e.flag) st.flags = st.flags.filter((f) => f !== e.flag); break;
      case 'counter': if (e.counter) (st.counters ??= {})[e.counter] = (st.counters[e.counter] ?? 0) + n; break;
      case 'setCounter': if (e.counter) (st.counters ??= {})[e.counter] = n; break;
      case 'countdown':
        if (!e.timer) break;
        st.countdowns = (st.countdowns ?? []).filter((c) => c.id !== e.timer);
        st.expired = (st.expired ?? []).filter((x) => x !== e.timer);
        st.countdowns.push({ id: e.timer, at: s.tick + Math.max(1, Math.round(Math.max(0, n) * TICK_HZ)), text: e.text ? this.fill(e.text) : '' });
        break;
      case 'stopCountdown': if (e.timer) st.countdowns = (st.countdowns ?? []).filter((c) => c.id !== e.timer); break;
      case 'event': if (e.event) this.fire(e.event); break;
      case 'pack': s.waves.next = s.tick; break;
      case 'spawn': if (e.unit && site) sim.spawnAt(e.unit, e.count ?? 1, site.x, site.z, e.guard ? site.r : 0); break;
      case 'research':
        if (e.research && content.research[e.research]) {
          const R = (s.research ??= { done: [], active: null });
          if (!R.done.includes(e.research)) { R.done.push(e.research); if (!st.flags.includes(`research-${e.research}`)) st.flags.push(`research-${e.research}`); }
          if (R.active?.id === e.research) R.active = null;
        }
        break;
      case 'lock': for (const id of [e.building, e.unit]) if (id && !(st.locked ??= []).includes(id)) st.locked.push(id); break;
      case 'unlock': if (st.locked) st.locked = st.locked.filter((x) => x !== e.building && x !== e.unit); break;
      case 'reveal': if (site) sim.reveal(site.x, site.z, n > 0 ? n : Math.max(site.r, 12)); break;
      case 'waypoint':
        if (!site) break;
        st.marks = (st.marks ?? []).filter((m) => m.site !== site.id);
        st.marks.push({ site: site.id, x: site.x, z: site.z, text: e.text ? this.fill(e.text) : '' });
        break;
      case 'clearWaypoint': st.marks = e.site ? (st.marks ?? []).filter((m) => m.site !== e.site) : []; break;
      case 'camera': {
        const b = e.building ? s.buildings.find((x) => x.kind === e.building) : undefined;
        const at = site ?? b;
        if (at) st.look = { x: at.x, z: at.z, n: (st.look?.n ?? 0) + 1 };
        break;
      }
      case 'hint': st.hint = { target: e.target ?? 'build', building: e.building, text: e.text ? this.fill(e.text) : '', n: (st.hint?.n ?? 0) + 1 }; break;
      case 'unhint': if (st.hint) st.hint = null; break;
      case 'cinematic': if (e.cinematic) this.playCine(e.cinematic); break;
      case 'win': sim.end('won', e.text ? this.fill(e.text) : ''); break;
      case 'fail': sim.end('story', e.text ? this.fill(e.text) : ''); break;
    }
  }

  /** Is this building or unit kind out of the build menus? */
  locked(id: string) { return !!this.s.locked?.includes(id); }

  /** The player opened part of the HUD (renderer → 'ui' command); a hint pointing at it has done its job. */
  opened(what: string) {
    if (!(this.s.opened ??= []).includes(what)) this.s.opened.push(what);
    const h = this.s.hint;
    if (h && HINT_DONE[h.target] === what) this.s.hint = null;
  }

  /** The player placed a building: a build-menu hint for it has done its job. */
  placed(kind: string) {
    if (!(this.s.placed ??= []).includes(kind)) this.s.placed.push(kind);
    const h = this.s.hint;
    if (h?.target === 'buildItem' && h.building === kind) this.s.hint = null;
  }

  /** Story text with {first} filled in (the first pod-born colonist's given name). */
  fill(text: string) {
    return text.includes('{first}') ? text.replaceAll('{first}', this.firstName() ?? 'your first colonist') : text;
  }
  private firstName() {
    return this.sim.s.people ? this.sim.people.first()?.name.split(' ')[0] : undefined;
  }
  /** Who is talking on an event (its character's name, or its speaker). */
  private who(ev: StoryDef) {
    return (ev.character && content.characters[ev.character]?.name) || ev.speaker || 'Transmission';
  }

  snapshot(): StorySnap {
    const st = this.s, tick = this.sim.s.tick;
    return {
      inbox: [...st.inbox], flags: [...st.flags], first: this.firstName(), cine: st.cineQueue?.length ? [...st.cineQueue] : undefined,
      counters: { ...(st.counters ?? {}) },
      countdowns: (st.countdowns ?? []).map((c) => ({ id: c.id, left: Math.max(0, (c.at - tick) / TICK_HZ), text: c.text })),
      locked: [...(st.locked ?? [])],
      marks: (st.marks ?? []).map((m) => ({ ...m })),
      hint: st.hint ? { ...st.hint } : null,
      look: st.look ? { ...st.look } : undefined,
      fired: [...st.fired], answered: [...st.answered],
      timers: st.timers.map((t) => ({ id: t.id, left: Math.max(0, (t.at - tick) / TICK_HZ) })),
      expired: [...(st.expired ?? [])],
    };
  }
}
