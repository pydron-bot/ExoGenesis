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
import { choiceShown, shownChoices, type EffectDef, type StoryDef } from '../content/defs';
import type { StorySnap } from './types';
import { conditionMet } from './conditions';
import type { Sim } from './core';
import { TICK_HZ, type StoryState } from './types';
import { blocOf, type PolicyKey } from './people-types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Hints that clear themselves when the player uses what they point at (others stay until an unhint or the next hint). */
const HINT_DONE: Record<string, string> = { build: 'build', people: 'people', mood: 'mood', army: 'army', goals: 'goals', minimap: 'minimap', pause: 'speed', fast: 'speed' };

export class Story {
  /**
   * Field Guide pages whose tip trigger to watch (content/guide `trigger`, src/guide.ts): the renderer's list, sent
   * with a `guide` command (only while tips are on and the player is playing). Not saved and read by nothing else,
   * so headless runs (which never send it) step exactly as before.
   */
  private guideWatch: string[] = [];
  /** Watched pages whose trigger has held, in order (the snapshot's `tips`). */
  private guideHits: string[] = [];

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

  /** Is this region (empty = any) the one being played? A headless playthrough counts every region as here. */
  here(region?: string) { return !region || this.sim.everywhere || region === this.region().id; }
  /** What a trigger or objective set in `region` sees: the region being played and its story sites. */
  world(region?: string) {
    const r = this.region();
    return { region: r.id, sites: this.sim.everywhere && region && region !== r.id ? content.regions[region]?.sites ?? [] : r.sites };
  }

