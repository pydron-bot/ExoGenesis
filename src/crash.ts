/**
 * When something breaks after loading: the player sees it and can do something about it, instead of a game that
 * silently stops.
 *
 * - The simulation stopped (an error in the sim worker, src/sim/worker.ts): a card with Reload (back to the last
 *   autosave), Copy details (to send in) and Keep watching.
 * - An error on the main thread (rendering, the HUD): the game usually carries on, so only a small note at the top,
 *   once, with Copy details.
 */
import { VERSION } from './version';

export interface CrashInfo {
  /** Where: 'sim' (the simulation stopped) or 'page' (main thread; the game may carry on). */
  where: 'sim' | 'page';
  message: string;
  stack?: string;
  tick?: number;
}

let shown = false;
let noted = false;

/** The text Copy details puts on the clipboard. */
export function crashReport(c: CrashInfo): string {
  return [
    `Exo Genesis v${VERSION} · ${c.where === 'sim' ? 'simulation' : 'page'} error${c.tick !== undefined ? ` at tick ${c.tick}` : ''}`,
    `${location.pathname}${location.search}`,
    navigator.userAgent,
    '',
    c.message,
    c.stack ?? '',
  ].join('\n').trim();
}

async function copy(text: string, btn: HTMLButtonElement) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch {
    // no clipboard (http, old browser): select it in a box instead
    const ta = document.createElement('textarea');
    ta.value = text; ta.className = 'cr-text'; ta.readOnly = true;
    btn.closest('.cr-panel, #crash-note')?.appendChild(ta);
    ta.select();
    btn.textContent = 'Select and copy';
  }
}

/** The address the game reloads to: resume from the autosave, without the title or test flags that start over. */
export function reloadUrl(): string {
  const u = new URL(location.href);
  for (const k of ['new', 'intro', 'story', 'mission', 'cinematic', 'travel', 'land']) u.searchParams.delete(k);
  u.searchParams.set('title', '0');
  return u.toString();
}

/** The simulation stopped: a card over the game. */
export function showSimCrash(c: CrashInfo, opts: { canResume: boolean } = { canResume: true }) {
  if (shown) return;
  shown = true;
  console.error('simulation stopped', c.message, c.stack);
  const el = document.createElement('div');
  el.id = 'crash';
  el.innerHTML = `
    <div class="cr-panel" role="alertdialog" aria-labelledby="cr-h" aria-describedby="cr-p">
      <h2 id="cr-h">THE SIMULATION STOPPED</h2>
      <p id="cr-p">Something went wrong and the game can't go on from here. ${opts.canResume ? 'Your colony was autosaved in the last few seconds: <b>Reload</b> picks it up from there.' : '<b>Reload</b> starts this game again.'}</p>
      <p class="cr-msg"></p>
      <div class="cr-btns">
        <button class="cr-reload">Reload</button>
        <button class="cr-copy">Copy details</button>
        <button class="cr-stay">Keep watching</button>
      </div>
      <p class="cr-hint">Copy details and send them in, so it can be fixed.</p>
    </div>`;
  el.querySelector('.cr-msg')!.textContent = c.message;
  el.querySelector<HTMLButtonElement>('.cr-reload')!.onclick = () => { location.href = reloadUrl(); };
  const cp = el.querySelector<HTMLButtonElement>('.cr-copy')!;
  cp.onclick = () => void copy(crashReport(c), cp);
  el.querySelector<HTMLButtonElement>('.cr-stay')!.onclick = () => el.remove();
  document.body.appendChild(el);
  el.querySelector<HTMLButtonElement>('.cr-reload')!.focus({ preventScroll: true });
}

/** An error on the main thread: a small note, once a session. */
export function notePageError(c: CrashInfo) {
  if (noted || shown) return;
  noted = true;
  const el = document.createElement('div');
  el.id = 'crash-note';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Something went wrong (the game may carry on).</span><button class="cr-copy">Copy details</button><button class="cr-x" aria-label="Dismiss">✕</button>`;
  const cp = el.querySelector<HTMLButtonElement>('.cr-copy')!;
  cp.onclick = () => void copy(crashReport(c), cp);
  el.querySelector<HTMLButtonElement>('.cr-x')!.onclick = () => el.remove();
  document.body.appendChild(el);
}

/** Once the game has loaded: uncaught errors and rejections on the page get the note. */
export function watchPageErrors() {
  addEventListener('error', (e) => {
    if (!document.body.classList.contains('loaded')) return; // the loader reports its own
    // resource load failures (an image, a sound) come through here too, with no error object: not a crash
    if (!(e as ErrorEvent).error) return;
    notePageError({ where: 'page', message: e.message, stack: (e as ErrorEvent).error?.stack });
  });
  addEventListener('unhandledrejection', (e) => {
    if (!document.body.classList.contains('loaded')) return;
    const r = e.reason as { message?: string; stack?: string } | undefined;
    // a failed fetch or audio decode is noise, not a crash
    if (r && /fetch|network|decode|abort/i.test(String(r.message ?? r))) return;
    notePageError({ where: 'page', message: String(r?.message ?? r), stack: r?.stack });
  });
}
