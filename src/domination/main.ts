/**
 * Domination's strategy map (domination.html; DESIGN §5.12 phase 3, TECH.md "Domination: the strategy layer").
 * Every world with areas as a flat map (longitude across, latitude up), its areas as nodes in their holder's colour
 * with the army there, links between neighbours. Tap an area to see it, build there or send its army; armies on the
 * way move along the links. The war (src/sim/domination.ts) runs here in real time at the speed chosen, autosaves to
 * this browser, and saves to named save files like the rest of the game.
 */
import '../style.css';
import './dom.css';
import { content } from '../content';
import { VERSION } from '../changelog';
import { delSave, getSave, putSave } from '../save';
import { readSave, writeSave, type SaveMeta } from '../saves';
import { openSaves } from '../saves-panel';
import { esc, openMenu, panel } from '../options';
import { bodyTitle, type Area } from '../sim/areas';
import { allied, controlNeed, heldBySide, movesSeenBy, sideOf, visibleTo } from '../sim/domination';
import { applyBattle, BATTLE_KEY, cannotCommand, makeBattle, type DomBattle } from '../sim/dom-battle';
import {
  armyCap, armyOf, cannotBuild, DOM, destinations, domBuild, domMap, domSend, incomeOf, jobCost, newDomination, ownedBy, stepDomination,
  type DomJobKind, type DomLevel, type DomState,
} from '../sim/domination';

const BASE = import.meta.env.BASE_URL;
const AUTO = 'domination';
const FILE_KEY = 'exo.domfile';
const SETUP_KEY = 'exo.dom-setup';
const params = new URLSearchParams(location.search);
const map = domMap(content.bodies as never);
const root = document.getElementById('dom')!;
const ME = 0;

let s: DomState | null = null;
let speed = 1;
let sel: string | null = null;
/** Choosing where to send the selected area's army: how much. */
let sending: number | null = null;
let currentFile: string | null = (() => { try { return sessionStorage.getItem(FILE_KEY); } catch { return null; } })();
const rememberFile = (id: string | null) => { currentFile = id; try { if (id) sessionStorage.setItem(FILE_KEY, id); else sessionStorage.removeItem(FILE_KEY); } catch { /* private mode */ } };

