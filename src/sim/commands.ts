/**
 * The player's commands (orders, building, research, policies, abilities, debug): what `Sim.command` does with
 * each one, for the player whose turn it is (`sim.team`, set by Sim.command). Split out of ./core.ts.
 */
import { content } from '../content';
import { regionHeightRaw } from '../world/planet';
import { moveOf, offLimits } from './path';
import { researchBlocked } from './mods';
import { compass, factoryMakes, gateSnap, linePoints, placeProblem, wallsUnderGate } from './rules';
import type { Command, Drone } from './types';
import { clamp } from '../util/math';
import { DEFS, type Foe, REGION_ID, RULES, SPREAD, type Sim, def, limit, maxHp } from './core';

export function runCommand(sim: Sim, c: Command) {
  const s = sim.s;
  if (c.type === 'landing') { sim.landing(c.stage); return; }
  if (!sim.deployed || s.over) return;
  switch (c.type) {
    case 'move': {
      const d = s.drones.find((x) => x.id === c.drone) ?? s.drones[0];
      if (!d) return;
      d.task = { kind: 'move', x: clamp(c.x, -limit(), limit()), z: clamp(c.z, -limit(), limit()) };
      d.manual = true;
      return;
    }
    case 'build': {
      const dd = DEFS[c.kind];
      if (!dd || !dd.buildable) return;
      if (sim.story.locked(c.kind)) { sim.emit(`${dd.name} isn't available yet`, 'warn', 'deny'); return; }
      if (!sim.researched(dd.research)) { sim.emit(`${dd.name} needs research: ${content.research[dd.research!]?.name}`, 'warn', 'deny'); return; }
      if (s.alloys < dd.cost) { sim.emit(`Not enough alloys for a ${dd.name} (${dd.cost} needed)`, 'warn', 'deny'); return; }
      if ((s.isotopes ?? 0) < (dd.isotopes ?? 0)) { sim.emit(`Not enough isotopes for a ${dd.name} (${dd.isotopes} needed)`, 'warn', 'deny'); return; }
      let { x, z } = c, yaw = c.yaw ?? 0;
      // a gate dropped by a wall snaps onto its line
      const sn = dd.role === 'gate' ? gateSnap(sim.world, DEFS, x, z) : null;
      if (sn) ({ x, z, yaw } = sn);
      const why = placeProblem(sim.world, DEFS, RULES, c.kind, x, z);
      if (why) { sim.emit(`Can't build there: ${why}`, 'warn', 'deny'); return; }
      s.alloys -= dd.cost;
      s.isotopes = (s.isotopes ?? 0) - (dd.isotopes ?? 0);
      let swapped = 0;
      if (dd.role === 'gate') {
        for (const w of wallsUnderGate(s.buildings, DEFS, dd, x, z, yaw)) {
          s.alloys += def(w).cost * 0.5 * (w.progress >= 1 ? w.hp / maxHp(w) : 1);
          s.buildings.splice(s.buildings.indexOf(w), 1);
          swapped++;
        }
      }
      s.buildings.push({ id: s.nextId++, kind: c.kind, x, z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
      sim.story.placed(c.kind);
      sim.emit(`${dd.name} placed${swapped ? ` · replaces ${swapped} wall segment${swapped > 1 ? 's' : ''}` : ''}${s.drones.length ? '' : ' · waiting for a drone'}`, 'info', 'placed');
      return;
    }
    case 'buildLine': {
      const dd = DEFS[c.kind];
      if (!dd || !dd.buildable || sim.story.locked(c.kind)) return;
      const { pts, yaw } = linePoints(dd, c.x1, c.z1, c.x2, c.z2);
      let placed = 0, skipped = 0, poor = false;
      for (const p of pts) {
        if (s.alloys < dd.cost) { poor = true; break; }
        if (placeProblem(sim.world, DEFS, RULES, c.kind, p.x, p.z)) { skipped++; continue; }
        s.alloys -= dd.cost;
        s.buildings.push({ id: s.nextId++, kind: c.kind, x: p.x, z: p.z, yaw, progress: 0, hp: Math.max(1, dd.hp * 0.1), on: true, powered: false });
        placed++;
      }
      if (placed) sim.story.placed(c.kind);
      if (placed) sim.emit(`${placed} ${dd.name} segment${placed > 1 ? 's' : ''} placed${skipped ? ` · ${skipped} spots blocked` : ''}${poor ? ' · ran out of alloys' : ''}`, 'info', 'placed');
      else sim.emit(poor ? `Not enough alloys for a ${dd.name} (${dd.cost} each)` : `Can't build a ${dd.name} there`, 'warn', 'deny');
      return;
    }
    case 'repair': {
      const b = s.buildings.find((x) => x.id === c.id);
      if (!b || b.progress < 1 || b.hp >= maxHp(b)) return;
      let best: Drone | null = null, bd = Infinity;
      for (const d of s.drones) {
        const dist = Math.hypot(d.x - b.x, d.z - b.z) + (d.task.kind === 'idle' ? 0 : 1000);
        if (dist < bd) { bd = dist; best = d; }
      }
      if (best) { best.task = { kind: 'repair', id: b.id }; best.manual = true; }
      return;
    }
    case 'power': {
      const b = s.buildings.find((x) => x.id === c.id);
      if (b && b.kind !== 'core') b.on = c.on;
      return;
    }
    case 'grow': case 'unpod': case 'policy':
      sim.people.command(c);
      return;
    case 'demolish': {
      const b = s.buildings.find((x) => x.id === c.id);
      if (!b || b.kind === 'core') return;
      const dd = def(b);
      if (s.people?.pods.some((p) => p.b === b.id)) { sim.emit(`Can't recycle the ${dd.name}: its growth pods are running`, 'warn', 'deny'); return; }
      const queued = (b.queue ?? []).reduce((m, k) => m + (content.units[k]?.cost ?? 0), 0);
      const refund = queued + (b.progress < 1 ? dd.cost * (1 - b.progress * 0.5) : dd.cost * 0.5 * (b.hp / dd.hp));
      s.alloys += refund;
      s.buildings.splice(s.buildings.indexOf(b), 1);
      sim.people.buildingLost(b, false);
      sim.emit(`${dd.name} ${b.progress < 1 ? 'cancelled' : 'recycled'} · +${Math.floor(refund)} alloys`, 'info', 'recycle');
      return;
    }
    case 'standing': sim.frontier.command(c.sector, c.order); return;
    case 'neighbour': sim.inhabitants.ask(c.camp, c.act, c.n ?? 0); return;
    case 'contact':
      sim.inhabitants.command(c.camp, c.choice);
      return;
    case 'story':
      sim.story.answer(c.id, c.choice);
      return;
    case 'cinematic':
      sim.story.cineDone(c.id);
      return;
    case 'ui':
      sim.story.opened(c.what);
      return;
    case 'guide':
      sim.story.watchGuide(c.watch);
      return;
    case 'travelled':
      delete s.travel;
      return;
    case 'inspect': {
      const st = sim.story.s;
      if (c.flag && !st.flags.includes(c.flag)) st.flags.push(c.flag);
      if (c.unflag) st.flags = st.flags.filter((f) => f !== c.unflag);
      if (c.counter) (st.counters ??= {})[c.counter.id] = c.counter.value;
      if (c.objective) sim.missions.mark(c.objective.mission, c.objective.index);
      if (c.finish) sim.missions.complete(c.finish);
      if (c.fail) sim.missions.fail(c.fail, 'failed from the story inspector');
      if (c.expire) { st.countdowns = (st.countdowns ?? []).filter((x) => x.id !== c.expire); if (!(st.expired ??= []).includes(c.expire)) st.expired.push(c.expire); }
      if (c.unlock && st.locked) st.locked = st.locked.filter((x) => x !== c.unlock);
      if (c.route) sim.story.effect({ kind: 'route', region: c.route });
      if (c.unroute) sim.story.effect({ kind: 'unroute', region: c.unroute });
      if (c.skip && c.skip > 0) sim.skip(c.skip);
      return;
    }
    case 'debug': {
      if (c.setup) sim.playSetup(c.setup);
      if (c.story) sim.story.fire(c.story);
      if (c.cinematic) sim.story.playCine(c.cinematic);
      if (c.mission) {
        sim.missions.jump(c.mission);
        // a mission on another region (?mission=, the inspector): go there to play it
        const r = content.missions[c.mission]?.region;
        if (r && r !== REGION_ID && content.regions[r] && !sim.everywhere && !s.players) { sim.story.effect({ kind: 'route', region: r }); s.travel = r; }
      }
      if (c.regard) sim.inhabitants.setRegard(c.regard.camp, c.regard.value);
      if (c.alloys) s.alloys += c.alloys;
      if (c.wave) s.waves.next = s.tick;
      if (c.spawn && content.units[c.spawn.unit]) {
        // tests: a pack of `n` right here
        const sp = c.spawn, pack = { id: s.nextId++, size: sp.n ?? 1, alive: 0, announced: true, from: compass(sp.x, sp.z) };
        for (let i = 0; i < pack.size; i++) {
          const slot = sim.freeSlot();
          if (slot < 0) break;
          s.hostiles.push({ id: s.nextId++, unit: sp.unit, slot, x: sp.x + (i % 4) * 1.6, z: sp.z - Math.floor(i / 4) * 1.6, heading: 0, hp: content.units[sp.unit].hp, target: -1, cd: 0, pack: pack.id, under: content.units[sp.unit].burrows || undefined });
          pack.alive++;
        }
        s.packs.push(pack);
      }
      if (c.units && content.units[c.units.unit]?.faction === 'accord') {
        // tests / playtesting: combat units right here, guarding where they land
        const sp = c.units, ud = content.units[sp.unit];
        for (let i = 0; i < (sp.n ?? 1); i++) {
          const slot = sim.freeSlot();
          if (slot < 0) break;
          const x = clamp(sp.x + (i % 4) * 3, -limit(), limit()), z = clamp(sp.z - Math.floor(i / 4) * 3, -limit(), limit());
          sim.units.push({ id: s.nextId++, unit: sp.unit, slot, x, z, heading: 0, hp: ud.hp, cd: 0, order: { kind: 'idle' }, gx: x, gz: z, target: -1 });
        }
      }
      if (c.people) sim.people.debug(c.people);
      if (c.hurt) {
        const b = s.buildings.find((x) => x.id === c.hurt!.id);
        if (b) { b.hp -= c.hurt.hp; if (b.hp <= 0) sim.destroyBuilding(b); }
      }
      return;
    }
    case 'produce': {
      const b = s.buildings.find((x) => x.id === c.id);
      const ud = content.units[c.unit];
      if (!b || def(b).role !== 'factory' || b.progress < 1 || !ud || ud.faction !== 'accord' || ud.cost === undefined) return;
      if (!factoryMakes(def(b), ud)) { sim.emit(`The ${def(b).name} can't build a ${ud.name}`, 'warn', 'deny'); return; }
      if (sim.story.locked(c.unit)) { sim.emit(`${ud.name} isn't available yet`, 'warn', 'deny'); return; }
      const queued = s.buildings.reduce((m, x) => m + (x.queue?.length ?? 0), 0);
      if (sim.armySize() + queued >= sim.unitCap()) { sim.emit(`Combat unit limit reached (${sim.unitCap()})`, 'warn', 'deny'); return; }
      if (!sim.researched(ud.research)) { sim.emit(`${ud.name} needs research: ${content.research[ud.research!]?.name}`, 'warn', 'deny'); return; }
      if (s.alloys < ud.cost) { sim.emit(`Not enough alloys for a ${ud.name} (${ud.cost} needed)`, 'warn', 'deny'); return; }
      if ((s.isotopes ?? 0) < (ud.isotopes ?? 0)) { sim.emit(`Not enough isotopes for a ${ud.name} (${ud.isotopes} needed)`, 'warn', 'deny'); return; }
      s.alloys -= ud.cost;
      s.isotopes = (s.isotopes ?? 0) - (ud.isotopes ?? 0);
      (b.queue ??= []).push(c.unit);
      if (b.queue.length === 1) b.prod = 0;
      return;
    }
    case 'unqueue': {
      const b = s.buildings.find((x) => x.id === c.id);
      if (!b?.queue?.length) return;
      const k = b.queue.pop()!;
      s.alloys += content.units[k]?.cost ?? 0;
      s.isotopes = (s.isotopes ?? 0) + (content.units[k]?.isotopes ?? 0);
      if (!b.queue.length) b.prod = 0;
      return;
    }
    case 'order': {
      let sel = sim.units.filter((u) => c.ids.includes(u.id));
      const x = clamp(c.x, -limit(), limit()), z = clamp(c.z, -limit(), limit());
      for (const u of sel) { u.ride = undefined; u.drop = undefined; if (content.units[u.unit].ability === 'siege') u.abT = 0; }
      // a loaded transport sent to a spot on land goes to land its cargo there
      if (!offLimits('ground', regionHeightRaw(x, z))) sel = sel.filter((u) => !(u.cargo?.length && sim.sendToLand(u, x, z)));
      // spread out around the point (sunflower), nearest units take the inner spots
      sel.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      // spots that land in a building (or the water, for a Rover) move to open ground beside it, a spot apart
      sim.setUnitBodies(sel);
      // spots already held near the point (units standing there, or on their way to it) stay theirs: reinforcements
      // sent after the first group take the next free spots instead of all piling onto the middle
      const held: number[] = [];
      const near = SPREAD * Math.sqrt(sel.length + 40) + 6;
      for (const o of sim.units) {
        if (sel.includes(o) || (o.team ?? 0) !== sim.team) continue;
        const px = o.order.kind === 'move' ? o.order.x : o.order.kind === 'idle' ? o.x : NaN, pz = o.order.kind === 'move' ? o.order.z : o.z;
        if (Number.isFinite(px) && Math.hypot(px - x, pz - z) < near) held.push(px, pz);
      }
      const isHeld = (px: number, pz: number) => { for (let k = 0; k < held.length; k += 2) if (Math.hypot(held[k] - px, held[k + 1] - pz) < SPREAD * 0.8) return true; return false; };
      const taken: number[] = [];
      let slot = 0;
      sel.forEach((u) => {
        let i = slot;
        while (i < slot + 400 && isHeld(x + Math.cos(i * 2.39996) * SPREAD * Math.sqrt(i), z + Math.sin(i * 2.39996) * SPREAD * Math.sqrt(i))) i++;
        slot = i + 1;
        const r = SPREAD * Math.sqrt(i) * (i ? 1 : 0), a = i * 2.39996;
        let ox = clamp(x + Math.cos(a) * r, -limit(), limit()), oz = clamp(z + Math.sin(a) * r, -limit(), limit());
        const m = moveOf(content.units[u.unit]);
        if (m !== 'air' && sim.unitGrid(m).isBlocked(ox, oz)) {
          const g = sim.unitGrid(m), free = (px: number, pz: number) => !g.isBlocked(px, pz) && !taken.some((_, k) => k % 2 === 0 && Math.hypot(taken[k] - px, taken[k + 1] - pz) < SPREAD * 0.8);
          search: for (let rr = 2; rr < 40; rr += 2) {
            const steps = Math.ceil((rr * 6.3) / 2);
            for (let q = 0; q < steps; q++) {
              const t = a + (q / steps) * Math.PI * 2, px = ox + Math.cos(t) * rr, pz = oz + Math.sin(t) * rr;
              if (Math.abs(px) < limit() && Math.abs(pz) < limit() && free(px, pz)) { ox = px; oz = pz; break search; }
            }
          }
        }
        taken.push(ox, oz);
        u.order = { kind: 'move', x: ox, z: oz };
        u.target = -1;
      });
      return;
    }
    case 'attack': {
      // one target: a campaign faction's unit or building (a neutral one turns hostile), or a predator
      const all = sim.all ?? { buildings: s.buildings, units: sim.units };
      const tgt: Foe | undefined = all.units.find((u) => u.id === c.target) ?? all.buildings.find((b) => b.id === c.target) ?? s.hostiles.find((h) => h.id === c.target);
      if (!tgt) return;
      const t = (tgt as { team?: number }).team ?? 0;
      if (t && !s.players) {
        const f = s.factions?.find((x) => x.team === t);
        if (sim.attitude(t) === 'allied') { sim.emit(`${f?.name ?? 'They'} are on our side`, 'warn', 'deny'); return; }
        if (f && f.attitude === 'neutral') {
          sim.setAttitude(f.id, 'hostile');
          if (!sim.story.has(`${f.id}-attacked`)) sim.story.s.flags.push(`${f.id}-attacked`);
        }
      }
      sim.run({ type: 'order', ids: c.ids, x: tgt.x, z: tgt.z });
      for (const u of sim.units) if (c.ids.includes(u.id)) u.target = tgt.id;
      return;
    }
    case 'surrender': {
      if (s.players && !s.players[sim.team]?.out && !sim.falling.includes(sim.team)) sim.falling.push(sim.team);
      return;
    }
    case 'ability': {
      let n = 0, any = false;
      for (const u of sim.units) {
        if (!c.ids.includes(u.id) || !content.units[u.unit]?.ability) continue;
        any = true;
        if (sim.useAbility(u)) n++;
      }
      if (any && !n) sim.emit('Not ready yet', 'warn', 'deny');
      return;
    }
    case 'stop': {
      for (const u of sim.units) if (c.ids.includes(u.id)) { u.order = { kind: 'idle' }; u.gx = u.x; u.gz = u.z; u.ride = undefined; u.drop = undefined; }
      return;
    }
    case 'board': {
      const t = sim.units.find((u) => u.id === c.transport), td = t && content.units[t.unit];
      if (!t || !td?.carries) return;
      // ground units only, as many as there's room for (nearest first)
      const room = td.carries - (t.cargo?.length ?? 0) - sim.units.filter((u) => u.ride === t.id && !c.ids.includes(u.id)).length;
      const riders = sim.units.filter((u) => c.ids.includes(u.id) && u !== t && !content.units[u.unit].carries && moveOf(content.units[u.unit]) === 'ground')
        .sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z)).slice(0, Math.max(0, room));
      if (!riders.length) { sim.emit(room <= 0 ? `${td.name} is full (${td.carries})` : `Only ground units can board the ${td.name}`, 'warn', 'deny'); return; }
      for (const u of riders) { u.ride = t.id; u.drop = undefined; u.target = -1; u.order = { kind: 'idle' }; }
      // it comes in to the water nearest them
      const cx = riders.reduce((m, u) => m + u.x, 0) / riders.length, cz = riders.reduce((m, u) => m + u.z, 0) / riders.length;
      const w = sim.unitGrid('water').openNear(cx, cz, 80, t);
      if (w && Math.hypot(w.x - t.x, w.z - t.z) > 4) { t.drop = undefined; t.order = { kind: 'move', x: w.x, z: w.z }; t.target = -1; }
      return;
    }
    case 'unload': {
      for (const t of sim.units) {
        if (!c.ids.includes(t.id) || !t.cargo?.length) continue;
        const at = sim.unitGrid('ground').openNear(t.x, t.z, 80);
        if (at) sim.sendToLand(t, at.x, at.z);
      }
      return;
    }
    case 'research': {
      const r = content.research[c.id], R = (s.research ??= { done: [], active: null });
      if (!r || R.done.includes(c.id)) return;
      if (R.active) { sim.emit(`The Tech Lab is busy with ${content.research[R.active.id]?.name ?? 'other research'}`, 'warn', 'deny'); return; }
      if (!s.buildings.some((b) => b.progress >= 1 && def(b)?.role === 'lab')) { sim.emit('Research needs a finished Tech Lab', 'warn', 'deny'); return; }
      const why = researchBlocked(r, content.research, DEFS, sim.researchWorld());
      if (why) { sim.emit(`${r.name} needs ${why}`, 'warn', 'deny'); return; }
      if (s.alloys < r.cost) { sim.emit(`Not enough alloys for ${r.name} (${r.cost} needed)`, 'warn', 'deny'); return; }
      if ((s.isotopes ?? 0) < (r.isotopes ?? 0)) { sim.emit(`Not enough isotopes for ${r.name} (${r.isotopes} needed)`, 'warn', 'deny'); return; }
      s.alloys -= r.cost;
      s.isotopes = (s.isotopes ?? 0) - (r.isotopes ?? 0);
      R.active = { id: c.id, progress: 0 };
      sim.emit(`Research started: ${r.name}`, 'info', 'confirm');
      return;
    }
    case 'unresearch': {
      const R = s.research, a = R?.active, r = a && content.research[a.id];
      if (!R || !a) return;
      if (r) { s.alloys += r.cost; s.isotopes = (s.isotopes ?? 0) + (r.isotopes ?? 0); }
      R.active = null;
      sim.emit(`Research cancelled${r ? `: ${r.name} (refunded)` : ''}`, 'info', 'recycle');
      return;
    }
    case 'fab': {
      if (s.drones.length + s.fab.queued >= sim.maxDrones()) { sim.emit(`Drone limit reached (${sim.maxDrones()})`, 'warn', 'deny'); return; }
      if (s.alloys < RULES.droneCost) { sim.emit(`Not enough alloys for a drone (${RULES.droneCost} needed)`, 'warn', 'deny'); return; }
      s.alloys -= RULES.droneCost;
      s.fab.queued++;
      sim.emit('Drone fabrication started', 'info', 'confirm');
      return;
    }
  }
}
