/**
 * Story events (content/story/<id>.json, STORY.md §8): each has a trigger, a
 * card (title, text, choices) and effects. Owned by the Sim (src/sim/core.ts).
 *
 * Every second the runner checks the triggers of events that haven't fired. A
 * firing event applies its "when it fires" effects, logs its title and puts its
 * card in the inbox; the HUD shows the inbox's first card. Answering (a choice,
 * or Continue) applies that choice's effects and lets "after" events follow.
 * Each event fires once per game. State (fired, answered, flags, inbox) is saved.
 */
import { content } from '../content';
import type { StoryDef, StoryEffectDef } from '../content/defs';
import type { Sim } from './core';
import { TICK_HZ, type StoryState } from './types';

const SOL = content.colony.solSeconds;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class Story {
  constructor(private sim: Sim, private region: () => { id: string; sites: { id: string; x: number; z: number; r: number }[] }) {}

  get s(): StoryState { return (this.sim.s.story ??= { fired: [], answered: [], flags: [], inbox: [], timers: [] }); }

  init() { this.sim.s.story = { fired: [], answered: [], flags: [], inbox: [], timers: [] }; }

  load() {
    const st = this.s;
    st.inbox = st.inbox.filter((id) => content.story[id]);
    st.timers = st.timers.filter((t) => content.story[t.id]);
  }

  has(flag: string) { return this.s.flags.includes(flag); }

  step() {
    const sim = this.sim, st = this.s;
    // delayed events whose time has come
    for (let i = st.timers.length - 1; i >= 0; i--) {
      if (sim.s.tick >= st.timers[i].at) { const id = st.timers[i].id; st.timers.splice(i, 1); this.fire(id); }
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
  }

  /** Is the event's trigger satisfied right now? */
  private met(ev: StoryDef): boolean {
    const sim = this.sim, s = sim.s;
    switch (ev.trigger) {
      case 'start': return sim.deployed;
      case 'time': return ev.sol !== undefined && sim.secs / SOL + 1 >= ev.sol;
      case 'built': return !!ev.building && s.buildings.some((b) => b.kind === ev.building && b.progress >= 1);
      case 'colonists': return ev.count !== undefined && (s.people?.colonists.length ?? 0) >= ev.count;
      case 'packs': return ev.count !== undefined && s.stats.packsBeaten >= ev.count;
      case 'site': {
        const site = this.region().sites.find((x) => x.id === ev.site);
        if (!site) return false;
        const near = (o: { x: number; z: number }) => Math.hypot(o.x - site.x, o.z - site.z) <= site.r;
        return s.drones.some(near) || (s.units ?? []).some(near);
      }
      case 'contact': return (s.camps ?? []).some((c) => c.group === ev.group && c.met);
      case 'trust': return (s.camps ?? []).some((c) => c.group === ev.group && c.trusted);
      case 'flag': return !!ev.flag && this.has(ev.flag);
      case 'after': return !!ev.event && this.s.answered.includes(ev.event);
      case 'never': return false;
    }
  }

  /** Fire an event now (its trigger met, an `event` effect, or a debug command). */
  fire(id: string) {
    const ev = content.story[id], st = this.s;
    if (!ev || st.fired.includes(id)) return;
    st.fired.push(id);
    this.sim.emit(ev.title, 'info', 'warning');
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
      if (ch.reply) this.sim.emit(ch.reply, 'info');
      this.apply(ev, choice + 1);
    }
    if (!st.answered.includes(id)) st.answered.push(id);
  }

  private apply(ev: StoryDef, when: number) {
    for (const e of ev.effects ?? []) if ((e.after ?? 0) === when) this.effect(e);
  }

  private effect(e: StoryEffectDef) {
    const sim = this.sim, s = sim.s, st = this.s, n = e.amount ?? 0;
    switch (e.kind) {
      case 'log': if (e.text) sim.emit(e.text, 'info'); break;
      case 'alloys': s.alloys = Math.max(0, s.alloys + n); break;
      case 'biomass': if (s.people) sim.people.debug({ biomass: n }); break;
      case 'stance': for (const c of s.people?.colonists ?? []) c.stance = clamp(c.stance + n, 0, 100); break;
      case 'wellbeing': for (const c of s.people?.colonists ?? []) c.wb = clamp(c.wb + n, 0, 100); break;
      case 'regard':
        (s.camps ?? []).forEach((c, i) => { if (c.group === e.group && !c.gone) sim.inhabitants.setRegard(i, c.regard + n); });
        break;
      case 'flag': if (e.flag && !st.flags.includes(e.flag)) st.flags.push(e.flag); break;
      case 'unflag': if (e.flag) st.flags = st.flags.filter((f) => f !== e.flag); break;
      case 'event': if (e.event) this.fire(e.event); break;
      case 'pack': s.waves.next = s.tick; break;
    }
  }

  snapshot() {
    return { inbox: [...this.s.inbox], flags: [...this.s.flags] };
  }
}