// ---------- layout ----------
/** Worlds with areas: the planets (by area count), then their moons and the rest. */
const bodyIds = [...new Set(map.list.map((a) => a.body))].sort((a, b) => {
  const ka = map.list.filter((x) => x.body === a).length, kb = map.list.filter((x) => x.body === b).length;
  return (kb >= 3 ? 1 : 0) - (ka >= 3 ? 1 : 0) || kb - ka || a.localeCompare(b);
});
const W = 200, H = 100;
/** Small worlds (1–2 areas) get a narrower map (their card shows x 40–160). */
const isSmall = (body: string) => map.list.filter((x) => x.body === body).length < 3;
const halfW = (body: string) => (isSmall(body) ? 56 : W / 2 - 4);
const nodeXY = (a: Area) => [W / 2 + (a.lon / 180) * (halfW(a.body) - 10), H / 2 - (a.lat / 90) * (H / 2 - 10)] as const;
const worldName = (id: string) => bodyTitle(content.bodies[id]?.name ?? id);
const areaName = (id: string) => map.byId[id]?.name ?? id;
const placeName = (id: string) => (id === 'home-1' ? 'Touchdown' : `${worldName(map.byId[id].body)} · ${areaName(id)}`);
const colorOf = (p: number) => (p >= 0 ? s!.players[p].color : '#3a4a55');
const fmtT = (t: number) => { const m = Math.floor(t / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const n0 = (v: number) => String(Math.round(v));

root.innerHTML = `
  <header class="dm-top">
    <span class="dm-brand">DOMINATION</span>
    <span class="dm-stat" data-s="alloys"></span>
    <span class="dm-stat" data-s="army"></span>
    <span class="dm-stat" data-s="areas"></span>
    <span class="dm-stat" data-s="time"></span>
    <span class="dm-speed">
      <button class="dm-btn" data-speed="0" title="Pause (space)">❚❚</button>
      <button class="dm-btn" data-speed="1" title="Real time">▶</button>
      <button class="dm-btn" data-speed="3" title="Three times as fast">▶▶</button>
      <button class="dm-btn" data-speed="10" title="Ten times as fast">▶▶▶</button>
      <button class="dm-btn" data-act="menu" title="Menu (Esc)">☰ Menu</button>
    </span>
  </header>
  <div class="dm-players"></div>
  <div class="dm-main">
    <section class="dm-worlds">${bodyIds.map((b) => {
      const n = map.list.filter((a) => a.body === b).length;
      return `<div class="dm-world ${n >= 3 ? 'big' : 'small'}" data-body="${b}"><h3>${esc(worldName(b).toUpperCase())}<small></small></h3><svg viewBox="${n >= 3 ? `0 0 ${W} ${H}` : `40 0 ${W - 80} ${H}`}" role="img" aria-label="${esc(worldName(b))}"></svg></div>`;
    }).join('')}</section>
    <aside class="dm-side"></aside>
  </div>`;
const $ = <T extends Element = HTMLElement>(q: string) => root.querySelector<T>(q)!;

// ---------- drawing ----------
/** What you can see this frame (fog of war): areas, and moves. */
let seen = new Set<string>();
let seenMoves: DomState['moves'] = [];

function drawWorld(body: string) {
  const el = $(`.dm-world[data-body="${body}"]`);
  const areas = map.list.filter((a) => a.body === body);
  const mine = areas.filter((a) => s!.areas[a.id].owner === ME).length;
  el.querySelector('h3 small')!.textContent = `${mine ? `${mine} of ` : ''}${areas.length} area${areas.length > 1 ? 's' : ''}`;
  const targets = sel && sending !== null ? new Set(destinations(map, s!, sel).map((d) => d.to)) : null;
  const hw = halfW(body);
  let svg = `<ellipse class="disc" cx="${W / 2}" cy="${H / 2}" rx="${hw}" ry="${H / 2 - 3}"/>`;
  // links (across the date line: out to the edge and in from the other side)
  for (const a of areas) for (const l of a.links) {
    if (l < a.id) continue;
    const [x1, y1] = nodeXY(a), [x2, y2] = nodeXY(map.byId[l]);
    if (Math.abs(x2 - x1) <= hw) svg += `<line class="link" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    else {
      const [lx, ly, rx, ry] = x1 < x2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1];
      const ym = (ly + ry) / 2;
      svg += `<line class="link" x1="${lx}" y1="${ly}" x2="${W / 2 - hw + 2}" y2="${ym}"/><line class="link" x1="${rx}" y1="${ry}" x2="${W / 2 + hw - 2}" y2="${ym}"/>`;
    }
  }
  // armies on the way overland
  for (const m of seenMoves) {
    if (m.launch || map.byId[m.to].body !== body) continue;
    const [x1, y1] = nodeXY(map.byId[m.from]), [x2, y2] = nodeXY(map.byId[m.to]);
    if (Math.abs(x2 - x1) > hw) continue;
    const k = Math.min(1, Math.max(0, (s!.t - m.t0) / (m.t1 - m.t0)));
    svg += `<circle class="dm-move" cx="${x1 + (x2 - x1) * k}" cy="${y1 + (y2 - y1) * k}" r="3" fill="${colorOf(m.player)}" stroke="#fff" stroke-width="0.6"/>`;
  }
  for (const a of areas) {
    const st = s!.areas[a.id];
    const [x, y] = nodeXY(a);
    const vis = seen.has(a.id);
    const fighting = vis && Object.values(st.visitors).some((v) => v > 0);
    const label = !vis ? '?' : st.owner >= 0 ? n0(st.army) : n0(st.natives);
    const ally = st.owner > ME && allied(s!, st.owner, ME);
    svg += `<g class="dm-node${sel === a.id ? ' sel' : ''}${vis ? '' : ' fog'}${ally ? ' ally' : ''}" data-area="${a.id}" transform="translate(${x} ${y})">
      <title>${esc(placeName(a.id))}</title>
      ${targets?.has(a.id) ? '<circle class="ring" r="12.5"/>' : ''}
      ${fighting ? '<circle class="fight" r="11"/>' : ''}
      ${vis && st.guns > 0 ? `<rect class="guns" x="-10.5" y="-10.5" width="21" height="21" rx="3" opacity="${Math.min(1, 0.3 + st.guns / DOM.jobs.guns.max)}"/>` : ''}
      <circle class="body" r="8.5" fill="${colorOf(st.owner)}"/>
      <text class="${st.owner < 0 ? 'neutral' : ''}">${label}</text>
      ${st.gantry ? '<path class="gantry" d="M-3 -10.5 L0 -15.5 L3 -10.5 Z"/>' : ''}
      ${Array.from({ length: vis ? st.level : 0 }, (_, i) => `<circle class="pip" cx="${(i - (st.level - 1) / 2) * 4}" cy="12.5" r="1.3"/>`).join('')}
    </g>`;
  }
  el.querySelector('svg')!.innerHTML = svg;
}

function drawTop() {
  const inc = incomeOf(s!, ME);
  $('[data-s="alloys"]').innerHTML = `◆ <b>${n0(s!.players[ME].alloys)}</b> <small>+${inc.toFixed(0)}/s</small>`;
  $('[data-s="army"]').innerHTML = `⚔ <b>${n0(armyOf(s!, ME))}</b><small>/${armyCap(s!, ME)}</small>`;
  const control = s!.rules?.win === 'control';
  const mySide = heldBySide(s!, sideOf(s!, ME));
  $('[data-s="areas"]').innerHTML = `◉ <b>${ownedBy(s!, ME).length}</b><small>/${map.list.length} areas${control ? ` · ${teamGame() ? 'your side ' + mySide + ', ' : ''}win at ${controlNeed(s!)}` : ''}</small>`;
  $('[data-s="time"]').innerHTML = `⏱ ${fmtT(s!.t)}`;
  root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  const tags = [s!.rules?.fog ? '<span class="dm-tag">FOG</span>' : '', control ? '<span class="dm-tag">75% WINS</span>' : ''].join('');
  $('.dm-players').innerHTML = s!.players.map((pl, p) => `<span class="${pl.out ? 'out' : ''}"><i style="background:${pl.color}"></i>${esc(pl.name)}${pl.ai ? ` <small>(${pl.ai})</small>` : ''}${teamGame() ? ` <small>· team ${'AB'[sideOf(s!, p)] ?? sideOf(s!, p) + 1}${p !== ME && allied(s!, p, ME) ? ', ally' : ''}</small>` : ''} · ${ownedBy(s!, p).length}</span>`).join('') + tags;
}

const JOBS: { kind: DomJobKind; label: string; gives: string }[] = [
  { kind: 'army', label: 'ARMY', gives: `+${DOM.jobs.army.gives} strength` },
  { kind: 'guns', label: 'GUNS', gives: `+${DOM.jobs.guns.gives} defences` },
  { kind: 'develop', label: 'DEVELOP', gives: '+1 alloy/s' },
  { kind: 'gantry', label: 'GANTRY', gives: 'launch to other worlds' },
];

function drawSide() {
  const side = $('.dm-side');
  let html = '';
  if (sel) {
    const a = s!.areas[sel], ar = map.byId[sel];
    const who = a.owner >= 0 ? `${s!.players[a.owner].name}${a.owner !== ME && allied(s!, a.owner, ME) ? ' (ally)' : ''}` : 'Unclaimed';
    const vis = seen.has(sel);
    const fighting = vis ? Object.entries(a.visitors).filter(([, v]) => v > 0) : [];
    html += `<h2>${esc(areaName(sel).toUpperCase())}</h2><div class="sub">${esc(worldName(ar.body))} · <span style="color:${colorOf(a.owner)}">${esc(who)}</span></div>
      <dl class="dm-grid">
        ${!vis ? '<dt>Seen</dt><dd>Out of sight: who holds it is known, not what\'s there. Hold an area next to it to see</dd>' : a.owner >= 0 ? `<dt>Army</dt><dd>${n0(a.army)}</dd><dt>Guns</dt><dd>${n0(a.guns)}</dd>` : `<dt>Natives</dt><dd>${n0(a.natives)} <small>(wildlife and old defences)</small></dd>`}
        ${vis ? `<dt>Level</dt><dd>${a.level} of ${DOM.develop.max} · +${DOM.income.base + a.level * DOM.income.perLevel} alloys/s</dd>
        <dt>Gantry</dt><dd>${a.gantry ? 'Yes: can launch' : 'No'}</dd>` : ''}
        <dt>Links</dt><dd>${ar.links.length ? ar.links.map((l) => esc(areaName(l))).join(', ') : 'none (launch only)'}</dd>
        ${fighting.length ? `<dt>Fighting</dt><dd style="color:var(--crimson)">${fighting.map(([p, v]) => `${esc(s!.players[Number(p)].name)} ${n0(v)}`).join(', ')}</dd>` : ''}
      </dl>`;
    if (fighting.length) {
      const no = cannotCommand(s!, sel, ME);
      if (!no) html += `<div class="dm-send"><button class="dm-btn go" data-act="fight">⚔ FIGHT IT YOURSELF</button></div><div class="dm-empty" style="margin-top:4px">On this area's own ground, in full. The war waits for you.</div>`;
      else if (a.owner < 0 && a.visitors[ME]) html += `<div class="dm-empty" style="margin-top:8px">${esc(no)}.</div>`;
    }
    if (a.owner === ME) {
      html += `<div class="dm-acts">${JOBS.map((j) => {
        const no = cannotBuild(s!, ME, a, j.kind);
        return `<button class="dm-btn" data-build="${j.kind}" ${no ? `disabled title="${esc(no)}"` : ''}>${j.label} · ${jobCost(a, j.kind).cost}◆<small>${esc(no ?? j.gives)}</small></button>`;
      }).join('')}</div>`;
      if (a.queue.length) html += `<h4>Building</h4>${a.queue.map((q, i) => `<div class="dm-q"><span>${q.kind}</span><span>${i ? 'queued' : `${Math.ceil(q.left)} s`}</span></div>${i ? '' : `<div class="dm-bar"><i style="width:${(1 - q.left / q.total) * 100}%"></i></div>`}`).join('')}`;
      const half = Math.floor(a.army / 2);
      html += `<h4>Send the army</h4><div class="dm-send">
        <button class="dm-btn${sending !== null && sending >= Math.floor(a.army) ? ' on' : ''}" data-send="${Math.floor(a.army)}" ${a.army < 1 ? 'disabled' : ''}>ALL ${Math.floor(a.army)}</button>
        <button class="dm-btn${sending !== null && sending < Math.floor(a.army) && sending === half ? ' on' : ''}" data-send="${half}" ${half < 1 ? 'disabled' : ''}>HALF ${half}</button>
        ${sending !== null ? '<button class="dm-btn" data-send="cancel">CANCEL</button>' : ''}
      </div>${sending !== null ? `<div class="dm-hint">Tap a ringed area to send ${sending}${a.gantry ? ' (other worlds by launch)' : ''}</div>` : ''}`;
    }
  } else html += `<h2>THE SYSTEM</h2><div class="sub">Tap an area to see it, build there or send its army.</div>`;
  const moves = seenMoves.filter((m) => allied(s!, m.player, ME) || s!.areas[m.to].owner === ME);
  html += `<h4>On the move</h4><div class="dm-list">${moves.length ? moves.map((m) => `<div><i style="background:${colorOf(m.player)}"></i>${n0(m.strength)} → ${esc(placeName(m.to))}${m.launch ? ' 🚀' : ''} · ${Math.ceil(m.t1 - s!.t)} s</div>`).join('') : '<div class="dm-empty">Nothing on the way</div>'}</div>`;
  html += `<h4>Events</h4><div class="dm-list">${[...s!.log].reverse().slice(0, 14).map((e) => `<div class="ev ${e.kind}" ${e.area ? `data-area="${e.area}"` : ''}>${fmtT(e.t)} · ${esc(e.text)}</div>`).join('')}</div>`;
  side.innerHTML = html;
}

function draw() {
  if (!s) return;
  seen = visibleTo(map, s, ME);
  seenMoves = movesSeenBy(map, s, ME, seen);
  drawTop();
  for (const b of bodyIds) drawWorld(b);
  drawSide();
}

// ---------- input ----------
root.addEventListener('click', (e) => {
  if (!s) return;
  const t = e.target as Element;
  const sp = t.closest<HTMLElement>('[data-speed]');
  if (sp) { speed = Number(sp.dataset.speed); draw(); return; }
  if (t.closest('[data-act="menu"]')) { showMenu(); return; }
  if (t.closest('[data-act="fight"]') && sel) { void fight(sel); return; }
  const b = t.closest<HTMLButtonElement>('[data-build]');
  if (b && sel) { const no = domBuild(s, ME, sel, b.dataset.build as DomJobKind); if (no) flash(no); draw(); return; }
  const sd = t.closest<HTMLElement>('[data-send]');
  if (sd) { sending = sd.dataset.send === 'cancel' ? null : Number(sd.dataset.send); draw(); return; }
  const node = t.closest<SVGGElement | HTMLElement>('[data-area]');
  if (node) {
    const id = node.dataset.area!;
    if (sending !== null && sel && id !== sel && destinations(map, s, sel).some((d) => d.to === id)) {
      const no = domSend(map, s, ME, sel, id, sending);
      if (no) flash(no);
      sending = null;
    } else { sel = id === sel && !node.classList.contains('ev') ? null : id; sending = null; }
    draw();
  }
});
let flashT = 0;
function flash(text: string) {
  let el = document.querySelector<HTMLElement>('.dm-flash');
  if (!el) { el = document.createElement('div'); el.className = 'dm-flash'; Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', background: 'var(--panel)', border: '1px solid var(--amber)', color: 'var(--amber)', padding: '8px 14px', borderRadius: '4px', zIndex: '70', fontSize: '12px' }); document.body.appendChild(el); }
  el.textContent = text;
  clearTimeout(flashT);
  flashT = window.setTimeout(() => el!.remove(), 2600);
}
addEventListener('keydown', (e) => {
  if (!s || document.getElementById('options')) return;
  if (e.key === ' ') { e.preventDefault(); speed = speed ? 0 : 1; draw(); }
  else if (e.key === 'Escape') { if (sending !== null) sending = null; else if (sel) sel = null; else showMenu(); draw(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void quickSave(); }
});

// ---------- saving ----------
const labels = () => ({ place: `${s!.players.length} players · ${s!.players.find((p) => p.ai)?.ai ?? ''}`, when: `${fmtT(s!.t)} · ${ownedBy(s!, ME).length} areas` });
async function autosave() {
  if (!s) return;
  try { await putSave(AUTO, { version: 1, savedAt: Date.now(), dom: s }); } catch (e) { console.warn('autosave failed', e); }
}
async function saveToFile(name: string, id?: string): Promise<SaveMeta | null> {
  if (!s) return null;
  try {
    const meta = await writeSave({ id, name, kind: 'domination', ...labels() }, { version: 1, region: 'domination', dom: JSON.parse(JSON.stringify(s)) });
    rememberFile(meta.id);
    flash(`Saved “${meta.name}”`);
    return meta;
  } catch (e) { flash(`Save failed: ${(e as Error).message}`); return null; }
}
async function quickSave() {
  const { listSaves } = await import('../saves');
  const m = currentFile ? (await listSaves()).find((x) => x.id === currentFile) : undefined;
  await saveToFile(m?.name ?? `Domination · ${fmtT(s!.t)}`, m?.id);
}
function showSaves(onClose?: () => void) {
  const was = speed; speed = 0; draw();
  openSaves({
    save: s && !s.over ? { kind: 'domination', name: `Domination · ${fmtT(s.t)}`, run: (name, id) => saveToFile(name, id) } : undefined,
    load: (m) => void loadFile(m.id),
    cannotLoad: (m) => (m.kind === 'domination' ? null : 'load it from the title screen'),
    loadWarning: () => (s && !s.over ? 'TAP: THIS WAR ENDS' : null),
    onClose: () => { speed = was; draw(); onClose?.(); },
  });
}
async function loadFile(id: string) {
  const body = await readSave(id).catch(() => undefined);
  if (body?.dom?.version !== 1) { flash('That save couldn’t be read'); if (!s) showSetup(); return; }
  start(body.dom);
  rememberFile(id);
  void autosave();
}
addEventListener('pagehide', () => void autosave());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void autosave(); });
setInterval(() => void autosave(), 15000);

// ---------- menus ----------
function showMenu() {
  const was = speed; speed = 0; draw();
  openMenu('Menu', [
    { id: 'resume', label: 'Resume', sub: 'Back to the war (Esc)', run: () => {} },
    { id: 'saves', label: 'Save & load', sub: 'Save files by name (Ctrl+S saves) · the war also autosaves', run: () => showSaves(() => showMenu()) },
    { id: 'new', label: 'New war', sub: 'Pick the players and start again', confirm: 'This war will be lost (unless you saved it) · tap again', run: () => showSetup(true) },
    { id: 'title', label: 'Title screen', sub: 'The war is autosaved', run: () => void autosave().then(() => { location.href = BASE; }) },
  ], `v${VERSION} · Domination`, undefined, (picked) => { if (!picked || picked.id === 'resume') { speed = was || 1; draw(); } });
}

interface Setup { players: number; ai: DomLevel; teams: 'ffa' | '2v2' | 'alone'; fog: 'on' | 'off'; win: 'wipe' | 'control' }
/** Each player's side for a setup (you are player 0). */
const sidesFor = (c: Setup) => Array.from({ length: c.players }, (_, i) => (c.teams === '2v2' && c.players === 4 ? (i < 2 ? 0 : 1) : c.teams === 'alone' && c.players > 2 ? (i ? 1 : 0) : i));
const teamGame = () => !!s && new Set(s.players.map((_, i) => sideOf(s!, i))).size < s.players.length;
function showSetup(fresh = false, saved?: DomState) {
  let c: Setup = { players: 3, ai: 'normal', teams: 'ffa', fog: 'off', win: 'wipe' };
  try { c = { ...c, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') }; } catch { /* private mode */ }
  const seg = (key: keyof Setup, opts: [string | number, string][], label: string, help: string) => `
    <div class="op-row op-choice" data-key="${key}"><span class="op-text"><b>${label}</b><small>${help}</small></span>
    <span class="seg">${opts.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</span></div>`;
  const { el, close } = panel('Domination', `<div class="dm-setup">
    <div class="op-info" style="padding:10px 8px;font-size:12px;line-height:1.5">A war for the whole solar system: 40 areas on its planets and moons. Take them one by one, build them up and wipe out the other players. A long game: it saves itself, and you can keep save files.</div>
    ${seg('players', [[2, '2'], [3, '3'], [4, '4']], 'Players', 'You and the computer players')}
    ${seg('teams', [['ffa', 'Free for all'], ['2v2', '2 v 2'], ['alone', 'You vs all']], 'Teams', '2 v 2: you and Crimson against Amber and Violet. You vs all: the computers are allies')}
    ${seg('ai', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'Computer', 'Hard ones also earn a quarter more')}
    ${seg('fog', [['off', 'Off'], ['on', 'On']], 'Fog of war', 'See only your side\'s areas, the areas next to them and your fights')}
    ${seg('win', [['wipe', 'Wipe them out'], ['control', 'Hold 75%']], 'Victory', 'The last side holding areas, or the first to hold 30 of the 40')}
    <div class="dm-start">${saved && !fresh ? `<button class="dm-btn go" data-act="continue">CONTINUE · ${fmtT(saved.t)}</button>` : ''}<button class="sk-start" data-act="start">${saved && !fresh ? 'NEW WAR' : 'START'}</button></div>
    <div class="dm-start"><button class="dm-btn" data-act="load">LOAD A SAVE…</button><a class="dm-btn" href="${BASE}" style="text-decoration:none;text-align:center">TITLE SCREEN</a></div></div>`, () => { if (!s) location.href = BASE; });
  el.classList.add('sk-setup');
  const sync = () => {
    // a team setup that doesn't fit the player count falls back to free for all
    if ((c.teams === '2v2' && c.players !== 4) || (c.teams === 'alone' && c.players === 2)) c.teams = 'ffa';
    el.querySelectorAll<HTMLElement>('[data-key]').forEach((row) => row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('on', String(c[row.dataset.key as keyof Setup]) === b.dataset.v);
      b.disabled = row.dataset.key === 'teams' && ((b.dataset.v === '2v2' && c.players !== 4) || (b.dataset.v === 'alone' && c.players === 2));
    }));
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(c)); } catch { /* private mode */ }
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    const row = b.closest<HTMLElement>('[data-key]');
    if (row) { const k = row.dataset.key as keyof Setup; (c as unknown as Record<string, unknown>)[k] = k === 'players' ? Number(b.dataset.v) : b.dataset.v; sync(); return; }
    const act = b.dataset.act;
    if (act === 'continue' && saved) { start(saved); close(); }
    else if (act === 'start') {
      rememberFile(null);
      start(newDomination(map, { seed: 1 + Math.floor(Math.random() * 99999), players: c.players, ai: c.ai, rules: { side: sidesFor(c), fog: c.fog === 'on', win: c.win } }));
      close();
      void autosave();
    }
    else if (act === 'load') showSaves(() => { if (!s) showSetup(fresh, saved); });
  });
  sync();
}

