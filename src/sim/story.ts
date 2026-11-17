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
import { conditionMet } from './conditions';
import type { Sim } from './core';
import { TICK_HZ, type StoryState } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class Story {
  constructor(private sim: Sim, private region: () => { id: string; sites: { id: string; x: number; z: number; r: number }[] }) {}

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
    switch (e.kind) {
      case 'log': if (e.text) sim.emit(this.fill(e.text), 'info'); break;
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
      case 'cinematic': if (e.cinematic) this.playCine(e.cinematic); break;
    }
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

  snapshot() {
    return { inbox: [...this.s.inbox], flags: [...this.s.flags], first: this.firstName(), cine: this.s.cineQueue?.length ? [...this.s.cineQueue] : undefined };
  }
}
