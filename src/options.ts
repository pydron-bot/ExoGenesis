/**
 * Options: toggles in a panel, opened from OPTIONS on the title screen or ⚙ Options in the ⋯ menu.
 * Rows come in sections (the title screen adds Region and Sound above Graphics). Each option is
 * remembered by its owner (main.ts); this only draws the panel.
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openOptions(toggles: Toggle[], tap?: () => void, onClose?: () => void) {
  if (document.getElementById('options')) return;
  const el = document.createElement('div');
  el.id = 'options';
  el.innerHTML = `
    <div class="op-panel" role="dialog" aria-label="Options">
      <div class="op-head"><b>OPTIONS</b><button class="op-x" aria-label="Close">✕</button></div>
      <div class="op-list">${toggles.map((t, i) => `${(t.section ?? 'Graphics') !== (toggles[i - 1]?.section ?? (i ? 'Graphics' : '')) ? `<div class="op-sec">${esc(t.section ?? 'Graphics')}</div>` : ''}
        <button class="op-row" data-id="${esc(t.id)}" role="switch">
          <span class="op-text"><b>${esc(t.label)}</b>${t.help ? `<small>${esc(t.help)}</small>` : ''}</span>
          <span class="op-state"></span>
        </button>`).join('')}
      </div>
    </div>`;
  const sync = () => {
    for (const t of toggles) {
      const row = el.querySelector<HTMLButtonElement>(`[data-id="${t.id}"]`)!;
      const lock = t.locked?.() ?? null;
      const on = t.get();
      row.disabled = !!lock;
      row.setAttribute('aria-checked', String(on));
      row.classList.toggle('on', on);
      const st = row.querySelector<HTMLElement>('.op-state')!;
      st.textContent = lock ?? (t.state ? t.state(on) : on ? 'ON' : 'OFF');
      st.hidden = !st.textContent;
    }
  };
  for (const t of toggles) {
    el.querySelector<HTMLButtonElement>(`[data-id="${t.id}"]`)!.onclick = () => { tap?.(); t.set(!t.get()); sync(); };
  }
  const close = () => { el.remove(); removeEventListener('keydown', key, true); onClose?.(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.querySelector<HTMLButtonElement>('.op-x')!.onclick = close;
  addEventListener('keydown', key, true);
  sync();
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('.op-row:not(:disabled)')?.focus({ preventScroll: true });
}