let shownOver = false;
function showOver() {
  shownOver = true;
  speed = 0;
  const o = s!.over!, won = o.side !== undefined ? o.side === sideOf(s!, ME) : o.winner === ME;
  const mates = s!.players.map((_, i) => i).filter((i) => o.side !== undefined && sideOf(s!, i) === o.side);
  const who = mates.length ? mates.map((i) => (i === ME ? 'You' : s!.players[i].name)).join(' and ') : s!.players[o.winner]?.name ?? 'No one';
  const how = o.how === 'control' ? ` by holding ${heldBySide(s!, o.side ?? -1)} of ${map.list.length} areas` : '';
  panel(won ? 'Victory' : 'Defeat', `<div class="op-info" style="padding:10px 8px">
    <p style="font-size:14px;color:${won ? 'var(--cyan)' : 'var(--crimson)'}">${won ? `The system is yours${mates.length > 1 ? ', with your allies' : ''}${how}.` : `${esc(who)} ${mates.length > 1 ? 'have' : 'has'} taken the system${how}.`}</p>
    <p>${fmtT(o.t)} of war.</p>
    ${chart()}
    <table class="dm-stats"><tr><th>Player</th><th>Most areas</th><th>Taken</th><th>Lost</th><th>Army built</th></tr>
    ${s!.players.map((pl, i) => `<tr><td><span style="color:${pl.color}">●</span> ${esc(pl.name)}${teamGame() ? ` <small>team ${'AB'[sideOf(s!, i)] ?? ''}</small>` : ''}${pl.out ? ` <small>(out at ${fmtT(pl.outAt ?? 0)})</small>` : ''}</td><td>${pl.stats.peak}</td><td>${pl.stats.taken}</td><td>${pl.stats.lost}</td><td>${pl.stats.built}</td></tr>`).join('')}</table>
    <div class="dm-start"><button class="sk-start" data-act="again">NEW WAR</button><a class="dm-btn" href="${BASE}" style="text-decoration:none;text-align:center">TITLE SCREEN</a></div></div>`);
  document.querySelector('#options [data-act="again"]')?.addEventListener('click', () => showSetup(true));
}

