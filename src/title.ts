/**
 * Title screen: the EXO GENESIS wordmark over the live planet. The camera
 * drifts in a slow orbit (low over the limb, out to the full disc and back)
 * while the wordmark assembles, the tagline types out and the menu slides in.
 * On a landscape screen the planet is shifted right, clear of the menu column.
 * After a while the camera tours the system: it pulls out, flies to a random
 * planet or big moon, settles into a sunlit orbit there, and later moves on
 * (sometimes back home, and now and then far out over the star to see the whole system at once).
 *
 * Tour (the 🪐 button, or `?tour=1`): the same trips with the wordmark and menu put away, a screensaver
 * of the system. It leaves sooner, keeps the screen awake, and any tap or key brings the menu back.
 *
 * The world keeps rendering behind it; main.ts decides what each choice does
 * and hides the HUD while `body.title` is set.
 */
import { viewH } from './viewport';
import * as THREE from 'three';
import type { ZoomCamera } from './camera';
import type { SolarSystem } from './world/system';
import { R } from './world/planet';
import { smoothstep } from './world/noise';

export interface TitleChoice {
  id: string;
  label: string;
  sub?: string;
  /** Two taps to confirm: the button asks this first. */
  confirm?: string;
  /** A link instead of an action. */
  href?: string;
  run?: () => void;
  /**
   * Where it sits: `hero` (the one big button), `plain` (a full-width button), `tile` (half width, side by side),
   * `icon` (the small row at the bottom), `link` (a line of text). Default `plain`.
   */
  kind?: 'hero' | 'plain' | 'tile' | 'icon' | 'link';
  /** An icon row button's symbol. */
  icon?: string;
  /** A NEW badge on it. */
  badge?: boolean;
}

export interface TitleOptions {
  choices: TitleChoice[];
  /** Small text bottom-left (build, hub link). */
  foot: string;
  /** A short sound for button taps. */
  tap: () => void;
  /** Live line under the menu (e.g. sound state); re-read on every tap. */
  status?: () => string;
  /** A line under the menu with the endings reached ("ENDINGS: 2 OF 5"); empty hides it. */
  endings?: string;
  /** The solar system, for the tour of other bodies (no tour without it). */
  system?: SolarSystem;
}

/** A place the title camera can orbit; `null` means home. */
/**
 * Somewhere the tour goes: home (null), a body, or a special stop (`kind`): `overview` far out over the star to see the
 * whole system; `sun` a close pass round the star; `comet` alongside a comet and its tail; `belt` a run through the
 * asteroid belt (the focus flies along it); `rings` a skim just above a ringed giant's ring plane.
 */
type StopKind = 'overview' | 'sun' | 'comet' | 'belt' | 'rings';
type Stop = { name: string; sub: string; radius: number; pos: THREE.Vector3; kind?: StopKind; normal?: (out: THREE.Vector3) => THREE.Vector3 } | null;
/** The camera's look at a special stop: the way out from the focus to the camera, how far, and how level to the stop's plane. */
interface Aim { dir: THREE.Vector3; dist: number; level: number }
const Y_UP = new THREE.Vector3(0, 1, 0);
interface Trip { from: Stop; to: Stop; u: number; dur: number; d0: number; d1: number; peak: number; yaw0: number; yaw1: number }

const HOME_DWELL = 25; // seconds over home before the first trip, and on each return
const AWAY_DWELL = [15, 25] as const;
const ORIGIN = new THREE.Vector3();
const posOf = (s: Stop) => (s ? s.pos : ORIGIN);
const radiusOf = (s: Stop) => (s ? s.radius : R);

const TAGLINE = 'SEED-PROBE ACCORD · CARETAKER ONLINE';

