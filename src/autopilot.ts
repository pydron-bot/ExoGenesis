/**
 * Autopilot (spectator mode), the renderer's half (TECH.md "Autopilot"): the computer plays the campaign while
 * you watch. The colony is played in the sim worker (src/sim/autopilot.ts); here: the AUTOPILOT badge with its
 * caption, speed and Stop; story cards read for a few seconds and answered by a policy (the chosen button lights
 * up first); and the director, a camera that follows what matters and backs off for a while when you move it.
 * Remembered in the browser (`exo.autopilot`), so a travel reload keeps it on.
 */
import type { ZoomCamera } from './camera';
import { pickChoice, type ChoicePolicy } from './sim/choices';
import type { PilotConfig, PilotStatus } from './sim/autopilot';

export const AUTOPILOT_KEY = 'exo.autopilot';
export interface AutopilotPrefs { on: boolean; policy: ChoicePolicy; assist: boolean; assistMinutes: number; speed: number }
const DEFAULTS: AutopilotPrefs = { on: false, policy: 'first', assist: false, assistMinutes: 6, speed: 1 };

/** The saved preferences (with `on` as last left). */
export function loadPrefs(): AutopilotPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(AUTOPILOT_KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
function savePrefs(p: AutopilotPrefs) {
  try { localStorage.setItem(AUTOPILOT_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

interface Deps {
  cam: ZoomCamera;
  /** Tell the worker (on, assist). */
  pilot(cfg: PilotConfig): void;
  setSpeed(n: number): void;
  speed(): number;
  /** Something has the screen (title, cinematic, travel, a menu): no cards, no camera moves. */
  busy(): boolean;
  /** Where player input arrives (drags and zooms make the director back off). */
  canvas: HTMLElement;
  tap?(): void;
  /** The game is over: an ending (the campaign is over) or an expedition lost (it goes home). Null while it plays. */
  outcome?(): 'ended' | 'lost-away' | null;
  /** Clear the player's selection (its card would sit over the game while you watch). */
  deselect?(): void;
}

/** A shot: what the camera looks at and how close. */
interface Shot { kind: keyof typeof RANK; x: number; z: number; dist: number; since: number }
const RANK = { strike: 6, fight: 5, card: 4, group: 3, build: 2, at: 2, core: 1 } as const;
const DIST: Record<keyof typeof RANK, number> = { strike: 95, fight: 75, card: 85, group: 62, build: 58, at: 60, core: 115 };
/** How long a shot holds before a less urgent one may take over (ms), and the back-off after the player moves the camera. */
const HOLD = 5000, BACK_OFF = 10000;

export class AutopilotView {
  prefs: AutopilotPrefs;
  private el: HTMLElement;
  private capEl: HTMLElement;
  private status: PilotStatus = { doing: '' };
  /** The card being read: its markup, and when the bot picks. */
  private card = { key: '', at: 0, picked: false };
  /** A caption the renderer sets (answering a card), shown over the worker's for a while. */
  private say = { text: '', until: 0 };
  private shot: Shot | null = null;
  /** Cards it answered ("Title → choice"), newest last (tests). */
  readonly answered: string[] = [];
  private backOff = 0;

  constructor(private d: Deps, on: boolean) {
    this.prefs = { ...loadPrefs(), on };
    this.el = document.createElement('div');
    this.el.id = 'autopilot';
    this.el.innerHTML = `<div class="ap-row"><span class="ap-name" title="The computer is playing your campaign">AUTOPILOT</span>
      <span class="ap-speed">${[1, 2, 3].map((n) => `<button data-sp="${n}" title="Game speed ×${n}">×${n}</button>`).join('')}</span>
      <button class="ap-assist" title="Assist: finish an objective stuck for ${this.prefs.assistMinutes} min, hold off a pack at the Core">ASSIST</button>
      <button class="ap-stop" title="Hand control back to you">■ Stop</button></div><div class="ap-cap"></div>`;
    this.capEl = this.el.querySelector('.ap-cap')!;
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      d.tap?.();
      if (b.classList.contains('ap-stop')) this.set(false);
      else if (b.classList.contains('ap-assist')) { this.prefs.assist = !this.prefs.assist; this.sync(); }
      else if (b.dataset.sp) { this.prefs.speed = Number(b.dataset.sp); d.setSpeed(this.prefs.speed); this.sync(); }
    });
    // the player takes the camera: the director stands back for a while
    const mine = () => { if (this.prefs.on) { this.backOff = performance.now() + BACK_OFF; } };
    d.canvas.addEventListener('pointerdown', mine);
    d.canvas.addEventListener('wheel', mine, { passive: true });
    addEventListener('keydown', (e) => { if (/^(Arrow|[wasdqeWASDQE+\-=])/.test(e.key) && !(e.target instanceof HTMLInputElement)) mine(); });
    this.sync();
  }

  get on() { return this.prefs.on; }

  /** Switch on or off (Stop hands control back at once; the browser remembers it for travel). */
  set(on: boolean, opts: Partial<Pick<AutopilotPrefs, 'policy' | 'assist' | 'speed'>> = {}) {
    Object.assign(this.prefs, opts, { on });
    if (!on) { this.card = { key: '', at: 0, picked: false }; this.shot = null; this.d.setSpeed(this.d.speed() > 1 ? 1 : this.d.speed()); document.querySelectorAll('.ap-pick').forEach((b) => b.classList.remove('ap-pick')); }
    else { this.d.setSpeed(this.prefs.speed); this.d.deselect?.(); }
    this.sync();
  }

  /** Keep the preferences (the title's Options change them). */
  save() { this.sync(); }

  private sync() {
    savePrefs(this.prefs);
    this.d.pilot({ on: this.prefs.on, assist: this.prefs.assist, assistMinutes: this.prefs.assistMinutes });
    this.el.classList.toggle('on', this.prefs.on);
    document.body.classList.toggle('autopilot', this.prefs.on);
    this.el.querySelectorAll<HTMLElement>('[data-sp]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.sp) === this.prefs.speed));
    this.el.querySelector('.ap-assist')!.classList.toggle('sel', this.prefs.assist);
  }

  /** The worker's report. */
  report(s: PilotStatus) { this.status = s; }

  /** Every frame. */
  update(now: number, dt: number) {
    if (!this.prefs.on) return;
    const end = this.d.outcome?.() ?? null;
    if (end) { this.ending(now, end); return; }
    const busy = this.d.busy();
    const cap = now < this.say.until ? this.say.text : this.status.doing;
    if (this.capEl.textContent !== cap) this.capEl.textContent = cap;
    this.clearCard();
    if (busy) return;
    this.answer(now);
    this.direct(now, dt);
  }

  /** A story card up where the badge sits (narrower screens): the badge moves just under it, so the card reads clear and Stop stays in reach. */
  private clearCard() {
    const card = document.getElementById('contact');
    let top = '';
    if (card?.classList.contains('on')) {
      const r = card.getBoundingClientRect(), a = this.el.getBoundingClientRect();
      const zoom = parseFloat(getComputedStyle(this.el).zoom) || 1;
      if (r.height && r.right > innerWidth - a.width - 24) top = `${Math.round((r.bottom + 8) / zoom)}px`;
    }
    if (this.el.style.top !== top) this.el.style.top = top;
    this.el.classList.toggle('below-card', !!top);
  }

  // ---------- story cards ----------
  /** Read the card on screen for a while (longer for more text), light up the chosen button, then press it. */
  private answer(now: number) {
    const el = document.getElementById('contact');
    const on = !!el?.classList.contains('on');
    const key = on ? el!.textContent ?? '' : '';
    if (key !== this.card.key) {
      const text = key.length;
      // ~2.5 s + 40 ms a character, at most 9 s; a little quicker when the game runs fast
      const fast = this.d.speed() >= 3 ? 2 : this.d.speed() >= 2 ? 1.5 : 1;
      this.card = { key, at: now + Math.min(9000, 2500 + 40 * text) / fast, picked: false };
    }
    if (!on || now < this.card.at) return;
    const title = el!.querySelector('.t')?.textContent ?? '';
    const btn = (sel: string) => el!.querySelector<HTMLButtonElement>(sel);
    if (!this.card.picked) {
      let b: HTMLButtonElement | null = btn('[data-next]');
      if (!b) {
        const story = [...el!.querySelectorAll<HTMLButtonElement>('[data-s]')];
        if (story.length) {
          const idx = story.map((x) => Number(x.dataset.s!.slice(x.dataset.s!.lastIndexOf(':') + 1)));
          const labels: string[] = [];
          story.forEach((x, i) => { labels[idx[i]] = x.textContent ?? ''; });
          const k = pickChoice(this.prefs.policy, idx, labels, Math.random);
          b = story[idx.indexOf(k)] ?? story[0];
        // (a choice's reply comes back on the card with Continue: data-reply)
        } else b = btn('[data-c$=":approach"]') ?? btn('[data-ok]') ?? btn('[data-reply]');
      }
      if (!b) return;
      this.card.picked = true;
      this.card.at = now + (b.dataset.next !== undefined ? 250 : 900);
      b.classList.add('ap-pick');
      if (b.dataset.next === undefined) {
        this.say = { text: `Answering: ${titleCase(title)} → ${b.textContent?.trim()}`, until: now + 4000 };
        this.answered.push(`${title} → ${b.textContent?.trim()}`);
      }
      return;
    }
    // press it (the card may have redrawn: find the same button again)
    const picked = el!.querySelector<HTMLButtonElement>('.ap-pick');
    if (picked) picked.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    this.card = { key: '', at: 0, picked: false };
  }

  // ---------- the end ----------
  /**
   * The game is over. An ending: the epilogue's pages are read like a card (a little longer) and turned with Next, then
   * the autopilot stops on the end screen and leaves it there. An expedition lost: the end screen is read for a
   * moment and "Back to Touchdown" pressed (the campaign goes on at home, the autopilot still on).
   */
  private ending(now: number, end: 'ended' | 'lost-away') {
    const fast = this.d.speed() >= 3 ? 2 : this.d.speed() >= 2 ? 1.5 : 1;
    const page = document.getElementById('epilogue');
    const key = page ? `epi:${page.textContent ?? ''}` : `over:${end}`;
    if (key !== this.card.key) {
      const text = page?.textContent?.length ?? 0;
      // a page: ~3 s + 45 ms a character, at most 14 s; the end screen: 6 s
      this.card = { key, at: now + (page ? Math.min(14000, 3000 + 45 * text) : 6000) / fast, picked: false };
      const cap = page ? `Reading the epilogue: ${page.querySelector('.epi-n')?.textContent ?? ''}` : end === 'ended' ? 'The end' : 'Expedition lost: going home';
      if (this.capEl.textContent !== cap) this.capEl.textContent = cap;
    }
    if (now < this.card.at) return;
    const btn = page ? document.getElementById('epi-next') : end === 'lost-away' ? document.getElementById('over-restart') : null;
    if (page && !btn) return;
    if (btn && !this.card.picked) { btn.classList.add('ap-pick'); this.card.picked = true; this.card.at = now + 900; return; }
    if (btn) { btn.click(); this.card = { key: '', at: 0, picked: false }; return; }
    // the end screen of an ending: stop here and leave it on screen
    this.answered.push(`The end: ${document.getElementById('over-title')?.textContent ?? ''}`);
    this.set(false);
  }

  // ---------- the director ----------
  private direct(now: number, dt: number) {
    const cam = this.d.cam, s = this.status;
    if (now < this.backOff) return;
    // the most urgent place to look at
    let best: Shot | null = null;
    for (const kind of Object.keys(RANK) as (keyof typeof RANK)[]) {
      const p = s[kind];
      if (p && (!best || RANK[kind] > RANK[best.kind])) best = { kind, x: p.x, z: p.z, dist: DIST[kind], since: now };
    }
    const cur = this.shot;
    if (best) {
      const held = cur ? now - cur.since : Infinity;
      const far = cur ? Math.hypot(best.x - cur.x, best.z - cur.z) > 14 : true;
      if (!cur || (best.kind === cur.kind && !far)) {
        // the same subject: follow it (a group walking, a fight moving)
        this.shot = cur ? { ...cur, x: best.x, z: best.z } : best;
      } else if (held > HOLD || RANK[best.kind] >= RANK.fight && RANK[best.kind] > RANK[cur.kind] && held > 1500) {
        // a new subject once the shot has held (sooner for a strike or a fight); not just back and forth nearby
        if (far || best.kind !== cur.kind) this.shot = best;
      } else if (cur.kind !== 'core' && !s[cur.kind] && held > 2500) this.shot = best;
    }
    const shot = this.shot;
    if (!shot) return;
    if (cam.a > 0.3) cam.setView('surface');
    // glide: slow and eased (a long way goes faster), and the distance eases on its own (ZoomCamera)
    const k = 1 - Math.exp(-dt * 1.4);
    const fx = cam.fx + (shot.x - cam.fx) * k, fz = cam.fz + (shot.z - cam.fz) * k;
    if (Math.hypot(shot.x - cam.fx, shot.z - cam.fz) > 0.2) cam.lookAtGround(fx, fz);
    cam.targetDist += (shot.dist - cam.targetDist) * (1 - Math.exp(-dt * 0.8));
    cam.targetPitch += (0.82 - cam.targetPitch) * (1 - Math.exp(-dt * 0.5));
    // a slow turn while it waits on the Core
    if (shot.kind === 'core') cam.yaw += dt * 0.035;
  }
}

const titleCase = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
