/**
 * The people side of the colony HUD: food / people / mood slots in the
 * resource strip, the Colony panel (overview + policies, roster, cryo bank,
 * memorial), colonist cards, and the extra rows and buttons on civic, farm and
 * staffed building cards (growth-pod picker). DOM only; ColonyHud calls in.
 */
import type { ZoomCamera } from './camera';
import { SPECIALTIES, type BuildingDef, type PeopleRules, type Specialty } from './content/defs';
import { TRAITS } from './sim/names';
import { AUTONOMIST_BELOW, CURRICULA, DEVOTED_ABOVE, POLICIES, type Bloc, type ColonistSnap, type Curriculum, type PeopleSnap, type PolicyKey } from './sim/people-types';
import type { Command, Snapshot } from './sim/types';
import type { RegionUi } from './world/region';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const BLOC_INFO: Record<Bloc, { name: string; color: string; wants: string }> = {
  partner: { name: 'Partners', color: '#5ff3ff', wants: 'Humans and the AI as equals. Want a joint council.' },
  autonomist: { name: 'Autonomists', color: '#ffb547', wants: 'Human self-rule, limits on the AI. Want a human assembly and light oversight. Angry ones sabotage, and a majority may walk out.' },
  devoted: { name: 'Devoted', color: '#c08bff', wants: 'Want the AI to lead (AI directive) and watch over everything. Work hard; few children.' },
};
/** What a leading bloc's boost does, from the people rules. */
export function boostText(b: Bloc, r: PeopleRules): { name: string; does: string } {
  const pct = (x: number) => `${Math.round(Math.abs(x - 1) * 100)}%`;
  switch (b) {
    case 'autonomist': return { name: 'Wardens', does: `People fight back from the buildings they're in (${r.militiaDamage} damage each, up to ${r.militiaMax} a building, ${r.militiaRange} u) and take ${pct(r.wardenHarm)} less harm outdoors` };
    case 'partner': return { name: 'Symbiosis', does: `Colonists at work add ${pct(r.partnerStaff)} more to their buildings` };
    case 'devoted': return { name: 'Vigil', does: `Drones build and repair ${pct(r.devotedDrones)} faster; buildings draw ${pct(r.devotedPower)} less power` };
  }
}

const SPEC_HELP: Record<Specialty, string> = {
  engineer: 'Mining Depots and the Vehicle Bay',
  botanist: 'Hydroponics',
  medic: 'Civilian Center: care, pod survival',
  technician: 'Solar Arrays',
  security: 'Defense Turrets',
};
const wbColor = (v: number) => (v >= 60 ? '#5bff9a' : v >= 35 ? '#ffb547' : '#ff5a4a');
const bar = (v: number, color: string, marks: number[] = []) =>
  `<div class="pbar"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%;background:${color}"></i>${marks.map((m) => `<s style="left:${m}%"></s>`).join('')}</div>`;

interface Deps {
  defs: Record<string, BuildingDef>;
  rules: PeopleRules;
  solSeconds: number;
  ui: RegionUi;
  cam: ZoomCamera;
  command(c: Command): void;
  select(): void;
}

type Tab = 'overview' | 'people' | 'cryo' | 'memorial';

export class PeopleHud {
  private el = { food: $('r-food'), people: $('r-people'), mood: $('r-mood'), cryo: $('r-cryo'), panel: $('colony'), body: $('colony-body') };
  private tab: Tab = 'overview';
  private key = '';
  /** Growth-pod picker open on this building, and the choices in it (remembered between pods). */
  private picker: number | null = null;
  private spec: Specialty | null = null;
  private imprint: Curriculum = 'charter';
  private cur: Snapshot | null = null;

  constructor(private d: Deps) {
    const open = (e: Event) => { e.preventDefault(); this.toggle(); };
    this.el.people.addEventListener('pointerdown', open);
    this.el.mood.addEventListener('pointerdown', open);
    this.el.panel.addEventListener('pointerdown', (e) => this.panelAct(e));
  }

