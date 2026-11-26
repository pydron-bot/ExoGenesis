/**
 * Skirmish setup (title → SKIRMISH, or the game menu): players, teams, computer difficulty, the map (world, size,
 * sea, ground, seed, with a live preview) and the rules (starting alloys, fog, wildlife, predator packs). START builds
 * the `?skirmish=` link (src/skirmish/setup.ts reads it) and goes there. The last choices are remembered.
 */
import type { MapOptions } from './mapgen';
import { PLAYER_COLORS, PLAYER_NAMES, SKIRMISH_WORLDS } from './setup';
import { bodyAreas, type Area } from '../sim/areas';

export interface SetupChoice {
  players: number;
  teams: 'ffa' | '2v2' | 'alone';
  ai: 'easy' | 'normal' | 'hard';
  world: string;
  /** A Domination area on the world (its site), or '' for a random site. */
  area: string;
  size: 'small' | 'medium' | 'large';
  water: 'none' | 'some' | 'lots';
  relief: 'flat' | 'rolling' | 'rugged';
  alloys: number;
  fog: boolean;
  wildlife: boolean;
  packs: boolean;
  seed: number;
}

const KEY = 'exo-skirmish-setup';
const DEFAULTS: SetupChoice = { players: 2, teams: 'ffa', ai: 'normal', world: 'home', area: '', size: 'medium', water: 'some', relief: 'rolling', alloys: 600, fog: true, wildlife: true, packs: false, seed: 1 };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const newSeed = () => 1 + Math.floor(Math.random() * 99999);

function load(): SetupChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { ...DEFAULTS, ...v, seed: newSeed() };
  } catch { /* private mode */ }
  return { ...DEFAULTS, seed: newSeed() };
}
function save(c: SetupChoice) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }

/** Each player's side for a choice (index = player; 0 is you). */
export function sidesFor(c: Pick<SetupChoice, 'players' | 'teams'>): number[] {
  return Array.from({ length: c.players }, (_, i) => (c.teams === '2v2' && c.players === 4 ? i % 2 : c.teams === 'alone' ? (i ? 1 : 0) : i));
}

/** The link that starts this skirmish (relative to the game's base URL). */
export function skirmishLink(c: SetupChoice, base: string) {
  const q = new URLSearchParams({
    skirmish: String(c.seed), players: String(c.players), world: c.world, size: c.size, water: c.water, relief: c.relief,
    ai: c.ai, alloys: String(c.alloys),
  });
  if (c.area) q.set('area', c.area);
  const sides = sidesFor(c);
  if (sides.some((s, i) => s !== i)) q.set('teams', sides.join(''));
  if (!c.fog) q.set('fog', '0');
  if (!c.wildlife) q.set('wildlife', '0');
  if (c.packs) q.set('packs', '1');
  return `${base}?${q}`;
}

interface Preview { id: number; n: number; half: number; px: Uint8ClampedArray; homes: { x: number; z: number }[]; deposits: { x: number; z: number; big: boolean }[]; seams: { x: number; z: number }[]; ok: boolean }

/**
 * Open the setup panel. `bodies` = content.bodies (world names, which have seas); `go` starts the game (default:
 * navigate to the link). Returns a close function.
 */
