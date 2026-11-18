/**
 * Options: graphics toggles in a panel, opened from OPTIONS on the title screen or ⚙ Options in the
 * ⋯ menu. Each option is remembered by its owner (main.ts); this only draws the panel.
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
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openOptions(toggles: Toggle[], tap?: () => void, onClose?: () => void) {
  if (document.getElementById('options')) return;
  const el = document.createElement('div');
  el.id = 'options';
  el.innerHTML = `
    <div class="op-panel" role="dialog" aria-label="Options">
      <div class="op-head"><b>OPTIONS</b><span>Graphics</span><button class="op-x" aria-label="Close">✕</button></div>
      <div class="op-list">${toggles.map((t) => `
        <button class="op-row" data-id="${esc(t.id)}" role="switch">
          <span class="op-text"><b>${esc(t.label)}</b><small>${esc(t.help)}</small></span>
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
      row.querySelector('.op-state')!.textContent = lock ?? (on ? 'ON' : 'OFF');
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
