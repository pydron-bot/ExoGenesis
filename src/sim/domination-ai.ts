/**
 * Domination's computer players (DESIGN §5.12 phase 5; TECH.md "Domination: the computer's strategy"). Every few
 * seconds, through the same orders a player has (`domBuild`, `domSend`), seeing what a player sees (everything: there's
 * no fog yet):
 *   1. **Defend** (not Easy): armies on their way to its areas, and fights going on in them. It sends help from areas
 *      next door that can get there in time and queues guns where they'll be ready; Hard pulls an army out of a place
 *      it can't hold rather than lose it.
 *   2. **Spend:** develop safe areas while it pays back (Hard sooner), guns on borders sized to the enemy armies next
 *      door, gantries where they're needed, armies where they're massing, nothing hoarded.
 *   3. **Attack:** for each place it can reach, the armies that would arrive together (within 40 s of each other) join
 *      in if they beat what holds it by its margin; sends only what it takes. It prefers the weakest enemy (a player's
 *      last areas most of all, so wars end), places whose army has gone out, developed places, and near ones.
 *   4. **Gather:** armies with nothing to do join its strike force (its biggest army by an enemy or a gantry),
 *      overland or by launch, so it has one army big enough to break in rather than many small ones.
 * Deterministic: no randomness, ties broken by area order.
 */
import {
  DOM, armyCap, armyOf, destinations, domBuild, domSend, holderWorth, jobCost, ownedBy, travelTime,
  type DomArea, type DomLevel, type DomMap, type DomState,
} from './domination';
import { allied, movesSeenBy, visibleTo } from './domination';

interface Style {
  /** The edge it wants over what holds a place before it attacks. */
  margin: number;
  /** Least army it attacks with. */
  minArmy: number;
  /** Answers attacks on its areas. */
  defends: boolean;
  /** Pulls an army out of a place it can't hold. */
  evacuates: boolean;
  /** Goes for the weakest enemy, and a player's last areas. */
  focus: boolean;
  /** Develops while income is under this × areas held. */
  develop: number;
}
export const STYLES: Record<DomLevel, Style> = {
  easy: { margin: 1.7, minArmy: 35, defends: false, evacuates: false, focus: false, develop: 1.6 },
  normal: { margin: 1.35, minArmy: 25, defends: true, evacuates: false, focus: true, develop: 2.2 },
  hard: { margin: 1.2, minArmy: 20, defends: true, evacuates: true, focus: true, develop: 2.6 },
};

/** What it takes to win an area, as the attacker `p` sees it: its holder, and anyone else fighting there. */
const defence = (s: DomState, a: DomArea, p: number) =>
  holderWorth(a) + Object.entries(a.visitors).reduce((m, [k, v]) => m + (allied(s, Number(k), p) ? -v : v), 0);

/** What a computer guesses is in an area it has never seen (natives about average; a player's area well held). */
const GUESS = { natives: 18, army: 30, guns: 20 };

/**
 * The war as `p` sees it under fog: areas out of sight carry what it last saw (or a guess), with no fights or queues
 * it can know of; only the moves it can see. Areas in sight are the real ones (so its own orders show at once). It
 * remembers what it sees now for later.
 */
export function fogView(map: DomMap, real: DomState, p: number): DomState {
  const pl = real.players[p];
  const seen = visibleTo(map, real, p);
  const mem = (pl.seen ??= {});
  const areas: Record<string, DomArea> = {};
  for (const a of Object.values(real.areas)) {
    if (seen.has(a.id)) {
      areas[a.id] = a;
      if (!allied(real, a.owner, p)) mem[a.id] = { army: a.army, guns: a.guns, natives: a.natives, t: real.t };
      continue;
    }
    const m = mem[a.id];
    areas[a.id] = { ...a, queue: [], visitors: {}, army: a.owner >= 0 ? m?.army ?? GUESS.army : 0, guns: a.owner >= 0 ? m?.guns ?? GUESS.guns : 0, natives: a.owner < 0 ? m?.natives ?? GUESS.natives : 0 };
  }
  return { ...real, areas, moves: movesSeenBy(map, real, p, seen) };
}