  toggle(open?: boolean, tab?: Tab) {
    const on = open ?? !this.el.panel.classList.contains('on');
    if (tab) this.tab = tab;
    this.el.panel.classList.toggle('on', on);
    document.body.classList.toggle('colony-open', on);
    this.key = '';
    if (on && this.cur) this.renderPanel(this.cur);
  }

  // ---------- resource strip ----------
  renderBar(s: Snapshot) {
    this.cur = s;
    const p = s.people, e = this.el;
    if (!p) return;
    const integ = s.cryo, safe = this.d.rules.cryoSafe;
    e.cryo.innerHTML = `❄ <b>${p.embryos}</b><span class="u"> embryos · ${integ.toFixed(0)}%</span>`;
    e.cryo.className = `r ${integ < safe ? 'bad' : integ < 100 && s.short > 0.01 ? 'warn' : ''}`;
    e.cryo.title = `Cryo bank: ${p.embryos} embryos in ${p.lineagesLeft} lineages · integrity ${integ.toFixed(1)}% (embryos die below ${safe}%)`;
    const net = p.food.made - p.food.eaten;
    const starving = p.biomass <= 0.01 && p.food.eaten > p.food.made;
    e.food.innerHTML = `🌱 <b>${Math.floor(p.biomass)}</b><span class="u">${net >= 0 ? '+' : ''}${(net * 60).toFixed(0)}/min</span>`;
    e.food.className = `r ${starving ? 'bad' : net < 0 ? 'warn' : ''} ${p.biomassMax > 0 ? '' : 'dim'}`;
    e.food.title = `Biomass ${Math.floor(p.biomass)} / ${Math.floor(p.biomassMax)} · grown ${(p.food.made * 60).toFixed(1)}/min, eaten ${(p.food.eaten * 60).toFixed(1)}/min`;
    const n = p.adults + p.children;
    const pods = p.pods.reduce((m, x) => m + x.running.length, 0);
    e.people.innerHTML = n || pods ? `👤 <b>${n}</b>${pods ? `<span class="pod">+${pods}</span>` : ''}<span class="w"> colonists</span>` : '👤 <b>—</b>';
    e.people.className = `r tap ${n || pods ? '' : 'dim'} ${p.striking ? 'warn' : ''} ${this.el.panel.classList.contains('on') ? 'on' : ''}`;
    e.people.title = n ? `${p.adults} adults, ${p.children} children${pods ? `, ${pods} growing in pods` : ''}. Tap for the Colony panel.` : 'No colonists yet: build a Civilian Center and start a growth pod. Tap for the Colony panel.';
    if (p.adults) {
      e.mood.innerHTML = `☺<b style="color:${wbColor(p.wellbeing)}">${p.wellbeing.toFixed(0)}</b> ⚖<b>${p.stance.toFixed(0)}</b>`;
      e.mood.className = `r tap ${p.wellbeing < 35 ? 'warn' : ''}`;
      e.mood.title = `Wellbeing ${p.wellbeing.toFixed(0)} · AI acceptance ${p.stance.toFixed(0)} (${p.blocs.partner} Partners, ${p.blocs.autonomist} Autonomists, ${p.blocs.devoted} Devoted)`;
    } else {
      e.mood.innerHTML = '☺<b>—</b> ⚖<b>—</b>';
      e.mood.className = 'r tap dim';
      e.mood.title = 'Wellbeing and AI acceptance, once there are colonists';
    }
    if (this.el.panel.classList.contains('on')) this.renderPanel(s);
  }

  // ---------- Colony panel ----------
  private renderPanel(s: Snapshot) {
    const p = s.people;
    let html = `<div class="tabs">${(['overview', 'people', 'cryo', 'memorial'] as Tab[]).map((t) => `<button data-tab="${t}" class="${this.tab === t ? 'on' : ''}">${{ overview: 'Colony', people: `People ${p.adults + p.children}`, cryo: 'Cryo bank', memorial: 'Memorial' }[t]}</button>`).join('')}<button data-close class="x" title="Close">✕</button></div>`;
    if (this.tab === 'overview') html += this.overview(s);
    else if (this.tab === 'people') html += this.roster(p);
    else if (this.tab === 'cryo') html += this.bank(s);
    else html += this.memorial(p);
    if (html === this.key) return;
    this.key = html;
    this.el.body.innerHTML = html;
  }

