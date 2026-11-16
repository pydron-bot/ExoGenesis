/**
 * "What's new": the release notes (src/changelog.ts) in a panel, opened from
 * the version on the title screen or the ⋯ menu. Remembers the last version
 * the player opened it on, so a new release can show a NEW badge.
 */
import { CHANGELOG, VERSION } from './changelog';

const SEEN_KEY = 'exo.seenVersion';

export function hasUnseen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== VERSION; } catch { return false; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openWhatsNew(onClose?: () => void) {
  if (document.getElementById('whatsnew')) return;
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN_KEY); localStorage.setItem(SEEN_KEY, VERSION); } catch { /* private mode */ }
  const seenAt = seen ? CHANGELOG.findIndex((r) => r.version === seen) : -1;
  const el = document.createElement('div');
  el.id = 'whatsnew';
  el.innerHTML = `
    <div class="wn-panel" role="dialog" aria-label="What's new">
      <div class="wn-head"><b>WHAT'S NEW</b><span>v${esc(VERSION)}</span><button class="wn-x" aria-label="Close">✕</button></div>
      <div class="wn-list">${CHANGELOG.map((r, i) => `
        <section class="${seen && (seenAt < 0 || i < seenAt) ? 'new' : ''}">
          <h3><span class="v">v${esc(r.version)}</span> ${esc(r.title)}<small>${esc(r.date)}</small></h3>
          <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </section>`).join('')}
      </div>
    </div>`;
  const close = () => { el.remove(); removeEventListener('keydown', key); onClose?.(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.querySelector<HTMLButtonElement>('.wn-x')!.onclick = close;
  addEventListener('keydown', key);
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('.wn-x')!.focus({ preventScroll: true });
}
