/**
 * Unified touch + mouse input for the colony.
 *   - tap a drone or building to select it; tap empty ground with a drone
 *     selected to send it there; drag a vector from a drone to order it
 *   - combat units: tap one to select it (shift adds), double-tap or hold one to
 *     select every unit of that type on screen; tap ground to send the
 *     selection, or drag from one of them to aim the order
 *   - placing a building: on desktop the ghost follows the mouse and a click
 *     places it; on touch the first tap shows the ghost, a second tap on it places;
 *     R (or the ⟳ button) rotates it
 *   - walls are lines: click/tap where it starts, then where it ends (touch: tap
 *     the end again to confirm); the next line chains on from the end
 *   - drag elsewhere pans, pinch/wheel zooms, two-finger twist or right-drag rotates
 */
import * as THREE from 'three';
import type { ZoomCamera, ViewName } from './camera';
import type { RegionUi, RegionView } from './world/region';
import type { Building, UnitSnap } from './sim/types';
import type { ArmyView } from './skirmish/view';

export type UiState = RegionUi;

interface Handlers {
  move(drone: number, x: number, z: number): void;
  build(kind: string, x: number, z: number, yaw: number): void;
  /** Kinds placed as a line (walls). */
  isLine(kind: string): boolean;
  /** Segments a line would place, each checked. */
  linePreview(kind: string, x1: number, z1: number, x2: number, z2: number): NonNullable<UiState['ghostLine']>;
  buildLine(kind: string, x1: number, z1: number, x2: number, z2: number): void;
  /** Distance between segment centres in a line. */
  lineStep(kind: string): number;
  /** Why `kind` can't go at (x, z), or null. */
  placeProblem(kind: string, x: number, z: number): string | null;
  /** Where `kind` would really go near (x, z) if it snaps to something (a gate onto a wall). */
  snap?(kind: string, x: number, z: number): { x: number; z: number; yaw: number } | null;
  buildings(): Building[];
  units(): UnitSnap[];
  order(ids: number[], x: number, z: number): void;
  /** Ground units in `ids` that could go aboard transport `t` (empty: it isn't one, or none can). */
  riders?(ids: number[], t: number): number[];
  board?(ids: number[], t: number): void;
  setBuild(kind: string | null): void;
  select(): void;
  view(v: ViewName): void;
  togglePause(): void;
  toggleBuildMenu(): void;
  interacted(): void;
  /** A message for the player: a warning with the deny sound, or (ok) a plain note. */
  say(text: string, ok?: boolean): void;
  /** Colonist under a screen point (client px), or -1. */
  colonistAt?(x: number, y: number): number;
  /** Keyboard extras (main.ts): F centre, . idle drone, [ ] speed, ? controls, Ctrl+S save, Esc build menu. */
  centre?(): void;
  nextIdleDrone?(): void;
  speedStep?(dir: 1 | -1): void;
  showControls?(): void;
  quickSave?(): void;
  /** Esc: close the build menu if it's open (true = it was). */
  closeBuildMenu?(): boolean;
  /** Centre the camera on a point (control group double-press). */
  lookAt?(x: number, z: number): void;
  /** Mouse wheel zooms toward the cursor (Options). */
  zoomToCursor?(): boolean;
  /** Screen-edge scrolling with the mouse (Options). */
  edgeScroll?(): boolean;
  /** A placement can't go here: why (shown by the cursor), or null to hide it. */
  placeHint?(text: string | null, x: number, y: number): void;
}

type Mode = 'none' | 'pan' | 'orbit' | 'order' | 'pinch' | 'unit' | 'uorder';

const TAP_PX = 9;
const DRONE_PICK_PX = 42;
const UNIT_PICK_PX = 30;
const HOLD_MS = 420;
const DOUBLE_MS = 320;