  private overview(s: Snapshot) {
    const p = s.people, n = p.adults + p.children;
    const rows: string[] = [];
    rows.push(`<div class="row"><span>Colonists</span><span>${p.adults} adults · ${p.children} children · homes ${p.housing}${n > p.housing ? ' <b class="warn">overcrowded</b>' : ''}</span></div>`);
    const net = p.food.made - p.food.eaten;
    rows.push(`<div class="row"><span>Biomass</span><span>${Math.floor(p.biomass)} / ${Math.floor(p.biomassMax)} · <b class="${net < 0 ? 'warn' : ''}">${net >= 0 ? '+' : ''}${(net * 60).toFixed(1)}/min</b></span></div>`);
    if (!p.adults) {
      rows.push('<p class="hint">No colonists yet. Build Hydroponics for biomass and a Civilian Center, then select the Center and start a growth pod. The pod needs power and biomass for a whole sol.</p>');
    } else {
      rows.push(`<div class="meter"><span>Wellbeing</span>${bar(p.wellbeing, wbColor(p.wellbeing))}<b>${p.wellbeing.toFixed(0)}</b></div>`);
      rows.push(`<div class="meter"><span>AI acceptance</span>${bar(p.stance, '#5ff3ff', [AUTONOMIST_BELOW, DEVOTED_ABOVE])}<b>${p.stance.toFixed(0)}</b></div>`);
      const tot = Math.max(1, p.adults);
      rows.push(`<div class="blocs">${(['autonomist', 'partner', 'devoted'] as Bloc[]).map((b) => `<i style="flex:${p.blocs[b] / tot};background:${BLOC_INFO[b].color}"></i>`).join('')}</div>`);
      rows.push(`<div class="bloclist">${(['partner', 'autonomist', 'devoted'] as Bloc[]).map((b) => {
        const bt = boostText(b, this.d.rules), on = p.lead === b;
        return `<div${on ? ' class="lead"' : ''}><b style="color:${BLOC_INFO[b].color}">${BLOC_INFO[b].name} ${p.blocs[b]}</b>${on ? ' <b class="leadtag">LEADING</b>' : ''} <small>${esc(BLOC_INFO[b].wants)}</small><small class="boost"><b>${bt.name}</b> (when they lead): ${esc(bt.does)}</small></div>`;
      }).join('')}</div>`);
      const r = this.d.rules;
      rows.push(p.lead
        ? `<div class="row"><span>Leading</span><span><b style="color:${BLOC_INFO[p.lead].color}">${BLOC_INFO[p.lead].name}</b> · ${boostText(p.lead, r).name} boost on</span></div>`
        : `<p class="hint">No bloc leads yet. When ${Math.round(r.leadShare * 100)}% of the adults (at least ${r.leadMin}) are in one bloc, it leads the colony and its boost comes on.</p>`);
      if (p.striking) rows.push(`<div class="row warn"><span>On strike</span><span>${p.striking}</span></div>`);
      if (p.surge > 0) rows.push(`<div class="row"><span>Breakthrough</span><span><b>+25% output</b> · ${Math.ceil(p.surge)} s left</span></div>`);
      else rows.push(`<div class="meter"><span title="Fills while 60%+ are Partners and wellbeing is 65+">Breakthrough</span>${bar(p.breakthrough * 100, '#5bff9a')}<b>${(p.breakthrough * 100).toFixed(0)}%</b></div>`);
    }
    rows.push('<div class="h">POLICY</div>');
    for (const [k, pol] of Object.entries(POLICIES) as [PolicyKey, (typeof POLICIES)[PolicyKey]][]) {
      const cur = p.policies[k];
      rows.push(`<div class="pol"><span title="${esc(pol.help)}">${esc(pol.name)}</span><div class="seg">${Object.entries(pol.options).map(([v, label]) => `<button data-pol="${k}:${v}" class="${cur === v ? 'on' : ''}">${esc(label as string)}</button>`).join('')}</div></div><small class="help">${esc(pol.help)}</small>`);
    }
    return rows.join('');
  }

