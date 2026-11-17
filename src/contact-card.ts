/**
 * Story cards, one at a time, most urgent first:
 *   1. first contact with an inhabitant camp (src/sim/inhabitants.ts): approach,
 *      keep away or drive them off;
 *   2. story events (src/sim/story.ts, content/story): the inbox's oldest card,
 *      with its choices or Continue; an event marked `pause` pauses the game
 *      while its card is open;
 *   3. a camp's trust story, the first time it comes to trust the colony.
 * Otherwise the game doesn't pause: cards wait. DOM only; ColonyHud calls
 * `update` with each snapshot.
 */
import type { ZoomCamera } from './camera';
import type { InhabitantDef, StoryDef } from './content/defs';
import type { Command, ContactChoice, Snapshot } from './sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Deps {
  inhabitants: Record<string, InhabitantDef>;
  story: Record<string, StoryDef>;
  cam: ZoomCamera;
  command(c: Command): void;
  /** Pause (true) or resume (false) the game for a `pause` event. */
  pause(on: boolean): void;
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
  /** Story card the player just answered (hidden until the sim drops it from the inbox). */
  private answered = '';
  private paused = false;

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
    const inbox = (s.story?.inbox ?? []).filter((id) => id !== this.answered && this.d.story[id]);
    if (!s.story?.inbox.includes(this.answered)) this.answered = '';
    let html = '', pause = false;
    if (ask >= 0) {
      const c = camps[ask], g = this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.contactTitle)}</div><p>${esc(g.contactText)}</p>
        <div class="grp"><button data-c="${ask}:approach" title="Send the drone to their fire. They may come to trust us.">Approach</button><button data-c="${ask}:avoid" title="Leave them be. Their regard won't grow past where it is.">Keep away</button><button data-c="${ask}:drive" class="bad" title="Make them leave the region.">Drive them off</button></div>
        <div class="grp sub"><button data-look="${c.x},${c.z}">Look</button><button data-later="${ask}">Later</button></div>`;
    } else if (inbox.length) {
      const id = inbox[0], ev = this.d.story[id];
      pause = !!ev.pause;
      const choices = ev.choices?.length ? ev.choices.map((c, n) => `<button data-s="${esc(id)}:${n}">${esc(c.label)}</button>`).join('') : `<button data-s="${esc(id)}:0">Continue</button>`;
      html = `${ev.speaker ? `<div class="who">${esc(ev.speaker)}</div>` : ''}<div class="t">${esc(ev.title)}</div><p>${esc(ev.text)}</p><div class="grp">${choices}</div>`;
    } else if (this.story.length) {
      const i = this.story[0], c = camps[i], g = c && this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.trustTitle)}</div><p>${esc(g.trustText)}</p><div class="grp"><button data-ok>Continue</button><button data-look="${c.x},${c.z}">Look</button></div>`;
      else this.story.shift();
    }
    // nothing over the landing cinematic or the title screen: cards wait for play
    const cl = document.body.classList;
    if (cl.contains('cine') || cl.contains('title')) { html = ''; pause = false; }
    if (pause !== this.paused) { this.paused = pause; this.d.pause(pause); }
    if (html === this.key) return;
    this.key = html;
    this.el.innerHTML = html;
    this.el.classList.toggle('on', !!html);
  }

  private act(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.s) {
      const at = b.dataset.s.lastIndexOf(':');
      const id = b.dataset.s.slice(0, at);
      this.d.command({ type: 'story', id, choice: Number(b.dataset.s.slice(at + 1)) });
      this.answered = id;
      if (this.paused) { this.paused = false; this.d.pause(false); }
      this.close();
    } else if (b.dataset.c) {
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
  reset() {
    this.story = []; this.trusted.clear(); this.later.clear(); this.primed = false; this.answered = '';
    if (this.paused) { this.paused = false; this.d.pause(false); }
    this.close();
  }
}
