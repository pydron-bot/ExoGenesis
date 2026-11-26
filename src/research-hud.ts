/**
 * The research tree (Tech Lab → Research tree): every project by branch
 * (Economy, Defence, People, Precursor), each with what it does, what it waits
 * on (earlier research, a building, a specialist, a discovery) met or not, its
 * cost, and a button when it can start. One column that scrolls, so it reads
 * on a phone; projects that follow another sit indented under it. DOM only;
 * ColonyHud calls `update` with each snapshot. Gates are the sim's own
 * (src/sim/mods.ts), so the tree never offers what the sim would refuse.
 */
import { BRANCH_NAMES, RESEARCH_BRANCHES, type BuildingDef, type PeopleRules, type ResearchBranch, type ResearchDef, type UnitDef } from './content/defs';
import { modText, researchNeeds, type ResearchWorld } from './sim/mods';
import type { Command, Snapshot } from './sim/types';
import { esc } from './util/html';

interface Deps {
  research: Record<string, ResearchDef>;
  defs: Record<string, BuildingDef>;
  units: Record<string, UnitDef>;
  people: PeopleRules;
  command(c: Command): void;
  /** The player opened the tree (tutorials: `opened research`). */
  opened?(): void;
}

export class ResearchHud {
  private el = document.createElement('div');
  private tab: ResearchBranch = 'economy';
  private key = '';
  private cur: Snapshot | null = null;

  constructor(private d: Deps) {
    this.el.id = 'research';
    document.getElementById('hud')!.append(this.el);
    this.el.addEventListener('pointerdown', (e) => this.act(e));
  }

  get open() { return this.el.classList.contains('on'); }

  toggle(on = !this.open) {
    this.el.classList.toggle('on', on);
    document.body.classList.toggle('research-open', on);
    this.key = '';
    if (on) {
      this.d.opened?.();
      // open on the branch with something to do (the one under way, else the first with a project ready)
      const s = this.cur;
      if (s) {
        const a = s.research?.active?.id;
        const ready = Object.entries(this.d.research).find(([id, r]) => !s.research.done.includes(id) && researchNeeds(r, this.d.research, this.d.defs, this.world(s)).every((n) => n.ok));
        const pick = a ?? ready?.[0];
        if (pick) this.tab = this.d.research[pick]?.branch ?? 'economy';
      }
      if (this.cur) this.render(this.cur);
    }
  }

  /** What the gates look at, from a snapshot (as the sim's researchWorld). */
  world(s: Snapshot): ResearchWorld {
    return {
      done: s.research?.done ?? [], buildings: s.buildings.filter((b) => !b.team), flags: s.story?.flags ?? [],
      specialists: (s.people?.roster ?? []).filter((c) => c.specialty && c.age >= this.d.people.adultAge).map((c) => c.specialty!),
    };
  }

  /** Projects that could start now (for the Tech Lab card). */
  ready(s: Snapshot) {
    const w = this.world(s);
    return Object.entries(this.d.research).filter(([id, r]) => !w.done.includes(id) && researchNeeds(r, this.d.research, this.d.defs, w).every((n) => n.ok)).length;
  }

  update(s: Snapshot) {
    this.cur = s;
    if (!this.open) return;
    // the lab is gone: nothing to research with
    if (!s.buildings.some((b) => !b.team && b.progress >= 1 && this.d.defs[b.kind]?.role === 'lab')) { this.toggle(false); return; }
    this.render(s);
  }

  /** Unlocks and effects of a project, in words. */
  private does(id: string, r: ResearchDef) {
    const unlocks = [...Object.values(this.d.defs), ...Object.values(this.d.units)].filter((x) => x.research === id).map((x) => x.name);
    return [...(unlocks.length ? [`Unlocks ${unlocks.join(', ')}`] : []), ...(r.effects ?? []).map((e) => modText(e.stat, e.amount))];
  }

