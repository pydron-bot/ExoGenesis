/**
 * Play test setup ("simulate to here"): how far into a game a story or mission
 * play test starts. Remembered in this browser and shared by every play test
 * button; the game applies it once as the colony deploys (Sim.playSetup).
 */
import type { PlaySetup } from '../sim/types';
import { h } from './dom';

const KEY = 'exo.playtest.setup';
const load = (): PlaySetup & { on?: boolean } => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
let setup = load();
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(setup)); } catch { /* private mode */ } };

/** The setup to hand the game, or undefined when it's off or empty. */
export function playSetup(): PlaySetup | undefined {
  if (!setup.on) return undefined;
  const { on: _, ...rest } = setup;
  return Object.values(rest).some((v) => (Array.isArray(v) ? v.length : !!v)) ? rest : undefined;
}

/** One-line summary ("Sol 3 · 2 colonists · solar, depot"). */
export function setupSummary(): string {
  const p = playSetup();
  if (!p) return 'A fresh colony, just deployed.';
  return [p.sol && p.sol > 1 ? `Sol ${p.sol}` : '', p.buildings?.length ? p.buildings.join(', ') : '', p.colonists ? `${p.colonists} colonist${p.colonists > 1 ? 's' : ''}` : '',
    p.alloys ? `+${p.alloys} alloys` : '', p.flags?.length ? `flags: ${p.flags.join(', ')}` : '', p.peaceful ? 'no predators' : ''].filter(Boolean).join(' · ');
}


/** The setup form. `buildings` and `flags` offer what the content has. */
export function setupPanel(buildings: { id: string; name: string }[], flags: string[]): HTMLElement {
  const box = h('details', 'setup');
  box.open = !!setup.on;
  const sum = h('summary', '', 'Start further in: ', h('span', 'dim', setupSummary()));
  const refresh = () => { store(); sum.lastElementChild!.textContent = setupSummary(); };
  const on = h('input', '');
  on.type = 'checkbox';
  on.checked = !!setup.on;
  on.onchange = () => { setup.on = on.checked; refresh(); };
  const num = (label: string, key: 'sol' | 'alloys' | 'colonists', min: number, max: number, step = 1) => {
    const inp = h('input', 'setup-num');
    inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = String(step);
    inp.value = setup[key] ? String(setup[key]) : '';
    inp.oninput = () => { const v = Number(inp.value); if (inp.value === '' || !v) delete setup[key]; else setup[key] = Math.max(min, Math.min(max, v)); refresh(); };
    return h('label', 'setup-field', h('span', '', label), inp);
  };
  const picks = h('div', 'setup-builds');
  const drawPicks = () => {
    picks.replaceChildren();
    const have = setup.buildings ?? [];
    for (const b of buildings) {
      const n = have.filter((k) => k === b.id).length;
      const btn = h('button', n ? 'on' : '', b.name, n ? h('b', '', ` ×${n}`) : null);
      btn.type = 'button';
      btn.title = 'Click to add one; right-click to remove one';
      btn.onclick = (e) => { e.preventDefault(); setup.buildings = [...have, b.id]; drawPicks(); refresh(); };
      btn.oncontextmenu = (e) => { e.preventDefault(); const i = have.lastIndexOf(b.id); if (i >= 0) { have.splice(i, 1); setup.buildings = [...have]; drawPicks(); refresh(); } };
      picks.append(btn);
    }
  };
  drawPicks();
  const fl = h('input', 'setup-flags');
  fl.type = 'text';
  fl.placeholder = 'flags to set, comma separated';
  fl.value = (setup.flags ?? []).join(', ');
  const listId = 'setup-flag-list';
  fl.setAttribute('list', listId);
  const dl = h('datalist', '');
  dl.id = listId;
  for (const f of flags) dl.append(Object.assign(h('option', ''), { value: f }));
  fl.oninput = () => { setup.flags = fl.value.split(',').map((x) => x.trim()).filter(Boolean); refresh(); };
  const peace = h('input', '');
  peace.type = 'checkbox';
  peace.checked = !!setup.peaceful;
  peace.onchange = () => { setup.peaceful = peace.checked; refresh(); };
  box.append(sum,
    h('label', 'check', on, ' Use this setup in play tests'),
    h('div', 'setup-row', num('Start at Sol', 'sol', 1, 1000, 0.5), num('Colonists', 'colonists', 0, 60), num('Extra alloys', 'alloys', 0, 100000, 50)),
    h('div', 'setup-lbl', 'Already built (click to add, right-click to remove):'), picks,
    h('div', 'setup-row', fl, dl, h('label', 'check', peace, ' No predators')),
    h('div', 'help', 'Applied as the colony deploys, before the event fires or the mission starts. Moving the clock fires any time triggers it passes. Buildings go round the Core (depots by a deposit, a tap on a vent), finished.'));
  return box;
}
