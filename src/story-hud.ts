/**
 * The story's hands on the HUD (src/sim/story.ts effects): tutorial hints that
 * point at part of the HUD, waypoints over story sites (on the ground; the
 * minimap draws them too), camera moves, and reporting which parts of the HUD
 * the player has opened (`opened` conditions). DOM only; reads snapshots.
 */
import type { ZoomCamera } from './camera';
import type { Command, StorySnap } from './sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Where each hint target lives in the HUD. */
const TARGETS: Record<string, string> = {
  build: '#b-build', goals: '#goals', minimap: '#minimap', alloys: '#r-alloys', energy: '#r-energy', battery: '#r-battery', cryo: '#r-cryo',
  clock: '#r-clock', threat: '#r-threat', army: '#r-army', people: '#r-people', mood: '#r-mood', food: '#r-food', pause: '#b-pause', fast: '#b-fast',
};

export interface StoryHudDeps {
  cam: ZoomCamera;
  command(c: Command): void;
  /** Screen position of a region point (null when behind the camera). */
  screenOf(x: number, z: number, lift?: number): { x: number; y: number } | null;
}

export class StoryHud {
  private bubble = document.createElement('div');
  private marks = document.createElement('div');
  private hinted: HTMLElement | null = null;
  private hintN = -1;
  private lookN = -1;
  private told = new Set<string>();

  constructor(private d: StoryHudDeps) {
    this.bubble.id = 'hint';
    this.marks.id = 'waypoints';
    document.getElementById('hud')!.append(this.marks, this.bubble);
    // the player opening parts of the HUD (tutorials wait for these)
    const tap = (sel: string, what: string) => document.querySelector(sel)?.addEventListener('pointerdown', () => this.opened(what));
    tap('#b-build', 'build');
    tap('#r-people', 'people');
    tap('#r-mood', 'mood');
    tap('#r-army', 'army');
    tap('#goals', 'goals');
    tap('#minimap', 'minimap');
    tap('#b-pause', 'speed');
    tap('#b-fast', 'speed');
  }

  /** Tell the sim once per game that the player opened `what` ('build', 'select:solar'…). */
  opened(what: string) {
    if (this.told.has(what)) return;
    this.told.add(what);
    this.d.command({ type: 'ui', what });
  }

  /** A building was selected (its kind; the Tech Lab counts as opening research). */
  selected(kind: string, role?: string) {
    this.opened('select');
    this.opened(`select:${kind}`);
    if (role === 'lab') this.opened('research');
  }

  /** Every frame. */
  update(st: StorySnap | undefined) {
    if (!st) return;
    // camera moves: once per new request (not on load: a resumed game starts where it was)
    if (st.look && st.look.n !== this.lookN) {
      if (this.lookN >= 0) { this.d.cam.fx = st.look.x; this.d.cam.fz = st.look.z; }
      this.lookN = st.look.n;
    } else if (!st.look) this.lookN = 0;
    this.renderHint(st);
    this.renderMarks(st);
  }

  private renderHint(st: StorySnap) {
    const h = st.hint;
    if (!h) {
      if (this.hinted) { this.hinted.classList.remove('hinted'); this.hinted = null; }
      this.bubble.classList.remove('on');
      this.hintN = -1;
      return;
    }
    // the build menu item when the menu is open, else the Build button
    let el: HTMLElement | null = null;
    if (h.target === 'buildItem' && h.building) el = document.querySelector<HTMLElement>(`#build-menu.open [data-kind="${CSS.escape(h.building)}"]`) ?? document.querySelector<HTMLElement>('#b-build');
    else el = document.querySelector<HTMLElement>(TARGETS[h.target] ?? '#b-build');
    if (el && getComputedStyle(el).display === 'none') el = null;
    if (el !== this.hinted) {
      this.hinted?.classList.remove('hinted');
      el?.classList.add('hinted');
      this.hinted = el;
    }
    if (h.n !== this.hintN) {
      this.hintN = h.n;
      this.bubble.innerHTML = esc(h.text || 'Here');
      this.bubble.classList.add('on');
    }
    if (!el) { this.bubble.style.left = '50%'; this.bubble.style.top = '30%'; this.bubble.dataset.side = 'none'; return; }
    const r = el.getBoundingClientRect(), bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    // below the target if there's room, else above
    const below = r.bottom + bh + 16 < innerHeight;
    const x = Math.min(innerWidth - bw / 2 - 8, Math.max(bw / 2 + 8, r.left + r.width / 2));
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${below ? r.bottom + 12 : r.top - bh - 12}px`;
    this.bubble.dataset.side = below ? 'below' : 'above';
  }

  private renderMarks(st: StorySnap) {
    const want = st.marks;
    while (this.marks.children.length > want.length) this.marks.lastElementChild!.remove();
    while (this.marks.children.length < want.length) this.marks.append(Object.assign(document.createElement('div'), { className: 'wp' }));
    want.forEach((m, i) => {
      const el = this.marks.children[i] as HTMLElement;
      const key = `${m.site}|${m.text}`;
      if (el.dataset.key !== key) { el.dataset.key = key; el.innerHTML = `<i></i><span>${esc(m.text || '')}</span>`; }
      const p = this.d.screenOf(m.x, m.z, 3);
      if (!p) { el.style.display = 'none'; return; }
      el.style.display = '';
      // pinned to the screen edge when off screen
      const x = Math.min(innerWidth - 24, Math.max(24, p.x)), y = Math.min(innerHeight - 80, Math.max(60, p.y));
      el.classList.toggle('edge', x !== p.x || y !== p.y);
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  /** New game: forget what was reported. */
  reset() { this.told.clear(); this.hintN = -1; this.lookN = -1; }
}
