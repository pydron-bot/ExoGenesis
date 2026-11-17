/**
 * The HUD's look from content (content/rules/interface.json, editor: Rules →
 * Interface): colours, panel and outline opacity, size. Set as CSS variables
 * on <html>; style.css mixes every tint of them it needs (color-mix), so one
 * accent colour changes every cyan on the HUD.
 */
import type { InterfaceDef } from './content/defs';

/** Opacities style.css was designed at: panels and outlines scale from these. */
const PANEL0 = 0.72, LINE0 = 0.28;

export function applyInterface(d: InterfaceDef, root: HTMLElement = document.documentElement) {
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set('--cyan', d.accent);
  set('--amber', d.warning);
  set('--crimson', d.danger);
  set('--text', d.text);
  set('--panel-base', d.panel);
  set('--panel-k', String(d.panelOpacity / PANEL0));
  set('--line-k', String(d.lineOpacity / LINE0));
  set('--ui-scale', String(d.scale));
}
