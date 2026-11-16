/**
 * Title screen: the EXO GENESIS wordmark over the live planet. The camera
 * drifts in a slow orbit (low over the limb, out to the full disc and back)
 * while the wordmark assembles, the tagline types out and the menu slides in.
 * On a landscape screen the planet is shifted right, clear of the menu column.
 *
 * The world keeps rendering behind it; main.ts decides what each choice does
 * and hides the HUD while `body.title` is set.
 */
import { viewH } from './viewport';
import * as THREE from 'three';
import type { ZoomCamera } from './camera';
import { R } from './world/planet';

export interface TitleChoice {
  id: string;
  label: string;
  sub?: string;
  /** Two taps to confirm: the button asks this first. */
  confirm?: string;
  /** A link instead of an action. */
  href?: string;
  run?: () => void;
}

export interface TitleOptions {
  choices: TitleChoice[];
  /** Small text bottom-left (build, hub link). */
  foot: string;
  /** A short sound for button taps. */
  tap: () => void;
  /** Live line under the menu (e.g. sound state); re-read on every tap. */
  status?: () => string;
}

const TAGLINE = 'SEED-PROBE ACCORD · CARETAKER ONLINE';

export class TitleScreen {
  readonly root: HTMLElement;
  private t = 0;
  private tele: HTMLElement;
  private statusEl: HTMLElement;
  private typed = 0;
  private tagEl: HTMLElement;
  private armed: HTMLButtonElement | null = null;
  active = true;

  constructor(private cam: ZoomCamera, private camera: THREE.PerspectiveCamera, private opts: TitleOptions) {
    const root = (this.root = document.createElement('div'));
    root.id = 'title';
    const word = 'EXO GENESIS';
    const letters = [...word].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    root.innerHTML = `
      <div class="t-vignette"></div><div class="t-scan"></div>
      <div class="t-col">
        <h1 class="t-mark" aria-label="${word}">${letters}</h1>
        <div class="t-rule"></div>
        <div class="t-tag"><span class="t-typed"></span><i class="t-caret"></i></div>
        <nav class="t-menu"></nav>
        <div class="t-status"></div>
      </div>
      <div class="t-foot">${opts.foot}</div>
      <div class="t-tele"></div>`;
    this.tagEl = root.querySelector('.t-typed')!;
    this.tele = root.querySelector('.t-tele')!;
    this.statusEl = root.querySelector('.t-status')!;
    const menu = root.querySelector('.t-menu')!;
    opts.choices.forEach((c, i) => {
      const el = document.createElement(c.href ? 'a' : 'button') as HTMLButtonElement & HTMLAnchorElement;
      el.className = 't-item';
      el.style.setProperty('--i', String(i));
      el.dataset.id = c.id;
      if (c.href) { el.href = c.href; el.target = '_blank'; el.rel = 'noopener'; }
      el.innerHTML = `<b>${c.label}</b>${c.sub ? `<small>${c.sub}</small>` : ''}`;
      el.onclick = (e) => {
        opts.tap();
        if (c.href) return;
        e.preventDefault();
        if (c.confirm && this.armed !== el) {
          this.disarm();
          this.armed = el;
          el.classList.add('armed');
          el.querySelector('small')!.textContent = c.confirm;
          return;
        }
        this.disarm();
        c.run?.();
        this.refresh();
      };
      menu.appendChild(el);
    });
    // arrow keys walk the menu, Enter picks (buttons do that natively)
    root.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('.t-item')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
      if (e.key === 'Escape') this.disarm();
    });
    document.body.appendChild(root);
    document.body.classList.add('title');
    this.refresh();
    // focus for keyboards once the menu is in (not on touch: it draws a ring)
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => (menu.querySelector('.t-item') as HTMLElement | null)?.focus({ preventScroll: true }), 1600);
    // the camera's starting point for the drift
    cam.freePitch = true;
    cam.overrideW = 1;
    cam.focusOverride.set(0, 0, 0);
    cam.dist = cam.targetDist = R * 2.4;
    cam.pitch = cam.targetPitch = 0.42;
    cam.yaw = 2.2;
  }

  private disarm() {
    if (!this.armed) return;
    const c = this.opts.choices.find((x) => x.id === this.armed!.dataset.id);
    this.armed.classList.remove('armed');
    const s = this.armed.querySelector('small');
    if (s) s.textContent = c?.sub ?? '';
    this.armed = null;
  }

  refresh() {
    this.statusEl.textContent = this.opts.status?.() ?? '';
  }

  /** Relabel a choice's subtitle (e.g. the sound state). */
  setSub(id: string, sub: string) {
    const c = this.opts.choices.find((x) => x.id === id);
    if (c) c.sub = sub;
    const el = this.root.querySelector(`[data-id="${id}"] small`);
    if (el && this.armed?.dataset.id !== id) el.textContent = sub;
  }

  setLabel(id: string, label: string) {
    const el = this.root.querySelector(`[data-id="${id}"] b`);
    if (el) el.textContent = label;
  }

  /** Each frame while active: drift the camera, type the tagline, update the readout. */
  update(dt: number, alt: number, clock: string) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const cam = this.cam;
    // slow orbit: swings low over the limb and back out to the whole disc
    const w = innerWidth, h = viewH(), aspect = w / h;
    // a narrow screen sees less of the width: pull back so the disc still fits
    const back = aspect < 1 ? Math.pow(1 / aspect, 0.75) : 1;
    cam.yaw += dt * 0.045;
    cam.targetDist = R * (2.45 + 0.75 * Math.sin(t * 0.055)) * back;
    cam.targetPitch = 0.38 + 0.22 * Math.sin(t * 0.037 + 1);
    // landscape: shift the planet right, clear of the menu column; portrait: lift it
    // into the gap between the wordmark and the menu
    if (aspect > 1.1) this.camera.setViewOffset(w, h, -Math.min(w * 0.2, w / 2 - 360), 0, w, h);
    else if (aspect < 1) this.camera.setViewOffset(w, h, 0, h * 0.1, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();

    const n = Math.min(TAGLINE.length, Math.floor(Math.max(0, t - 1.1) * 28));
    if (n !== this.typed) { this.typed = n; this.tagEl.textContent = TAGLINE.slice(0, n); }
    if (t > 1.6) this.tele.textContent = `HOME · HIGH ORBIT · ALT ${Math.round(alt * 0.01).toLocaleString()} km · ${clock}`;
  }

  /** Fade out and hand the camera back. Resolves when the screen is gone. */
  hide(): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.active = false;
    this.cam.freePitch = false;
    this.cam.overrideW = 0;
    if (this.camera.view) this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('title');
    this.root.classList.add('out');
    return new Promise((res) => setTimeout(() => { this.root.remove(); res(); }, 700));
  }
}