/** The end screen's chart: areas each player held over the war (a line each, in its colour). */
function chart() {
  const h = s!.history ?? [];
  if (h.length < 2) return '';
  const W2 = 300, H2 = 90, T = h[h.length - 1].t || 1, top = Math.max(...h.flatMap((x) => x.held), 1);
  const X = (t: number) => (t / T) * W2, Y = (n: number) => H2 - (n / top) * (H2 - 6) - 3;
  const need = s!.rules?.win === 'control' ? controlNeed(s!) : 0;
  const lines = s!.players.map((pl, i) => `<polyline fill="none" stroke="${pl.color}" stroke-width="1.8" points="${h.map((x) => `${X(x.t).toFixed(1)},${Y(x.held[i] ?? 0).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<svg class="dm-chart" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Areas held over the war">
    <line x1="0" y1="${H2 - 3}" x2="${W2}" y2="${H2 - 3}" stroke="currentColor" stroke-opacity=".25"/>
    ${need && need <= top ? `<line x1="0" y1="${Y(need)}" x2="${W2}" y2="${Y(need)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3"/>` : ''}
    ${lines}</svg><div class="dm-empty">Areas held, from the start to the end (${top} at most)</div>`;
}

// ---------- the clock ----------
function start(state: DomState) {
  s = state;
  sel = null; sending = null; speed = 1; shownOver = !!s.over;
  draw();
}
let last = performance.now(), drawn = 0;
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (s && !s.over && speed > 0) stepDomination(map, s, dt * speed);
  if (s && now - drawn > 250) { drawn = now; draw(); }
  if (s?.over && !shownOver) { void autosave(); showOver(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __dom: unknown }).__dom = { get s() { return s; }, map, setSpeed: (v: number) => { speed = v; }, step: (dt: number) => s && stepDomination(map, s, dt) };

// ---------- battles in full (src/sim/dom-battle.ts) ----------
/** Fight `areaId`'s battle yourself: keep the war and the battle, then open it on the area's map in the game. */
async function fight(areaId: string) {
  if (!s || cannotCommand(s, areaId, ME)) return;
  const b = makeBattle(s, areaId, ME);
  speed = 0;
  await putSave(BATTLE_KEY, b);
  await autosave();
  const u = new URL(BASE, location.href);
  u.search = new URLSearchParams({ skirmish: String(b.seed), area: areaId, players: String(b.sides.length), battle: '1' }).toString();
  if (params.get('sw') === '0') u.searchParams.set('sw', '0');
  location.href = u.href;
}
/** Back from a battle: lay what's left over the war (if it's the same war, at the same moment). */
async function takeBattle(state: DomState) {
  const b = await getSave<DomBattle>(BATTLE_KEY).catch(() => undefined);
  if (!b) return;
  await delSave(BATTLE_KEY).catch(() => {});
  if (b.version !== 1 || !b.result || b.seed !== state.seed || Math.abs(b.at - state.t) > 0.01) return;
  applyBattle(state, b, b.result);
  const line = b.result.sides.map((x, i) => `${x.player === ME ? 'you' : b.sides[i].name} ${Math.round(b.sides[i].army)}→${Math.round(x.army)}${b.sides[i].core ? (x.core ? ' (held)' : ' (Core lost)') : ''}`).join(', ');
  const won = b.result.sides.some((x, i) => x.player === ME && (b.sides[i].core ? x.core : x.army >= 0.5 && !b.result!.sides.some((y, j) => b.sides[j].core && y.core)));
  state.log.push({ t: state.t, text: `Battle at ${placeName(b.area)}${b.result.done ? '' : ' (left early)'}: ${line}`, kind: won ? 'good' : 'bad', area: b.area });
}

// ---------- start: a save file, the autosave, or the setup ----------
const loadId = params.get('load');
if (loadId) {
  history.replaceState(history.state, '', location.pathname);
  void loadFile(loadId);
} else {
  const auto = await getSave<{ version: 1; dom: DomState }>(AUTO).catch(() => undefined);
  const saved = auto?.dom?.version === 1 && !auto.dom.over ? auto.dom : undefined;
  if (saved) await takeBattle(saved);
  // back from a battle: straight into the war, paused on the area so the outcome can be seen
  if (saved && params.get('battle') === '1') {
    history.replaceState(history.state, '', location.pathname);
    start(saved);
    const last = saved.log[saved.log.length - 1];
    if (last?.area) sel = last.area;
    speed = 0;
    void autosave();
    draw();
  } else if (saved && params.get('continue') === '1') start(saved);
  else showSetup(false, saved);
}