  private render(s: Snapshot) {
    const R = s.research ?? { done: [], active: null }, w = this.world(s), all = this.d.research;
    const branchOf = (r: ResearchDef): ResearchBranch => r.branch ?? 'economy';
    const tabs = RESEARCH_BRANCHES.map((b) => {
      const ids = Object.keys(all).filter((id) => branchOf(all[id]) === b);
      const done = ids.filter((id) => R.done.includes(id)).length;
      const live = R.active && branchOf(all[R.active.id] ?? {} as ResearchDef) === b;
      return `<button data-tab="${b}" class="${this.tab === b ? 'on' : ''}">${BRANCH_NAMES[b]} <small>${done}/${ids.length}${live ? ' ●' : ''}</small></button>`;
    }).join('');
    // this branch, in tree order: each project after the one it follows (depth = how many steps in from a root)
    const ids = Object.keys(all).filter((id) => branchOf(all[id]) === this.tab).sort((a, b) => (all[a].order ?? 100) - (all[b].order ?? 100) || all[a].cost - all[b].cost);
    const depth = (id: string, n = 0): number => {
      const p = all[id]?.requires;
      return p && all[p] && branchOf(all[p]) === this.tab && n < 6 ? 1 + depth(p, n + 1) : 0;
    };
    const ordered: string[] = [];
    const place = (id: string) => {
      if (ordered.includes(id)) return;
      ordered.push(id);
      for (const c of ids) if (all[c].requires === id) place(c);
    };
    for (const id of ids) if (!depth(id)) place(id);
    for (const id of ids) place(id);
    const lab = `${R.active ? `Researching <b>${esc(all[R.active.id]?.name ?? R.active.id)}</b> · ${Math.floor(R.active.progress * 100)}%` : 'The Tech Lab is idle'} · ${R.done.length} of ${Object.keys(all).length} done`;
    const nodes = ordered.map((id) => {
      const r = all[id], isDone = R.done.includes(id), now = R.active?.id === id;
      const needs = researchNeeds(r, all, this.d.defs, w), ok = needs.every((n) => n.ok);
      const poor = s.alloys < r.cost || (s.isotopes ?? 0) < (r.isotopes ?? 0);
      const state = isDone ? 'done' : now ? 'now' : ok ? 'ready' : 'locked';
      const cost = `${r.cost}◆${r.isotopes ? ` ${r.isotopes}◇` : ''} · ${r.seconds} s`;
      const right = isDone ? '✓ done' : now ? `${Math.floor(R.active!.progress * 100)}%` : ok ? cost : `🔒 ${cost}`;
      const need = isDone || !needs.length ? '' : `<div class="need">${needs.map((n) => `<span class="${n.ok ? 'ok' : 'no'}">${n.ok ? '✓' : '✗'} ${esc(n.text)}</span>`).join('')}</div>`;
      const btn = isDone ? '' : now ? '<button data-act="unresearch" title="Stop and get the cost back">Cancel</button>'
        : ok && !R.active ? `<button data-r="${esc(id)}" class="${poor ? 'poor' : 'go'}">${poor ? 'Not enough' : 'Research'}</button>` : '';
      const bar = now ? `<div class="pbar"><i style="width:${(R.active!.progress * 100).toFixed(0)}%"></i></div>` : '';
      return `<div class="node ${state}" style="--d:${Math.min(4, depth(id))}"><div class="nh"><b>${esc(r.name)}</b><span>${esc(right)}</span></div>
        <div class="eff">${this.does(id, r).map(esc).join(' · ')}</div>${bar}${need}
        <small>${esc(r.description ?? '')}</small>${btn ? `<div class="grp">${btn}</div>` : ''}</div>`;
    }).join('');
    const html = `<div class="tabs">${tabs}<button data-close class="x" title="Close">✕</button></div><div class="lab">${lab}</div>${nodes}`;
    if (html === this.key) return;
    this.key = html;
    this.el.innerHTML = html;
  }

  private act(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.close !== undefined) { this.toggle(false); return; }
    if (b.dataset.tab) { this.tab = b.dataset.tab as ResearchBranch; this.key = ''; if (this.cur) this.render(this.cur); this.el.scrollTop = 0; return; }
    if (b.dataset.r) { this.d.command({ type: 'research', id: b.dataset.r }); return; }
    if (b.dataset.act === 'unresearch') this.d.command({ type: 'unresearch' });
  }
}
