import { TICK_MS, type Command, type FromWorker, type SimState, type Snapshot } from './types';

/** Main-thread handle on the simulation worker, with snapshot interpolation. */
export class SimClient {
  prev: Snapshot | null = null;
  cur: Snapshot | null = null;
  private curAt = 0;
  private interval = TICK_MS;
  private worker: Worker;
  private reqId = 0;
  private pending = new Map<number, (s: SimState) => void>();

  constructor(private onEvent: (text: string, level: 'info' | 'warn' | 'bad') => void) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'snap') {
        const now = performance.now();
        // a fresh snapshot after a load or a pause: don't interpolate across the gap
        const sameWorld = this.cur && this.cur.fauna.length === m.fauna.length && m.tick > this.cur.tick && m.tick - this.cur.tick <= 6;
        this.prev = sameWorld ? this.cur : m;
        if (this.cur) this.interval = Math.min(250, Math.max(TICK_MS * 0.8, now - this.curAt));
        this.cur = m;
        this.curAt = now;
      } else if (m.type === 'saved') {
        this.pending.get(m.reqId)?.(m.state);
        this.pending.delete(m.reqId);
      } else if (m.type === 'event') {
        this.onEvent(m.text, m.level);
      }
    };
  }

  /** 0..1 blend factor between prev and cur for this frame. */
  alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.curAt) / this.interval));
  }

  command(cmd: Command) { this.worker.postMessage({ type: 'cmd', cmd }); }
  setSpeed(speed: number) { this.worker.postMessage({ type: 'speed', speed }); }
  load(state: SimState) { this.worker.postMessage({ type: 'load', state }); }

  save(): Promise<SimState> {
    const reqId = ++this.reqId;
    return new Promise((res) => {
      this.pending.set(reqId, res);
      this.worker.postMessage({ type: 'save', reqId });
    });
  }
}
