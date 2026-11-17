/**
 * Story cards for the inhabitants (src/sim/inhabitants.ts): first contact asks
 * the player what to do (approach, keep away, drive them off), and the trust
 * story is shown the first time a camp comes to trust the colony. The game
 * doesn't pause: the card waits, and the camp's regard keeps moving meanwhile.
 * DOM only; ColonyHud calls `update` with each snapshot.
 */
import type { ZoomCamera } from './camera';
import type { InhabitantDef } from './content/defs';
import type { Command, ContactChoice, Snapshot } from './sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Deps {
  inhabitants: Record<string, InhabitantDef>;
  cam: ZoomCamera;
  command(c: Command): void;
}

export class ContactCard {
  private el: HTMLElement;
  private key = '';
  /** Trust stories still to show (camp indexes), and camps already trusted when we started watching. */
  private story: number[] = [];
  private trusted = new Set<number>();
  private primed = false;
  /** Pending first contacts the player put off ("Later"): the card stays closed for them until a new one. */
  private later = new Set<number>();

  constructor(private d: Deps) {
    this.el = document.getElementById('contact')!;
    this.el.addEventListener('pointerdown', (e) => this.act(e));
  }

  update(s: Snapshot) {
    const camps = s.camps ?? [];
    camps.forEach((c, i) => {
      const was = this.trusted.has(i);
      if (c.trusted && !was) {
        this.trusted.add(i);
        if (this.primed) this.story.push(i);
      } else if (!c.trusted && was) this.trusted.delete(i);
    });
    this.primed = true;
    for (const i of this.later) if (!camps[i]?.pending) this.later.delete(i);

    const ask = camps.findIndex((c, i) => c.pending && !this.later.has(i));
    let html = '';
    if (ask >= 0) {
      const c = camps[ask], g = this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.contactTitle)}</div><p>${esc(g.contactText)}</p>
        <div class="grp"><button data-c="${ask}:approach" title="Send the drone to their fire. They may come to trust us.">Approach</button><button data-c="${ask}:avoid" title="Leave them be. Their regard won't grow past where it is.">Keep away</button><button data-c="${ask}:drive" class="bad" title="Make them leave the region.">Drive them off</button></div>
        <div class="grp sub"><button data-look="${c.x},${c.z}">Look</button><button data-later="${ask}">Later</button></div>`;
    } else if (this.story.length) {
      const i = this.story[0], c = camps[i], g = c && this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.trustTitle)}</div><p>${esc(g.trustText)}</p><div class="grp"><button data-ok>Continue</button><button data-look="${c.x},${c.z}">Look</button></div>`;
      else this.story.shift();
    }
    if (html === this.key) return;
    this.key = html;
    this.el.innerHTML = html;
    this.el.classList.toggle('on', !!html);
  }

  private act(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.c) {
      const [i, choice] = b.dataset.c.split(':');
      this.d.command({ type: 'contact', camp: Number(i), choice: choice as ContactChoice });
      this.close();
    } else if (b.dataset.later) {
      this.later.add(Number(b.dataset.later));
      this.close();
    } else if (b.dataset.ok !== undefined) {
      this.story.shift();
      this.close();
    } else if (b.dataset.look) {
      const [x, z] = b.dataset.look.split(',').map(Number);
      this.d.cam.fx = x; this.d.cam.fz = z;
    }
  }

  private close() {
    this.key = '';
    this.el.innerHTML = '';
    this.el.classList.remove('on');
  }

  /** New game / load: forget what was shown. */
  reset() { this.story = []; this.trusted.clear(); this.later.clear(); this.primed = false; this.close(); }
}
