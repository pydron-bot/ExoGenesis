/**
 * Domination's computer players (basic: DESIGN §5.12 phase 5 makes them smarter). Every few seconds, through the same
 * orders a player has (`domBuild`, `domSend`):
 *   - spend: develop the safest areas while income is low, guns on borders that face an enemy, a Launch Gantry once
 *     nothing on its own world is left to take, and armies in the area where they're massing;
 *   - move: armies in areas with no enemy next door walk to one that has; an army strong enough for the weakest place
 *     it can reach (natives, or an enemy's army and guns) goes for it; a big one launches for another world when its
 *     own has nothing left worth taking.
 * Deterministic: no randomness, ties broken by area order.
 */
import { DOM, armyCap, armyOf, destinations, domBuild, domSend, jobCost, ownedBy, type DomArea, type DomMap, type DomState } from './domination';

/** What it takes to win an area, as the attacker sees it. */
const defence = (a: DomArea, p: number) =>
  (a.owner >= 0 ? a.army + a.guns * DOM.gunsBonus : a.natives) + Object.entries(a.visitors).reduce((m, [k, v]) => m + (Number(k) === p ? -v : v), 0);

export function domAiThink(map: DomMap, s: DomState, p: number) {
  const pl = s.players[p];
  const level = pl.ai ?? 'normal';
  // the edge it wants before attacking; at its army limit (an idle army is wasted) it settles for less
  const full = armyOf(s, p) + 10 > armyCap(s, p);
  const margin = (level === 'hard' ? 1.25 : level === 'normal' ? 1.4 : 1.7) * (full ? 0.8 : 1);
  const mine = ownedBy(s, p);
  const enemyNext = (a: DomArea) => map.byId[a.id].links.some((l) => { const o = s.areas[l].owner; return o >= 0 && o !== p; });
  const openNext = (a: DomArea) => map.byId[a.id].links.some((l) => s.areas[l].owner !== p);
  const worldOpen = (body: string) => map.list.some((x) => x.body === body && s.areas[x.id].owner !== p);

  // ---- spend
  const busy = (a: DomArea) => a.queue.length >= 2 || Object.keys(a.visitors).length > 0;
  const spend = (a: DomArea | undefined, kind: Parameters<typeof domBuild>[3]) => !!a && !busy(a) && domBuild(s, p, a.id, kind) === null;
  const safe = mine.filter((a) => !enemyNext(a)).sort((a, b) => a.level - b.level);
  const borders = mine.filter(enemyNext).sort((a, b) => a.guns - b.guns);
  // where armies are built: areas next to something to take, the biggest garrisons first
  const fronts = mine.filter((a) => openNext(a) || a.gantry).sort((a, b) => (enemyNext(b) ? 1 : 0) - (enemyNext(a) ? 1 : 0) || b.army - a.army);
  const staging = fronts[0] ?? mine[0];
  for (let i = 0; i < 8; i++) {
    const income = mine.reduce((m, a) => m + 1 + a.level, 0);
    if (income < 6 + mine.length && safe[0] && safe[0].level < 2 && pl.alloys >= jobCost(safe[0], 'develop').cost + 100 && spend(safe[0], 'develop')) continue;
    if (borders[0] && borders[0].guns < 20 && pl.alloys > 200 && spend(borders[0], 'guns')) continue;
    const gantries = mine.filter((a) => a.gantry || a.queue.some((j) => j.kind === 'gantry'));
    const stuck = mine.length && !mine.some((a) => worldOpen(map.byId[a.id].body));
    // an army stranded on a world with nothing left to take (it launched there) needs a gantry to leave
    const stranded = mine.find((a) => a.army >= 20 && !a.gantry && !a.queue.some((j) => j.kind === 'gantry') && !worldOpen(map.byId[a.id].body) && !map.byId[a.id].links.some((l) => s.areas[l].gantry));
    if (stranded && spend(stranded, 'gantry')) continue;
    if ((stuck || s.t > 600) && gantries.length < 1 + Math.floor(mine.length / 6) && staging && !staging.gantry && spend(staging, 'gantry')) continue;
    if (fronts.some((a) => spend(a, 'army'))) continue;
    if (safe.find((a) => a.level < DOM.develop.max) && pl.alloys > 500 && spend(safe.find((a) => a.level < DOM.develop.max), 'develop')) continue;
    if (mine.some((a) => a.guns < 40 && enemyNext(a) && pl.alloys > 800 && spend(a, 'guns'))) continue;
    break;
  }

  // ---- attack: for each place to take, every army that can reach it joins in if together they're enough
  const minArmy = level === 'hard' ? 20 : level === 'normal' ? 25 : 35;
  const ready = (a: DomArea) => a.army >= 1 && !Object.keys(a.visitors).length;
  // next to an enemy, a garrison stays: a third of the army, at least 10
  const spare = (a: DomArea) => a.army - (enemyNext(a) ? Math.max(10, a.army / 3) : 0);
  const reach = new Map<string, { from: DomArea; launch: boolean }[]>();
  for (const a of mine) {
    if (!ready(a)) continue;
    for (const w of destinations(map, s, a.id)) {
      if (s.areas[w.to].owner === p) continue;
      // launches: once its world has nothing left to take, or with a big army
      if (w.launch && worldOpen(map.byId[a.id].body) && a.army < 40 && !full) continue;
      if (!reach.has(w.to)) reach.set(w.to, []);
      reach.get(w.to)!.push({ from: a, launch: w.launch });
    }
  }
  const plans = [...reach.entries()].map(([to, from]) => {
    const def = Math.max(0, defence(s.areas[to], p));
    const have = from.reduce((m, f) => m + Math.max(0, spare(f.from)), 0);
    // nearer and weaker first; an enemy's developed area is worth more
    const worth = 1 + s.areas[to].level * 0.3 + (s.areas[to].owner >= 0 ? 0.3 : 0);
    return { to, from, def, have, score: (have / (def * margin + 1)) * worth - (from.every((f) => f.launch) ? 0.3 : 0) };
  }).filter((x) => x.have >= minArmy * 0.5 && x.have > x.def * margin).sort((a, b) => b.score - a.score || (a.to < b.to ? -1 : 1));
  const used = new Set<string>();
  for (const plan of plans) {
    const go = plan.from.filter((f) => !used.has(f.from.id) && spare(f.from) >= 1).sort((a, b) => spare(b.from) - spare(a.from));
    if (go.reduce((m, f) => m + spare(f.from), 0) <= plan.def * margin) continue;
    // only what it takes (with some to spare to hold it), the biggest first
    let need = plan.def * margin * 1.3 + 10;
    for (const f of go) {
      if (need <= 0) break;
      const n = Math.floor(Math.min(spare(f.from), need));
      if (n < 1) continue;
      used.add(f.from.id);
      domSend(map, s, p, f.from.id, plan.to, n);
      need -= n;
    }
  }

  // ---- armies with nothing to take next door step toward the front: the nearest area (over its own ground) that
  // borders something to take, or has a gantry
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const a of mine) if (openNext(a) || a.gantry) { dist.set(a.id, 0); queue.push(a.id); }
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of map.byId[id].links) if (s.areas[l].owner === p && !dist.has(l)) { dist.set(l, dist.get(id)! + 1); queue.push(l); }
  }
  for (const a of mine) {
    const d = dist.get(a.id);
    if (used.has(a.id) || !ready(a) || a.army < 10 || d === undefined || d === 0) continue;
    const next = map.byId[a.id].links.filter((l) => s.areas[l].owner === p && (dist.get(l) ?? 99) < d).sort()[0];
    if (next) domSend(map, s, p, a.id, next, Math.floor(a.army));
  }
}