export class Input {
  private pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private mode: Mode = 'none';
  private pinch = { d: 0, ang: 0, my: 0 };
  private ndc = new THREE.Vector2();
  private orderDrone = -1;
  private downUnit = -1;
  /** Horizontal orbit direction for this drag: −1 for the mouse (reversed from touch). */
  private orbitSign = 1;
  /** When the press on a unit happened (event time), and the selection before it (to undo a hold that fired late). */
  private downStamp = 0;
  private downSel: number[] = [];
  private held = false;
  private holdTimer = 0;
  private lastTap = { t: 0, id: -1 };
  private v = new THREE.Vector3();
  /** Camera keys held down (smooth panning and turning, every frame). */
  private held_ = new Set<string>();
  private shiftHeld = false;
  /** The mouse over the canvas (client px), for edge scrolling; null when it's gone. */
  private mouse: { x: number; y: number } | null = null;
  /** Control groups 4–9 (1–3 are the views): unit ids, and the last recall (double-press centres). */
  private groups = new Map<number, number[]>();
  private lastGroup = { n: -1, t: 0 };

  constructor(
    private el: HTMLElement,
    private cam: ZoomCamera,
    private region: RegionView,
    private ui: UiState,
    private h: Handlers,
    private army: ArmyView | null = null,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.moveEv(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      const before = this.cam.targetDist;
      this.cam.zoomBy(f);
      // zoom toward (or away from) the point under the cursor, near the ground
      const k = this.cam.targetDist / before;
      if (k !== 1 && this.cam.a < 0.15 && this.h.zoomToCursor?.()) {
        const g = this.ground(e.clientX, e.clientY);
        if (g) this.cam.lookAtGround(g.x + (this.cam.fx - g.x) * k, g.z + (this.cam.fz - g.z) * k);
      }
      this.h.interacted();
    }, { passive: false });
    el.addEventListener('pointerleave', () => { this.mouse = null; this.h.placeHint?.(null, 0, 0); });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => { this.held_.delete(e.code); this.shiftHeld = e.shiftKey; });
    window.addEventListener('blur', () => { this.held_.clear(); this.mouse = null; });
  }

  /** Per frame: held camera keys pan and turn smoothly; the mouse at the screen edge scrolls (if on). */
  update(dt: number, active: boolean) {
    if (!active) { this.held_.clear(); return; }
    const h = this.el.clientHeight, k = this.held_;
    const pan = (this.shiftHeld ? 1500 : 700) * dt;
    let dx = 0, dy = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) dy += pan;
    if (k.has('KeyS') || k.has('ArrowDown')) dy -= pan;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx += pan;
    if (k.has('KeyD') || k.has('ArrowRight')) dx -= pan;
    if (this.mouse && this.pts.size === 0 && this.cam.a < 0.5 && this.h.edgeScroll?.()) {
      const m = this.mouse, edge = 10, w = this.el.clientWidth;
      if (m.x <= edge) dx += pan; else if (m.x >= w - edge) dx -= pan;
      if (m.y <= edge) dy += pan; else if (m.y >= h - edge) dy -= pan;
    }
    if (dx || dy) this.cam.pan(dx, dy, h);
    const turn = 1.8 * dt;
    if (k.has('KeyQ')) this.cam.rotate(turn, 0);
    if (k.has('KeyE')) this.cam.rotate(-turn, 0);
  }

  private ground(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    return this.region.pick(this.ndc, this.cam.camera);
  }

  /** Nearest drone to a screen point within the pick radius, or -1. */
  private droneAt(x: number, y: number) {
    if (this.cam.dist > 400) return -1;
    const r = this.el.getBoundingClientRect();
    let best = -1, bd = DRONE_PICK_PX;
    const v = new THREE.Vector3();
    for (const [id, d] of this.region.drones) {
      if (d.team) continue; // another skirmish player's
      v.copy(d.world).project(this.cam.camera);
      if (v.z > 1) continue;
      const dist = Math.hypot(((v.x + 1) / 2) * r.width + r.left - x, ((1 - v.y) / 2) * r.height + r.top - y);
      if (dist < bd) { bd = dist; best = id; }
    }
    return best;
  }

  /** Screen position of a combat unit (from the renderer's interpolated positions). */
  private unitScreen(u: UnitSnap) {
    const a = this.army;
    if (!a || !a.visible[u.slot]) return null;
    this.v.set(a.wx[u.slot], a.wy[u.slot] + 1, a.wz[u.slot]).project(this.cam.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) return null;
    const r = this.el.getBoundingClientRect();
    return { x: ((this.v.x + 1) / 2) * r.width + r.left, y: ((1 - this.v.y) / 2) * r.height + r.top };
  }

  /** Nearest combat unit to a screen point within the pick radius, or -1. */
  private unitAt(x: number, y: number) {
    if (this.cam.dist > 400) return -1;
    let best = -1, bd = UNIT_PICK_PX;
    for (const u of this.h.units()) {
      const p = this.unitScreen(u);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = u.id; }
    }
    return best;
  }

  private selIds(): number[] { return this.ui.sel?.kind === 'units' ? this.ui.sel.ids : []; }

  private selectUnits(ids: number[], add = false) {
    const set = new Set(add ? this.selIds() : []);
    for (const id of ids) set.add(id);
    this.ui.sel = set.size ? { kind: 'units', ids: [...set] } : null;
    this.h.select();
  }

  /** Every on-screen combat unit of the same type as unit `id`. */
  private selectType(id: number) {
    const all = this.h.units();
    const kind = all.find((u) => u.id === id)?.unit;
    this.selectUnits(all.filter((u) => u.unit === kind && this.unitScreen(u)).map((u) => u.id));
    if (navigator.vibrate) navigator.vibrate(15);
  }

  private centre(ids: number[]) {
    let x = 0, z = 0, n = 0;
    for (const u of this.h.units()) if (ids.includes(u.id)) { x += u.x; z += u.z; n++; }
    return n ? { x: x / n, z: z / n } : null;
  }

  private ghostAt(g: { x: number; z: number } | null) {
    const kind = this.ui.build;
    if (!g || !kind) { this.ui.ghost = null; this.ui.ghostLine = null; return; }
    if (this.h.isLine(kind)) {
      const from = this.ui.line ?? g;
      const prev = this.h.linePreview(kind, from.x, from.z, g.x, g.z);
      // a lone first segment follows the placement rotation
      if (!this.ui.line) prev.yaw = this.ui.yaw ?? 0;
      this.ui.ghostLine = prev;
      this.ui.ghost = { x: g.x, z: g.z, ok: prev.pts.some((p) => p.ok) };
      return;
    }
    this.ui.ghostLine = null;
    const sn = this.h.snap?.(kind, g.x, g.z);
    if (sn) { this.ui.yaw = sn.yaw; g = sn; }
    this.ui.ghost = { x: g.x, z: g.z, ok: !this.h.placeProblem(kind, g.x, g.z) };
  }

  /** By the cursor while placing: why the ghost can't go here (nothing when it can). */
  private hint(x: number, y: number) {
    const kind = this.ui.build, g = this.ui.ghost;
    const why = kind && g && !g.ok && !this.h.isLine(kind) ? this.h.placeProblem(kind, g.x, g.z) : null;
    this.h.placeHint?.(why, x, y);
  }

  /** Placement: turn the building (or a lone wall segment) 45°. */
  rotate() {
    if (!this.ui.build) return;
    this.ui.yaw = ((this.ui.yaw ?? 0) + Math.PI / 4) % (Math.PI * 2);
    if (this.ui.ghost) this.ghostAt(this.ui.ghost);
  }

  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.h.interacted();
    if (this.pts.size === 2) {
      clearTimeout(this.holdTimer);
      this.mode = 'pinch';
      this.ui.drag = null;
      this.pinch = this.pinchState();
      return;
    }
    if (this.pts.size > 2) return;
    const surface = this.cam.a < 0.5;
    // mouse rotate (right-drag, shift-drag) is reversed from a touch drag; a touch drag keeps its direction
    if (e.button === 2 || e.shiftKey || !surface) { this.mode = 'orbit'; this.orbitSign = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey) ? -1 : 1; return; }
    const drone = this.ui.build ? -1 : this.droneAt(e.clientX, e.clientY);
    const unit = this.ui.build || drone >= 0 ? -1 : this.unitAt(e.clientX, e.clientY);
    clearTimeout(this.holdTimer);
    this.held = false;
    if (drone >= 0) { this.mode = 'order'; this.orderDrone = drone; }
    else if (unit >= 0) {
      this.mode = 'unit';
      this.downUnit = unit;
      this.downStamp = e.timeStamp;
      this.downSel = [...this.selIds()];
      this.holdTimer = window.setTimeout(() => {
        if (this.mode === 'unit') { this.held = true; this.selectType(unit); }
      }, HOLD_MS);
    } else this.mode = 'pan';
  }

  private pinchState() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
  }

  private moveEv(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (e.pointerType === 'mouse') { const r = this.el.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; }
    if (this.ui.build && e.pointerType === 'mouse' && this.pts.size === 0) {
      this.ghostAt(this.ground(e.clientX, e.clientY));
      this.hint(e.clientX, e.clientY);
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
    if (this.mode === 'unit' && this.held && e.timeStamp - this.downStamp < HOLD_MS) {
      // the finger was already moving before the hold time was up; a slow frame just delivered the move late.
      // It's a drag, not a hold: undo the select-all-of-type
      this.held = false;
      this.selectUnits(this.downSel);
    }
    if (this.mode === 'unit' && !this.held) {
      // dragging off a unit aims an order: for the selection if it's in it, else for this unit alone
      clearTimeout(this.holdTimer);
      if (!this.selIds().includes(this.downUnit)) this.selectUnits([this.downUnit]);
      this.mode = 'uorder';
    }
    if (this.mode === 'uorder') {
      this.ui.dragFrom = this.centre(this.selIds());
      this.ui.drag = this.ground(e.clientX, e.clientY) ?? this.ui.drag;
      return;
    }
    if (this.mode === 'pan') this.cam.pan(dx, dy, this.el.clientHeight);
    else if (this.mode === 'orbit') this.cam.rotate(-dx * 0.005 * this.orbitSign, dy * 0.004);
    else if (this.mode === 'order') {
      if (this.ui.sel?.kind !== 'drone' || this.ui.sel.id !== this.orderDrone) { this.ui.sel = { kind: 'drone', id: this.orderDrone }; this.h.select(); }
      this.ui.drag = this.ground(e.clientX, e.clientY) ?? this.ui.drag;
    }
  }

  private up(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    this.pts.delete(e.pointerId);
    if (!p) return;
    if (this.mode === 'pinch') {
      if (this.pts.size === 0) this.mode = 'none';
      return;
    }
    clearTimeout(this.holdTimer);
    const tap = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= TAP_PX && performance.now() - p.t < 450;
    if (this.mode === 'order' && this.ui.drag) {
      this.h.move(this.orderDrone, this.ui.drag.x, this.ui.drag.z);
    } else if (this.mode === 'uorder' && this.ui.drag) {
      this.orderUnits(this.ui.drag.x, this.ui.drag.z);
    } else if (this.mode === 'unit') {
      if (!this.held && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) <= TAP_PX) {
        // event timestamps: a slow frame mustn't break a double-tap
        const u = this.downUnit, kind = (id: number) => this.h.units().find((x) => x.id === id)?.unit;
        // ground units selected, a tap on a transport: they go aboard
        const riders = e.shiftKey || this.selIds().includes(u) ? [] : this.h.riders?.(this.selIds(), u) ?? [];
        if (riders.length) {
          this.h.board?.(riders, u);
          const t = this.h.units().find((x) => x.id === u);
          if (t) this.ui.mark = { x: t.x, z: t.z, until: performance.now() + 900 };
        } else if (this.lastTap.id >= 0 && e.timeStamp - this.lastTap.t < DOUBLE_MS && kind(this.lastTap.id) === kind(u)) {
          this.selectType(u);
          this.lastTap = { t: 0, id: -1 };
        } else {
          if (e.shiftKey && this.selIds().includes(u)) this.selectUnits(this.selIds().filter((x) => x !== u));
          else this.selectUnits([u], e.shiftKey);
          this.lastTap = { t: e.timeStamp, id: u };
        }
      }
    } else if (tap && e.button !== 2) {
      this.tap(e.clientX, e.clientY, e.pointerType === 'mouse', e.shiftKey);
    } else if (tap && e.button === 2) {
      this.rightTap(e.clientX, e.clientY);
    }
    this.ui.drag = null;
    this.ui.dragFrom = null;
    this.mode = 'none';
  }

  private orderUnits(x: number, z: number) {
    const ids = this.selIds();
    if (!ids.length) return;
    this.h.order(ids, x, z);
    this.ui.mark = { x, z, until: performance.now() + 900 };
  }

  private cancel(e: PointerEvent) {
    this.pts.delete(e.pointerId);
    clearTimeout(this.holdTimer);
    this.ui.drag = null;
    this.ui.dragFrom = null;
    this.mode = 'none';
  }

  /** Right-click without dragging: stop placing, or send the selected drone or units there. */
  private rightTap(x: number, y: number) {
    if (this.cam.a >= 0.5) return;
    if (this.ui.build) { this.h.setBuild(null); this.h.placeHint?.(null, 0, 0); return; }
    const g = this.ground(x, y);
    if (!g) return;
    if (this.ui.sel?.kind === 'drone') this.h.move(this.ui.sel.id, g.x, g.z);
    else if (this.ui.sel?.kind === 'units') this.orderUnits(g.x, g.z);
  }

  private tap(x: number, y: number, mouse: boolean, keep: boolean) {
    if (this.cam.a >= 0.5) return;
    const g = this.ground(x, y);
    if (this.ui.build && this.h.isLine(this.ui.build)) {
      if (!g) return;
      const kind = this.ui.build;
      if (!this.ui.line) {
        // first point
        this.ui.line = g;
        this.ghostAt(g);
        return;
      }
      // touch: tapping somewhere else moves the end; tapping the end again builds
      // (so tapping the start twice builds a single segment)
      const near = this.ui.ghost && Math.hypot(this.ui.ghost.x - g.x, this.ui.ghost.z - g.z) < 6;
      if (!mouse && !near) { this.ghostAt(g); return; }
      const end = mouse ? g : this.ui.ghost!;
      const from = this.ui.line;
      const prev = this.h.linePreview(kind, from.x, from.z, end.x, end.z);
      if (!prev.pts.some((p) => p.ok)) { this.h.say('Can\'t build a wall there'); this.ghostAt(end); return; }
      this.h.buildLine(kind, from.x, from.z, end.x, end.z);
      // the next line chains on one segment past where this one ended
      const last = prev.pts[prev.pts.length - 1], step = this.h.lineStep(kind);
      this.ui.line = { x: last.x + Math.sin(prev.yaw) * step, z: last.z + Math.cos(prev.yaw) * step };
      this.ui.yaw = prev.yaw;
      this.ui.ghost = null;
      this.ui.ghostLine = null;
      return;
    }
    if (this.ui.build) {
      if (!g) return;
      // touch: first tap previews, a tap on the preview places it
      const confirm = mouse || (this.ui.ghost && Math.hypot(this.ui.ghost.x - g.x, this.ui.ghost.z - g.z) < 6);
      if (!confirm) { this.ghostAt(g); return; }
      const at = mouse ? (this.h.snap?.(this.ui.build, g.x, g.z) ?? g) : this.ui.ghost!;
      const why = this.h.placeProblem(this.ui.build, at.x, at.z);
      if (why) { this.h.say(`Can't build there: ${why}`); this.ghostAt(at); return; }
      this.h.build(this.ui.build, at.x, at.z, this.ui.yaw ?? 0);
      if (!keep) this.h.setBuild(null);
      return;
    }
    const drone = this.droneAt(x, y);
    if (drone >= 0) {
      this.ui.sel = this.ui.sel?.kind === 'drone' && this.ui.sel.id === drone ? null : { kind: 'drone', id: drone };
      this.h.select();
      return;
    }
    const col = this.h.colonistAt?.(x, y) ?? -1;
    if (col >= 0) {
      this.ui.sel = { kind: 'colonist', id: col };
      this.h.select();
      return;
    }
    const b = g ? this.region.buildingAt(g.x, g.z, this.h.buildings()) : null;
    if (b !== null) {
      this.ui.sel = { kind: 'building', id: b };
      this.h.select();
      return;
    }
    if (this.ui.sel?.kind === 'drone' && g) this.h.move(this.ui.sel.id, g.x, g.z);
    else if (this.ui.sel?.kind === 'units' && g) this.orderUnits(g.x, g.z);
    else { this.ui.sel = null; this.h.select(); }
  }

  /** Control group n: Ctrl or Shift + n saves the selected units, n recalls them, n twice centres on them. */
  private group(n: number, save: boolean) {
    if (save) {
      const ids = this.selIds();
      if (!ids.length) { this.h.say(`Select combat units first, then Ctrl+${n} to make them group ${n}`); return; }
      this.groups.set(n, [...ids]);
      this.h.say(`Group ${n}: ${ids.length} unit${ids.length > 1 ? 's' : ''} · press ${n} to select them`, true);
      return;
    }
    const live = new Set(this.h.units().map((u) => u.id));
    const ids = (this.groups.get(n) ?? []).filter((id) => live.has(id));
    this.groups.set(n, ids);
    if (!ids.length) { this.h.say(`Group ${n} is empty · select units, then Ctrl+${n}`); return; }
    const now = performance.now();
    if (this.lastGroup.n === n && now - this.lastGroup.t < 400) {
      const c = this.centre(ids);
      if (c) this.h.lookAt?.(c.x, c.z);
    }
    this.lastGroup = { n, t: now };
    this.selectUnits(ids);
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
    this.shiftHeld = e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;
    const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
    if (digit && Number(digit) >= 4 && !e.altKey) {
      // 1–3 are the views; 4–9 control groups
      e.preventDefault();
      this.group(Number(digit), mod || e.shiftKey);
      this.h.interacted();
      return;
    }
    if (mod) {
      if (e.code === 'KeyA') { e.preventDefault(); this.selectUnits(this.h.units().map((u) => u.id)); }
      else if (e.code === 'KeyS') { e.preventDefault(); this.h.quickSave?.(); }
      return;
    }
    if (e.altKey) return;
    switch (e.code) {
      case 'KeyW': case 'KeyS': case 'KeyA': case 'KeyD': case 'KeyQ': case 'KeyE':
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        e.preventDefault();
        this.held_.add(e.code);
        this.h.interacted();
        return;
    }
    switch (e.key) {
      case '+': case '=': this.cam.zoomBy(0.7); break;
      case '-': case '_': this.cam.zoomBy(1.4); break;
      case '1': this.h.view('surface'); break;
      case '2': this.h.view('planet'); break;
      case '3': this.h.view('system'); break;
      case 'b': case 'B': this.h.toggleBuildMenu(); break;
      case 'r': case 'R': this.rotate(); break;
      case 'f': case 'F': case 'Home': this.h.centre?.(); break;
      case '.': this.h.nextIdleDrone?.(); break;
      case ']': this.h.speedStep?.(1); break;
      case '[': this.h.speedStep?.(-1); break;
      case '?': this.h.showControls?.(); break;
      case 'Escape':
        if (this.h.closeBuildMenu?.()) break;
        this.h.setBuild(null); this.h.placeHint?.(null, 0, 0); this.ui.sel = null; this.h.select(); break;
      case ' ': e.preventDefault(); this.h.togglePause(); break;
      default: return;
    }
    this.h.interacted();
  }
}