  step() {
    const sim = this.sim, st = this.s;
    // delayed events whose time has come
    for (let i = st.timers.length - 1; i >= 0; i--) {
      if (sim.s.tick >= st.timers[i].at) { const id = st.timers[i].id; st.timers.splice(i, 1); this.fire(id); }
    }
    // orbital strikes whose warning has run out
    if (st.strikes?.length) {
      for (const k of st.strikes.filter((x) => sim.s.tick >= x.at)) {
        st.strikes = st.strikes.filter((x) => x !== k);
        st.struck = { x: k.x, z: k.z, r: k.r, n: (st.struck?.n ?? 0) + 1 };
        sim.orbitalStrike(k.x, k.z, k.r, k.amount);
      }
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
    // story boosts that have run their time
    if (st.mods?.length) {
      for (const b of st.mods.filter((x) => x.until >= 0 && x.until <= sim.s.tick)) if (b.text) sim.emit(`${b.text}: over`, 'info');
      st.mods = st.mods.filter((x) => x.until < 0 || x.until > sim.s.tick);
    }
    // dilemmas that can come again
    if (st.again?.length) for (const a of st.again.filter((x) => x.at <= sim.s.tick)) {
      st.again = st.again.filter((x) => x !== a);
      st.fired = st.fired.filter((x) => x !== a.id);
      st.answered = st.answered.filter((x) => x !== a.id);
    }
    // events and cinematics started elsewhere whose region this is
    if (st.away?.length) for (const id of [...st.away]) {
      const cine = id.startsWith('cine:'), key = cine ? id.slice(5) : id;
      const region = cine ? content.cinematics[key]?.region : content.story[key]?.region;
      if (!(cine ? content.cinematics[key] : content.story[key])) { st.away = st.away.filter((x) => x !== id); continue; }
      if (!this.here(region)) continue;
      st.away = st.away.filter((x) => x !== id);
      if (cine) this.playCine(key); else this.fire(key);
    }
    let dilemma = this.dilemmaOk();
    for (const [id, ev] of Object.entries(content.story)) {
      if (st.fired.includes(id) || st.timers.some((t) => t.id === id)) continue;
      if (!this.here(ev.region) || st.away?.includes(id)) continue;
      if (ev.unless && this.has(ev.unless)) continue;
      if (ev.dilemma && !dilemma) continue;
      if (!this.met(ev)) continue;
      if (ev.cast && !sim.people.castFor(ev.cast)) continue; // no one it could be about (yet)
      if (ev.dilemma) { dilemma = false; st.lastDilemma = sim.s.tick; }
      if (ev.delay) st.timers.push({ id, at: sim.s.tick + Math.round(ev.delay * TICK_HZ) });
      else this.fire(id);
    }
    for (const [id, cd] of Object.entries(content.cinematics)) {
      if (cd.scene === 'landing' || cd.trigger === 'never' || st.cines?.includes(id)) continue;
      if (!this.here(cd.region)) continue;
      if (cd.unless && this.has(cd.unless)) continue;
      if (!conditionMet(sim, cd.trigger, cd, this.world(cd.region))) continue;
      (st.cines ??= []).push(id);
      this.playCine(id);
    }
    // Field Guide tips: read-only checks of the same conditions (nothing here changes the game)
    if (this.guideWatch.length && sim.deployed) {
      for (const id of [...this.guideWatch]) {
        const g = content.guide?.[id];
        if (g?.trigger && !conditionMet(sim, g.trigger, g, this.world())) continue;
        this.guideWatch = this.guideWatch.filter((x) => x !== id);
        if (g?.trigger) this.guideHits.push(id);
      }
    }
  }

  /** The renderer's Field Guide pages to watch for tips (an empty list stops watching). */
  watchGuide(ids: string[]) { this.guideWatch = ids.filter((id) => !this.guideHits.includes(id)); }

  /**
   * Can a colony dilemma fire now? Not before the colony rules' first-dilemma time, not within the dilemma gap of the
   * last one, and not while another card waits for an answer (or a dilemma waits out its delay).
   */
  private dilemmaOk() {
    const sim = this.sim, st = this.s, R = content.colony;
    if (!sim.s.people || sim.secs < (R.dilemmaFrom ?? 900)) return false;
    if (st.lastDilemma !== undefined && sim.s.tick - st.lastDilemma < (R.dilemmaGap ?? 180) * TICK_HZ) return false;
    if (st.inbox.some((id) => content.story[id] && content.story[id].style !== 'radio')) return false;
    return !st.timers.some((t) => content.story[t.id]?.dilemma);
  }

  /** Queue a cinematic to play (its trigger met, a `cinematic` effect, or a play test). */
  playCine(id: string) {
    const cd = content.cinematics[id], st = this.s;
    if (!cd || cd.scene === 'landing' || st.cineQueue?.includes(id)) return;
    // a cinematic set somewhere else plays when that region is played
    if (!this.here(cd.region)) { if (!(st.away ??= []).includes(`cine:${id}`)) st.away.push(`cine:${id}`); return; }
    (st.cineQueue ??= []).push(id);
    if (cd.camera) this.sim.seeForCinematic(cd.camera);
  }

  /** The renderer finished (or skipped) a cinematic. */
  cineDone(id: string) {
    const q = this.s.cineQueue;
    if (q) this.s.cineQueue = q.filter((x) => x !== id);
  }

  /** Is the event's trigger satisfied right now? */
  private met(ev: StoryDef): boolean {
    return conditionMet(this.sim, ev.trigger, ev, this.world(ev.region));
  }

  /** Fire an event now (its trigger met, an `event` effect, or a debug command). */
  fire(id: string) {
    const ev = content.story[id], st = this.s;
    if (!ev || st.fired.includes(id)) return;
    // an event set somewhere else (a mission's briefing, an `event` effect) waits until that region is played
    if (!this.here(ev.region)) { if (!(st.away ??= []).includes(id)) st.away.push(id); return; }
    st.fired.push(id);
    if (ev.cast) {
      const c = this.sim.s.people ? this.sim.people.castFor(ev.cast) : undefined;
      if (c) (st.cast ??= {})[id] = { id: c.id, name: c.name, line: this.sim.people.lineOf(c) };
      else if (st.cast) delete st.cast[id];
    }
    // a radio message logs what was said; a card logs its title (the card shows the rest)
    this.sim.emit(ev.style === 'radio' ? `${this.fill(this.who(ev), id)}: ${this.fill(ev.text, id)}` : this.fill(ev.title, id), 'info', 'warning');
    st.inbox.push(id);
    this.apply(ev, 0, id);
  }

  /** The player answered a card: `choice` is the button's index (0 for Continue). */
  answer(id: string, choice: number) {
    const ev = content.story[id], st = this.s;
    const at = st.inbox.indexOf(id);
    if (!ev || at < 0) return;
    st.inbox.splice(at, 1);
    const ch = ev.choices?.[choice];
    // (choices can be offered only with or without a flag; with none on offer it's a Continue)
    if (shownChoices(ev, st.flags).length) {
      if (!ch || !choiceShown(ch, st.flags)) { st.inbox.splice(at, 0, id); return; }
      if (ch.reply) this.sim.emit(this.fill(ch.reply, id), 'info', 'message');
      this.apply(ev, choice + 1, id);
    }
    if (!st.answered.includes(id)) st.answered.push(id);
    if (ev.dilemma) st.lastDilemma = this.sim.s.tick; // the gap runs from the answer
    if (ev.again && !st.again?.some((a) => a.id === id)) (st.again ??= []).push({ id, at: this.sim.s.tick + Math.round(ev.again * TICK_HZ) });
  }

  private apply(ev: StoryDef, when: number, id?: string) {
    for (const e of ev.effects ?? []) if ((e.after ?? 0) === when) this.effect(e, id);
  }

  /** The colonist an event is about, if they're still with us. */
  private castOf(id?: string) {
    const c = id ? this.s.cast?.[id] : undefined;
    return c && this.sim.s.people ? this.sim.people.colonist(c.id) : undefined;
  }

  /** Run one effect (story events, mission rewards). `from`: the event it belongs to (whose cast "only the one" means). */
  effect(e: EffectDef, from?: string) {
    const sim = this.sim, s = sim.s, st = this.s, n = e.amount ?? 0;
    const site = e.site ? this.region().sites.find((x) => x.id === e.site) : undefined;
    switch (e.kind) {
      case 'log': if (e.text) sim.emit(this.fill(e.text), 'info', 'message'); break;
      case 'alloys': s.alloys = Math.max(0, s.alloys + n); break;
      case 'isotopes': s.isotopes = Math.max(0, (s.isotopes ?? 0) + n); break;
      case 'biomass': if (s.people) sim.people.debug({ biomass: n }); break;
      case 'planet': sim.planet.adjust(n); break;
      case 'stance': for (const c of this.targets(e, from)) c.stance = clamp(c.stance + n, 0, 100); break;
      case 'wellbeing': for (const c of this.targets(e, from)) c.wb = clamp(c.wb + n, 0, 100); break;
      case 'boost': {
        if (!e.stat) break;
        const text = e.text ? this.fill(e.text, from) : '';
        st.mods = (st.mods ?? []).filter((b) => !(text && b.text === text));
        st.mods.push({ stat: e.stat, amount: n, until: e.seconds ? s.tick + Math.round(e.seconds * TICK_HZ) : -1, text, id: from });
        break;
      }
      case 'policy': {
        const [key, value] = (e.policy ?? '').split(':');
        if (s.people && key && value) sim.people.command({ type: 'policy', key: key as PolicyKey, value });
        break;
      }
      case 'favourLine': { const c = this.castOf(from); if (c && s.people) s.people.favour = c.lineage; break; }
      case 'rescue': { const c = this.castOf(from); if (c) sim.people.carryIn(c); break; }
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
      case 'pack': {
        // one pack now; waves held off (a peaceful play test or playthrough) stay held after it
        const w = s.waves;
        if (w.next - s.tick > 1e8) w.held ??= w.next;
        w.next = s.tick;
        break;
      }
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
      case 'travel': if (e.region && content.regions[e.region] && s.campaign && e.region !== this.region().id) s.travel = e.region; break;
      case 'route': {
        const c = s.campaign;
        if (!c || !e.region || !content.regions[e.region] || c.routes.includes(e.region)) break;
        c.routes.push(e.region);
        sim.emit(`New route: ${content.regions[e.region].name}`, 'info', 'message');
        break;
      }
      case 'unroute': if (s.campaign && e.region) s.campaign.routes = s.campaign.routes.filter((x) => x !== e.region); break;
      case 'win': sim.end('won', e.text ? this.fill(e.text) : ''); break;
      case 'fail': sim.end('story', e.text ? this.fill(e.text) : ''); break;
      case 'attitude': if (e.faction && e.attitude) sim.setAttitude(e.faction, e.attitude); break;
      case 'mission': if (e.mission) sim.missions.begin(e.mission); break;
      case 'outpost':
        if (e.outcome) sim.outposts({ faction: e.faction, story: e.story, outcome: e.outcome, at: site ? { x: site.x, z: site.z, r: e.radius ?? site.r } : undefined });
        break;
      case 'strike': {
        // where: the story site, a random one of our buildings of the kind, or any of ours
        const ours = s.buildings.filter((b) => !b.team && (!e.building || b.kind === e.building));
        const at = site ?? (ours.length ? ours[Math.floor(sim.rnd() * ours.length)] : undefined);
        if (!at) break;
        const r = e.radius ?? 10, delay = e.delay ?? 6;
        (st.strikes ??= []).push({ x: at.x, z: at.z, at: s.tick + Math.max(1, Math.round(delay * TICK_HZ)), amount: n > 0 ? n : 400, r });
        sim.emit(`Orbital strike incoming: ${Math.round(delay)} s. Get clear of the ring.`, 'bad', 'alarm', { x: at.x, z: at.z });
        break;
      }
      case 'corrupt': sim.corrupt(e.count ?? 1, e.unit); break;
      case 'glitch': {
        st.counters = { ...(st.counters ?? {}), clause: (st.counters?.clause ?? 0) + 1 };
        const kind = e.glitch ?? 'log';
        if (kind === 'log') { if (e.text) sim.emit(this.fill(e.text), 'info', 'deny', undefined, 'clause'); }
        else if (kind === 'turret') sim.slewTurret();
        else if (kind === 'pod') { if (s.people?.pods.length) st.podPause = Math.max(st.podPause ?? 0, s.tick + Math.round((e.seconds || 8) * TICK_HZ)); }
        st.glitch = { kind, n: (st.glitch?.n ?? 0) + 1, tears: (st.glitch?.tears ?? 0) + (kind === 'screen' ? 1 : 0) };
        break;
      }
      case 'epilogue': {
        const allies = (s.factions ?? []).filter((f) => f.attitude === 'allied').map((f) => f.name);
        const ally = (group: string) => { const g = content.inhabitants[group]?.name ?? group; if (!allies.includes(g)) allies.push(g); };
        for (const c of s.camps ?? []) if (c.trusted && !c.gone) ally(c.group);
        // played away from home: the colony, its planet and its friends are at home (the campaign's snapshot)
        const home = !sim.atHome ? s.campaign?.home : undefined;
        if (home) for (const [g, v] of Object.entries(home.groups)) if (v.trusted) ally(g);
        st.epilogue = {
          ending: e.ending ?? 'covenant',
          pages: (e.pages ?? []).map((p) => ({ title: p.title ? this.fill(p.title) : undefined, text: this.fill(p.text ?? '') })),
          sols: home?.sols ?? Math.floor(sim.secs / content.colony.solSeconds) + 1,
          colonists: home?.colonists ?? s.people?.colonists.length ?? 0,
          planet: home ? Math.round(home.planet) : s.planet ? Math.round(sim.planet.health()) : null,
          allies,
          deaths: home?.deaths ?? s.people?.memorial.filter((m) => !m.cause.startsWith('left')).length ?? 0,
        };
        sim.end(e.ending === 'cycle' ? 'story' : 'won', e.text ? this.fill(e.text) : '');
        break;
      }
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

  /** Who a stance or wellbeing effect touches: the card's one colonist, one bloc's adults, or everyone. */
  private targets(e: EffectDef, from?: string) {
    const all = this.sim.s.people?.colonists ?? [];
    if (e.one) { const c = this.castOf(from); return c ? [c] : []; }
    if (e.bloc) return all.filter((c) => this.sim.people.adult(c) && blocOf(c.stance) === e.bloc);
    return all;
  }

  /** Story text with {first} filled in (the first pod-born colonist's given name), and {who} / {whoLine} (the card's cast). */
  fill(text: string, id?: string) {
    let t = text.includes('{first}') ? text.replaceAll('{first}', this.firstName() ?? 'your first colonist') : text;
    if (t.includes('{who')) {
      const c = id ? this.s.cast?.[id] : undefined;
      t = t.replaceAll('{whoLine}', c?.line ?? 'their').replaceAll('{who}', c?.name ?? 'someone');
    }
    return t;
  }
  private firstName() {
    // away from home (no colonists here) the campaign remembers the Firstborn
    return (this.sim.s.people ? this.sim.people.first()?.name : undefined)?.split(' ')[0] ?? this.sim.s.campaign?.first?.name.split(' ')[0];
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
      who: Object.fromEntries(st.inbox.filter((id) => st.cast?.[id]).map((id) => [id, { name: st.cast![id].name, line: st.cast![id].line }])),
      boosts: (st.mods ?? []).filter((b) => b.text).map((b) => ({ text: b.text, stat: b.stat, amount: b.amount, left: b.until < 0 ? -1 : Math.max(0, (b.until - tick) / TICK_HZ) })),
      strikes: st.strikes?.length ? st.strikes.map((k) => ({ x: k.x, z: k.z, r: k.r, left: Math.max(0, (k.at - tick) / TICK_HZ) })) : undefined,
      struck: st.struck ? { ...st.struck } : undefined,
      glitch: st.glitch ? { ...st.glitch } : undefined,
      epilogue: st.epilogue,
      tips: this.guideHits.length ? [...this.guideHits] : undefined,
    };
  }
}
