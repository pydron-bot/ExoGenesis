/**
 * The colony HUD (landing mode): resource bar, goals, build menu, selection
 * card, radar minimap and the game-over panel. DOM only; reads snapshots and
 * sends commands. Updated a few times a second, not every frame.
 */
import type { ZoomCamera } from './camera';
import type { BuildingDef, ColonyRules } from './content/defs';
import { hourAt } from './sim/daylight';
import type { Command, Snapshot } from './sim/types';
import { F, STRIDE } from './skirmish/types';
import { REGION_HALF } from './sim/types';
import { regionFlora, regionHeightRaw, terrainColor } from './world/planet';
import type { RegionUi } from './world/region';
import * as THREE from 'three';

interface HudDeps {
  defs: Record<string, BuildingDef>;
  rules: ColonyRules;
  ui: RegionUi;
  cam: ZoomCamera;
  command(c: Command): void;
  setBuild(kind: string | null): void;
  restart(): void;
  load(): void;
  log(text: string, level?: 'info' | 'warn' | 'bad'): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Goal { id: string; text: string; done: (s: Snapshot) => boolean }

export class ColonyHud {
  private el = {
    energy: $('r-energy'), battery: $('r-battery'), alloys: $('r-alloys'), cryo: $('r-cryo'), clock: $('r-clock'), threat: $('r-threat'),
    goals: $('goals'), goalsList: $('goals-list'), menu: $('build-menu'), card: $('card'), mini: $<HTMLCanvasElement>('minimap'),
    over: $('over'),
  };
  private goals: Goal[];
  private reached = new Set<string>();
  private cardKey = '';
  private menuKey = '';
  private terrain: HTMLCanvasElement | null = null;
  private last = 0;
  cur: Snapshot | null = null;

  constructor(private d: HudDeps) {
    const has = (s: Snapshot, role: string) => s.buildings.some((b) => b.progress >= 1 && this.d.defs[b.kind]?.role === role);
    const sol = (s: Snapshot) => Math.floor(s.secs / this.d.rules.solSeconds) + 1;
    this.goals = [
      { id: 'solar', text: 'Build a Solar Array to power the cryo bank', done: (s) => has(s, 'solar') },
      { id: 'depot', text: 'Build a Mining Depot near an alloy deposit', done: (s) => has(s, 'depot') },
      { id: 'battery', text: 'Build a Battery Bank before nightfall', done: (s) => has(s, 'battery') },
      { id: 'turret', text: 'Build a Defense Turret', done: (s) => has(s, 'turret') },
      { id: 'pack', text: 'Destroy a predator pack', done: (s) => s.stats.packsBeaten >= 1 },
      { id: 'radar', text: 'Build a Radar for early warning', done: (s) => has(s, 'radar') },
      { id: 'drone', text: 'Fabricate a second worker drone at the Core', done: (s) => s.drones.length >= 2 },
      { id: 'sol4', text: 'Keep the colony alive until Sol 4', done: (s) => sol(s) >= 4 },
    ];
    // phones start with just the current goal showing
    if (innerWidth < 640) this.el.goals.classList.add('min');
    this.el.goals.onclick = () => this.el.goals.classList.toggle('min');
    this.el.card.addEventListener('pointerdown', (e) => this.act(e));
    this.el.menu.addEventListener('pointerdown', (e) => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (!kind) return;
      e.preventDefault();
      this.d.setBuild(kind);
      this.toggleMenu(false);
    });
    this.el.mini.addEventListener('pointerdown', (e) => {
      const r = this.el.mini.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width * 2 - 1) * REGION_HALF;
      const z = -((e.clientY - r.top) / r.height * 2 - 1) * REGION_HALF;
      this.d.cam.fx = x; this.d.cam.fz = z;
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
    if (now - this.last < 160) return;
    this.last = now;
    this.renderBar(s, speed);
    this.renderGoals(s);
    if (this.el.menu.classList.contains('open')) this.renderMenu();
    this.renderCard(s);
    this.renderMini(s);
    this.renderOver(s);
  }

