/**
 * Performance report (menu → Performance report): numbers a player can paste into a bug report.
 *
 *  - Record: frame times while you play (until Stop, at most 10 minutes), with how long the game's own frame work
 *    took, long frames, the render scale over time and frame times by how far the camera is zoomed.
 *  - Benchmark: holds the view still (paused, render scale pinned) and measures it as you have it, then with each
 *    costly effect that's on turned off by itself, then with all of them off. Each measured frame waits for the
 *    graphics chip to finish (a 1-pixel read), so it's the real cost even where vsync would hide it at 60 fps.
 *    Your settings are put back exactly as they were afterwards (the remembered ones included).
 *
 * The report is plain text: Copy puts it on the clipboard, Save downloads it as a .txt file.
 */
import * as THREE from 'three';
import type { Toggle } from './options';

export interface PerfDeps {
  renderer: THREE.WebGLRenderer;
  /** Every Options toggle (graphics and interface): their states go in the report; the benchmark flips some. */
  toggles: () => Toggle[];
  /** Ids of the toggles worth benchmarking one by one (the costly ones). */
  bench: string[];
  /** Game facts at this moment: version, view, zoom, counts, render scale… */
  facts: () => Record<string, string | number>;
  /** Camera distance now (records frame times by zoom). */
  camDist: () => number;
  /** Render scale now, and holding it still (the benchmark) or letting it adapt again. */
  resScale: () => number;
  holdRes: (on: boolean) => void;
  speed: () => number;
  setSpeed: (s: number) => void;
  open: (title: string, html: string, onClose?: () => void) => { el: HTMLElement; close: () => void };
  tap: () => void;
  /** Frames to settle and to measure per benchmark step (tests shorten them). */
  frames?: { warm: number; measure: number };
}

const RECORD_MAX = 10 * 60 * 1000;