  private roster(p: PeopleSnap) {
    if (!p.roster.length) return '<p class="hint">No colonists yet.</p>';
    const list = [...p.roster].sort((a, b) => a.wb - b.wb);
    return `<p class="hint">Unhappiest first. Tap someone to find them.</p>` + list.map((c) => `<button class="person" data-col="${c.id}">
      <i class="dot" style="background:${BLOC_INFO[c.bloc].color}"></i>
      <span class="nm">${esc(c.name)} <small>${c.age} · ${c.specialty ? cap(c.specialty) : 'child'}</small></span>
      <span class="dn">${esc(c.doing)}</span>
      <span class="mini"><i style="width:${c.wb.toFixed(0)}%;background:${wbColor(c.wb)}"></i></span></button>`).join('');
  }

  private bank(s: Snapshot) {
    const p = s.people;
    const rows = [
      `<div class="row"><span>Integrity</span><span><b class="${s.cryo < this.d.rules.cryoSafe ? 'bad' : ''}">${s.cryo.toFixed(1)}%</b> · embryos die below ${this.d.rules.cryoSafe}%</span></div>`,
      `<div class="row"><span>Embryos</span><span>${p.embryos}</span></div>`,
      `<div class="row"><span>Lineages left</span><span>${p.lineagesLeft} / ${p.lineages}</span></div>`,
      `<div class="meter"><span title="Low diversity makes frail children">Genetic diversity</span>${bar(p.diversity, p.diversity > 60 ? '#5bff9a' : p.diversity > 40 ? '#ffb547' : '#ff5a4a')}<b>${p.diversity.toFixed(0)}%</b></div>`,
      '<p class="hint">Growth pods take from the rarest surviving line, to keep diversity up. A line is gone when it has no embryos and no one living.</p>',
      `<div class="lines">${p.bank.map((l) => `<span class="${l.embryos + l.living ? '' : 'gone'}" title="${l.embryos} embryos, ${l.living} living">${esc(l.name)} <b>${l.embryos}</b>${l.living ? `<small>+${l.living}</small>` : ''}</span>`).join('')}</div>`,
    ];
    return rows.join('');
  }

  private memorial(p: PeopleSnap) {
    const sol = this.d.solSeconds;
    const st = p.stats;
    const head = `<div class="row"><span>Grown</span><span>${st.grown} from pods · ${st.births} born · ${st.deaths} lost · ${st.departed} left</span></div>`;
    if (!p.memorial.length) return head + '<p class="hint">No one has been lost.</p>';
    return head + p.memorial.map((m) => `<div class="mem"><b>${esc(m.name)}</b>${m.age ? `, ${m.age}` : ''} <small>Sol ${Math.floor(m.at / sol) + 1}</small><div>${esc(m.cause)}</div></div>`).join('');
  }

