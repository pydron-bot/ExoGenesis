/**
 * Options: toggles and sliders in a panel, opened from OPTIONS on the title screen or Options in the
 * game menu (☰ / Esc). Rows come in sections (the title screen adds Region above Graphics). Each option
 * is remembered by its owner (main.ts); this only draws the panel.
 *
 * Also the in-game menu itself (`openMenu`): a list of big buttons in the same panel style.
 */

export interface Toggle {
  id: string;
  label: string;
  /** One line on what it does (and what it costs). */
  help: string;
  get(): boolean;
  set(on: boolean): void;
  /** Why it can't be changed right now (e.g. turned off in the URL), or nothing. */
  locked?: () => string | null;
  /** The heading it sits under; a new heading starts where it changes. Empty = Graphics. */
  section?: string;
  /** What the state box says instead of ON / OFF (e.g. a pick list's "HERE" and ""). */
  state?: (on: boolean) => string;
}

/** A 0–100 slider row (volumes). */
export interface Slider {
  kind: 'slider';
  id: string;
  label: string;
  help: string;
  section?: string;
  get(): number;
  set(v: number): void;
  locked?: () => string | null;
}

export type OptionRow = Toggle | Slider;
const isSlider = (r: OptionRow): r is Slider => (r as Slider).kind === 'slider';

import { esc } from './util/html';
export { esc };

/** The shared overlay: one panel at a time; Esc or a tap outside closes it. */
export function panel(title: string, body: string, onClose?: () => void) {
  document.getElementById('options')?.remove();
  const el = document.createElement('div');
  el.id = 'options';
  el.innerHTML = `
    <div class="op-panel" role="dialog" aria-label="${esc(title)}">
      <div class="op-head"><b>${esc(title.toUpperCase())}</b><button class="op-x" aria-label="Close">✕</button></div>
      <div class="op-list">${body}</div>
    </div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; el.remove(); removeEventListener('keydown', key, true); onClose?.(); };
  // (not while the Field Guide is open over it: Esc closes that first)
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.getElementById('guide')) { e.stopPropagation(); e.preventDefault(); close(); } };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.querySelector<HTMLButtonElement>('.op-x')!.onclick = close;
  addEventListener('keydown', key, true);
  document.body.appendChild(el);
  return { el, close };
}

/** A panel is open (options, the menu, Controls, or the Field Guide, src/guide.ts). */
export const panelOpen = () => !!document.getElementById('options') || !!document.getElementById('guide');

/** A panel of read-only text (Controls): `html` is trusted markup built by the caller. */
export function openInfo(title: string, html: string, onClose?: () => void) {
  const { el, close } = panel(title, `<div class="op-info">${html}</div>`, onClose);
  el.classList.add('info');
  el.querySelector<HTMLElement>('.op-x')?.focus({ preventScroll: true });
  return { el, close };
}

export function openOptions(rows: OptionRow[], tap?: () => void, onClose?: () => void) {
  const sec = (r?: OptionRow) => r?.section ?? 'Graphics';
  const { el } = panel('Options', rows.map((t, i) => `${!i || sec(t) !== sec(rows[i - 1]) ? `<div class="op-sec">${esc(sec(t))}</div>` : ''}
    ${isSlider(t)
      ? `<label class="op-row op-slide" data-id="${esc(t.id)}">
          <span class="op-text"><b>${esc(t.label)}</b>${t.help ? `<small>${esc(t.help)}</small>` : ''}</span>
          <input type="range" min="0" max="100" step="5" aria-label="${esc(t.label)}"><span class="op-val"></span>
        </label>`
      : `<button class="op-row" data-id="${esc(t.id)}" role="switch">
          <span class="op-text"><b>${esc(t.label)}</b>${t.help ? `<small>${esc(t.help)}</small>` : ''}</span>
          <span class="op-state"></span>
        </button>`}`).join(''), onClose);
  const sync = () => {
    for (const t of rows) {
      const row = el.querySelector<HTMLElement>(`[data-id="${t.id}"]`)!;
      const lock = t.locked?.() ?? null;
      if (isSlider(t)) {
        const inp = row.querySelector('input')!;
        inp.disabled = !!lock;
        inp.value = String(Math.round(t.get()));
        row.querySelector('.op-val')!.textContent = lock ?? `${Math.round(t.get())}%`;
        row.classList.toggle('dis', !!lock);
        continue;
      }
      const on = t.get();
      (row as HTMLButtonElement).disabled = !!lock;
      row.setAttribute('aria-checked', String(on));
      row.classList.toggle('on', on);
      const st = row.querySelector<HTMLElement>('.op-state')!;
      st.textContent = lock ?? (t.state ? t.state(on) : on ? 'ON' : 'OFF');
      st.hidden = !st.textContent;
    }
  };
  for (const t of rows) {
    const row = el.querySelector<HTMLElement>(`[data-id="${t.id}"]`)!;
    if (isSlider(t)) row.querySelector('input')!.oninput = (e) => { t.set(Number((e.target as HTMLInputElement).value)); sync(); };
    else row.onclick = () => { tap?.(); t.set(!t.get()); sync(); };
  }
  sync();
  el.querySelector<HTMLElement>('button.op-row:not(:disabled)')?.focus({ preventScroll: true });
}

export interface MenuItem {
  id: string;
  label: string;
  /** One line under the label. */
  sub?: string;
  run(): void;
  /** Ask first: the button says this and needs a second tap. */
  confirm?: string;
}

/**
 * The in-game menu: big buttons, one per action (each closes the menu, then runs).
 * `onClose` gets the item that closed it (null for Esc, a tap outside or the panel's ✕), so it can tell those apart.
 */
export function openMenu(title: string, items: MenuItem[], foot: string, tap?: () => void, onClose?: (picked: MenuItem | null) => void) {
  let picked: MenuItem | null = null;
  const { el, close } = panel(title, `${items.map((m) => `
    <button class="op-row op-act" data-id="${esc(m.id)}">
      <span class="op-text"><b>${esc(m.label)}</b>${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>
    </button>`).join('')}<div class="op-foot">${foot}</div>`, () => onClose?.(picked));
  el.classList.add('menu');
  for (const m of items) {
    const b = el.querySelector<HTMLButtonElement>(`[data-id="${m.id}"]`)!;
    let armed = false;
    b.onclick = () => {
      tap?.();
      if (m.confirm && !armed) {
        armed = true;
        b.classList.add('armed');
        b.querySelector('small')?.remove();
        b.querySelector('.op-text')!.insertAdjacentHTML('beforeend', `<small>${esc(m.confirm)}</small>`);
        return;
      }
      picked = m;
      close();
      m.run();
    };
  }
  el.querySelector<HTMLElement>('.op-row')?.focus({ preventScroll: true });
  return { el, close };
}
