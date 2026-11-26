/**
 * The simulation worker: owns the game state and runs src/sim/core.ts at a
 * fixed tick; the main thread only renders snapshots and sends commands.
 */
import { CAMPAIGN, delSave, putSave, regionKey, wipeCampaign, type AutoSave, type CampaignSave } from '../save';
import { applyShared, campaignOver, forgetRegion, HOME_REGION, sharedOf } from './campaign';
import { content } from '../content';
import { Sim, useRegion } from './core';
import { Autopilot, type PilotConfig } from './autopilot';
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
/** Autosaves that failed in a row (the main thread warns at 2). */
let saveFails = 0;
/** The sim threw: no more ticks or autosaves (its state may be half-updated). */
let crashed = false;
function crash(e: unknown) {
  if (crashed) return;
  crashed = true;
  autosave = false;
  const err = e as { message?: string; stack?: string } | undefined;
  post({ type: 'crash', message: String(err?.message ?? e), stack: err?.stack, tick: sim?.s?.tick });
}
self.addEventListener('error', (e) => crash((e as ErrorEvent).error ?? (e as ErrorEvent).message));
self.addEventListener('unhandledrejection', (e) => crash((e as PromiseRejectionEvent).reason));
/** The autopilot (spectator mode): plays the colony each tick while on (never in a skirmish). */
let pilot: Autopilot | null = null;
let pilotCfg: PilotConfig = { on: false };
const newPilot = () => {
  pilot = new Autopilot(sim, (text) => post({ type: 'event', text, level: 'warn', style: 'assist' }));
  pilot.configure(pilotCfg);
};

/**
 * Write the game to this region's save and the campaign record (or clear the region's save once its colony is
 * lost: an expedition lost sends the campaign home; the home colony lost ends it; an ending, reached anywhere, wipes
 * every region's save and the campaign).
 */
async function autoSave() {
  if (!autosave || saving || crashed) return;
  const s = sim.s;
  if (s.phase !== 'deployed') return;
  saving = true;
  try {
    const over = campaignOver(s, region);
    if (over) {
      await delSave(regionKey(region));
      // the campaign over (an ending reached anywhere, Cycle at the Lantern too; the home colony lost): every save goes
      if (over === 'ended') await wipeCampaign();
      // an expedition lost: home, and the region's story forgotten so a retry plays it again
      else await putSave(CAMPAIGN, { version: 1, savedAt: Date.now(), current: HOME_REGION, shared: forgetRegion(sharedOf(s), region, content) } satisfies CampaignSave);
    } else if (s.tick !== lastSavedTick) {
      const savedAt = Date.now();
      const file: AutoSave = { version: 2, savedAt, sim: s };
      await putSave(regionKey(region), file);
      await putSave(CAMPAIGN, { version: 1, savedAt, current: region, shared: sharedOf(s) } satisfies CampaignSave);
      lastSavedTick = s.tick;
    }
    saveFails = 0;
  } catch (e) {
    console.warn('autosave failed', e);
    saveFails++;
    post({ type: 'saveFailed', n: saveFails, message: String((e as Error)?.message ?? e) });
  } finally {
    saving = false;
  }
}

/** Campaign travel: save this region as it is, make `to` the current region (with the shared state), stop autosaving. */
async function travel(to: string) {
  autosave = false;
  while (saving) await new Promise((r) => setTimeout(r, 20));
  const s = sim.s;
  try {
    delete s.travel;
    const savedAt = Date.now();
    await putSave(regionKey(region), { version: 2, savedAt, sim: s } satisfies AutoSave);
    await putSave(CAMPAIGN, { version: 1, savedAt: savedAt + 1, current: to, shared: sharedOf(s) } satisfies CampaignSave);
    post({ type: 'travelled', to, ok: true });
  } catch (e) {
    console.warn('travel save failed', e);
    post({ type: 'travelled', to, ok: false });
  }
}
setInterval(() => void autoSave(), 10000);

function snapshot() {
  const snap = sim.snapshot();
  post(snap, [snap.fauna.buffer, snap.army.buffer, snap.fx.buffer, snap.fog.buffer, snap.blips.buffer, snap.people.walkers.buffer, snap.natives.buffer]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  try { handle(e.data); } catch (err) { crash(err); }
};

function handle(msg: ToWorker) {
  if (msg.type === 'init') {
    region = useRegion(msg.region, msg.def);
    // the editor's play test: an unsaved story event joins the content
    if (msg.story) content.story[msg.story.id] = msg.story.def;
    if (msg.mission) content.missions[msg.mission.id] = msg.mission.def;
    if (msg.cinematic) content.cinematics[msg.cinematic.id] = msg.cinematic.def;
    sim = new Sim((text, level, cue, at, style) => post({ type: 'event', text, level, cue, at, style }));
    skirmish = msg.skirmish ?? null;
    if (skirmish) sim.newSkirmish(skirmish);
    else if (msg.shared) { applyShared(sim.s, msg.shared, region); sim.arrived(); }
    newPilot();
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
      // pausing: no ticks will send what changed since the last one (a command answered just before), so send it now
      if (speed === 0) snapshot();
      return;
    case 'save':
      post({ type: 'saved', reqId: msg.reqId, state: sim.s });
      return;
    case 'load':
      if (msg.state?.version !== 2) { post({ type: 'event', text: 'That save is from an older version of the game and can’t be loaded', level: 'bad', cue: 'deny' }); return; }
      if ((msg.state.region ?? 'touchdown') !== region) { post({ type: 'event', text: 'That save is from another region and can’t be loaded here', level: 'bad', cue: 'deny' }); return; }
      sim.load(msg.state);
      newPilot();
      snapshot();
      post({ type: 'event', text: 'Save restored', level: 'info', cue: 'confirm' });
      return;
    case 'new':
      if (skirmish) sim.newSkirmish(skirmish); else sim.newGame(msg.seed);
      lastSavedTick = -1;
      newPilot();
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
    case 'travel':
      void travel(msg.to);
      return;
    case 'pilot':
      // never in a skirmish
      pilotCfg = skirmish ? { on: false } : msg.cfg;
      pilot?.configure(pilotCfg);
      if (pilot?.on) post({ type: 'pilot', status: pilot.status() });
      return;
  }
}

let last = performance.now();
let acc = 0;
function tick() {
  if (crashed) return;
  try { step(); } catch (e) { crash(e); }
}
function step() {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  let stepped = false;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (let i = 0; i < speed; i++) { pilot?.tick(); sim.step(); stepped = true; }
  }
  if (stepped) {
    snapshot();
    if (pilot?.on && sim.s.tick % 5 === 0) post({ type: 'pilot', status: pilot.status() });
  }
}