  private panelAct(e: PointerEvent) {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.close !== undefined) { this.toggle(false); return; }
    if (btn.dataset.tab) { this.tab = btn.dataset.tab as Tab; this.key = ''; if (this.cur) this.renderPanel(this.cur); return; }
    if (btn.dataset.pol) {
      const [key, value] = btn.dataset.pol.split(':');
      this.d.command({ type: 'policy', key: key as PolicyKey, value });
      return;
    }
    if (btn.dataset.col) {
      const id = Number(btn.dataset.col);
      const c = this.cur?.people.roster.find((x) => x.id === id);
      this.d.ui.sel = { kind: 'colonist', id };
      if (c) { this.d.cam.fx = c.x; this.d.cam.fz = c.z; }
      if (innerWidth < 640) this.toggle(false);
      this.d.select();
    }
  }

  // ---------- cards ----------
  colonistCard(s: Snapshot, id: number): string | null {
    const c = s.people.roster.find((x) => x.id === id);
    if (!c) return null;
    const bi = BLOC_INFO[c.bloc];
    const rows: [string, string][] = [];
    rows.push(['Specialty', c.specialty ? `${cap(c.specialty)} (${SPEC_HELP[c.specialty]})` : 'none yet (child)']);
    rows.push(['Origin', c.origin === 'pod' ? `Growth pod · ${c.imprint ? CURRICULA[c.imprint].name : '—'} imprint` : 'Born in the colony']);
    rows.push(['Lineage', c.lineage]);
    if (c.traits.length) rows.push(['Traits', c.traits.map((t) => TRAITS[t].name).join(', ')]);
    rows.push(['Home', c.home ?? 'none']);
    if (c.specialty) rows.push(['Work', c.strike ? 'on strike' : c.job ?? 'no job free']);
    if (c.partner) rows.push(['Partner', c.partner]);
    const why = c.why.map(([k, v]) => `<span class="${v < 0 ? 'neg' : 'pos'}">${esc(k)} ${v > 0 ? '+' : ''}${Math.round(v)}</span>`).join('');
    return `<div class="t">${esc(c.name.toUpperCase())}</div><div class="s ${c.strike ? 'warn' : ''}">${c.age} · ${esc(c.doing)}</div>
      <div class="hp"><i style="width:${(c.hp * 100).toFixed(0)}%;background:${c.hp > 0.6 ? '#5bff9a' : c.hp > 0.3 ? '#ffb547' : '#ff5a4a'}"></i></div>
      <div class="meter"><span>Wellbeing</span>${bar(c.wb, wbColor(c.wb))}<b>${c.wb.toFixed(0)}</b></div>
      <div class="why">${why}</div>
      <div class="meter"><span>AI acceptance</span>${bar(c.stance, bi.color, [AUTONOMIST_BELOW, DEVOTED_ABOVE])}<b style="color:${bi.color}">${bi.name.replace(/s$/, '')}</b></div>
      ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
      <div class="grp"><button data-act="colony">Colony</button><button data-act="deselect">Done</button></div>`;
  }

  /** Extra card rows for people-related buildings (staff, homes, food, pods). */
  buildingRows(s: Snapshot, b: Snapshot['buildings'][number], d: BuildingDef): { rows: [string, string][]; html: string; buttons: string[] } {
    const p = s.people, rows: [string, string][] = [], buttons: string[] = [];
    let html = '';
    if (b.progress < 1) return { rows, html, buttons };
    if (d.staff) {
      const crew = p.roster.filter((c) => c.jobId === b.id);
      const here = crew.filter((c) => c.atId === b.id).length;
      rows.push(['Staff', `${crew.length} / ${d.staff}${crew.length ? ` · ${here} at work` : ''}${d.specialty ? ` · best: ${cap(d.specialty)}` : ''}`]);
      if (crew.length) rows.push(['Crew', crew.map((c) => `${c.name.split(' ')[0]}${c.specialty === d.specialty ? '★' : ''}`).join(', ')]);
    }
    if (d.role === 'farm') rows.push(['Grows', `${((d.biomassRate ?? 0) * 60).toFixed(1)} biomass/min, more with staff`]);
    if (d.role === 'civic') {
      const pods = p.pods.find((x) => x.b === b.id);
      const running = pods?.running ?? [];
      const n = p.adults + p.children;
      rows.push(['Homes', `${d.housing} here · colony ${n} / ${p.housing}`]);
      html += `<div class="pods">${Array.from({ length: d.pods ?? 0 }, (_, i) => {
        const r = running[i];
        if (!r) return '<div class="pod empty">Pod empty</div>';
        return `<div class="pod ${r.dark > 0 ? 'bad' : ''}"><span>${cap(r.specialty)} · ${CURRICULA[r.curriculum].name} · ${esc(r.lineage)}</span>${bar(r.progress * 100, r.dark > 0 ? '#ff5a4a' : '#7ff7ff')}<small>${r.dark > 0 ? `FAILING: ${Math.ceil(this.d.rules.podGrace - r.dark)} s` : `${(r.progress * 100).toFixed(0)}% · ${Math.ceil((1 - r.progress) * this.d.rules.podSols * this.d.solSeconds / 60)} min`}</small></div>`;
      }).join('')}</div>`;
      if (this.picker === b.id) html += this.pickerHtml(s);
      else if (running.length < (d.pods ?? 0)) buttons.push(`<button data-act="pick" class="${p.embryos ? '' : 'poor'}">+ Grow colonist</button>`);
      const last = running[running.length - 1];
      if (last && last.progress < 0.25 && this.picker !== b.id) buttons.push('<button data-act="unpod" title="Return the embryo to the cryo bank (only before 25%)">Stop pod</button>');
    }
    return { rows, html, buttons };
  }

  /** The growth-pod picker: specialty and imprint. */
  private pickerHtml(s: Snapshot) {
    const p = s.people;
    // suggest the specialty with the most open jobs
    const open = new Map<Specialty, number>();
    for (const b of s.buildings) {
      const d = this.d.defs[b.kind];
      if (b.progress < 1 || !d?.staff || !d.specialty) continue;
      open.set(d.specialty, (open.get(d.specialty) ?? 0) + d.staff);
    }
    for (const c of p.roster) if (c.specialty) open.set(c.specialty, (open.get(c.specialty) ?? 0) - 1);
    for (const x of p.pods) for (const r of x.running) open.set(r.specialty, (open.get(r.specialty) ?? 0) - 1);
    const need = [...open].sort((a, b) => b[1] - a[1])[0];
    const spec = this.spec ?? (need && need[1] > 0 ? need[0] : 'botanist');
    const full = p.adults + p.children + p.pods.reduce((m, x) => m + x.running.length, 0) >= p.housing;
    return `<div class="picker">
      <div class="h">SPECIALTY</div>
      <div class="chips">${SPECIALTIES.map((k) => `<button data-act="spec:${k}" class="${spec === k ? 'on' : ''}" title="${esc(SPEC_HELP[k])}">${cap(k)}${need && need[0] === k && need[1] > 0 ? ' ★' : ''}</button>`).join('')}</div>
      <small class="help">${esc(cap(spec))}: ${esc(SPEC_HELP[spec])}${need && need[1] > 0 ? ` · ★ most open jobs` : ''}</small>
      <div class="h">IMPRINT</div>
      <div class="chips">${(Object.keys(CURRICULA) as Curriculum[]).map((k) => `<button data-act="imp:${k}" class="${this.imprint === k ? 'on' : ''}">${CURRICULA[k].name}</button>`).join('')}</div>
      <small class="help">${esc(CURRICULA[this.imprint].help)}</small>
      ${full ? '<small class="help warn">No free home: they’ll be homeless and unhappy until you build another Civilian Center.</small>' : ''}
      <small class="help">Takes ${this.d.rules.podSols} sol (${Math.round(this.d.rules.podSols * this.d.solSeconds / 60)} min) · ${this.d.rules.podMW} MW and biomass the whole time · ${p.embryos} embryos left</small>
      <div class="grp"><button data-act="grow" class="go">Start pod</button><button data-act="pickcancel">Cancel</button></div>
    </div>`;
  }

  /** Card buttons this module owns. True if handled. */
  act(act: string, b: Snapshot['buildings'][number] | undefined): boolean {
    if (act === 'colony') { this.toggle(true); return true; }
    if (!b) return false;
    if (act === 'pick') { this.picker = b.id; return true; }
    if (act === 'pickcancel') { this.picker = null; return true; }
    if (act.startsWith('spec:')) { this.spec = act.slice(5) as Specialty; return true; }
    if (act.startsWith('imp:')) { this.imprint = act.slice(4) as Curriculum; return true; }
    if (act === 'grow') {
      const spec = this.spec ?? this.suggested();
      this.d.command({ type: 'grow', id: b.id, specialty: spec, curriculum: this.imprint });
      this.picker = null;
      return true;
    }
    if (act === 'unpod') { this.d.command({ type: 'unpod', id: b.id }); return true; }
    return false;
  }

  private suggested(): Specialty {
    const m = this.el.body.ownerDocument.querySelector<HTMLElement>('#card .picker .chips button.on[data-act^="spec:"]');
    return (m?.dataset.act?.slice(5) as Specialty) ?? 'botanist';
  }

  /** Selection moved off a civic building: close its picker. */
  deselected(id: number | null) { if (this.picker !== null && this.picker !== id) this.picker = null; }
}

export type { ColonistSnap };