export function openSkirmishSetup(bodies: Record<string, { name?: string; ocean?: boolean; areas?: number; kind?: string }>, opts: { base: string; tap?: () => void; onClose?: () => void; go?: (url: string) => void }) {
  document.getElementById('options')?.remove();
  const c = load();
  // the skirmish worlds, then every other body with Domination areas (the moons and asteroids)
  const worlds = [...SKIRMISH_WORLDS, ...Object.keys(bodies).filter((id) => !SKIRMISH_WORLDS.includes(id) && (bodies[id].areas ?? 0) > 0).sort()];
  if (!worlds.includes(c.world)) c.world = 'home';
  const areasOf = (w: string): Area[] => (bodies[w] ? bodyAreas(w, bodies[w]) : []);
  if (c.area && !areasOf(c.world).some((a) => a.id === c.area)) c.area = '';
  const el = document.createElement('div');
  el.id = 'options';
  el.className = 'sk-setup';
  const worldName = (id: string) => (bodies[id]?.name ?? id).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
  const seg = (key: keyof SetupChoice, opts2: [string | number | boolean, string][], label: string, help = '') => `
    <div class="op-row op-choice" data-key="${key}">
      <span class="op-text"><b>${esc(label)}</b>${help ? `<small>${esc(help)}</small>` : ''}</span>
      <span class="seg">${opts2.map(([v, t]) => `<button data-v="${esc(String(v))}">${esc(t)}</button>`).join('')}</span>
    </div>`;
  el.innerHTML = `
    <div class="op-panel" role="dialog" aria-label="Skirmish">
      <div class="op-head"><b>SKIRMISH</b><span>you against the computer</span><button class="op-x" aria-label="Close">✕</button></div>
      <div class="op-list">
        <div class="sk-top">
          <div class="sk-prev"><canvas width="160" height="160"></canvas><div class="sk-wait">Generating…</div></div>
          <div class="sk-players"></div>
        </div>
        <div class="op-sec">Players</div>
        ${seg('players', [[2, '2'], [3, '3'], [4, '4']], 'Players', 'You and the computer players')}
        ${seg('teams', [['ffa', 'Free for all'], ['alone', 'You vs all'], ['2v2', '2 v 2']], 'Teams')}
        ${seg('ai', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'Computer', 'How hard the computer players play')}
        <div class="op-sec">Map</div>
        ${seg('world', worlds.map((w) => [w, worldName(w)] as [string, string]), 'World')}
        <div class="op-row op-choice" data-key="area">
          <span class="op-text"><b>Site</b><small>Anywhere, or one of the world's Domination areas</small></span>
          <span class="seg sk-areas"></span>
        </div>
        ${seg('size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'Size')}
        ${seg('water', [['none', 'None'], ['some', 'Some'], ['lots', 'Lots']], 'Sea', 'Only worlds with seas have any')}
        ${seg('relief', [['flat', 'Flat'], ['rolling', 'Rolling'], ['rugged', 'Rugged']], 'Ground')}
        <div class="op-row op-choice" data-key="seed">
          <span class="op-text"><b>Map seed</b><small>The same seed and settings make the same map</small></span>
          <span class="seg"><input type="number" min="1" max="99999" inputmode="numeric" aria-label="Map seed"><button data-act="reroll" title="New map">🎲</button></span>
        </div>
        <div class="op-sec">Rules</div>
        ${seg('alloys', [[400, 'Low'], [600, 'Standard'], [1500, 'High']], 'Starting alloys')}
        ${seg('fog', [[true, 'On'], [false, 'Off']], 'Fog of war')}
        ${seg('wildlife', [[true, 'On'], [false, 'Off']], 'Wildlife', 'Grazing herds (harmless)')}
        ${seg('packs', [[false, 'Off'], [true, 'On']], 'Predator packs', 'Waves from the map edges at everyone')}
        <button class="sk-start">START</button>
      </div>
    </div>`;
  const $ = <T extends Element>(q: string) => el.querySelector<T>(q)!;
  const canvas = $<HTMLCanvasElement>('.sk-prev canvas'), wait = $<HTMLElement>('.sk-wait');
  const seedIn = $<HTMLInputElement>('[data-key="seed"] input');
  let worker: Worker | null = null, reqId = 0, timer = 0;
  const preview = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      worker ??= new Worker(new URL('./map-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Preview>) => { if (e.data.id === reqId) draw(e.data); };
      wait.hidden = false;
      const a = areasOf(c.world).find((x) => x.id === c.area);
      const options: MapOptions = { seed: c.seed, players: c.players, size: c.size, world: c.world, water: c.water, relief: c.relief, site: a ? { lat: a.lat, lon: a.lon } : undefined };
      worker.postMessage({ id: ++reqId, options });
    }, 120);
  };
  const draw = (p: Preview) => {
    wait.hidden = true;
    const g = canvas.getContext('2d')!, W = canvas.width;
    const img = new ImageData(new Uint8ClampedArray(p.px), p.n, p.n);
    const tmp = Object.assign(document.createElement('canvas'), { width: p.n, height: p.n });
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tmp, 0, 0, W, W);
    const at = (q: { x: number; z: number }) => [((q.x / p.half + 1) / 2) * W, ((-q.z / p.half + 1) / 2) * W];
    for (const d of p.deposits) { const [x, y] = at(d); g.fillStyle = '#ffb547'; g.beginPath(); g.arc(x, y, d.big ? 3.2 : 2.2, 0, 7); g.fill(); }
    for (const v of p.seams) { const [x, y] = at(v); g.fillStyle = '#b39bff'; g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
    p.homes.forEach((h, i) => {
      const [x, y] = at(h);
      g.fillStyle = PLAYER_COLORS[i]; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.stroke();
    });
  };
  const players = () => {
    const sides = sidesFor(c);
    const names = ['A', 'B', 'C', 'D'];
    $('.sk-players').innerHTML = Array.from({ length: c.players }, (_, i) => `
      <div class="sk-p"><i style="background:${PLAYER_COLORS[i]}"></i><b>${esc(PLAYER_NAMES[i])}</b>
      <small>${i ? `Computer · ${esc(c.ai)}` : 'You'}${c.teams === 'ffa' ? '' : ` · team ${names[sides[i]]}`}</small></div>`).join('');
  };
  const sync = () => {
    // a team setup that doesn't fit the player count falls back to free-for-all
    if (c.teams === '2v2' && c.players !== 4) c.teams = 'ffa';
    if (c.teams === 'alone' && c.players === 2) c.teams = 'ffa';
    const sea = !!bodies[c.world]?.ocean;
    if (c.area && !areasOf(c.world).some((a) => a.id === c.area)) c.area = '';
    const areaRow = $<HTMLElement>('.sk-areas');
    const want = ['', ...areasOf(c.world).map((a) => a.id)].join(',');
    if (areaRow.dataset.for !== want) {
      areaRow.dataset.for = want;
      areaRow.innerHTML = [['', 'Anywhere'], ...areasOf(c.world).map((a) => [a.id, a.name])].map(([v, t]) => `<button data-v="${esc(v)}">${esc(t)}</button>`).join('');
      for (const b of areaRow.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { opts.tap?.(); c.area = b.dataset.v!; changed(true); };
    }
    for (const row of el.querySelectorAll<HTMLElement>('.op-choice[data-key]')) {
      const key = row.dataset.key as keyof SetupChoice;
      if (key === 'seed') continue;
      for (const b of row.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.classList.toggle('on', key === 'water' && !sea ? b.dataset.v === 'none' : String(c[key]) === b.dataset.v);
        b.disabled = (key === 'teams' && ((b.dataset.v === '2v2' && c.players !== 4) || (b.dataset.v === 'alone' && c.players === 2))) || (key === 'water' && !sea && b.dataset.v !== 'none');
      }
    }
    seedIn.value = String(c.seed);
    players();
    save(c);
  };
  const changed = (map: boolean) => { sync(); if (map) preview(); };
  for (const row of el.querySelectorAll<HTMLElement>('.op-choice[data-key]')) {
    const key = row.dataset.key as keyof SetupChoice;
    for (const b of row.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
      b.onclick = () => {
        opts.tap?.();
        const v = b.dataset.v!;
        const cur = c[key];
        (c as unknown as Record<string, unknown>)[key] = typeof cur === 'number' ? Number(v) : typeof cur === 'boolean' ? v === 'true' : v;
        changed(['players', 'world', 'size', 'water', 'relief'].includes(key));
      };
    }
  }
  $<HTMLButtonElement>('[data-act="reroll"]').onclick = () => { opts.tap?.(); c.seed = newSeed(); changed(true); };
  seedIn.onchange = () => { const v = Math.floor(Number(seedIn.value)); if (v >= 1 && v <= 99999) { c.seed = v; changed(true); } else sync(); };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    worker?.terminate();
    el.remove();
    removeEventListener('keydown', key, true);
    opts.onClose?.();
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  $<HTMLButtonElement>('.op-x').onclick = close;
  $<HTMLButtonElement>('.sk-start').onclick = () => {
    opts.tap?.();
    const url = skirmishLink({ ...c, water: bodies[c.world]?.ocean ? c.water : 'none' }, opts.base);
    closed = true;
    worker?.terminate();
    (opts.go ?? ((u: string) => { location.href = u; }))(url);
  };
  addEventListener('keydown', key, true);
  document.body.appendChild(el);
  changed(true);
  $<HTMLButtonElement>('.sk-start').focus({ preventScroll: true });
  return close;
}
