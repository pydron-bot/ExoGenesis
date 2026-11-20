/**
 * The simulation worker: owns the game state and runs src/sim/core.ts at a
 * fixed tick; the main thread only renders snapshots and sends commands.
 */
import { AUTOSAVE, delSave, putSave, type AutoSave } from '../save';
import { content } from '../content';
import { Sim, useRegion } from './core';
import { TICK_MS, type FromWorker, type ToWorker } from './types';

const ctx = self as unknown as Worker;
const post = (msg: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);
let region = 'touchdown';
/** Created by the first message ('init'), once the region is known. */
let sim: Sim = null!;
let speed = 1;
let autosave = false;
/** A skirmish's setup (restarts start it again). */
let skirmish: import('./types').SkirmishSetup | null = null;
let saving = false;
let lastSavedTick = -1;

/** Write the game to the autosave slot (or clear it once the colony is lost). */
async function autoSave() {
  if (!autosave || saving) return;
  const s = sim.s;
  if (s.phase !== 'deployed') return;
  saving = true;
  try {
    if (s.over) await delSave(AUTOSAVE);
    else if (s.tick !== lastSavedTick) {
      const file: AutoSave = { version: 2, savedAt: Date.now(), sim: s };
      await putSave(AUTOSAVE, file);
      lastSavedTick = s.tick;
    }
  } catch (e) {
    console.warn('autosave failed', e);
  } finally {
    saving = false;
  }
}
setInterval(() => void autoSave(), 10000);

function snapshot() {
  const snap = sim.snapshot();
  post(snap, [snap.fauna.buffer, snap.army.buffer, snap.fx.buffer, snap.fog.buffer, snap.blips.buffer, snap.people.walkers.buffer, snap.natives.buffer]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    region = useRegion(msg.region, msg.def);
    // the editor's play test: an unsaved story event joins the content
    if (msg.story) content.story[msg.story.id] = msg.story.def;
    if (msg.mission) content.missions[msg.mission.id] = msg.mission.def;
    if (msg.cinematic) content.cinematics[msg.cinematic.id] = msg.cinematic.def;
    sim = new Sim((text, level, cue) => post({ type: 'event', text, level, cue }));
    skirmish = msg.skirmish ?? null;
    if (skirmish) sim.newSkirmish(skirmish);
    snapshot();
    last = performance.now();
    setInterval(tick, TICK_MS / 2);
    return;
  }
  if (!sim) return;
  switch (msg.type) {
    case 'cmd':
      sim.command(msg.cmd, msg.team ?? 0);
      // paused: no ticks will send the result, so show it now (orders, queues, builds)
      if (msg.cmd.type === 'landing' || speed === 0) snapshot();
      return;
    case 'speed':
      speed = msg.speed;
      return;
    case 'save':
      post({ type: 'saved', reqId: msg.reqId, state: sim.s });
      return;
    case 'load':
      if (msg.state?.version !== 2) { post({ type: 'event', text: 'That save is from an older version of the game and can’t be loaded', level: 'bad', cue: 'deny' }); return; }
      if ((msg.state.region ?? 'touchdown') !== region) { post({ type: 'event', text: 'That save is from another region and can’t be loaded here', level: 'bad', cue: 'deny' }); return; }
      sim.load(msg.state);
      snapshot();
      post({ type: 'event', text: 'Save restored', level: 'info', cue: 'confirm' });
      return;
    case 'new':
      if (skirmish) sim.newSkirmish(skirmish); else sim.newGame(msg.seed);
      lastSavedTick = -1;
      snapshot();
      return;
    case 'content': {
      // live story edits: swap the collections in place (the sim reads them by reference)
      const live = content as unknown as Record<string, Record<string, unknown>>;
      for (const [k, v] of Object.entries(msg.patch)) {
        const tgt = live[k];
        if (!tgt) continue;
        for (const key of Object.keys(tgt)) delete tgt[key];
        Object.assign(tgt, v);
      }
      return;
    }
    case 'autosave':
      autosave = msg.on;
      return;
    case 'flush':
      void autoSave();
      return;
  }
};

let last = performance.now();
let acc = 0;
function tick() {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  let stepped = false;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (let i = 0; i < speed; i++) { sim.step(); stepped = true; }
  }
  if (stepped) snapshot();
}