export function domAiThink(map: DomMap, real: DomState, p: number) {
  // it plans on what it can see, and gives its orders in the real war
  const s = real.rules?.fog ? fogView(map, real, p) : real;
  const pl = s.players[p];
  const st = STYLES[pl.ai ?? 'normal'];
  // at its army limit an idle army is wasted: it settles for less of an edge
  const full = armyOf(s, p) + 10 > armyCap(s, p);
  const margin = st.margin * (full ? 0.85 : 1);
  const mine = ownedBy(s, p);
  if (!mine.length) return;
  const links = (a: DomArea) => map.byId[a.id].links.map((l) => s.areas[l]);
  const foe = (o: number) => o >= 0 && !allied(s, o, p);
  const enemyNext = (a: DomArea) => links(a).some((o) => foe(o.owner));
  const openNext = (a: DomArea) => links(a).some((o) => !allied(s, o.owner, p));
  const worldOpen = (body: string) => map.list.some((x) => x.body === body && !allied(s, s.areas[x.id].owner, p));
  const fighting = (a: DomArea) => Object.entries(a.visitors).some(([k, v]) => !allied(s, Number(k), p) && v > 0);
  /** Enemy armies on their way to each of its areas (strength, earliest arrival). */
  const incoming = new Map<string, { n: number; eta: number }>();
  for (const m of s.moves) {
    if (allied(s, m.player, p) || s.areas[m.to].owner !== p) continue;
    const x = incoming.get(m.to) ?? { n: 0, eta: Infinity };
    x.n += m.strength; x.eta = Math.min(x.eta, m.t1 - s.t);
    incoming.set(m.to, x);
  }
  /** Enemy army next door to an area (what could come at it soon). */
  const nearby = (a: DomArea) => links(a).reduce((n, o) => n + (foe(o.owner) ? o.army : 0), 0);
  const threat = (a: DomArea) => (incoming.get(a.id)?.n ?? 0) + Object.entries(a.visitors).reduce((n, [k, v]) => n + (allied(s, Number(k), p) ? 0 : v), 0);
  const used = new Set<string>();
  const busy = (a: DomArea) => a.queue.length >= 2 || fighting(a);
  const spend = (a: DomArea | undefined, kind: Parameters<typeof domBuild>[3]) => !!a && !busy(a) && domBuild(real, p, a.id, kind) === null;

  // ---- 1. defend
  if (st.defends) {
    const danger = mine.filter((a) => threat(a) > 0).sort((a, b) => threat(b) - threat(a));
    for (const a of danger) {
      const need = threat(a) * 1.15 - holderWorth(a);
      if (need <= 0) continue;
      const eta = incoming.get(a.id)?.eta ?? 0;
      // guns, if they'd be ready in time
      if (!fighting(a) && eta > DOM.jobs.guns.time && a.queue.length < 2) domBuild(real, p, a.id, 'guns');
      // help from next door that gets there in time (or straight away into a fight going on)
      let want = need;
      const helpers = links(a).filter((o) => o.owner === p && !used.has(o.id) && !fighting(o) && o.army >= 5)
        .map((o) => ({ o, t: travelTime(map, o.id, a.id, false) }))
        .filter((h) => fighting(a) || h.t <= eta + 10)
        .sort((x, y) => x.t - y.t);
      const can = helpers.reduce((m, h) => m + h.o.army * (threat(h.o) > 0 ? 0 : 0.8), 0);
      if (st.evacuates && can + holderWorth(a) < threat(a) * 0.8 && a.army >= 10 && !fighting(a)) {
        // can't be held: save the army (to the safest neighbour) rather than lose it
        const safe = links(a).filter((o) => o.owner === p && threat(o) === 0).sort((x, y) => nearby(x) - nearby(y))[0];
        if (safe) { domSend(map, real, p, a.id, safe.id, Math.floor(a.army)); used.add(a.id); used.add(safe.id); }
        continue;
      }
      for (const h of helpers) {
        if (want <= 0 || threat(h.o) > 0) continue;
        const n = Math.floor(Math.min(h.o.army * 0.8, want + 5));
        if (n < 1) continue;
        domSend(map, real, p, h.o.id, a.id, n);
        used.add(h.o.id);
        want -= n;
      }
    }
  }

  // ---- 2. spend
  const income = mine.reduce((m, a) => m + DOM.income.base + a.level * DOM.income.perLevel, 0);
  const safe = mine.filter((a) => !enemyNext(a) && !threat(a)).sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1));
  const borders = mine.filter(enemyNext).map((a) => ({ a, want: Math.min(DOM.jobs.guns.max, 10 + nearby(a) * 0.3) })).sort((x, y) => (x.a.guns - x.want) - (y.a.guns - y.want));
  const fronts = mine.filter((a) => openNext(a) || a.gantry).sort((a, b) => (enemyNext(b) ? 1 : 0) - (enemyNext(a) ? 1 : 0) || b.army - a.army || (a.id < b.id ? -1 : 1));
  const staging = fronts[0] ?? mine[0];
  const reserve = st === STYLES.easy ? 150 : 50;
  for (let i = 0; i < 10; i++) {
    const devAt = safe.find((a) => a.level < DOM.develop.max && !a.queue.some((j) => j.kind === 'develop'));
    if (devAt && income < st.develop * mine.length && pl.alloys >= jobCost(devAt, 'develop').cost + reserve && spend(devAt, 'develop')) continue;
    const gunAt = borders.find((x) => x.a.guns + x.a.queue.filter((j) => j.kind === 'guns').length * DOM.jobs.guns.gives < x.want);
    if (gunAt && pl.alloys > reserve + 100 && spend(gunAt.a, 'guns')) continue;
    // gantries: an army stranded on a world with nothing left to take; once its world is taken; one per six areas later
    const stranded = mine.find((a) => a.army >= 20 && !a.gantry && !a.queue.some((j) => j.kind === 'gantry') && !worldOpen(map.byId[a.id].body) && !links(a).some((o) => o.gantry));
    if (stranded && spend(stranded, 'gantry')) continue;
    // alloys to spare: a gantry wherever an army waits, so it can go anywhere (no stand-offs)
    const waiting = pl.alloys > 1000 ? mine.find((a) => a.army >= 30 && !a.gantry && !a.queue.some((j) => j.kind === 'gantry')) : undefined;
    if (waiting && spend(waiting, 'gantry')) continue;
    const gantries = mine.filter((a) => a.gantry || a.queue.some((j) => j.kind === 'gantry')).length;
    const stuck = !mine.some((a) => worldOpen(map.byId[a.id].body));
    if ((stuck || s.t > 600) && gantries < 1 + Math.floor(mine.length / 6) && staging && !staging.gantry && spend(staging, 'gantry')) continue;
    if (pl.alloys >= reserve && fronts.some((a) => spend(a, 'army'))) continue;
    // nothing else to spend on (army at its limit): develop anywhere safe, then more guns
    if (full && devAt && spend(devAt, 'develop')) continue;
    break;
  }

  // ---- 3. attack
  const ready = (a: DomArea) => a.army >= 1 && !fighting(a) && !used.has(a.id);
  // what stays home: enough for what's next door and on its way, at least 10 by an enemy
  const keep = (a: DomArea) => Math.max(enemyNext(a) ? 10 : 0, Math.min(a.army, threat(a) * 1.1 + nearby(a) * 0.35 - a.guns));
  const spare = (a: DomArea) => Math.max(0, a.army - keep(a));
  const alive = s.players.map((x, i) => (x.out || allied(s, i, p) ? 0 : ownedBy(s, i).length));
  const weakest = st.focus ? alive.reduce((b, n, i) => (n > 0 && (b < 0 || n < alive[b]) ? i : b), -1) : -1;
  const reach = new Map<string, { from: DomArea; launch: boolean; t: number }[]>();
  for (const a of mine) {
    if (!ready(a) || spare(a) < 1) continue;
    for (const w of destinations(map, s, a.id)) {
      const to = s.areas[w.to];
      if (allied(s, to.owner, p)) continue;
      // launches: once its world has nothing left to take, or with a big army, or at its army limit
      if (w.launch && worldOpen(map.byId[a.id].body) && a.army < 40 && !full) continue;
      if (!reach.has(w.to)) reach.set(w.to, []);
      reach.get(w.to)!.push({ from: a, launch: w.launch, t: travelTime(map, a.id, w.to, w.launch) });
    }
  }
  const plans = [...reach.entries()].map(([to, from]) => {
    const t = s.areas[to];
    // what holds it, and half of what its holder could bring from next door before an attack lands
    const help = t.owner >= 0 ? map.byId[to].links.reduce((n, l) => n + (s.areas[l].owner === t.owner ? s.areas[l].army : 0), 0) : 0;
    const def = Math.max(0, defence(s, t, p)) + help * 0.5;
    // the armies that arrive together: within 40 s of the first
    from.sort((x, y) => x.t - y.t || (x.from.id < y.from.id ? -1 : 1));
    const together = from.filter((f) => f.t <= from[0].t + 40);
    const have = together.reduce((m, f) => m + spare(f.from), 0);
    let value = 1 + t.level * 0.3;
    if (t.owner >= 0) {
      value += 0.3;
      if (t.owner === weakest) value += 1;
      if (st.focus && alive[t.owner] <= 2) value += 2; // a player's last areas: finish them
      if (t.army < t.guns * 0.5) value += 0.3; // its army has gone out
    }
    const eta = together[together.length - 1].t;
    // (past three times what it takes, easier doesn't count: what's worth taking decides, so it doesn't just churn weak spots)
    return { to, together, def, have, score: Math.min(3, have / (def * margin + 1)) * value / (1 + eta / 150) };
  }).filter((x) => x.have >= st.minArmy * 0.5 && x.have > x.def * margin + 5).sort((a, b) => b.score - a.score || (a.to < b.to ? -1 : 1));
  for (const plan of plans) {
    const go = plan.together.filter((f) => !used.has(f.from.id) && spare(f.from) >= 1).sort((a, b) => spare(b.from) - spare(a.from));
    if (go.reduce((m, f) => m + spare(f.from), 0) <= plan.def * margin + 5) continue;
    // enough to be sure (with some over to hold it), the biggest first
    let need = plan.def * margin * 1.5 + 20;
    for (const f of go) {
      if (need <= 0) break;
      const n = Math.floor(Math.min(spare(f.from), need));
      if (n < 1) continue;
      used.add(f.from.id);
      domSend(map, real, p, f.from.id, plan.to, n);
      need -= n;
    }
  }

  // ---- 4. gather: armies with nothing to do join the strike force, the biggest army that can reach a fight (one by
  // an enemy, or with a gantry); overland step by step, or by launch from another world
  // (armies already on their way there count, so the choice holds steady while they gather)
  const coming = (a: DomArea) => s.moves.reduce((n, m) => n + (m.player === p && m.to === a.id ? m.strength : 0), 0);
  const strike = mine.filter((a) => (enemyNext(a) || a.gantry) && !fighting(a)).sort((a, b) => b.army + coming(b) - a.army - coming(a) || (a.id < b.id ? -1 : 1))[0];
  if (!strike) return;
  const dist = new Map<string, number>([[strike.id, 0]]);
  const queue = [strike.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of map.byId[id].links) if (s.areas[l].owner === p && !dist.has(l)) { dist.set(l, dist.get(id)! + 1); queue.push(l); }
  }
  for (const a of mine) {
    if (a === strike || !ready(a) || spare(a) < 15) continue;
    const d = dist.get(a.id);
    const n = Math.floor(spare(a));
    if (d !== undefined) {
      const next = map.byId[a.id].links.filter((l) => (dist.get(l) ?? 99) < d).sort()[0];
      if (next) domSend(map, real, p, a.id, next, n);
    } else if (a.gantry && map.byId[a.id].body !== map.byId[strike.id].body) domSend(map, real, p, a.id, strike.id, n);
  }
}