  /** Force the card to rebuild (selection changed). */
  selected() { this.cardKey = ''; if (this.cur) this.renderCard(this.cur); }

  private renderBar(s: Snapshot, speed: number) {
    const e = this.el;
    const short = s.short > 0.01, draining = s.gen < s.draw && s.stored > 0;
    e.energy.innerHTML = `⚡ <b>${s.gen.toFixed(1)}</b> / ${s.draw.toFixed(1)} MW`;
    e.energy.className = `r ${short ? 'bad' : draining || s.gen < s.draw ? 'warn' : ''}`;
    e.energy.title = short ? `Cryo bank short ${s.short.toFixed(1)} MW` : 'Power generated / wanted';
    e.battery.style.display = s.storageMax > 0 ? '' : 'none';
    const pct = s.storageMax > 0 ? (s.stored / s.storageMax) * 100 : 0;
    e.battery.innerHTML = `🔋 <b>${pct.toFixed(0)}%</b>`;
    e.battery.className = `r ${draining && pct < 25 ? 'warn' : ''}`;
    e.alloys.innerHTML = `◆ <b>${Math.floor(s.alloys)}</b>`;
    e.cryo.innerHTML = `❄ <b>${s.cryo.toFixed(1)}%</b>`;
    e.cryo.className = `r ${s.cryo < 30 ? 'bad' : short ? 'warn' : ''}`;
    const sol = this.d.rules.solSeconds;
    const sl = Math.floor(s.secs / sol) + 1, h = hourAt(s.secs, sol);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    e.clock.textContent = `SOL ${sl} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${s.daylight > 0.5 ? '☀' : '☾'}${speed === 0 ? ' · PAUSED' : speed > 1 ? ` · ×${speed}` : ''}`;
    const seen = s.packs.filter((p) => p.seen);
    if (seen.length) { e.threat.style.display = ''; e.threat.className = 'r bad'; e.threat.innerHTML = `⚠ <b>${seen.reduce((m, p) => m + p.alive, 0)}</b> predators`; }
    else if (s.nextPack !== null) { e.threat.style.display = ''; e.threat.className = `r ${s.nextPack < 30 ? 'warn' : ''}`; e.threat.innerHTML = `⚠ next pack <b>${mmss(s.nextPack)}</b>`; }
    else e.threat.style.display = 'none';
  }

  private renderGoals(s: Snapshot) {
    for (const g of this.goals) if (!this.reached.has(g.id) && g.done(s)) {
      this.reached.add(g.id);
      this.d.log(`Goal complete: ${g.text}`);
    }
    const first = this.goals.find((g) => !this.reached.has(g.id));
    const html = this.goals.map((g, i) => `<li value="${i + 1}" class="${this.reached.has(g.id) ? 'done' : g === first ? 'now' : ''}">${esc(g.text)}</li>`).join('');
    if (this.el.goalsList.innerHTML !== html) this.el.goalsList.innerHTML = html;
  }

  private renderMenu() {
    const s = this.cur;
    const alloys = s ? Math.floor(s.alloys) : 0;
    const items = Object.entries(this.d.defs).filter(([, d]) => d.buildable && d.role !== 'core').sort((a, b) => a[1].cost - b[1].cost);
    const key = items.map(([k, d]) => `${k}:${alloys >= d.cost}`).join() + this.d.ui.build;
    if (key === this.menuKey) return;
    this.menuKey = key;
    this.el.menu.innerHTML = items.map(([k, d]) => {
      const pw = d.powerMW > 0 ? `+${d.powerMW} MW${d.role === 'solar' ? ' by day' : ''}` : d.powerMW < 0 ? `${d.powerMW} MW` : d.role === 'battery' ? `${d.storage} MJ` : '';
      return `<button data-kind="${k}" class="${alloys < d.cost ? 'poor' : ''} ${this.d.ui.build === k ? 'on' : ''}" title="${esc(d.description ?? '')}"><b>${esc(d.name)}</b><small class="cost">${d.cost}◆</small><small>${pw}</small></button>`;
    }).join('');
  }