interface Stats { n: number; mean: number; p50: number; p90: number; p99: number; max: number }
function stats(a: number[]): Stats {
  if (!a.length) return { n: 0, mean: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1] };
}
const ms = (v: number) => `${v.toFixed(1)} ms`;
const line = (st: Stats) => `avg ${ms(st.mean)} (${st.mean ? (1000 / st.mean).toFixed(0) : '–'} fps) · median ${ms(st.p50)} · 90% ${ms(st.p90)} · 99% ${ms(st.p99)} · worst ${ms(st.max)}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Phase { label: string; off: string[]; times: number[]; calls: number; tris: number }

export class PerfReport {
  private mode: 'idle' | 'record' | 'bench' = 'idle';
  private t0 = 0;
  private frameT = 0;
  private last = 0;
  // record
  private dts: number[] = [];
  private work: number[] = [];
  private byZoom = new Map<string, number[]>();
  private scales: string[] = [];
  private lastScale = 0;
  private calls: number[] = [];
  private tris: number[] = [];
  private recordText = '';
  // bench
  private phases: Phase[] = [];
  private pi = 0;
  private fi = 0;
  private saved: [string, string | null][] = [];
  private savedSpeed = 1;
  private benchText = '';
  private px = new Uint8Array(4);
  private badge: HTMLElement | null = null;

  private warm: number;
  private measure: number;
  constructor(private d: PerfDeps) {
    this.warm = d.frames?.warm ?? 40;
    this.measure = d.frames?.measure ?? 90;
  }

  get busy() { return this.mode !== 'idle'; }

  private resume?: () => void;
  /**
   * The report panel: what each mode does, buttons, and the report so far. `back` runs when it's closed without
   * starting a run; `resume` un-pauses the game (the menu paused it): when recording starts, and when the
   * benchmark's report is closed.
   */
  open(back?: () => void, resume?: () => void) {
    if (resume) this.resume = resume;
    const report = this.text();
    const html = `
      <p>Measures how the game runs on this device. Paste the report into a message (or attach the file) when something is slow.</p>
      <p><b>Record while I play</b>: play as usual (move around, zoom in and out, fight); stop when you're done. Up to 10 minutes.</p>
      <p><b>Benchmark the effects</b>: the game pauses and the view holds still for about half a minute while each costly effect is switched off in turn. Leave the camera where something typical is on screen. Your settings are put back afterwards.</p>
      <div class="pf-acts">
        <button class="op-act pf-btn" data-pf="record">● Record while I play</button>
        <button class="op-act pf-btn" data-pf="bench">⏱ Benchmark the effects</button>
      </div>
      ${report ? `<div class="pf-acts"><button class="op-act pf-btn" data-pf="copy">Copy report</button><button class="op-act pf-btn" data-pf="save">Save as file</button></div>
      <pre class="pf-pre">${esc(report)}</pre>` : '<p class="pf-none">No report yet.</p>'}`;
    let started = false;
    const { el, close } = this.d.open('Performance report', html, () => { if (!started) back?.(); });
    el.querySelectorAll<HTMLButtonElement>('[data-pf]').forEach((b) => {
      b.onclick = () => {
        this.d.tap();
        const k = b.dataset.pf;
        if (k === 'record' || k === 'bench') {
          started = true;
          close();
          if (k === 'record') { this.resume?.(); this.resume = undefined; this.startRecord(); } else this.startBench();
        }
        else if (k === 'copy') void this.copy(b);
        else if (k === 'save') this.save();
      };
    });
  }

  /** Start of each frame (before any work). */
  frameStart(now: number) {
    if (this.mode === 'idle') return;
    this.frameT = performance.now();
    if (this.mode === 'record') {
      if (this.last) {
        const dt = now - this.last;
        if (dt < 1000) { // a background tab or a stall, not a frame
          this.dts.push(dt);
          const z = this.d.camDist(), key = z < 60 ? 'close (under 60)' : z < 160 ? 'mid (60–160)' : z < 500 ? 'far (160–500)' : 'orbit and beyond';
          (this.byZoom.get(key) ?? this.byZoom.set(key, []).get(key)!).push(dt);
        }
      }
      this.last = now;
      const sc = this.d.resScale();
      if (sc !== this.lastScale) { this.scales.push(`${((now - this.t0) / 1000).toFixed(0)} s: ${sc.toFixed(2)}`); this.lastScale = sc; }
      if (now - this.t0 > RECORD_MAX) this.stopRecord();
      else this.setBadge(`● Recording ${fmtT(now - this.t0)}`, 'Stop', () => this.stopRecord());
    }
  }

  /** After the frame is rendered. */
  frameEnd() {
    if (this.mode === 'idle') return;
    const info = this.d.renderer.info.render;
    if (this.mode === 'record') {
      this.work.push(performance.now() - this.frameT);
      this.calls.push(info.calls); this.tris.push(info.triangles);
      return;
    }
    // bench: wait for the graphics chip, then count the whole frame
    const gl = this.d.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
    const took = performance.now() - this.frameT;
    const ph = this.phases[this.pi];
    this.fi++;
    if (this.fi > this.warm) { ph.times.push(took); ph.calls = info.calls; ph.tris = info.triangles; }
    this.setBadge(`⏱ Benchmark ${this.pi + 1}/${this.phases.length}: ${ph.label}`, 'Cancel', () => this.endBench(true));
    if (this.fi >= this.warm + this.measure) {
      this.setOff(ph.off, false);
      this.pi++;
      this.fi = 0;
      if (this.pi >= this.phases.length) this.endBench(false);
      else this.setOff(this.phases[this.pi].off, true);
    }
  }

  // ---------- record ----------
  private startRecord() {
    this.mode = 'record';
    this.t0 = performance.now();
    this.last = 0;
    this.dts = []; this.work = []; this.calls = []; this.tris = [];
    this.byZoom.clear();
    this.scales = []; this.lastScale = 0;
    this.recordText = '';
  }
  private stopRecord() {
    this.mode = 'idle';
    this.clearBadge();
    const secs = (performance.now() - this.t0) / 1000;
    const st = stats(this.dts), wk = stats(this.work);
    const long = (lim: number) => this.dts.filter((x) => x > lim).length;
    const out = [`RECORDING (${secs.toFixed(0)} s, ${st.n} frames)`,
      `  Frame to frame: ${line(st)}`,
      `  The game's own work per frame (main thread, graphics chip not waited for): ${line(wk)}`,
      `  Slow frames: ${long(33.4)} over 33 ms, ${long(50)} over 50 ms, ${long(100)} over 100 ms`,
      `  Draw calls: avg ${stats(this.calls).mean.toFixed(0)}, most ${stats(this.calls).max}; triangles: avg ${(stats(this.tris).mean / 1000).toFixed(0)}k, most ${(stats(this.tris).max / 1000).toFixed(0)}k`,
      '  By zoom:'];
    for (const [k, a] of this.byZoom) out.push(`    ${k}: ${line(stats(a))} (${a.length} frames)`);
    out.push(`  Render scale over time: ${this.scales.join(' · ') || '(unchanged)'}`);
    this.recordText = out.join('\n');
    this.open();
  }

  // ---------- benchmark ----------
  private startBench() {
    const ts = this.d.toggles();
    // every costly effect that's on (one set in the address counts: the benchmark puts it back too)
    const on = this.d.bench.filter((id) => !!ts.find((x) => x.id === id)?.get());
    // the remembered choices as they are: the switches the benchmark flips remember what they're set to, and those
    // keys (only those: the game saves other things meanwhile) are put back afterwards
    this.saved = [];
    this.touched.clear();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; this.saved.push([k, localStorage.getItem(k)]); } } catch { /* private mode */ }
    this.savedSpeed = this.d.speed();
    this.d.setSpeed(0);
    this.d.holdRes(true);
    const label = (id: string) => ts.find((x) => x.id === id)?.label ?? id;
    this.phases = [{ label: 'as you have it', off: [], times: [], calls: 0, tris: 0 },
      ...on.map((id) => ({ label: `${label(id)} off`, off: [id], times: [], calls: 0, tris: 0 })),
      ...(on.length > 1 ? [{ label: 'all of those off', off: on, times: [], calls: 0, tris: 0 }] : [])];
    this.pi = 0; this.fi = 0;
    this.benchText = '';
    this.mode = 'bench';
  }
  private touched = new Set<string>();
  /** Flip the switches, noting which remembered keys they write. */
  private setOff(ids: string[], off: boolean) {
    const ts = this.d.toggles();
    const orig = Storage.prototype.setItem, touched = this.touched;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) { touched.add(k); return orig.call(this, k, v); };
    try { for (const id of ids) ts.find((x) => x.id === id)?.set(!off); } finally { Storage.prototype.setItem = orig; }
  }
  private endBench(cancelled: boolean) {
    if (this.pi < this.phases.length) this.setOff(this.phases[this.pi].off, false);
    this.mode = 'idle';
    this.clearBadge();
    try {
      for (const k of this.touched) {
        const was = this.saved.find(([s]) => s === k);
        if (was && was[1] !== null) localStorage.setItem(k, was[1]); else localStorage.removeItem(k);
      }
    } catch { /* private mode */ }
    this.d.holdRes(false);
    this.d.setSpeed(this.savedSpeed);
    const done = () => { this.resume?.(); this.resume = undefined; };
    if (cancelled) { this.open(done); return; }
    const base = stats(this.phases[0].times).mean;
    const out = [`BENCHMARK (view held still, render scale ${this.d.resScale().toFixed(2)}, each frame waits for the graphics chip; ${this.measure} frames each)`];
    for (const ph of this.phases) {
      const st = stats(ph.times);
      const save = ph.off.length ? `  → saves ${ms(base - st.mean)} (${((1 - st.mean / base) * 100).toFixed(0)}%)` : '';
      out.push(`  ${ph.label.padEnd(30)} ${line(st)} · ${ph.calls} draws, ${(ph.tris / 1000).toFixed(0)}k tris${save}`);
    }
    this.benchText = out.join('\n');
    this.open(done);
  }

  // ---------- the report ----------
  private text() {
    if (!this.recordText && !this.benchText) return '';
    const r = this.d.renderer, gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? `${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)} (${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)})` : String(gl.getParameter(gl.RENDERER));
    const nav = navigator as Navigator & { deviceMemory?: number };
    const facts = this.d.facts();
    const settings = this.d.toggles().map((t) => `${t.label}: ${t.state ? t.state(t.get()) : t.get() ? 'on' : 'off'}`);
    return [
      `EXO GENESIS PERFORMANCE REPORT · ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      '',
      'DEVICE',
      `  Graphics: ${gpu}`,
      `  Browser: ${navigator.userAgent}`,
      `  Screen ${screen.width}×${screen.height} at ${devicePixelRatio}× · window ${innerWidth}×${innerHeight} · canvas ${r.domElement.width}×${r.domElement.height}`,
      `  CPU threads ${navigator.hardwareConcurrency ?? '?'} · memory ${nav.deviceMemory ?? '?'} GB · max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`,
      '',
      'GAME',
      ...Object.entries(facts).map(([k, v]) => `  ${k}: ${v}`),
      '',
      'SETTINGS',
      ...settings.map((s) => `  ${s}`),
      '',
      ...(this.benchText ? [this.benchText, ''] : []),
      ...(this.recordText ? [this.recordText, ''] : []),
    ].join('\n');
  }

  private async copy(b: HTMLButtonElement) {
    const t = this.text();
    let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch {
      // older browsers, or no permission: select it in a hidden box and copy that
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    b.textContent = ok ? 'Copied ✓' : 'Copy failed: use Save';
  }

  private save() {
    const blob = new Blob([this.text()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `exo-performance-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- the badge (top of the screen while it runs) ----------
  private setBadge(text: string, btn: string, fn: () => void) {
    if (!this.badge) {
      this.badge = document.createElement('div');
      this.badge.id = 'perf-badge';
      this.badge.innerHTML = '<span></span><button></button>';
      document.body.appendChild(this.badge);
    }
    const s = this.badge.querySelector('span')!, b = this.badge.querySelector('button')!;
    if (s.textContent !== text) s.textContent = text;
    if (b.textContent !== btn) b.textContent = btn;
    b.onclick = () => { this.d.tap(); fn(); };
  }
  private clearBadge() { this.badge?.remove(); this.badge = null; }
}

const fmtT = (t: number) => { const s = Math.floor(t / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
