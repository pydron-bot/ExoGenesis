/**
 * Skirmish input — the touch-selection experiment. Three ways to select an
 * army without a mouse box-select, all available at once so they can be
 * compared on a phone:
 *
 *   1. Paint-select: toggle Paint, then swipe over units to collect them.
 *   2. Hold / double-tap a unit: selects every unit of that type on screen.
 *   3. Control groups: long-press a group button to store the selection,
 *      tap to recall (double-tap to also centre the camera).
 *
 * Plus: tap a unit (select one), tap ground (move/attack-move the selection),
 * drag from a selected unit (aim an order vector). Desktop adds a classic box
 * select (left-drag on empty ground) with right-drag to pan.
 */
import { viewH } from '../viewport';
import * as THREE from 'three';
import type { ZoomCamera } from '../camera';
import type { RegionView } from '../world/region';
import type { ArmyView } from './view';

export interface SkUi {
  paint: boolean;
  /** slot → gen of selected units */
  selected: Map<number, number>;
  drag: { x: number; z: number } | null;
  /** slot → gen snapshot used to validate selections */
  gens: (slot: number) => number;
  isPlayer: (slot: number) => boolean;
}

interface Handlers {
  move(slots: number[], x: number, z: number): void;
  changed(): void;
  interacted(): void;
  keyGroup(n: number, assign: boolean): void;
  stop(): void;
  togglePause(): void;
}

type Mode = 'none' | 'pan' | 'orbit' | 'pinch' | 'paint' | 'box' | 'order' | 'unit';

const TAP_PX = 10;
const PICK_PX = 30;
const HOLD_MS = 420;
const BRUSH_PX = 30;

export class SkInput {
  private pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private mode: Mode = 'none';
  /** Horizontal orbit direction for this drag: −1 for mouse (reversed from touch). */
  private orbitSign = 1;
  private pinch = { d: 0, ang: 0, my: 0 };
  private ndc = new THREE.Vector2();
  private v = new THREE.Vector3();
  private holdTimer = 0;
  private held = false;
  private downUnit = -1;
  private stroke: { x: number; y: number }[] = [];
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastTap = { t: 0, slot: -1 };
  private overlay: CanvasRenderingContext2D;

