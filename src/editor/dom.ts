/** The editor's element builder: `h('div', 'cls', child, 'text', cond && child)` (null/false/undefined children skipped). */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null | false | undefined)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null && k !== false && k !== undefined) el.append(k);
  return el;
};
