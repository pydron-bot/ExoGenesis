import type { CinematicDef, MissionDef, RegionDef, StoryDef } from '../content/defs';
import type { SharedState } from './campaign';
import { TICK_MS, type Command, type EventCue, type FromWorker, type SimState, type SkirmishSetup, type Snapshot } from './types';

/** Most effect floats carried over between unseen snapshots (5 per effect). */
const MAX_FX = 5 * 600;

/** Main-thread handle on the simulation worker, with snapshot interpolation. */
export class SimClient {
  prev: Snapshot | null = null;
  cur: Snapshot | null = null;
  /** The snapshot tick the last frame drew and played (main.ts sets it); effects of a snapshot no frame saw carry over. */
  seenTick = -1;
  private curAt = 0;
  private interval = TICK_MS;
  private worker: Worker;
  private reqId = 0;
  private pending = new Map<number, (s: SimState) => void>();

  constructor(private onEvent: (text: string, level: 'info' | 'warn' | 'bad', cue?: EventCue, at?: { x: number; z: number }) => void, enabled = true, region = 'touchdown', draft?: RegionDef, story?: { id: string; def: StoryDef }, mission?: { id: string; def: MissionDef }, cinematic?: { id: string; def: CinematicDef }, skirmish?: SkirmishSetup, shared?: SharedState) {
    // disabled (skirmish mode): a stub that never produces snapshots
    this.worker = enabled
      ? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      : ({ postMessage() {}, onmessage: null } as unknown as Worker);
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'snap') {
        const now = performance.now();
        // a fresh snapshot after a load or a pause: don't interpolate across the gap
        const sameWorld = this.cur && this.cur.fauna.length === m.fauna.length && m.tick > this.cur.tick && m.tick - this.cur.tick <= 6;
        // two snapshots in one frame (slow frames, ×3 speed): the first one's effects (shots, deaths and
        // their sounds) would be lost, so they ride along with the next, newest kept if there are many
        if (sameWorld && this.cur!.tick !== this.seenTick && this.cur!.fx.length) {
          const both = new Float32Array(this.cur!.fx.length + m.fx.length);
          both.set(this.cur!.fx);
          both.set(m.fx, this.cur!.fx.length);
          m.fx = both.length > MAX_FX ? both.slice(both.length - MAX_FX) : both;
        }
        this.prev = sameWorld ? this.cur : m;
        if (this.cur) this.interval = Math.min(250, Math.max(TICK_MS * 0.8, now - this.curAt));
        this.cur = m;
        this.curAt = now;
      } else if (m.type === 'saved') {
        this.pending.get(m.reqId)?.(m.state);
        this.pending.delete(m.reqId);
      } else if (m.type === 'travelled') {
        this.onTravelled?.(m.ok);
        this.onTravelled = null;
      } else if (m.type === 'event') {
        this.onEvent(m.text, m.level, m.cue, m.at);
      }
    };
    // the region comes first: the sim starts its first game from it
    this.worker.postMessage({ type: 'init', region, def: draft, story, mission, cinematic, skirmish, shared });
  }

  /** 0..1 blend factor between prev and cur for this frame. */
  alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.curAt) / this.interval));
  }

  /** `team`: act as that skirmish player (tests; you are 0). */
  command(cmd: Command, team?: number) { this.worker.postMessage({ type: 'cmd', cmd, team }); }
  setSpeed(speed: number) { this.worker.postMessage({ type: 'speed', speed }); }
  load(state: SimState) { this.worker.postMessage({ type: 'load', state }); }
  newGame(seed: number) { this.worker.postMessage({ type: 'new', seed }); }
  autosave(on: boolean) { this.worker.postMessage({ type: 'autosave', on }); }
  flush() { this.worker.postMessage({ type: 'flush' }); }
  /** Live story edits: replace these content collections in the worker. */
  patchContent(patch: Record<string, Record<string, unknown>>) { this.worker.postMessage({ type: 'content', patch }); }

  private onTravelled: ((ok: boolean) => void) | null = null;
  /** Campaign travel: the worker saves this region and makes `to` the current one (resolves false if saving failed). */
  travel(to: string): Promise<boolean> {
    return new Promise((res) => {
      this.onTravelled = res;
      this.worker.postMessage({ type: 'travel', to });
    });
  }

  save(): Promise<SimState> {
    const reqId = ++this.reqId;
    return new Promise((res) => {
      this.pending.set(reqId, res);
      this.worker.postMessage({ type: 'save', reqId });
    });
  }
}
