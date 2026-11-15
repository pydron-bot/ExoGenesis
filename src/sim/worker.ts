/**
 * The simulation worker: owns the game state and runs src/sim/core.ts at a
 * fixed tick; the main thread only renders snapshots and sends commands.
 */
import { Sim } from './core';
import { TICK_MS, type FromWorker, type ToWorker } from './types';

const ctx = self as unknown as Worker;
const post = (msg: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);
const sim = new Sim((text, level) => post({ type: 'event', text, level }));
let speed = 1;

function snapshot() {
  const snap = sim.snapshot();
  post(snap, [snap.fauna.buffer, snap.army.buffer, snap.fx.buffer]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'cmd':
      sim.command(msg.cmd);
      if (msg.cmd.type === 'landing') snapshot();
      return;
    case 'speed':
      speed = msg.speed;
      return;
    case 'save':
      post({ type: 'saved', reqId: msg.reqId, state: sim.s });
      return;
    case 'load':
      if (msg.state?.version !== 2) { post({ type: 'event', text: 'That save is from an older version of the game and can’t be loaded', level: 'bad' }); return; }
      sim.load(msg.state);
      snapshot();
      post({ type: 'event', text: 'Save restored', level: 'info' });
      return;
    case 'new':
      sim.newGame(msg.seed);
      snapshot();
      return;
  }
};

snapshot();

let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(1000, now - last);
  last = now;
  let stepped = false;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (let i = 0; i < speed; i++) { sim.step(); stepped = true; }
  }
  if (stepped) snapshot();
}, TICK_MS / 2);
