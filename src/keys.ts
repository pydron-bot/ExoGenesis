/**
 * Key bindings the player can change (Controls → tap a key). The camera keys (W A S D Q E, arrows), the number keys
 * (views, groups, the build menu), zoom (+ −), Esc and Ctrl shortcuts stay fixed: they're read by physical position
 * or are standard. Bindings are single keys, kept in localStorage.
 */
export const ACTIONS = {
  build: { label: 'Build menu', key: 'b' },
  repeat: { label: 'Place another of the last building', key: 'v' },
  rotate: { label: 'Rotate while placing', key: 'r' },
  stop: { label: 'Selected units stop and guard', key: 'x' },
  ability: { label: 'Selected units use their ability', key: 'g' },
  centre: { label: 'Look at the selection', key: 'f' },
  idle: { label: 'Next idle worker drone', key: '.' },
  alert: { label: 'Look at the latest alert', key: 'h' },
  history: { label: 'Message log', key: 'l' },
  pause: { label: 'Pause', key: ' ' },
  slower: { label: 'Slower', key: '[' },
  faster: { label: 'Faster', key: ']' },
  controls: { label: 'Controls (this list)', key: '?' },
} as const;
export type Action = keyof typeof ACTIONS;

const KEY = 'exo.keys';
/** Keys that can't be bound: the fixed ones above. */
const FIXED = new Set(['w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_', 'escape', 'home', 'tab', 'enter', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

let custom: Partial<Record<Action, string>> = {};
try { custom = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* private mode */ }

const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k.toLowerCase());

/** The key bound to `a` now. */
export function keyFor(a: Action): string { return custom[a] ?? ACTIONS[a].key; }

/** How a key reads on screen: "Space", "B", "[". */
export function keyLabel(k: string): string { return k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1); }

/** The action this key press does, if any (no modifiers but Shift). */
export function actionOf(e: KeyboardEvent): Action | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = norm(e.key);
  for (const a of Object.keys(ACTIONS) as Action[]) if (keyFor(a) === k) return a;
  return null;
}

/** Bind `a` to key `k`. An action already on `k` swaps to `a`'s old key. Null if `k` can't be bound (why). */
export function rebind(a: Action, k: string): string | null {
  k = norm(k);
  if (FIXED.has(k) || k.startsWith('arrow') || k.length > 1 && k !== ' ') return `${keyLabel(k)} can't be changed: it's a camera, view or menu key`;
  const old = keyFor(a);
  for (const b of Object.keys(ACTIONS) as Action[]) if (b !== a && keyFor(b) === k) setKey(b, old);
  setKey(a, k);
  return null;
}

function setKey(a: Action, k: string) {
  if (k === ACTIONS[a].key) delete custom[a]; else custom[a] = k;
  try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* private mode */ }
}

/** Every key back to its default. */
export function resetKeys() {
  custom = {};
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
