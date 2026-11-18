/**
 * The colony HUD (landing mode): resource bar, goals, build menu, selection
 * card, radar minimap and the game-over panel. DOM only; reads snapshots and
 * sends commands. Updated a few times a second, not every frame.
 */
import type { ZoomCamera } from './camera';
import type { BuildingDef, ColonyRules, InhabitantDef, MissionDef, PeopleRules, ResearchDef, StoryDef, UnitDef } from './content/defs';
import { ContactCard } from './contact-card';
import { PeopleHud } from './people-hud';
import { hourAt } from './sim/daylight';
import type { Command, Snapshot } from './sim/types';
import { FOG_N, REGION_HALF } from './sim/types';
import { regionColor } from './world/planet';
import type { RegionUi } from './world/region';
import * as THREE from 'three';

interface HudDeps {
  defs: Record<string, BuildingDef>;
  units: Record<string, UnitDef>;
  research: Record<string, ResearchDef>;
  inhabitants: Record<string, InhabitantDef>;
  story: Record<string, StoryDef>;
  missions: Record<string, MissionDef>;
  rules: ColonyRules;
  people: PeopleRules;
  ui: RegionUi;
  cam: ZoomCamera;
  command(c: Command): void;
  setBuild(kind: string | null): void;
  restart(): void;
  load(): void;
  /** Story cards: pause the game (true) or resume (false). */
  pause(on: boolean): void;
  log(text: string, level?: 'info' | 'warn' | 'bad'): void;
  /** A building was selected (tutorial `opened` conditions). */
  onSelect?(kind: string, role?: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;


export class ColonyHud {
  private el = {
    energy: $('r-energy'), battery: $('r-battery'), alloys: $('r-alloys'), iso: $('r-iso'), cryo: $('r-cryo'), clock: $('r-clock'), threat: $('r-threat'), army: $('r-army'),
    goals: $('goals'), goalsHead: $('goals-head'), goalsList: $('goals-list'), menu: $('build-menu'), card: $('card'), mini: $<HTMLCanvasElement>('minimap'),
    over: $('over'),
  };
  private goalsKey = '';
  private cardKey = '';
  private menuKey = '';
  private terrain: HTMLCanvasElement | null = null;
  private fogCv: HTMLCanvasElement | null = null;
  private last = 0;
  /**
   * Radar as the HUD shows it. A radar that's short of power can flick on and
   * off from tick to tick; the minimap and pack timer ride through short drops
   * instead of blinking. `at` = game secs it was last powered.
   */
  private radar = { at: -1e9, next: null as number | null, built: false };
  cur: Snapshot | null = null;
  readonly people: PeopleHud;
  readonly contact: ContactCard;

  constructor(private d: HudDeps) {
    this.people = new PeopleHud({
      defs: d.defs, inhabitants: d.inhabitants, rules: d.people, solSeconds: d.rules.solSeconds, ui: d.ui, cam: d.cam,
      command: (c) => d.command(c), select: () => this.selected(),
    });
    this.contact = new ContactCard({ inhabitants: d.inhabitants, story: d.story, cam: d.cam, command: (c) => d.command(c), pause: (on) => d.pause(on) });
    // phones start with just the current goal showing
    if (innerWidth < 640) this.el.goals.classList.add('min');
    this.el.goals.onclick = () => this.el.goals.classList.toggle('min');
    this.el.card.addEventListener('pointerdown', (e) => this.act(e));
    this.el.menu.addEventListener('pointerdown', (e) => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (!kind) return;
      e.preventDefault();
      const need = this.d.defs[kind]?.research;
      if (need && this.d.research[need] && !this.cur?.research?.done.includes(need)) { this.d.log(`${this.d.defs[kind].name} needs research: ${this.d.research[need].name} (Tech Lab)`, 'warn'); return; }
      this.d.setBuild(kind);
      this.toggleMenu(false);
    });
    this.el.mini.addEventListener('pointerdown', (e) => {
      const r = this.el.mini.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width * 2 - 1) * REGION_HALF;
      const z = -((e.clientY - r.top) / r.height * 2 - 1) * REGION_HALF;
      this.d.cam.fx = x; this.d.cam.fz = z;
    });
    this.el.army.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const ids = this.cur?.units.map((u) => u.id) ?? [];
      const all = this.d.ui.sel?.kind === 'units' && this.d.ui.sel.ids.length === ids.length;
      if (!ids.length) return;
      if (all) {
        // second tap: centre the camera on them
        this.d.cam.fx = this.cur!.units.reduce((m, u) => m + u.x, 0) / ids.length;
        this.d.cam.fz = this.cur!.units.reduce((m, u) => m + u.z, 0) / ids.length;
      }
      this.d.ui.sel = { kind: 'units', ids };
      this.selected();
    });
    $('over-restart').onclick = () => this.d.restart();
    $('over-load').onclick = () => this.d.load();
  }

  toggleMenu(open?: boolean) {
    const on = open ?? !this.el.menu.classList.contains('open');
    this.el.menu.classList.toggle('open', on);
    document.body.classList.toggle('menu-open', on);
    if (on) { this.menuKey = ''; this.renderMenu(); }
  }

  /** Call every frame; it redraws at ~6 Hz. */
  update(s: Snapshot, speed: number, now: number) {
    this.cur = s;
    if (s.radar) { this.radar.at = s.secs; this.radar.next = s.nextPack; }
    if (s.secs < this.radar.at) this.radar.at = -1e9; // new game / load
    this.radar.built = s.buildings.some((b) => b.progress >= 1 && this.d.defs[b.kind]?.role === 'radar');
    if (now - this.last < 160) return;
    this.last = now;
    this.renderBar(s, speed);
    this.contact.update(s);
    this.renderGoals(s);
    if (this.el.menu.classList.contains('open')) this.renderMenu();
    this.renderCard(s);
    this.renderMini(s);
    this.renderOver(s);
  }

  /** Radar on (allowing a few seconds' brownout), and its pack timer. */
  private radarView(s: Snapshot) {
    const on = this.radar.built && s.secs - this.radar.at < 4;
    const next = on ? (s.radar ? s.nextPack : this.radar.next === null ? null : Math.max(0, this.radar.next - (s.secs - this.radar.at))) : null;
    return { on, next, offline: this.radar.built && !on };
  }

  /** Force the card to rebuild (selection changed). */
  selected() {
    this.cardKey = '';
    const sel = this.d.ui.sel;
    if (sel?.kind === 'building') {
      const b = this.cur?.buildings.find((x) => x.id === sel.id);
      if (b) this.d.onSelect?.(b.kind, this.d.defs[b.kind]?.role);
    }
    this.people.deselected(sel?.kind === 'building' ? sel.id : null);
    if (this.cur) this.renderCard(this.cur);
  }

  private renderBar(s: Snapshot, speed: number) {
    const e = this.el;
    const short = s.short > 0.01, draining = s.gen < s.draw && s.stored > 0;
    e.energy.innerHTML = `⚡ <b>${s.gen.toFixed(1)}</b>/${s.draw.toFixed(1)}<span class="u"> MW</span>`;
    e.energy.className = `r ${short ? 'bad' : draining || s.gen < s.draw ? 'warn' : ''}`;
    e.energy.title = short ? `Cryo bank short ${s.short.toFixed(1)} MW` : 'Power generated / wanted';
    // every slot stays put (dimmed when empty) so nothing jumps around on a phone
    const pct = s.storageMax > 0 ? (s.stored / s.storageMax) * 100 : 0;
    e.battery.innerHTML = s.storageMax > 0 ? `🔋 <b>${pct.toFixed(0)}%</b>` : '🔋 <b>—</b>';
    e.battery.className = `r ${s.storageMax <= 0 ? 'dim' : draining && pct < 25 ? 'warn' : ''}`;
    e.battery.title = s.storageMax > 0 ? 'Battery charge' : 'No Battery Bank yet';
    e.alloys.innerHTML = `◆ <b>${Math.floor(s.alloys)}</b>`;
    // isotopes: dim until there are some (or something to make or burn them)
    const isoOn = (s.isotopes ?? 0) >= 1 || s.buildings.some((b) => { const r = this.d.defs[b.kind]?.role; return r === 'deepmine' || r === 'reactor'; });
    e.iso.innerHTML = isoOn ? `◇ <b>${Math.floor(s.isotopes ?? 0)}</b>` : '◇ <b>—</b>';
    e.iso.className = `r ${isoOn ? '' : 'dim'}`;
    e.iso.title = isoOn ? 'Exotic isotopes' : 'Exotic isotopes: a Deep-Core Mine on an isotope seam (research Deep Survey at a Tech Lab)';
    this.people.renderBar(s);
    const sol = this.d.rules.solSeconds;
    const sl = Math.floor(s.secs / sol) + 1, h = hourAt(s.secs, sol);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    e.clock.textContent = `SOL ${sl} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${s.daylight > 0.5 ? '☀' : '☾'}${speed === 0 ? ' · PAUSED' : speed > 1 ? ` · ×${speed}` : ''}`;
    const seen = s.packs.filter((p) => p.seen);
    const rv = this.radarView(s);
    if (seen.length) { e.threat.className = 'r bad'; e.threat.innerHTML = `⚠ <b>${seen.reduce((m, p) => m + p.alive, 0)}</b><span class="w"> predators</span>`; e.threat.title = 'Predators on the map'; }
    else if (rv.next !== null) { e.threat.className = `r ${rv.next < 30 ? 'warn' : ''}`; e.threat.innerHTML = `⚠<span class="w"> next pack</span> <b>${mmss(rv.next)}</b>`; e.threat.title = 'Next predator pack (radar)'; }
    else if (rv.offline) { e.threat.className = 'r warn'; e.threat.innerHTML = '⚠ <b>off</b><span class="w"> (radar)</span>'; e.threat.title = 'The radar has no power'; }
    else { e.threat.className = 'r dim'; e.threat.innerHTML = '⚠ <b>—</b>'; e.threat.title = 'Build a Radar to see packs coming'; }
    const n = s.units.length;
    e.army.innerHTML = `⚔ <b>${n}</b>`;
    e.army.className = `r tap ${n ? '' : 'dim'} ${this.d.ui.sel?.kind === 'units' ? 'on' : ''}`;
    e.army.title = n ? 'Combat units: tap to select them all' : 'No combat units yet (Vehicle Bay)';
  }

  /** GOALS: the objectives of the missions under way (content/missions; the sim announces progress). */
  private renderGoals(s: Snapshot) {
    const m = s.missions ?? { active: [], done: [] };
    const missions = m.active.map((a) => ({ a, def: this.d.missions[a.id] })).filter((x) => x.def);
    let head = 'GOALS', html = '';
    if (missions.length) {
      head = missions.map((x) => x.def.title.toUpperCase()).join(' · ');
      let now = false;
      html = missions.map(({ a, def }) => def.objectives.map((o, i) => {
        const done = a.marks[i];
        const cls = done ? 'done' : now ? '' : ((now = true), 'now');
        return `<li class="${cls}">${esc(o.text)}</li>`;
      }).join('')).join('');
    } else if (m.done.length) html = '<li class="done">All missions complete</li>';
    // countdowns the story started, under the goals
    for (const c of s.story?.countdowns ?? []) {
      html += `<li class="timer${c.left < 30 ? ' low' : ''}">⏱ ${esc(c.text || c.id)} <b>${mmss(Math.ceil(c.left))}</b></li>`;
      if (head === 'GOALS') head = 'COUNTDOWN';
    }
    const key = head + html;
    this.el.goals.style.display = key === 'GOALS' ? 'none' : '';
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    this.el.goalsHead.textContent = head;
    this.el.goalsList.innerHTML = html;
  }


  private renderMenu() {
    const s = this.cur;
    const alloys = s ? Math.floor(s.alloys) : 0, iso = s ? Math.floor(s.isotopes ?? 0) : 0;
    const done = (id?: string) => !id || !this.d.research[id] || !!s?.research?.done.includes(id);
    const locked = s?.story?.locked ?? [];
    const items = Object.entries(this.d.defs).filter(([k, d]) => d.buildable && d.role !== 'core' && !locked.includes(k)).sort((a, b) => Number(!done(a[1].research)) - Number(!done(b[1].research)) || a[1].cost - b[1].cost);
    const key = items.map(([k, d]) => `${k}:${alloys >= d.cost && iso >= (d.isotopes ?? 0)}:${done(d.research)}`).join() + this.d.ui.build;
    if (key === this.menuKey) return;
    this.menuKey = key;
    this.el.menu.innerHTML = items.map(([k, d]) => {
      const pw = d.powerMW > 0 ? `+${d.powerMW} MW${d.role === 'solar' ? ' by day' : ''}` : d.powerMW < 0 ? `${d.powerMW} MW` : d.role === 'battery' ? `${d.storage} MJ` : d.role === 'wall' ? `per ${d.clearance} u` : d.role === 'gate' ? 'on a wall' : d.role === 'sensor' ? `sees ${d.sight} u` : d.role === 'civic' && d.housing ? `homes ${d.housing}` : '';
      if (!done(d.research)) return `<button data-kind="${k}" class="locked" title="${esc(d.description ?? '')}"><b>${esc(d.name)}</b><span class="meta"><small class="cost">🔒 ${esc(this.d.research[d.research!].name)}</small></span></button>`;
      return `<button data-kind="${k}" class="${alloys < d.cost || iso < (d.isotopes ?? 0) ? 'poor' : ''} ${this.d.ui.build === k ? 'on' : ''}" title="${esc(d.description ?? '')}"><b>${esc(d.name)}</b><span class="meta"><small class="cost">${d.cost}◆${d.isotopes ? ` ${d.isotopes}◇` : ''}</small> <small>${pw}</small></span></button>`;
    }).join('');
  }

  private status(s: Snapshot, b: Snapshot['buildings'][number], d: BuildingDef): [string, string] {
    if (b.progress < 1) return [`Under construction · ${Math.floor(b.progress * 100)}%`, s.drones.some((x) => x.task === 'build') ? '' : 'warn'];
    if (!b.on) return ['Switched off', 'warn'];
    if (!b.powered && d.powerMW < 0) return ['No power (load shed)', 'bad'];
    if (d.role === 'depot' && (b.mining === undefined || b.mining < 0)) return ['Idle: no deposit in reach', 'warn'];
    if (d.role === 'repair') return b.engaged ? ['Repairing units', ''] : ['Idle: park damaged units here', ''];
    if (d.role === 'gate') return ['Closed to predators · open to your units', ''];
    if (d.role === 'sensor') return ['Watching', ''];
    if (d.role === 'lab') {
      const a = s.research?.active;
      return a ? [`Researching ${this.d.research[a.id]?.name ?? a.id} · ${Math.floor(a.progress * 100)}%`, ''] : ['Idle: pick something to research', ''];
    }
    if (d.role === 'deepmine' && (b.mining === undefined || b.mining < 0)) return ['Idle: no isotope seam in reach', 'warn'];
    if (d.role === 'reactor' && !b.powered) return ['Out of isotopes', 'bad'];
    if (d.role === 'relay') return ['Relaying · build area extended', ''];
    if (d.role === 'factory') {
      if (!b.queue?.length) return ['Idle: queue a unit', ''];
      return [`Producing ${this.d.units[b.queue[0]]?.name ?? b.queue[0]} · ${Math.floor((b.prod ?? 0) * 100)}%`, ''];
    }
    return ['Online', ''];
  }

  private renderCard(s: Snapshot) {
    const sel = this.d.ui.sel;
    const card = this.el.card;
    document.body.classList.toggle('card-open', !!sel);
    if (!sel) { card.classList.remove('on'); this.cardKey = ''; return; }
    let html = '';
    if (sel.kind === 'units') {
      const us = s.units.filter((u) => sel.ids.includes(u.id));
      if (!us.length) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      if (us.length !== sel.ids.length) sel.ids = us.map((u) => u.id); // drop the dead
      const counts = new Map<string, number>();
      for (const u of us) counts.set(u.unit, (counts.get(u.unit) ?? 0) + 1);
      const title = [...counts].map(([k, n]) => `${n} ${(this.d.units[k]?.name ?? k).toUpperCase()}${n > 1 ? 'S' : ''}`).join(' · ');
      const hp = us.reduce((m, u) => m + u.hp, 0) / us.length;
      const fighting = us.filter((u) => u.engaged).length, moving = us.filter((u) => u.order === 'move').length;
      const st = fighting ? `${fighting} engaging` : moving ? 'Moving' : 'Guarding';
      const rows: [string, string][] = [];
      if (us.length === 1) {
        const d = this.d.units[us[0].unit];
        if (d.repairRate) rows.push(['Repairs', `${d.repairRate} hp/s · reach ${d.range} u · costs alloys`]);
        else rows.push(['Weapon', `${(d.damage / d.cooldown).toFixed(0)} dmg/s · range ${d.minRange ? `${d.minRange}–` : ''}${d.range} u${d.splash ? ' · splash' : ''}${d.chain ? ` · arcs to ${d.chain} more` : ''}`]);
        if (d.sight && d.sight > 40) rows.push(['Sight', `${d.sight} u`]);
        rows.push(['Speed', `${d.speed} u/s`]);
      }
      rows.push(['Move', this.coarse() ? 'tap ground or drag from a unit' : 'click ground or drag from a unit']);
      rows.push(['Select', this.coarse() ? 'hold or double-tap: all of a type' : 'double-click: all of a type']);
      html = `<div class="t">${esc(title)}</div><div class="s ${fighting ? 'warn' : ''}">${st}</div>
        <div class="hp"><i style="width:${(hp * 100).toFixed(0)}%;background:${hp > 0.6 ? '#5bff9a' : hp > 0.3 ? '#ffb547' : '#ff5a4a'}"></i></div>
        ${rows.map(([k, v]) => `<div class="row ${k === 'Move' || k === 'Select' ? 'tip' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
        <div class="grp"><button data-act="stop" title="Stop and guard here (X)">Stop</button><button data-act="deselect">Done</button></div>`;
    } else if (sel.kind === 'colonist') {
      const c = this.people.colonistCard(s, sel.id);
      if (!c) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      html = c;
    } else if (sel.kind === 'drone') {
      const dr = s.drones.find((x) => x.id === sel.id);
      if (!dr) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      const n = s.drones.indexOf(dr) + 1;
      const task = { idle: 'Idle', move: 'Moving', build: 'Building', repair: 'Repairing' }[dr.task];
      html = `<div class="t">WORKER DRONE ${n}</div><div class="s">${task}${dr.manual ? ' (your order)' : ''}</div>
        <div class="hp"><i style="width:${(dr.hp * 100).toFixed(0)}%"></i></div>
        <div class="row tip"><span>Tip</span><span>drag from it, or tap the ground</span></div>`;
    } else {
      const b = s.buildings.find((x) => x.id === sel.id);
      const d = b && this.d.defs[b.kind];
      if (!b || !d) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      const [st, cls] = this.status(s, b, d);
      const rows: [string, string][] = [];
      rows.push(['Hit points', `${Math.ceil(b.hp)} / ${d.hp}`]);
      if (d.powerMW > 0) rows.push(['Power', d.role === 'solar' ? `+${(d.powerMW * (this.d.rules.nightSolar + (1 - this.d.rules.nightSolar) * s.daylight)).toFixed(1)} MW now` : `+${d.powerMW} MW`]);
      else if (d.powerMW < 0) rows.push(['Power', `${d.powerMW} MW${d.fireRange ? ' when firing' : ''}`]);
      if (d.fireRange && d.damage && d.cooldown) rows.push(['Weapon', `${(d.damage / d.cooldown).toFixed(0)} dmg/s · range ${d.minRange ? `${d.minRange}–` : ''}${d.fireRange} u${d.splash ? ' · splash' : ''}`]);
      if (d.role === 'repair') rows.push(['Repairs', `${d.repairRate} hp/s per unit within ${d.range} u`]);
      if (d.role === 'depot') {
        const dep = b.mining !== undefined && b.mining >= 0 ? s.deposits[b.mining] : undefined;
        rows.push(['Mining', `${d.mineRate} alloys/s`]);
        if (dep) rows.push(['Deposit left', `${Math.floor(dep.alloys)} / ${dep.max}`]);
      }
      if (d.role === 'battery') rows.push(['Bank (all)', `${Math.round(s.stored)} / ${Math.round(s.storageMax)} MJ`]);
      if (d.role === 'radar') rows.push(['Next pack', s.nextPack !== null ? mmss(s.nextPack) : '—']);
      if (d.role === 'sensor' && d.sight) rows.push(['Sees', `${d.sight} u`]);
      if (d.role === 'deepmine') {
        const sm = b.mining !== undefined && b.mining >= 0 ? s.seams?.[b.mining] : undefined;
        rows.push(['Mining', `${d.mineRate} isotopes/s`]);
        if (sm) rows.push(['Seam left', `${Math.floor(sm.isotopes)} / ${sm.max}`]);
        if (d.lure) rows.push(['Noise', 'loud: draws predator packs']);
      }
      if (d.role === 'reactor') rows.push(['Burns', `${d.fuelRate} isotopes/s · ${Math.floor(s.isotopes ?? 0)} in store`]);
      if (d.role === 'relay' && d.range) rows.push(['Build area', `${d.range} u around it`]);
      if (d.role === 'civic' && !d.pods && d.housing) rows.push(['Growth pods', 'none: housing only']);
      const pe = this.people.buildingRows(s, b, d);
      rows.push(...pe.rows);
      if (d.role === 'core') {
        rows.push(['Cryo bank', `${s.people.embryos} embryos · ${s.cryo.toFixed(1)}%`]);
        rows.push(['Drones', `${s.drones.length} / ${this.d.rules.maxDrones}${s.fab.queued ? ` · fabricating ${Math.floor(s.fab.progress * 100)}%` : ''}`]);
      }
      const btn: string[] = [];
      if (d.role === 'core') btn.push(`<button data-act="fab" title="Fabricate a worker drone">+ Drone <small>${this.d.rules.droneCost}◆</small></button>`);
      let queue = '';
      if (d.role === 'factory' && b.progress >= 1) {
        const q = b.queue ?? [];
        const total = s.units.length + s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0);
        rows.push(['Army', `${s.units.length} / ${this.d.rules.maxUnits}${total > s.units.length ? ` (+${total - s.units.length} queued)` : ''}`]);
        queue = q.length ? `<div class="q">${q.map((k, i) => `<i class="${i ? '' : 'now'}">${esc(this.d.units[k]?.name ?? k)}</i>`).join('')}</div>` : '';
        for (const [k, u] of Object.entries(this.d.units).sort((a, b) => (a[1].cost ?? 0) - (b[1].cost ?? 0))) {
          if (u.faction !== 'accord' || u.cost === undefined) continue;
          if (u.research && this.d.research[u.research] && !s.research?.done.includes(u.research)) continue; // not yet: the Tech Lab lists it
          if (s.story?.locked?.includes(k)) continue; // the story hasn't opened it up yet
          btn.push(`<button data-act="produce:${k}" class="${s.alloys < u.cost || (s.isotopes ?? 0) < (u.isotopes ?? 0) || total >= this.d.rules.maxUnits ? 'poor' : ''}" title="${esc(u.description ?? '')}">+ ${esc(u.name)} <small>${u.cost}◆${u.isotopes ? ` ${u.isotopes}◇` : ''}</small></button>`);
        }
        if (q.length) btn.push('<button data-act="unqueue" title="Cancel the last queued unit (full refund)">Cancel last</button>');
      }
      let lab = '';
      if (d.role === 'lab' && b.progress >= 1) {
        const R = s.research ?? { done: [], active: null };
        const list = Object.entries(this.d.research).sort((a, b) => (a[1].order ?? 100) - (b[1].order ?? 100) || a[1].cost - b[1].cost);
        const unlocks = (id: string) => [...Object.values(this.d.defs), ...Object.values(this.d.units)].filter((x) => x.research === id).map((x) => x.name).join(', ');
        lab = `<div class="research">${list.map(([id, r]) => {
          const isDone = R.done.includes(id), now = R.active?.id === id;
          const ready = !r.requires || !this.d.research[r.requires] || R.done.includes(r.requires);
          const what = unlocks(id);
          const right = isDone ? '✓ done' : now ? `${Math.floor(R.active!.progress * 100)}%` : ready ? `${r.cost}◆${r.isotopes ? ` ${r.isotopes}◇` : ''} · ${r.seconds}s` : `after ${this.d.research[r.requires!].name}`;
          return `<div class="rs ${isDone ? 'done' : now ? 'now' : ''}" title="${esc(r.description ?? '')}"><span>${esc(r.name)}${what ? ` → ${esc(what)}` : ''}</span><span>${esc(right)}</span></div>`;
        }).join('')}</div>`;
        if (R.active) btn.push('<button data-act="unresearch" title="Stop and get the cost back">Cancel research</button>');
        else for (const [id, r] of list) {
          if (R.done.includes(id) || (r.requires && this.d.research[r.requires] && !R.done.includes(r.requires))) continue;
          btn.push(`<button data-act="research:${id}" class="${s.alloys < r.cost || (s.isotopes ?? 0) < (r.isotopes ?? 0) ? 'poor' : ''}" title="${esc(r.description ?? '')}">${esc(r.name)} <small>${r.cost}◆${r.isotopes ? ` ${r.isotopes}◇` : ''}</small></button>`);
        }
      }
      btn.push(...pe.buttons);
      if (b.progress >= 1 && b.hp < d.hp) btn.push('<button data-act="repair">Repair</button>');
      if (d.role !== 'core' && b.progress >= 1) btn.push(`<button data-act="power">${b.on ? 'Switch off' : 'Switch on'}</button>`);
      if (d.role !== 'core') btn.push(`<button data-act="demolish">${b.progress < 1 ? 'Cancel' : 'Recycle'}</button>`);
      html = `<div class="t">${esc(d.name.toUpperCase())}</div><div class="s ${cls}">${esc(st)}</div>
        <div class="hp"><i style="width:${Math.min(100, (b.hp / d.hp) * 100).toFixed(0)}%;background:${b.hp / d.hp > 0.6 ? '#5bff9a' : b.hp / d.hp > 0.3 ? '#ffb547' : '#ff5a4a'}"></i></div>
        ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}${queue}${lab}${pe.html}
        <div class="grp">${btn.join('')}</div>`;
    }
    card.classList.add('on');
    if (html !== this.cardKey) { card.innerHTML = html; this.cardKey = html; }
  }

  private act(e: PointerEvent) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const sel = this.d.ui.sel;
    if (!act || !sel || !this.cur) return;
    e.preventDefault();
    if (sel.kind === 'colonist') {
      if (act === 'deselect') this.d.ui.sel = null;
      else this.people.act(act, undefined);
      this.cardKey = '';
      return;
    }
    if (sel.kind === 'units') {
      if (act === 'stop') this.d.command({ type: 'stop', ids: sel.ids });
      if (act === 'deselect') this.d.ui.sel = null;
      this.cardKey = '';
      return;
    }
    const b = this.cur.buildings.find((x) => x.id === sel.id);
    if (this.people.act(act, b)) { this.cardKey = ''; this.renderCard(this.cur); return; }
    if (act === 'fab') this.d.command({ type: 'fab' });
    else if (b && act.startsWith('produce:')) this.d.command({ type: 'produce', id: b.id, unit: act.slice(8) });
    else if (b && act === 'unqueue') this.d.command({ type: 'unqueue', id: b.id });
    else if (act.startsWith('research:')) this.d.command({ type: 'research', id: act.slice(9) });
    else if (act === 'unresearch') this.d.command({ type: 'unresearch' });
    else if (!b) return;
    else if (act === 'repair') this.d.command({ type: 'repair', id: b.id });
    else if (act === 'power') this.d.command({ type: 'power', id: b.id, on: !b.on });
    else if (act === 'demolish') {
      const d = this.d.defs[b.kind];
      if (b.progress >= 1 && !confirm(`Recycle this ${d.name}? You get back about half its cost.`)) return;
      this.d.command({ type: 'demolish', id: b.id });
      this.d.ui.sel = null;
    }
    this.cardKey = '';
  }

  private coarse() { return matchMedia('(pointer: coarse)').matches; }

  private terrainImage() {
    if (this.terrain) return this.terrain;
    const n = 120, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d')!, img = g.createImageData(n, n), c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n * 2 - 1) * REGION_HALF, z = -((j + 0.5) / n * 2 - 1) * REGION_HALF;
      regionColor(x, z, c);
      const o = (j * n + i) * 4;
      img.data[o] = c.r * 200; img.data[o + 1] = c.g * 200; img.data[o + 2] = c.b * 200; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (this.terrain = cv);
  }

  private renderMini(s: Snapshot) {
    const cv = this.el.mini;
    const rv = this.radarView(s);
    cv.classList.toggle('on', this.radar.built);
    cv.classList.toggle('off', rv.offline);
    if (!this.radar.built) return;
    const g = cv.getContext('2d')!, W = cv.width;
    const px = (x: number) => ((x / REGION_HALF + 1) / 2) * W, pz = (z: number) => ((-z / REGION_HALF + 1) / 2) * W;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.85;
    g.drawImage(this.terrainImage(), 0, 0, W, W);
    g.globalAlpha = 1;
    g.fillStyle = '#ffb547';
    for (const d of s.deposits) if (d.alloys > 0) { g.beginPath(); g.arc(px(d.x), pz(d.z), 2.5, 0, 7); g.fill(); }
    const fill = g.fillStyle;
    g.fillStyle = '#9b86ff';
    for (const v of s.seams ?? []) if (v.isotopes > 0) { g.beginPath(); g.arc(px(v.x), pz(v.z), 2.5, 0, 7); g.fill(); }
    g.fillStyle = '#c9b8ff';
    for (const c of s.caches ?? []) if (c.found && !c.opened) g.fillRect(px(c.x) - 2, pz(c.z) - 2, 4, 4);
    g.fillStyle = '#9aa3ab';
    for (const w of s.wrecks ?? []) if (w.found && w.alloys > 0) g.fillRect(px(w.x) - 2.5, pz(w.z) - 1.5, 5, 3);
    g.fillStyle = fill;
    for (const b of s.buildings) {
      const d = this.d.defs[b.kind];
      const r = Math.max(2, (d?.clearance ?? 8) / REGION_HALF * W * 0.3);
      g.fillStyle = b.kind === 'core' ? '#ffffff' : b.progress < 1 ? '#7f9aa6' : '#5ff3ff';
      g.fillRect(px(b.x) - r, pz(b.z) - r, r * 2, r * 2);
    }
    g.fillStyle = '#ffffff';
    for (const d of s.drones) g.fillRect(px(d.x) - 1, pz(d.z) - 1, 3, 3);
    g.fillStyle = '#5ff3ff';
    for (const u of s.units) g.fillRect(px(u.x) - 1.5, pz(u.z) - 1.5, 3, 3);
    // fog of war: unexplored black, explored dim (drawn under the radar blips)
    if (s.fog) {
      this.fogCv ??= Object.assign(document.createElement('canvas'), { width: FOG_N, height: FOG_N });
      const fg = this.fogCv.getContext('2d')!, img = fg.createImageData(FOG_N, FOG_N);
      for (let j = 0; j < FOG_N; j++) for (let i = 0; i < FOG_N; i++) {
        const v = s.fog[j * FOG_N + i], o = ((FOG_N - 1 - j) * FOG_N + i) * 4; // canvas y runs south
        img.data[o + 3] = v === 2 ? 0 : v === 1 ? 110 : 225;
      }
      fg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCv, 0, 0, W, W);
      g.imageSmoothingEnabled = false;
    }
    // radar blips: every predator on the map, fog or not
    g.fillStyle = '#ff4d5e';
    const bl = rv.offline ? new Float32Array(0) : s.blips ?? new Float32Array(0);
    for (let i = 0; i < bl.length; i += 2) g.fillRect(px(bl[i]) - 1.5, pz(bl[i + 1]) - 1.5, 3, 3);
    // story waypoints
    const pulse = 3 + Math.sin(performance.now() / 200) * 1.2;
    g.strokeStyle = '#ffb547'; g.lineWidth = 2;
    for (const m of s.story?.marks ?? []) { g.beginPath(); g.arc(px(m.x), pz(m.z), pulse + 2, 0, 7); g.stroke(); }
    g.lineWidth = 1;
    // where the camera is looking
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.strokeRect(px(this.d.cam.fx) - 10, pz(this.d.cam.fz) - 7, 20, 14);
    if (rv.offline) {
      g.fillStyle = 'rgba(5,10,16,.6)';
      g.fillRect(0, 0, W, W);
      g.fillStyle = '#ffb547';
      g.font = `600 ${Math.round(W / 9)}px ui-monospace, monospace`;
      g.textAlign = 'center';
      g.fillText('RADAR', W / 2, W / 2 - 4);
      g.fillText('OFFLINE', W / 2, W / 2 + W / 9);
    }
  }

  private renderOver(s: Snapshot) {
    const on = !!s.over;
    this.el.over.classList.toggle('on', on);
    if (!on) return;
    this.el.over.classList.toggle('won', s.over === 'won');
    $('over-title').textContent = s.over === 'won' ? 'COLONY ENDURES' : 'COLONY LOST';
    $('over-sub').textContent = s.over === 'won' || s.over === 'story' ? (s.overText || (s.over === 'won' ? 'You won through.' : 'The colony is lost.')) : s.over === 'core' ? 'The Command Core was destroyed.' : s.over === 'cryo' ? 'The cryo bank failed. The last embryos are gone, and no one is left to carry on.' : 'No colonists are left, and the cryo bank is empty.';
    const sol = Math.floor(s.secs / this.d.rules.solSeconds) + 1;
    $('over-stats').textContent = `Lasted ${mmss(s.secs)} (Sol ${sol}) · ${s.stats.kills} predators killed · ${s.stats.packsBeaten} packs beaten\n${Math.round(s.stats.mined)} alloys mined · ${s.stats.buildingsLost} buildings lost · ${s.stats.unitsLost ?? 0} units lost · missions ${s.missions?.done.length ?? 0}${s.people ? `\n${s.people.stats.grown} grown · ${s.people.stats.births} born · ${s.people.stats.deaths} lost · ${s.people.stats.departed} left · ${s.people.embryos} embryos left` : ''}`;
  }

  /** Forget goal progress (new game). */
  reset() { this.goalsKey = ''; this.cardKey = ''; this.menuKey = ''; this.contact.reset(); }
}
