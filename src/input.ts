/**
 * Unified touch + mouse input. No box-select: tap to select, drag a vector from
 * the drone to order it, drag elsewhere to pan, pinch/wheel to zoom, two-finger
 * twist or right-drag to rotate.
 */
import * as THREE from 'three';
import type { ZoomCamera, ViewName } from './camera';
import type { RegionView } from './world/region';

export interface UiState {
  selected: boolean;
  buildMode: boolean;
  drag: { x: number; z: number } | null;
  ghost: { x: number; z: number } | null;
}

interface Handlers {
  move(x: number, z: number): void;
  build(x: number, z: number): void;
  setBuildMode(on: boolean): void;
  view(v: ViewName): void;
  togglePause(): void;
  interacted(): void;
}

type Mode = 'none' | 'pan' | 'orbit' | 'order' | 'pinch';

const TAP_PX = 9;
const DRONE_PICK_PX = 42;

export class Input {
  private pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private mode: Mode = 'none';
  private pinch = { d: 0, ang: 0, my: 0 };
  private ndc = new THREE.Vector2();

  constructor(
    private el: HTMLElement,
    private cam: ZoomCamera,
    private region: RegionView,
    private ui: UiState,
    private h: Handlers,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.moveEv(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
      this.h.interacted();
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  private ground(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    return this.region.pick(this.ndc, this.cam.camera);
  }

  private droneScreenDist(x: number, y: number) {
    if (this.cam.dist > 400) return Infinity;
    const r = this.el.getBoundingClientRect();
    const v = this.region.droneWorld.clone().project(this.cam.camera);
    if (v.z > 1) return Infinity;
    return Math.hypot(((v.x + 1) / 2) * r.width + r.left - x, ((1 - v.y) / 2) * r.height + r.top - y);
  }

  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.h.interacted();
    if (this.pts.size === 2) {
      this.mode = 'pinch';
      this.ui.drag = null;
      this.pinch = this.pinchState();
      return;
    }
    if (this.pts.size > 2) return;
    const surface = this.cam.a < 0.5;
    if (e.button === 2 || e.shiftKey || !surface) this.mode = 'orbit';
    else if (!this.ui.buildMode && this.droneScreenDist(e.clientX, e.clientY) < DRONE_PICK_PX) this.mode = 'order';
    else this.mode = 'pan';
  }

  private pinchState() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
  }

  private moveEv(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (this.ui.buildMode && e.pointerType === 'mouse' && this.pts.size === 0) {
      this.ui.ghost = this.ground(e.clientX, e.clientY);
    }
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
    if (this.mode === 'pan') this.cam.pan(dx, dy, this.el.clientHeight);
    else if (this.mode === 'orbit') this.cam.rotate(-dx * 0.005, dy * 0.004);
    else if (this.mode === 'order') this.ui.drag = this.ground(e.clientX, e.clientY) ?? this.ui.drag;
    if (this.ui.buildMode && e.pointerType !== 'mouse') this.ui.ghost = null;
  }

  private up(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    this.pts.delete(e.pointerId);
    if (!p) return;
    if (this.mode === 'pinch') {
      if (this.pts.size === 0) this.mode = 'none';
      return;
    }
    const tap = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= TAP_PX && performance.now() - p.t < 450;
    if (this.mode === 'order' && this.ui.drag) {
      this.h.move(this.ui.drag.x, this.ui.drag.z);
      this.ui.selected = true;
    } else if (tap && e.button !== 2) {
      this.tap(e.clientX, e.clientY);
    }
    this.ui.drag = null;
    this.mode = 'none';
  }

  private cancel(e: PointerEvent) {
    this.pts.delete(e.pointerId);
    this.ui.drag = null;
    this.mode = 'none';
  }

  private tap(x: number, y: number) {
    if (this.cam.a >= 0.5) return;
    const g = this.ground(x, y);
    if (this.ui.buildMode) {
      if (g) this.h.build(g.x, g.z);
      this.h.setBuildMode(false);
      return;
    }
    if (this.droneScreenDist(x, y) < DRONE_PICK_PX) {
      this.ui.selected = !this.ui.selected;
      return;
    }
    if (this.ui.selected && g) this.h.move(g.x, g.z);
    else this.ui.selected = false;
  }

  private key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
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
      case '1': this.h.view('surface'); break;
      case '2': this.h.view('planet'); break;
      case '3': this.h.view('system'); break;
      case 'b': this.h.setBuildMode(!this.ui.buildMode); break;
      case 'Escape': this.h.setBuildMode(false); this.ui.selected = false; break;
      case ' ': e.preventDefault(); this.h.togglePause(); break;
      default: return;
    }
    this.h.interacted();
  }
}
