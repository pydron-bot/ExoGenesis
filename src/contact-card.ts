/**
 * Story cards, one at a time, most urgent first:
 *   1. first contact with an inhabitant camp (src/sim/inhabitants.ts): approach,
 *      keep away or drive them off;
 *   2. story events (src/sim/story.ts, content/story): the inbox's oldest card,
 *      with its choices or Continue; an event marked `pause` pauses the game
 *      while its card is open. A card with more lines is a conversation: one
 *      line at a time (Next), the choices with the last. Speakers can be
 *      characters (content/characters: name, colour, portrait);
 *   3. a camp's trust story, the first time it comes to trust the colony.
 * Otherwise the game doesn't pause: cards wait. Radio messages (style
 * 'radio') don't wait in line: they show in their own corner panel, close by
 * themselves after a while (or when tapped) and stay in the log.
 * DOM only; ColonyHud calls `update` with each snapshot.
 */
import type { ZoomCamera } from './camera';
import { content } from './content';
import { mediaUrl, shownChoices, type InhabitantDef, type StoryDef } from './content/defs';
import type { Command, ContactChoice, Snapshot } from './sim/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Deps {
  inhabitants: Record<string, InhabitantDef>;
  story: Record<string, StoryDef>;
  cam: ZoomCamera;
  command(c: Command): void;
  /** Pause (true) or resume (false) the game for a `pause` event. */
  pause(on: boolean): void;
  /** A card opened (a sound). */
  opened?(): void;
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
  /** The reply to the choice just made, shown on the card until Continue (it also goes to the log). */
  private reply: { html: string; color: string; pause: boolean } | null = null;
  /** The conversation page showing (story card id, line). */
  private page = { id: '', n: 0 };
  private last: Snapshot | null = null;
  private first = '';
  /** Radio messages: the panel, the one showing and until when, and the one just closed. */
  private radioEl: HTMLElement;
  private radioId = '';
  private radioUntil = 0;
  private radioDone = '';

  constructor(private d: Deps) {
    this.el = document.getElementById('contact')!;
    this.el.addEventListener('pointerdown', (e) => this.act(e));
    this.radioEl = document.createElement('div');
    this.radioEl.id = 'radio';
    this.el.after(this.radioEl);
    this.radioEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.closeRadio(); });
  }

  /** Story text with {first} (the first pod-born colonist's given name). */
  private fill(t: string, id?: string) {
    const w = id ? this.last?.story?.who?.[id] : undefined;
    return t.replaceAll('{first}', this.first || 'your first colonist').replaceAll('{whoLine}', w?.line ?? 'their').replaceAll('{who}', w?.name ?? 'someone');
  }

  /** Name, role and portrait above a line, in the character's colour. */
  private speaker(character?: string, speaker?: string): { html: string; color: string } {
    const ch = character ? content.characters?.[character] : undefined;
    const name = ch?.name ?? speaker ?? '';
    if (!name) return { html: '', color: '' };
    const a = ch?.portrait ? content.assets[ch.portrait] : undefined;
    const img = a?.kind === 'image' ? `<img class="por" src="${esc(mediaUrl(a))}" alt="">` : '';
    const color = ch?.color ?? '';
    return { html: `<div class="who"${color ? ` style="color:${esc(color)}"` : ''}>${img}<span>${esc(this.fill(name))}${ch?.role ? `<small>${esc(this.fill(ch.role))}</small>` : ''}</span></div>`, color };
  }

  /** A story card: its current page and buttons. */
  private storyHtml(id: string): { html: string; color: string } {
    const ev = this.d.story[id];
    const pages = [{ character: ev.character, speaker: ev.speaker, text: ev.text }, ...(ev.lines ?? []).map((l) => ({
      character: l.character ?? (l.speaker ? undefined : ev.character), speaker: l.speaker ?? (l.character ? undefined : ev.speaker), text: l.text,
    }))];
    if (this.page.id !== id) this.page = { id, n: 0 };
    // choices offered with (or without) a flag; each button keeps its place in the full list (effects go by it)
    const offered = shownChoices(ev, this.last?.story?.flags ?? []);
    const n = Math.min(this.page.n, pages.length - 1), pg = pages[n], who = this.speaker(pg.character, pg.speaker);
    const buttons = n < pages.length - 1
      ? `<button data-next>Next ›</button><span class="pg">${n + 1} / ${pages.length}</span>`
      : offered.length ? offered.map((k) => `<button data-s="${esc(id)}:${k}">${esc(this.fill(ev.choices![k].label, id))}</button>`).join('') : `<button data-s="${esc(id)}:0">Continue</button>`;
    return { html: `${who.html}${ev.dilemma ? '<small class="kind">Colony dilemma</small>' : ''}<div class="t">${esc(this.fill(ev.title, id))}</div><p>${esc(this.fill(pg.text, id))}</p><div class="grp">${buttons}</div>`, color: who.color };
  }

  /** The radio panel: the oldest radio message, until it times out or is tapped. */
  private radio(ids: string[], hidden: boolean) {
    const id = ids.find((x) => x !== this.radioDone) ?? '';
    if (hidden || !id) {
      if (this.radioId) { this.radioId = ''; this.radioShown(false); }
      return;
    }
    if (id !== this.radioId) {
      const ev = this.d.story[id], who = this.speaker(ev.character, ev.speaker || 'Transmission');
      this.radioId = id;
      const words = ev.text.split(/\s+/).length;
      this.radioUntil = performance.now() + Math.min(20, Math.max(6, 4 + words * 0.35)) * 1000;
      this.radioEl.innerHTML = `<div class="rd-head"><i></i>${who.html}</div><div class="t">${esc(this.fill(ev.title))}</div><p>${esc(this.fill(ev.text))}</p>`;
      this.radioEl.style.borderColor = who.color;
      this.radioShown(true);
    } else if (performance.now() > this.radioUntil) this.closeRadio();
  }
  private closeRadio() {
    if (!this.radioId) return;
    this.d.command({ type: 'story', id: this.radioId, choice: 0 });
    this.radioDone = this.radioId;
    this.radioId = '';
    this.radioShown(false);
  }
  private radioShown(on: boolean) {
    this.radioEl.classList.toggle('on', on);
    document.body.classList.toggle('radio-on', on);
    if (on) document.body.style.setProperty('--radio-h', `${this.radioEl.offsetHeight + 6}px`);
  }

  update(s: Snapshot) {
    this.last = s;
    this.first = s.story?.first ?? '';
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
    const all = (s.story?.inbox ?? []).filter((id) => id !== this.answered && this.d.story[id]);
    if (!s.story?.inbox.includes(this.answered)) this.answered = '';
    if (!s.story?.inbox.includes(this.radioDone)) this.radioDone = '';
    const inbox = all.filter((id) => this.d.story[id].style !== 'radio');
    const cl = document.body.classList, quiet = cl.contains('cine') || cl.contains('title');
    this.radio(all.filter((id) => this.d.story[id].style === 'radio'), quiet);
    let html = '', pause = false, color = '';
    // a cinematic started by the choice plays the reply out on screen: drop the card's copy
    if (this.reply && quiet) this.reply = null;
    if (this.reply) {
      ({ html, color, pause } = this.reply);
    } else if (ask >= 0) {
      const c = camps[ask], g = this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.contactTitle)}</div><p>${esc(g.contactText)}</p>
        <div class="grp"><button data-c="${ask}:approach" title="Send the drone to their fire. They may come to trust us.">Approach</button><button data-c="${ask}:avoid" title="Leave them be. Their regard won't grow past where it is.">Keep away</button><button data-c="${ask}:drive" class="bad" title="Make them leave the region.">Drive them off</button></div>
        <div class="grp sub"><button data-look="${c.x},${c.z}">Look</button><button data-later="${ask}">Later</button></div>`;
    } else if (inbox.length) {
      const id = inbox[0];
      pause = !!this.d.story[id].pause;
      ({ html, color } = this.storyHtml(id));
    } else if (this.story.length) {
      const i = this.story[0], c = camps[i], g = c && this.d.inhabitants[c.group];
      if (g) html = `<div class="t">${esc(g.trustTitle)}</div><p>${esc(g.trustText)}</p><div class="grp"><button data-ok>Continue</button><button data-look="${c.x},${c.z}">Look</button></div>`;
      else this.story.shift();
    }
    // nothing over the landing cinematic or the title screen: cards wait for play
    if (quiet) { html = ''; pause = false; }
    if (pause !== this.paused) { this.paused = pause; this.d.pause(pause); }
    if (html === this.key) return;
    if (html && !this.key) this.d.opened?.();
    this.key = html;
    this.el.innerHTML = html;
    this.el.style.borderColor = color;
    this.el.classList.toggle('on', !!html);
  }

  private act(e: PointerEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.next !== undefined) {
      this.page.n++;
      if (this.last) this.update(this.last);
    } else if (b.dataset.s) {
      const at = b.dataset.s.lastIndexOf(':');
      const id = b.dataset.s.slice(0, at);
      const k = Number(b.dataset.s.slice(at + 1)), ev = this.d.story[id], ch = ev?.choices?.[k];
      this.d.command({ type: 'story', id, choice: k });
      this.answered = id;
      this.page = { id: '', n: 0 };
      if (ch?.reply?.trim()) {
        // the answer stays on the card: what you chose, then what came of it
        const who = this.speaker(ev.character, ev.speaker);
        this.reply = {
          html: `<div class="t">${esc(this.fill(ev.title, id))}</div><p class="said">› ${esc(this.fill(ch.label, id))}</p><p>${esc(this.fill(ch.reply, id))}</p><div class="grp"><button data-reply>Continue</button></div>`,
          color: who.color, pause: !!ev.pause,
        };
        if (this.last) this.update(this.last);
        return;
      }
      if (this.paused) { this.paused = false; this.d.pause(false); }
      this.close();
    } else if (b.dataset.reply !== undefined) {
      this.reply = null;
      if (this.paused) { this.paused = false; this.d.pause(false); }
      this.close();
      if (this.last) this.update(this.last);
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
    this.story = []; this.trusted.clear(); this.later.clear(); this.primed = false; this.answered = ''; this.reply = null;
    this.page = { id: '', n: 0 }; this.radioId = ''; this.radioDone = ''; this.radioShown(false);
    if (this.paused) { this.paused = false; this.d.pause(false); }
    this.close();
  }
}
