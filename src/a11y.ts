/**
 * The player's own readability and comfort settings (Options → Accessibility), on top of the interface the content
 * sets (src/ui-theme.ts):
 * - Interface size: scales the HUD and panels (`--ui-player`, multiplied with the content's `--ui-scale`).
 * - Reduce motion: no camera shake, zoom blur or scrambled text, and CSS animations cut short (`html.reduce-motion`);
 *   follows the device's own setting until the player picks.
 * - Colour-blind palette: the accent, warning and danger colours, and the placement ghost's green/red, from the
 *   Okabe–Ito set (told apart with any common colour vision). Team colours come from the setup and stay as they are.
 */
const SIZE_KEY = 'exo.uiSize', MOTION_KEY = 'exo.reduceMotion', CB_KEY = 'exo.colourBlind';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

/** 0.8 … 1.5 (1 = as designed). */
export let uiSize = Math.min(1.5, Math.max(0.8, Number(get(SIZE_KEY)) || 1));
/** The player's choice, or null to follow the device. */
let motionPick: boolean | null = get(MOTION_KEY) === null ? null : get(MOTION_KEY) === '1';
export let colourBlind = get(CB_KEY) === '1';

const osReduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Reduce motion in effect now. */
export const reduceMotion = () => motionPick ?? osReduce();
/** Whether the player picked (false: it's following the device). */
export const motionChosen = () => motionPick !== null;

/** Colours for the placement ghost (src/world/region.ts reads these). */
export const ghostColours = () => (colourBlind ? { ok: '#56b4e9', bad: '#e69f00' } : { ok: '#5bff9a', bad: '#ff5a4a' });

const listeners: (() => void)[] = [];
/** Called after any of these changes (the region repaints its ghost colours). */
export function onA11yChange(f: () => void) { listeners.push(f); }

export function applyA11y(root: HTMLElement = document.documentElement) {
  root.style.setProperty('--ui-player', String(uiSize));
  root.classList.toggle('reduce-motion', reduceMotion());
  root.classList.toggle('cb', colourBlind);
  if (colourBlind) {
    root.style.setProperty('--cyan', '#56b4e9');
    root.style.setProperty('--amber', '#f0e442');
    root.style.setProperty('--crimson', '#e69f00');
  }
  for (const f of listeners) f();
}

export function setUiSize(v: number) { uiSize = Math.min(1.5, Math.max(0.8, v)); put(SIZE_KEY, uiSize === 1 ? null : String(uiSize)); applyA11y(); }
export function setReduceMotion(v: boolean) { motionPick = v; put(MOTION_KEY, v ? '1' : '0'); applyA11y(); }
/** Colour-blind palette on or off. Off needs the content's colours put back: `restore` re-applies them. */
export function setColourBlind(v: boolean, restore: () => void) { colourBlind = v; put(CB_KEY, v ? '1' : null); if (!v) restore(); applyA11y(); }
