/**
 * Missions (content/missions/<id>.json): objectives shown in the GOALS panel.
 * Owned by the Sim (src/sim/core.ts), checked once a second.
 *
 * A mission starts when the colony is deployed and the mission it follows (if
 * any) is done, in its region (if it names one). Objectives are conditions
 * (src/sim/conditions.ts) and stay met once met, in any order. When all are met
 * the mission is done: its rewards run (story effects), its "when done" event
 * fires, and missions that follow it start.
 */
import { content } from '../content';
import type { MissionDef } from '../content/defs';
import { conditionMet } from './conditions';
import type { Sim } from './core';
import { TICK_HZ, type MissionSnap, type MissionState } from './types';

export class Missions {
  constructor(private sim: Sim, private region: () => { id: string; sites: { id: string; x: number; z: number; r: number }[] }) {}

  get s(): MissionState { return (this.sim.s.missions ??= { active: [], done: [], marks: {} }); }

  init() { this.sim.s.missions = { active: [], done: [], marks: {} }; }

  /** Saves keep their missions; older saves catch up quietly (no log, cards or rewards for what's long done). */
  load() {
    if (!this.sim.s.missions) {
      this.init();
      for (let i = 0; i < 50 && this.pass(true); i++);
      return;
    }
    const m = this.s;
    m.active = m.active.filter((id) => content.missions[id]);
  }

  step() {
    if (this.sim.s.tick % TICK_HZ) return;
    // a finished mission starts the next one in the same check
    for (let i = 0; i < 8 && this.pass(false); i++);
  }

  /** One check of everything. Returns true if anything changed. */
  private pass(quiet: boolean): boolean {
    const m = this.s;
    let changed = false;
    // start the ones whose turn has come
    for (const [id, def] of Object.entries(content.missions)) {
      if (m.active.includes(id) || m.done.includes(id) || !this.ready(id, def)) continue;
      this.start(id, quiet);
      changed = true;
    }
    for (const id of [...m.active]) {
      const def = content.missions[id];
      // a fail condition met while it's under way: it fails (before any objective counts)
      const fail = (def.fails ?? []).find((f) => conditionMet(this.sim, f.kind, f, { sites: this.region().sites }));
      if (fail) { this.fail(id, fail.text, quiet); changed = true; continue; }
      const marks = (m.marks[id] ??= []);
      def.objectives.forEach((o, i) => {
        if (marks.includes(i) || !conditionMet(this.sim, o.kind, o, { sites: this.region().sites })) return;
        marks.push(i);
        changed = true;
        if (!quiet) this.sim.emit(`✓ ${o.text}`, 'info', 'objective');
      });
      if (marks.length >= def.objectives.length) { this.finish(id, quiet); changed = true; }
    }
    return changed;
  }

  /** A mission failed: no rewards, its fail event, and maybe the end of the game. */
  fail(id: string, text: string | undefined, quiet = false) {
    const def = content.missions[id], m = this.s;
    if (!def) return;
    m.active = m.active.filter((x) => x !== id);
    if (!(m.failed ??= []).includes(id)) m.failed.push(id);
    if (quiet) return;
    const why = text ? this.sim.story.fill(text) : '';
    this.sim.emit(`Mission failed: ${def.title}${why ? ` · ${why}` : ''}`, 'bad', 'missionFail');
    if (def.onFail) this.sim.story.fire(def.onFail);
    if (def.failEnds) this.sim.end('story', why || `Mission failed: ${def.title}`);
  }

  /** Inspector: tick off one objective now. */
  mark(id: string, index: number) {
    const marks = (this.s.marks[id] ??= []);
    if (this.s.active.includes(id) && !marks.includes(index)) marks.push(index);
  }

  /** Inspector: finish a mission now (rewards and all). */
  complete(id: string) {
    if (!content.missions[id]) return;
    if (!this.s.active.includes(id)) this.start(id);
    this.finish(id, false);
  }

  private ready(id: string, def: MissionDef) {
    if (!this.sim.deployed) return false;
    if (def.region && def.region !== this.region().id) return false;
    if (this.s.failed?.includes(id)) return false;
    return !def.after || this.s.done.includes(def.after);
  }

  /** Start a mission (its turn came, or debug / play test). */
  start(id: string, quiet = false) {
    const def = content.missions[id], m = this.s;
    if (!def || m.active.includes(id)) return;
    m.done = m.done.filter((x) => x !== id);
    if (m.failed) m.failed = m.failed.filter((x) => x !== id);
    m.active.push(id);
    m.marks[id] = [];
    if (quiet) return;
    this.sim.emit(`Mission: ${def.title}`, 'info', 'mission');
    if (def.onStart) this.sim.story.fire(def.onStart);
  }

  /** Debug / play test: skip ahead to a mission (the ones before it count as done, no rewards) and start it. */
  jump(id: string) {
    const m = this.s;
    const before = new Set<string>();
    for (let at = content.missions[id]?.after; at && !before.has(at); at = content.missions[at]?.after) before.add(at);
    m.active = m.active.filter((x) => !before.has(x) && x !== id);
    for (const b of before) if (!m.done.includes(b)) m.done.push(b);
    this.start(id);
  }

  private finish(id: string, quiet: boolean) {
    const def = content.missions[id], m = this.s;
    m.active = m.active.filter((x) => x !== id);
    if (!m.done.includes(id)) m.done.push(id);
    if (quiet) return;
    this.sim.emit(`Mission complete: ${def.title}`, 'info', 'missionDone');
    for (const e of def.rewards ?? []) this.sim.story.effect(e);
    if (def.onDone) this.sim.story.fire(def.onDone);
  }

  snapshot(): { active: MissionSnap[]; done: string[]; failed: string[] } {
    const m = this.s;
    return {
      active: m.active.filter((id) => content.missions[id]).map((id) => ({ id, marks: content.missions[id].objectives.map((_, i) => (m.marks[id] ?? []).includes(i)) })),
      done: [...m.done],
      failed: [...(m.failed ?? [])],
    };
  }
}