  private status(s: Snapshot, b: Snapshot['buildings'][number], d: BuildingDef): [string, string] {
    if (b.progress < 1) return [`Under construction · ${Math.floor(b.progress * 100)}%`, s.drones.some((x) => x.task === 'build') ? '' : 'warn'];
    if (!b.on) return ['Switched off', 'warn'];
    if (!b.powered && d.powerMW < 0) return ['No power (load shed)', 'bad'];
    if (d.role === 'depot' && (b.mining === undefined || b.mining < 0)) return ['Idle: no deposit in reach', 'warn'];
    return ['Online', ''];
  }

  private renderCard(s: Snapshot) {
    const sel = this.d.ui.sel;
    const card = this.el.card;
    document.body.classList.toggle('card-open', !!sel);
    if (!sel) { card.classList.remove('on'); this.cardKey = ''; return; }
    let html = '';
    if (sel.kind === 'drone') {
      const dr = s.drones.find((x) => x.id === sel.id);
      if (!dr) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      const n = s.drones.indexOf(dr) + 1;
      const task = { idle: 'Idle', move: 'Moving', build: 'Building', repair: 'Repairing' }[dr.task];
      html = `<div class="t">WORKER DRONE ${n}</div><div class="s">${task}${dr.manual ? ' (your order)' : ''}</div>
        <div class="hp"><i style="width:${(dr.hp * 100).toFixed(0)}%"></i></div>
        <div class="row"><span>Tip</span><span>drag from it, or tap the ground</span></div>`;
    } else {
      const b = s.buildings.find((x) => x.id === sel.id);
      const d = b && this.d.defs[b.kind];
      if (!b || !d) { this.d.ui.sel = null; card.classList.remove('on'); return; }
      const [st, cls] = this.status(s, b, d);
      const rows: [string, string][] = [];
      rows.push(['Hit points', `${Math.ceil(b.hp)} / ${d.hp}`]);
      if (d.powerMW > 0) rows.push(['Power', d.role === 'solar' ? `+${(d.powerMW * (this.d.rules.nightSolar + (1 - this.d.rules.nightSolar) * s.daylight)).toFixed(1)} MW now` : `+${d.powerMW} MW`]);
      else if (d.powerMW < 0) rows.push(['Power', `${d.powerMW} MW${d.fireRange ? ' when firing' : ''}`]);
      if (d.fireRange && d.damage && d.cooldown) rows.push(['Weapon', `${(d.damage / d.cooldown).toFixed(0)} dmg/s · range ${d.fireRange} u`]);
      if (d.role === 'depot') {
        const dep = b.mining !== undefined && b.mining >= 0 ? s.deposits[b.mining] : undefined;
        rows.push(['Mining', `${d.mineRate} alloys/s`]);
        if (dep) rows.push(['Deposit left', `${Math.floor(dep.alloys)} / ${dep.max}`]);
      }
      if (d.role === 'battery') rows.push(['Bank (all)', `${Math.round(s.stored)} / ${Math.round(s.storageMax)} MJ`]);
      if (d.role === 'radar') rows.push(['Next pack', s.nextPack !== null ? mmss(s.nextPack) : '—']);
      if (d.role === 'core') {
        rows.push(['Cryo bank', `${s.cryo.toFixed(1)}%`]);
        rows.push(['Drones', `${s.drones.length} / ${this.d.rules.maxDrones}${s.fab.queued ? ` · fabricating ${Math.floor(s.fab.progress * 100)}%` : ''}`]);
      }
      const btn: string[] = [];
      if (d.role === 'core') btn.push(`<button data-act="fab" title="Fabricate a worker drone">+ Drone <small>${this.d.rules.droneCost}◆</small></button>`);
      if (b.progress >= 1 && b.hp < d.hp) btn.push('<button data-act="repair">Repair</button>');
      if (d.role !== 'core' && b.progress >= 1) btn.push(`<button data-act="power">${b.on ? 'Switch off' : 'Switch on'}</button>`);
      if (d.role !== 'core') btn.push(`<button data-act="demolish">${b.progress < 1 ? 'Cancel' : 'Recycle'}</button>`);
      html = `<div class="t">${esc(d.name.toUpperCase())}</div><div class="s ${cls}">${esc(st)}</div>
        <div class="hp"><i style="width:${Math.min(100, (b.hp / d.hp) * 100).toFixed(0)}%;background:${b.hp / d.hp > 0.6 ? '#5bff9a' : b.hp / d.hp > 0.3 ? '#ffb547' : '#ff5a4a'}"></i></div>
        ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
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
    const b = this.cur.buildings.find((x) => x.id === sel.id);
    if (act === 'fab') this.d.command({ type: 'fab' });
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

  private terrainImage() {
    if (this.terrain) return this.terrain;
    const n = 120, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d')!, img = g.createImageData(n, n), c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n * 2 - 1) * REGION_HALF, z = -((j + 0.5) / n * 2 - 1) * REGION_HALF;
      terrainColor(regionHeightRaw(x, z), regionFlora(x, z), c);
      const o = (j * n + i) * 4;
      img.data[o] = c.r * 200; img.data[o + 1] = c.g * 200; img.data[o + 2] = c.b * 200; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (this.terrain = cv);
  }

  private renderMini(s: Snapshot) {
    const cv = this.el.mini;
    cv.classList.toggle('on', s.radar);
    if (!s.radar) return;
    const g = cv.getContext('2d')!, W = cv.width;
    const px = (x: number) => ((x / REGION_HALF + 1) / 2) * W, pz = (z: number) => ((-z / REGION_HALF + 1) / 2) * W;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.85;
    g.drawImage(this.terrainImage(), 0, 0, W, W);
    g.globalAlpha = 1;
    g.fillStyle = '#ffb547';
    for (const d of s.deposits) if (d.alloys > 0) { g.beginPath(); g.arc(px(d.x), pz(d.z), 2.5, 0, 7); g.fill(); }
    for (const b of s.buildings) {
      const d = this.d.defs[b.kind];
      const r = Math.max(2, (d?.clearance ?? 8) / REGION_HALF * W * 0.3);
      g.fillStyle = b.kind === 'core' ? '#ffffff' : b.progress < 1 ? '#7f9aa6' : '#5ff3ff';
      g.fillRect(px(b.x) - r, pz(b.z) - r, r * 2, r * 2);
    }
    g.fillStyle = '#ffffff';
    for (const d of s.drones) g.fillRect(px(d.x) - 1, pz(d.z) - 1, 3, 3);
    g.fillStyle = '#ff4d5e';
    for (let i = 0; i < s.armySlots; i++) {
      const o = i * STRIDE;
      if (!s.army[o + F.ALIVE]) continue;
      g.fillRect(px(s.army[o + F.X]) - 1.5, pz(s.army[o + F.Z]) - 1.5, 3, 3);
    }
    // where the camera is looking
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.strokeRect(px(this.d.cam.fx) - 10, pz(this.d.cam.fz) - 7, 20, 14);
  }

  private renderOver(s: Snapshot) {
    const on = !!s.over;
    this.el.over.classList.toggle('on', on);
    if (!on) return;
    $('over-title').textContent = 'COLONY LOST';
    $('over-sub').textContent = s.over === 'core' ? 'The Command Core was destroyed.' : 'The cryo bank failed. The embryos are gone.';
    const sol = Math.floor(s.secs / this.d.rules.solSeconds) + 1;
    $('over-stats').textContent = `Lasted ${mmss(s.secs)} (Sol ${sol}) · ${s.stats.kills} predators killed · ${s.stats.packsBeaten} packs beaten\n${Math.round(s.stats.mined)} alloys mined · ${s.stats.buildingsLost} buildings lost · goals ${this.reached.size}/${this.goals.length}`;
  }

  /** Forget goal progress (new game). */
  reset() { this.reached.clear(); this.cardKey = ''; this.menuKey = ''; }
}