  constructor(
    private el: HTMLElement,
    private overlayCanvas: HTMLCanvasElement,
    private cam: ZoomCamera,
    private region: RegionView,
    private army: ArmyView,
    private ui: SkUi,
    private h: Handlers,
  ) {
    this.overlay = overlayCanvas.getContext('2d')!;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.moveEv(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  // ---------- picking ----------
  private screen(slot: number) {
    this.v.set(this.army.wx[slot], this.army.wy[slot] + 1, this.army.wz[slot]).project(this.cam.camera);
    if (this.v.z > 1 || this.v.x < -1.05 || this.v.x > 1.05 || this.v.y < -1.05 || this.v.y > 1.05) return null;
    const r = this.el.getBoundingClientRect();
    return { x: ((this.v.x + 1) / 2) * r.width + r.left, y: ((1 - this.v.y) / 2) * r.height + r.top };
  }

  private pickUnit(x: number, y: number) {
    let best = -1, bd = PICK_PX;
    for (let s = 0; s < this.army.slots; s++) {
      if (!this.army.visible[s] || !this.ui.isPlayer(s)) continue;
      const p = this.screen(s);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private ground(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    return this.region.pick(this.ndc, this.cam.camera);
  }

  private select(slots: number[], add = false) {
    if (!add) this.ui.selected.clear();
    for (const s of slots) this.ui.selected.set(s, this.ui.gens(s));
    this.h.changed();
  }

  /** Every on-screen player unit of the same type as `slot`. */
  selectType(slot: number) {
    const t = this.army.type[slot];
    const out: number[] = [];
    for (let s = 0; s < this.army.slots; s++) {
      if (this.army.visible[s] && this.ui.isPlayer(s) && this.army.type[s] === t && this.screen(s)) out.push(s);
    }
    this.select(out);
    if (navigator.vibrate) navigator.vibrate(15);
  }

  // ---------- pointer flow ----------
  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.h.interacted();
    clearTimeout(this.holdTimer);
    if (this.pts.size === 2) {
      // a second finger always means camera
      this.mode = 'pinch';
      this.ui.drag = null;
      this.stroke = [];
      this.box = null;
      this.drawOverlay();
      this.pinch = this.pinchState();
      return;
    }
    if (this.pts.size > 2) return;
    this.held = false;
    if (e.pointerType === 'mouse' && e.button === 2) { this.mode = 'pan'; return; }
    if (e.pointerType === 'mouse' && (e.button === 1 || e.altKey)) { this.mode = 'orbit'; this.orbitSign = -1; return; }
    if (this.cam.a > 0.5) { this.mode = 'orbit'; this.orbitSign = 1; return; }
    if (this.ui.paint) {
      this.mode = 'paint';
      this.stroke = [{ x: e.clientX, y: e.clientY }];
      if (!e.shiftKey) { this.ui.selected.clear(); this.h.changed(); }
      this.paintAt(e.clientX, e.clientY);
      return;
    }
    const u = this.pickUnit(e.clientX, e.clientY);
    this.downUnit = u;
    if (u >= 0) {
      this.mode = 'unit';
      this.holdTimer = window.setTimeout(() => {
        if (this.mode === 'unit') { this.held = true; this.selectType(u); }
      }, HOLD_MS);
      return;
    }
    this.mode = e.pointerType === 'mouse' ? 'box' : 'pan';
  }

  private pinchState() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
  }

  private paintAt(x: number, y: number) {
    const prev = this.stroke[this.stroke.length - 2] ?? { x, y };
    // units within BRUSH_PX of the latest stroke segment
    const add: number[] = [];
    for (let s = 0; s < this.army.slots; s++) {
      if (!this.army.visible[s] || !this.ui.isPlayer(s) || this.ui.selected.has(s)) continue;
      const p = this.screen(s);
      if (!p) continue;
      const dx = x - prev.x, dy = y - prev.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - prev.x) * dx + (p.y - prev.y) * dy) / l2)) : 0;
      if (Math.hypot(p.x - (prev.x + dx * t), p.y - (prev.y + dy * t)) < BRUSH_PX) add.push(s);
    }
    if (add.length) this.select(add, true);
  }

  private moveEv(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.mode === 'pinch' && this.pts.size >= 2) {
      const s = this.pinchState();
      if (s.d > 0 && this.pinch.d > 0) this.cam.zoomBy(this.pinch.d / s.d);
      let da = s.ang - this.pinch.ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      this.cam.rotate(-da, (s.my - this.pinch.my) * 0.004);
      this.pinch = s;
      return;
    }
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > TAP_PX;
    if (!moved) return;
    if (this.mode === 'unit' && !this.held) {
      clearTimeout(this.holdTimer);
      // dragging off a unit aims an order: from the selection if this unit is in it, else from this unit alone
      if (!this.ui.selected.has(this.downUnit)) this.select([this.downUnit]);
      this.mode = 'order';
    }
    switch (this.mode) {
      case 'pan': this.cam.pan(dx, dy, this.el.clientHeight); break;
      case 'orbit': this.cam.rotate(-dx * 0.005 * this.orbitSign, dy * 0.004); break;
      case 'order': this.ui.drag = this.ground(e.clientX, e.clientY) ?? this.ui.drag; break;
      case 'paint':
        this.stroke.push({ x: e.clientX, y: e.clientY });
        this.paintAt(e.clientX, e.clientY);
        this.drawOverlay();
        break;
      case 'box':
        this.box = { x0: p.sx, y0: p.sy, x1: e.clientX, y1: e.clientY };
        this.drawOverlay();
        break;
    }
  }

  private up(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    this.pts.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    if (!p) return;
    if (this.mode === 'pinch') {
      if (this.pts.size === 0) this.mode = 'none';
      return;
    }
    const tap = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= TAP_PX;
    // event timestamps, not processing time: a slow frame mustn't break a double-tap
    const now = e.timeStamp;
    if (this.mode === 'order' && this.ui.drag) {
      this.h.move([...this.ui.selected.keys()], this.ui.drag.x, this.ui.drag.z);
    } else if (this.mode === 'box' && this.box) {
      const { x0, y0, x1, y1 } = this.box;
      const out: number[] = [];
      for (let s = 0; s < this.army.slots; s++) {
        if (!this.army.visible[s] || !this.ui.isPlayer(s)) continue;
        const q = this.screen(s);
        if (q && q.x >= Math.min(x0, x1) && q.x <= Math.max(x0, x1) && q.y >= Math.min(y0, y1) && q.y <= Math.max(y0, y1)) out.push(s);
      }
      this.select(out, e.shiftKey);
    } else if (tap && this.mode === 'unit' && !this.held) {
      const u = this.downUnit;
      if (this.lastTap.slot >= 0 && now - this.lastTap.t < 320 && this.army.type[this.lastTap.slot] === this.army.type[u]) {
        this.selectType(u);
        this.lastTap = { t: 0, slot: -1 };
      } else {
        this.select([u], e.shiftKey);
        this.lastTap = { t: now, slot: u };
      }
    } else if (tap && (this.mode === 'pan' || this.mode === 'box' || (this.mode === 'paint' && this.stroke.length < 3))) {
      // tap on ground: order the selection there
      const g = this.ground(e.clientX, e.clientY);
      if (g && this.ui.selected.size) this.h.move([...this.ui.selected.keys()], g.x, g.z);
    }
    this.ui.drag = null;
    this.stroke = [];
    this.box = null;
    this.drawOverlay();
    this.mode = 'none';
  }

  private cancel(e: PointerEvent) {
    this.pts.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    this.ui.drag = null;
    this.stroke = [];
    this.box = null;
    this.drawOverlay();
    this.mode = 'none';
  }

  private drawOverlay() {
    const c = this.overlayCanvas, g = this.overlay;
    const dpr = Math.min(2, devicePixelRatio);
    if (c.width !== innerWidth * dpr) { c.width = innerWidth * dpr; c.height = viewH() * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, viewH());
    if (this.stroke.length > 1) {
      g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,210,122,0.18)';
      g.lineWidth = BRUSH_PX * 2;
      g.beginPath();
      this.stroke.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      g.strokeStyle = 'rgba(255,210,122,0.8)';
      g.lineWidth = 2;
      g.stroke();
    }
    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      g.fillStyle = 'rgba(255,210,122,0.08)';
      g.strokeStyle = 'rgba(255,210,122,0.85)';
      g.lineWidth = 1.5;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }

  private key(e: KeyboardEvent) {
    if (e.key >= '1' && e.key <= '4') { this.h.keyGroup(Number(e.key), e.ctrlKey || e.metaKey); e.preventDefault(); return; }
    const step = 40;
    switch (e.key) {
      case 'w': case 'ArrowUp': this.cam.pan(0, step, this.el.clientHeight); break;
      case 's': case 'ArrowDown': this.cam.pan(0, -step, this.el.clientHeight); break;
      case 'a': case 'ArrowLeft': this.cam.pan(step, 0, this.el.clientHeight); break;
      case 'd': case 'ArrowRight': this.cam.pan(-step, 0, this.el.clientHeight); break;
      case 'q': this.cam.rotate(0.15, 0); break;
      case 'e': this.cam.rotate(-0.15, 0); break;
      case '+': case '=': this.cam.zoomBy(0.7); break;
      case '-': case '_': this.cam.zoomBy(1.4); break;
      case 'x': this.h.stop(); break;
      case 'Escape': this.ui.selected.clear(); this.h.changed(); break;
      case ' ': e.preventDefault(); this.h.togglePause(); break;
      default: return;
    }
  }
}