export class TitleScreen {
  readonly root: HTMLElement;
  private t = 0;
  private tele: HTMLElement;
  private statusEl: HTMLElement;
  private typed = 0;
  private tagEl: HTMLElement;
  private armed: HTMLButtonElement | null = null;
  private at: Stop = null;
  private trip: Trip | null = null;
  private dwell = HOME_DWELL;
  private trips = 0;
  private touring = false;
  private wake: { release(): Promise<void> } | null = null;
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
        <div class="endings"></div>
      </div>
      <div class="t-foot">${opts.foot}</div>
      <div class="t-tele"></div>
      <div class="t-hint">${matchMedia('(pointer: coarse)').matches ? 'TAP' : 'CLICK OR PRESS A KEY'} TO RETURN</div>`;
    this.tagEl = root.querySelector('.t-typed')!;
    this.tele = root.querySelector('.t-tele')!;
    this.statusEl = root.querySelector('.t-status')!;
    root.querySelector('.endings')!.textContent = opts.endings ?? '';
    const menu = root.querySelector('.t-menu')!;
    // grouped by kind: the hero and full-width buttons in order, the tiles in one row, the icons in the bottom row
    const tiles = document.createElement('div'), icons = document.createElement('div');
    tiles.className = 't-tiles';
    icons.className = 't-icons';
    opts.choices.forEach((c, i) => {
      const kind = c.kind ?? 'plain';
      const el = document.createElement(c.href ? 'a' : 'button') as HTMLButtonElement & HTMLAnchorElement;
      el.className = `t-item t-${kind}`;
      el.style.setProperty('--i', String(i));
      el.dataset.id = c.id;
      if (c.href) { el.href = c.href; el.target = '_blank'; el.rel = 'noopener'; }
      const badge = c.badge ? '<span class="badge">NEW</span>' : '';
      el.innerHTML = kind === 'icon'
        ? `<i aria-hidden="true">${c.icon ?? ''}</i><b>${c.label}</b>${badge}`
        : `<b>${c.label}${badge}</b>${c.sub ? `<small>${c.sub}</small>` : ''}`;
      if (kind === 'icon' && c.sub) el.title = c.sub;
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
      (kind === 'tile' ? tiles : kind === 'icon' ? icons : menu).appendChild(el);
    });
    if (tiles.childElementCount) menu.appendChild(tiles);
    if (icons.childElementCount) menu.appendChild(icons);
    // arrow keys walk the menu, Enter picks (buttons do that natively)
    root.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('.t-item')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && at >= 0 && items[at].parentElement !== menu) {
        e.preventDefault();
        items[(at + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]?.focus();
      }
      if (e.key === 'Escape') this.disarm();
    });
    // touring: the first tap or key anywhere brings the menu back (pointerdown, so the tap that started it can't)
    root.addEventListener('pointerdown', () => { if (this.touring) this.tour(false); });
    addEventListener('keydown', this.tourKey);
    document.body.appendChild(root);
    document.body.classList.add('title');
    this.refresh();
    // shrink the wordmark to fit its column: the font is the device's monospace, so its
    // width varies (SF Mono on iPad clipped the last S at the 64px cap)
    this.fitMark();
    void document.fonts?.ready.then(() => this.fitMark());
    addEventListener('resize', this.fitMark);
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

  /** Size the wordmark so all of it shows inside the column (it hides overflow for the glint). */
  private fitMark = () => {
    const mark = this.root.querySelector<HTMLElement>('.t-mark');
    if (!mark || !this.active) return;
    mark.style.fontSize = '';
    // measure a settled copy: the letters fly in with extra letter-spacing
    const probe = mark.cloneNode(true) as HTMLElement;
    probe.style.cssText = 'position:absolute;visibility:hidden;overflow:visible;width:max-content;max-width:none';
    probe.querySelectorAll('span').forEach((s) => { s.style.animation = 'none'; s.style.opacity = '1'; });
    mark.parentElement!.appendChild(probe);
    const natural = probe.scrollWidth, avail = mark.clientWidth;
    probe.remove();
    if (natural > avail && avail > 0) {
      const fs = parseFloat(getComputedStyle(mark).fontSize);
      mark.style.fontSize = `${Math.floor(fs * avail / natural * 0.98)}px`;
    }
  };

  private tourKey = () => { if (this.touring) this.tour(false); };

  /** Put the menu away and tour the system (a screensaver), or bring the menu back. */
  tour(on: boolean) {
    if (!this.active || on === this.touring) return;
    this.touring = on;
    this.disarm();
    this.root.classList.toggle('touring', on);
    if (on) {
      // off somewhere soon, rather than after the full dwell over home
      this.dwell = Math.min(this.dwell, 2.5);
      const hint = this.root.querySelector('.t-hint')!;
      hint.classList.remove('show'); void (hint as HTMLElement).offsetWidth; hint.classList.add('show');
      (document.activeElement as HTMLElement | null)?.blur?.();
      // keep a phone's screen on while it plays (where the browser allows it)
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      wl?.request('screen').then((l) => { if (this.touring) this.wake = l; else void l.release(); }).catch(() => {});
    } else {
      void this.wake?.release().catch(() => {});
      this.wake = null;
    }
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
    const t = this.opts.status?.() ?? '';
    if (this.statusEl.textContent !== t) this.statusEl.textContent = t;
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
    this.refresh();
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const cam = this.cam;
    // slow orbit: swings low over the limb and back out to the whole disc
    const w = innerWidth, h = viewH(), aspect = w / h;
    // a narrow screen sees less of the width: pull back so the disc still fits
    const back = (this.back = aspect < 1 ? Math.pow(1 / aspect, 0.75) : 1);
    const sys = this.opts.system;
    const orbitDist = (stop: Stop, at: number) => this.distAt(stop, at);
    // the belt run's focus flies along the belt
    if (sys && (this.at?.kind === 'belt' || this.trip?.to?.kind === 'belt' || this.trip?.from?.kind === 'belt')) {
      this.beltA += dt * 2400 / this.beltR;
      this.beltPos.set(Math.cos(this.beltA) * this.beltR, 0, Math.sin(this.beltA) * this.beltR).add(sys.starPos);
    }
    if (sys) sys.beltsOn = this.at?.kind === 'belt' || this.trip?.to?.kind === 'belt' || this.trip?.from?.kind === 'belt';
    if (sys) sys.chase = [this.at, this.trip?.to, this.trip?.from].find((s) => s?.kind === 'comet')?.name ?? null;
    // how much of a special look applies: in on the way in, out on the way away
    const into = (k: (s: Stop) => boolean) => this.trip ? (k(this.trip.to) ? smoothstep(0.5, 1, this.trip.u) : k(this.trip.from) ? 1 - smoothstep(0, 0.5, this.trip.u) : 0) : k(this.at) ? 1 : 0;
    // over the whole system, look down on it at a steeper angle: the orbits read as rings round the star
    const over = into((s) => s?.kind === 'overview');
    const special = into((s) => !!s?.kind && s.kind !== 'overview');
    const sp = this.trip ? (this.trip.u > 0.5 ? this.trip.to : this.trip.from) : this.at;
    const aim = sp?.kind && sp.kind !== 'overview' ? this.aimAt(sp, t) : null;
    let pitch = THREE.MathUtils.lerp(0.38 + 0.22 * Math.sin(t * 0.037 + 1), 0.82 + 0.08 * Math.sin(t * 0.04), over);
    // level the horizon with a belt's or a ring's plane (blended in, so the frame never jumps)
    cam.upW += ((aim ? aim.level * special : 0) - cam.upW) * Math.min(1, dt * 1.5);
    if (aim && sp?.kind === 'rings' && sp.normal) sp.normal(cam.upOverride); else cam.upOverride.copy(Y_UP);
    if (aim) pitch = THREE.MathUtils.lerp(pitch, cam.aim(aim.dir, aim.dist).pitch, special);
    cam.targetPitch = pitch;
    if (sys) sys.overview = over;
    if (sys && !this.trip && (this.dwell -= dt) <= 0) this.depart(sys, orbitDist);
    if (this.touring && !this.trip && !this.at && this.dwell > 12) this.dwell = 12; // a shorter stay at home on the tour
    if (this.trip) {
      const tr = this.trip;
      tr.u = Math.min(1, tr.u + dt / tr.dur);
      const u = tr.u;
      const e = u * u * (3 - 2 * u);
      // out, across while far out, then in: the pan happens near the top of the arc
      const ef = smoothstep(0.22, 0.78, u);
      cam.focusOverride.copy(posOf(tr.from)).lerp(posOf(tr.to), ef);
      const l0 = Math.log(tr.d0), l1 = Math.log(tr.to?.kind && tr.to.kind !== 'overview' ? this.aimAt(tr.to, t).dist : tr.d1);
      const ld = l0 + (l1 - l0) * e + (Math.log(tr.peak) - (l0 + l1) / 2) * Math.sin(Math.PI * u);
      cam.dist = cam.targetDist = Math.exp(ld);
      // a special stop is arrived at along its own look (it moves: aim at it as it is now)
      const yaw1 = tr.to?.kind && tr.to.kind !== 'overview' ? cam.aim(this.aimAt(tr.to, t).dir, cam.dist).yaw : tr.yaw1;
      let dy = yaw1 - tr.yaw0;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      cam.yaw = tr.yaw0 + dy * e;
      sys!.tour = tr.to ? (tr.from ? 1 : ef) : 1 - ef;
      if (u >= 1) {
        this.at = tr.to;
        this.trip = null;
        this.dwell = tr.to ? AWAY_DWELL[0] + Math.random() * (AWAY_DWELL[1] - AWAY_DWELL[0]) : HOME_DWELL;
        // a run along the belt or past a comet is over sooner
        if (tr.to?.kind === 'belt' || tr.to?.kind === 'comet') this.dwell = Math.min(this.dwell, 16);
      }
    } else if (aim) {
      // a special stop: follow its look (yaw eased toward it; the pitch rides targetPitch above)
      cam.focusOverride.copy(posOf(this.at));
      cam.targetDist = aim.dist;
      const want = cam.aim(aim.dir, cam.dist).yaw;
      cam.yaw += Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw)) * Math.min(1, dt * 2);
    } else {
      cam.yaw += dt * 0.045;
      cam.focusOverride.copy(posOf(this.at));
      cam.targetDist = orbitDist(this.at, t);
    }
    void back;
    // landscape: shift the planet right, clear of the menu column; portrait: lift it
    // into the gap between the wordmark and the menu
    if (this.touring) { if (this.camera.view) this.camera.clearViewOffset(); } // nothing to keep clear of: centred
    else if (aspect > 1.1) this.camera.setViewOffset(w, h, -Math.min(w * 0.2, w / 2 - 360), 0, w, h);
    else if (aspect < 1) this.camera.setViewOffset(w, h, 0, h * 0.1, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();

    const n = Math.min(TAGLINE.length, Math.floor(Math.max(0, t - 1.1) * 28));
    if (n !== this.typed) { this.typed = n; this.tagEl.textContent = TAGLINE.slice(0, n); }
    if (t > 1.6) {
      const km = (n: number) => Math.round(n * 0.01).toLocaleString();
      const at = this.at;
      if (this.trip) this.tele.textContent = `IN TRANSIT · ${this.trip.to?.name ?? 'HOME'} · ${clock}`;
      else if (at?.kind === 'overview') this.tele.textContent = `SYSTEM VIEW · ${this.opts.system?.tourStops().length ?? 0} WORLDS · ${clock}`;
      else if (at?.kind === 'sun') this.tele.textContent = `THE STAR · CORONA PASS · ALT ${km(this.camera.position.distanceTo(at.pos) - at.radius)} km · ${clock}`;
      else if (at?.kind === 'comet') this.tele.textContent = `${at.name} · ALONGSIDE · ${clock}`;
      else if (at?.kind === 'belt') this.tele.textContent = `ASTEROID BELT · RUNNING THE BELT · ${clock}`;
      else if (at?.kind === 'rings') this.tele.textContent = `${at.name} · RING PASS · ${clock}`;
      else if (at) this.tele.textContent = `${at.name} · HIGH ORBIT · ALT ${km(this.camera.position.distanceTo(at.pos) - at.radius)} km · ${clock}`;
      else this.tele.textContent = `HOME · HIGH ORBIT · ALT ${km(alt)} km · ${clock}`;
    }
  }

  private back = 1;
  private beltA = Math.random() * Math.PI * 2;
  private beltR = 135000;
  private beltPos = new THREE.Vector3();

  /** How far out the camera sits at a stop (the ordinary orbits, and the system view). */
  private distAt(stop: Stop, at: number) {
    const back = this.back, sys = this.opts.system;
    if (stop?.kind === 'overview') return (sys?.extent() ?? 1e5) * 2.4 * (1 + 0.06 * Math.sin(at * 0.05)) * back;
    if (stop?.kind) return this.aimAt(stop, at).dist;
    return radiusOf(stop) * (stop ? (stop.radius < 2000 ? 3.4 : 2.6) * (1 + 0.15 * Math.sin(at * 0.06)) : 2.45 + 0.75 * Math.sin(at * 0.055)) * back;
  }

  /** The look at a special stop at time `t`. */
  private aimAt(stop: NonNullable<Stop>, t: number): Aim {
    const sys = this.opts.system!;
    const dir = new THREE.Vector3();
    switch (stop.kind) {
      case 'sun': {
        // a slow pass round the star, low over its limb: the corona and the prominences against space
        const y = t * 0.05;
        dir.set(Math.cos(y), 0.18 + 0.12 * Math.sin(t * 0.07), Math.sin(y)).normalize();
        return { dir, dist: stop.radius * (2.5 + 0.35 * Math.sin(t * 0.06)) * this.back, level: 1 };
      }
      case 'comet': {
        // side-on to the tail (it streams away from the star), a little above and sunward of the head
        const sun = sys.starPos.clone().sub(stop.pos).normalize();
        const side = new THREE.Vector3().crossVectors(sun, Y_UP).normalize();
        dir.copy(side).multiplyScalar(0.85).addScaledVector(Y_UP, 0.3).addScaledVector(sun, 0.35 + 0.1 * Math.sin(t * 0.1)).normalize();
        return { dir, dist: 30000 * this.back, level: 1 };
      }
      case 'belt': {
        // behind the focus as it flies along the belt, just above the plane: rocks come past
        const tan = new THREE.Vector3(-Math.sin(this.beltA), 0, Math.cos(this.beltA));
        dir.copy(tan).multiplyScalar(-Math.cos(0.16)).addScaledVector(Y_UP, Math.sin(0.16 + 0.05 * Math.sin(t * 0.3))).normalize();
        return { dir, dist: 2600, level: 1 };
      }
      case 'rings': {
        // just above the ring plane, swinging slowly round: the rings sweep past, edge-on, with the planet behind
        const n = stop.normal!(new THREE.Vector3());
        const e1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? Y_UP : new THREE.Vector3(1, 0, 0)).normalize();
        const e2 = new THREE.Vector3().crossVectors(n, e1);
        const a = t * 0.04;
        dir.copy(e1).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)).multiplyScalar(Math.cos(0.1)).addScaledVector(n, Math.sin(0.1)).normalize();
        return { dir, dist: stop.radius * 2.9 * this.back, level: 1 };
      }
      default:
        return { dir: dir.set(0, 1, 0), dist: stop.radius * 3, level: 0 };
    }
  }

  /** Start a trip to somewhere else: another body, a special stop, or home now and then. */
  private depart(sys: SolarSystem, orbitDist: (s: Stop, at: number) => number) {
    // the bodies as plain stops (their own `kind`, planet or moon, isn't a special stop's)
    const bodies: Stop[] = sys.tourStops().filter((b) => b.name !== this.at?.name).map((b) => ({ name: b.name, sub: b.sub, radius: b.radius, pos: b.pos }));
    const sc = sys.scenic();
    const specials: Stop[] = [
      { name: 'SYSTEM VIEW', sub: '', radius: 0, pos: sys.starPos, kind: 'overview' as const },
      { name: 'THE STAR', sub: '', radius: sc.star.radius, pos: sc.star.pos, kind: 'sun' as const },
      { name: 'THE BELT', sub: '', radius: 0, pos: this.beltPos, kind: 'belt' as const },
      ...sc.comets.map((c): Stop => ({ name: c.name, sub: '', radius: c.radius, pos: c.pos, kind: 'comet' })),
      ...sc.ringed.map((r): Stop => ({ name: r.name, sub: '', radius: r.radius, pos: r.pos, kind: 'rings', normal: r.normal })),
    ].filter((s) => !(s!.kind === this.at?.kind && s!.name === this.at?.name));
    this.beltR = sc.belt;
    this.trips++;
    // the first few trips show the new sights (the whole system, then the star), then a mix
    const pick = (k: StopKind) => specials.find((s) => s!.kind === k) ?? null;
    let to: Stop;
    if (this.trips === 2 && this.at?.kind !== 'overview') to = pick('overview');
    else if (this.trips === 3 && this.at?.kind !== 'sun') to = pick('sun');
    else if (Math.random() < 0.4) to = specials[Math.floor(Math.random() * specials.length)];
    else to = this.at && Math.random() < 0.25 ? null : bodies[Math.floor(Math.random() * bodies.length)];
    if (to?.kind === 'belt') this.beltA = Math.random() * Math.PI * 2;
    const sep = posOf(this.at).distanceTo(posOf(to));
    const dur = THREE.MathUtils.clamp(4 + Math.log10(Math.max(1, sep / 1000)) * 1.6, 5, 9);
    const d0 = this.cam.dist, d1 = orbitDist(to, this.t + dur);
    let yaw1 = this.cam.yaw + dur * 0.045;
    if (to && !to.kind) {
      // arrive with the sun off to one side of the camera: a lit disc with a terminator
      const sun = sys.starPos.clone().sub(to.pos).normalize();
      const dir = new THREE.Vector3();
      let best = -Infinity;
      for (let i = 0; i < 48; i++) {
        const y = (i / 48) * Math.PI * 2;
        const score = -Math.abs(this.cam.viewDir(y, 0.45, d1, dir).dot(sun) - 0.55) + Math.random() * 0.08;
        if (score > best) { best = score; yaw1 = y; }
      }
    }
    this.trip = { from: this.at, to, u: 0, dur, d0, d1, peak: Math.max(d0, d1, sep * 0.6), yaw0: this.cam.yaw, yaw1 };
  }

  /** Fade out and hand the camera back. Resolves when the screen is gone. */
  hide(): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.tour(false);
    this.active = false;
    removeEventListener('resize', this.fitMark);
    removeEventListener('keydown', this.tourKey);
    // back home if the tour had wandered off: the game picks up from orbit over home
    if (this.at || this.trip) {
      this.at = this.trip = null;
      this.cam.dist = this.cam.targetDist = R * 2.45;
      this.cam.focusOverride.set(0, 0, 0);
    }
    if (this.opts.system) { this.opts.system.tour = 0; this.opts.system.overview = 0; this.opts.system.beltsOn = false; this.opts.system.chase = null; }
    this.cam.upW = 0;
    this.cam.freePitch = false;
    this.cam.overrideW = 0;
    if (this.camera.view) this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('title');
    this.root.classList.add('out');
    return new Promise((res) => setTimeout(() => { this.root.remove(); res(); }, 700));
  }
}
