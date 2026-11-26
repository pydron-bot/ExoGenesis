/**
 * Whole-content editor pages and the pure helpers behind them:
 *   - `renameRefs`: rewrite every reference to a record when it gets a new id
 *   - `renderProblems`: everything `npm run content:check` would complain about
 *   - `renderCompare`: two records of a collection side by side
 *   - `collectText` / `textChecks` / `renderText`: every player-facing string in
 *     one place, editable, with the browser's spell check and a few style checks
 * DOM helpers only; main.ts owns state and the API.
 */
import { COLLECTIONS, pathOf, type Collection, type CollectionName } from '../content/defs';
import type { Field, Shape } from '../content/schema';
import { h } from './dom';

const link = (text: string, go: () => void, cls = 'fl-link') => {
  const a = h('a', cls, text);
  a.href = '#';
  a.onclick = (e) => { e.preventDefault(); go(); };
  return a;
};
const singular = (coll: CollectionName) => COLLECTIONS[coll].label.replace(/ies$/, 'y').replace(/s$/, '').toLowerCase();

export interface Rec { coll: CollectionName; id: string; title: string; data: unknown }

// ---------- paths into a record: "choices[1].reply" ----------
const STEP_RE = /([^.[\]]+)|\[(\d+)\]/g;
const steps = (path: string) => [...path.matchAll(STEP_RE)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));

export function getAt(data: unknown, path: string): unknown {
  let v = data;
  for (const s of steps(path)) v = v && typeof v === 'object' ? (v as Record<string | number, unknown>)[s] : undefined;
  return v;
}
export function setAt(data: Record<string, unknown>, path: string, value: unknown) {
  const st = steps(path);
  let o: Record<string | number, unknown> = data;
  for (const s of st.slice(0, -1)) o = o[s] as Record<string | number, unknown>;
  const last = st[st.length - 1];
  if (value === undefined) delete o[last]; else o[last] = value;
}

// ---------- rename ----------
/**
 * Point every `ref` to `toColl`/`from` (lists too) at `to` instead. Returns a
 * changed copy of each record that referred to it; the inputs aren't touched.
 */
export function renameRefs(all: Rec[], toColl: CollectionName, from: string, to: string): Rec[] {
  const out: Rec[] = [];
  const walk = (shape: Shape, d: unknown): boolean => {
    if (!d || typeof d !== 'object') return false;
    const rec = d as Record<string, unknown>;
    let hit = false;
    for (const [k, f] of Object.entries(shape) as [string, Field][]) {
      if (f.kind === 'ref' && f.to === toColl && rec[k] === from) { rec[k] = to; hit = true; }
      else if (f.kind === 'list' && Array.isArray(rec[k])) for (const item of rec[k] as unknown[]) if (walk(f.of, item)) hit = true;
    }
    return hit;
  };
  for (const r of all) {
    if (r.coll === toColl && r.id === from) continue;
    const copy = structuredClone(r.data);
    if (walk(COLLECTIONS[r.coll].shape, copy)) out.push({ ...r, data: copy });
  }
  return out;
}

// ---------- problems ----------
export interface PathIssue { path: string; field: string; msg: string }

/** Every content problem, grouped by file. `open(path, field)` opens the record (and the field). */
export function renderProblems(main: HTMLElement, aside: HTMLElement, issues: PathIssue[], title: (path: string) => string, open: (path: string) => void) {
  const by = new Map<string, PathIssue[]>();
  for (const i of issues) by.set(i.path, [...(by.get(i.path) ?? []), i]);
  const body = h('div', 'problems');
  if (!issues.length) body.append(h('p', 'note', 'No problems: the game will load this content, and npm run content:check passes.'));
  for (const [path, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    body.append(h('div', 'pb-file',
      h('div', 'pb-head', link(title(path), () => open(path)), h('small', 'path', ` content/${path}`)),
      ...list.map((i) => h('div', 'issue', i.field ? h('code', '', i.field) : null, i.field ? ': ' : '', i.msg))));
  }
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Problems'), h('div', 'path', `${issues.length} problem${issues.length === 1 ? '' : 's'} in ${by.size} file${by.size === 1 ? '' : 's'}: the same checks as npm run content:check and the game's loader, on saved content.`))),
    body,
  );
  aside.replaceChildren(h('div', 'group', 'About'), h('div', 'help-block',
    'The game refuses to start while any of these remain, and lists them instead. Records with a problem are red in the list on the left; open one to see each problem next to its field. Unsaved edits count once saved.'));
}

// ---------- compare ----------
const show = (f: Field, v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (f.kind === 'grid') return Array.isArray(v) ? `${v.length} rows` : '?';
  if (f.kind === 'list') return Array.isArray(v) ? (v.length ? `${v.length}: ${v.map((x) => Object.values(x as object).filter((y) => typeof y !== 'object').slice(0, 3).join(' ')).join(' · ')}` : 'none') : '?';
  if (f.kind === 'bool') return v ? 'yes' : 'no';
  return String(v);
};

/**
 * Two records of one collection side by side: every field, differences marked,
 * numbers with the change from A to B. `pick` swaps in another record.
 */
export function renderCompare(main: HTMLElement, aside: HTMLElement, o: {
  coll: CollectionName; a: string; b: string; ids: string[]; data: (id: string) => unknown; title: (id: string) => string;
  open: (id: string) => void; pick: (a: string, b: string) => void;
}) {
  const shape = COLLECTIONS[o.coll].shape as Shape;
  const A = (o.data(o.a) ?? {}) as Record<string, unknown>, B = (o.data(o.b) ?? {}) as Record<string, unknown>;
  const chooser = (cur: string, set: (id: string) => void) => {
    const s = h('select', 'cmp-pick');
    for (const id of o.ids) s.append(Object.assign(h('option', '', `${o.title(id)} (${id})`), { value: id }));
    s.value = cur;
    s.onchange = () => set(s.value);
    return s;
  };
  const t = h('table', 'bal cmp');
  t.append(h('tr', '', h('th', '', 'Field'),
    h('th', '', chooser(o.a, (id) => o.pick(id, o.b)), ' ', link('open', () => o.open(o.a))),
    h('th', '', chooser(o.b, (id) => o.pick(o.a, id)), ' ', link('open', () => o.open(o.b))),
    h('th', '', 'B − A')));
  let diffs = 0;
  const onlyDiff = (main.dataset.only ?? '') === '1';
  for (const [k, f] of Object.entries(shape)) {
    const va = A[k], vb = B[k];
    const same = JSON.stringify(va) === JSON.stringify(vb);
    if (!same) diffs++;
    if (same && onlyDiff) continue;
    let delta = '';
    if (typeof va === 'number' && typeof vb === 'number' && va !== vb) {
      const d = vb - va;
      delta = `${d > 0 ? '+' : ''}${+d.toFixed(3)}${va ? ` (${d > 0 ? '+' : ''}${Math.round((d / Math.abs(va)) * 100)}%)` : ''}`;
    }
    const tr = h('tr', same ? '' : 'diff', h('td', '', f.label ?? k, f.kind === 'num' && f.unit ? h('small', 'dim', ` ${f.unit}`) : null),
      h('td', typeof va === 'number' ? 'num' : '', show(f, va)), h('td', typeof vb === 'number' ? 'num' : '', show(f, vb)), h('td', 'num', delta));
    t.append(tr);
  }
  const only = h('label', 'cmp-only', h('input', ''), ' Only differences');
  const box = only.querySelector('input')!;
  box.type = 'checkbox';
  box.checked = onlyDiff;
  box.onchange = () => { main.dataset.only = box.checked ? '1' : ''; renderCompare(main, aside, o); };
  const swap = h('button', '', '⇄ Swap');
  swap.onclick = () => o.pick(o.b, o.a);
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', `Compare ${COLLECTIONS[o.coll].label.toLowerCase()}`), h('div', 'path', `${o.title(o.a)} and ${o.title(o.b)}: ${diffs} field${diffs === 1 ? '' : 's'} differ. Saved values.`)), h('div', 'actions', only, swap)),
    h('div', 'bal-wrap', t),
  );
  aside.replaceChildren(h('div', 'group', 'Compare'), h('div', 'help-block',
    `Pick any two ${COLLECTIONS[o.coll].label.toLowerCase()} at the top of the columns. Changed rows are highlighted; B − A shows how far B is from A, and by what share of A.`));
}

// ---------- text pass ----------
export interface TextEntry { coll: CollectionName; id: string; title: string; field: string; label: string; text: string; multiline: boolean }

/** String fields that are ids, flags or editor notes rather than words a player reads. */
const NOT_TEXT = new Set(['id', 'flag', 'unless', 'site', 'file', 'source', 'credit', 'notes', 'summary', 'tags', 'counter', 'timer', 'who', 'doneFlag']);
/** Lists that are editor-only (writers' comments). */
const NOT_TEXT_LISTS = new Set(['comments']);

/** Every string a player reads, in content order. Regions' and assets' text is editor-only. */
export function collectText(all: Rec[]): TextEntry[] {
  const out: TextEntry[] = [];
  const walk = (r: Rec, shape: Shape, d: unknown, prefix: string, labelPrefix: string) => {
    if (!d || typeof d !== 'object') return;
    const rec = d as Record<string, unknown>;
    for (const [k, f] of Object.entries(shape) as [string, Field][]) {
      const v = rec[k];
      if (f.kind === 'str' && typeof v === 'string' && v.trim() && !NOT_TEXT.has(k)) {
        out.push({ coll: r.coll, id: r.id, title: r.title, field: `${prefix}${k}`, label: `${labelPrefix}${f.label ?? k}`, text: v, multiline: !!f.multiline });
      } else if (f.kind === 'list' && Array.isArray(v) && !NOT_TEXT_LISTS.has(k)) {
        v.forEach((item, n) => walk(r, f.of, item, `${prefix}${k}[${n}].`, `${labelPrefix}${(f.label ?? k).replace(/ies$/, 'y').replace(/s$/, '')} ${n + 1} · `));
      }
    }
  };
  for (const r of all) if (r.coll !== 'regions' && r.coll !== 'assets') walk(r, COLLECTIONS[r.coll].shape as Shape, r.data, '', '');
  return out;
}

/** Style checks a spell checker won't make. Each returns a short note. */
export function textChecks(text: string, multiline: boolean): string[] {
  const out: string[] = [];
  if (/ {2,}/.test(text)) out.push('double space');
  if (text !== text.trim()) out.push('space at the start or end');
  const rep = text.match(/\b(\w+)\s+\1\b/i);
  if (rep && !/^(that|had|is)$/i.test(rep[1])) out.push(`repeated word "${rep[1]}"`);
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  if (count(/"/g) % 2) out.push('unmatched "');
  if (count(/“/g) !== count(/”/g)) out.push('unmatched “ ”');
  if (count(/\(/g) !== count(/\)/g)) out.push('unmatched ( )');
  if (/"/.test(text) && /[“”]/.test(text)) out.push('mixes straight and curly quotes');
  if (/[.!?] +[a-z]/.test(text.replace(/\b(e\.g|i\.e|etc|vs)\. /g, ''))) out.push('sentence starts lower-case');
  if (multiline && text.split(/\s+/).length > 3 && !/[.!?…"”’)]$/.test(text.trim())) out.push('no full stop at the end');
  if (text.length > 420) out.push(`long (${text.length} characters): may not fit a card`);
  if (/\b(teh|recieve|seperate|occured|untill|wich|thier)\b/i.test(text)) out.push('common misspelling');
  return out;
}

/** Ordinary words that start a quoted sentence often enough to clutter the names list. */
const COMMON = new Set(['The', 'They', 'Their', 'There', 'These', 'This', 'That', 'Those', 'It', 'Its', 'You', 'Your', 'We', 'Our', 'He', 'She', 'His', 'Her', 'No', 'Yes', 'Not', 'Thank', 'What', 'When', 'Where', 'Why', 'How', 'Who', 'And', 'But', 'If', 'In', 'On', 'At', 'A', 'An', 'Some', 'All', 'One', 'Do', 'Don\'t', 'I']);

/** Capitalised words that aren't at the start of a sentence: names, to check they're spelled the same everywhere. */
export function namesIn(entries: TextEntry[]): Map<string, number> {
  const names = new Map<string, number>();
  for (const e of entries) {
    for (const m of e.text.matchAll(/(?<![.!?:"“]\s|^)\b([A-Z][a-zà-ÿ]+(?:[-'][A-Z]?[a-z]+)?)\b/g)) {
      if (m.index === 0 || COMMON.has(m[1])) continue;
      names.set(m[1], (names.get(m[1]) ?? 0) + 1);
    }
  }
  return names;
}

export interface TextHost {
  entries: TextEntry[];
  open(coll: CollectionName, id: string): void;
  /** Write one string back to its record (saves the file). */
  save(e: TextEntry, text: string): Promise<boolean>;
}

/**
 * Every player-facing string, grouped by record, each in a box with the browser's
 * (British English) spell check. Edits save when the box loses focus.
 */
export function renderText(main: HTMLElement, aside: HTMLElement, host: TextHost, state: { q: string; warnOnly: boolean }) {
  const list = h('div', 'tx-list');
  const filter = h('input', 'tx-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter: words, a record or a field…';
  filter.value = state.q;
  const warn = h('label', 'cmp-only', h('input', ''), ' Only with notes');
  const wbox = warn.querySelector('input')!;
  wbox.type = 'checkbox';
  wbox.checked = state.warnOnly;
  let shown = 0, noted = 0, words = 0;
  const draw = () => {
    list.replaceChildren();
    shown = noted = 0;
    const q = state.q.trim().toLowerCase();
    let last = '';
    for (const e of host.entries) {
      const notes = textChecks(e.text, e.multiline);
      if (notes.length) noted++;
      if (state.warnOnly && !notes.length) continue;
      if (q && !`${e.title} ${e.id} ${e.label} ${e.text}`.toLowerCase().includes(q)) continue;
      shown++;
      const key = `${e.coll}/${e.id}`;
      if (key !== last) {
        last = key;
        list.append(h('div', 'tx-rec', link(e.title, () => host.open(e.coll, e.id)), h('small', 'dim', ` ${singular(e.coll)} · ${e.id}`)));
      }
      const box = h('textarea', 'tx-box') as HTMLTextAreaElement;
      box.value = e.text;
      box.spellcheck = true;
      box.lang = 'en-GB';
      box.rows = Math.min(8, Math.max(1, Math.ceil(e.text.length / 90) + (e.text.match(/\n/g)?.length ?? 0)));
      const noteEl = h('div', 'tx-notes', notes.join(' · '));
      box.oninput = () => { noteEl.textContent = textChecks(box.value, e.multiline).join(' · '); box.classList.toggle('edited', box.value !== e.text); };
      box.onblur = async () => {
        if (box.value === e.text) return;
        if (await host.save(e, box.value)) { e.text = box.value; box.classList.remove('edited'); box.classList.add('saved'); }
      };
      list.append(h('div', `tx-row${notes.length ? ' noted' : ''}`, h('div', 'tx-label', e.label), box, noteEl));
    }
    if (!shown) list.append(h('p', 'note', 'Nothing matches.'));
    sum.textContent = `${host.entries.length} strings, ${words.toLocaleString()} words; ${noted} with notes. Showing ${shown}.`;
  };
  const sum = h('div', 'path');
  words = host.entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
  filter.oninput = () => { state.q = filter.value; draw(); };
  wbox.onchange = () => { state.warnOnly = wbox.checked; draw(); };
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Text'), sum)),
    h('div', 'tx-bar', filter, warn),
    list,
  );
  draw();
  const names = [...namesIn(host.entries)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const nameEls = names.map(([n, c]) => {
    const b = h('button', 'tx-name', n, h('small', '', ` ${c}`));
    b.onclick = () => { state.q = n; filter.value = n; draw(); };
    return b;
  });
  aside.replaceChildren(
    h('div', 'group', 'Text pass'),
    h('div', 'help-block', 'Every word a player reads from content: cards, choices, replies, missions, objectives, names and descriptions. Misspellings are underlined by your browser (British English). Edit in place: a box saves when you click away. Notes flag double spaces, unmatched quotes, repeated words and the like.'),
    h('div', 'group', 'Names and capitalised words'),
    h('div', 'help-block', 'Click one to see where it is used. A name spelled two ways shows up twice.'),
    h('div', 'tx-names', ...nameEls),
  );
}

/** Which record file a text entry lives in. */
export const textPath = (e: TextEntry) => pathOf(e.coll, e.id);

// ---------- since the last release ----------
export interface FieldChange { label: string; before: string; after: string }
export interface RecordChange { coll: CollectionName; id: string; title: string; status: 'added' | 'removed' | 'changed'; fields: FieldChange[] }

const brief = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string') return v.length > 70 ? `“${v.slice(0, 67)}…”` : typeof v === 'string' && /\s/.test(v) ? `“${v}”` : v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
};

/** Field-by-field changes of one record's shape (lists item by item; grids by changed rows). */
function fieldChanges(shape: Shape, a: Record<string, unknown>, b: Record<string, unknown>, prefix = ''): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [k, f] of Object.entries(shape) as [string, Field][]) {
    const va = a?.[k], vb = b?.[k];
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    const label = `${prefix}${f.label ?? k}`;
    if (f.kind === 'grid') {
      const ra = Array.isArray(va) ? va : [], rb = Array.isArray(vb) ? vb : [];
      const rows = Math.max(ra.length, rb.length);
      let n = 0;
      for (let i = 0; i < rows; i++) if (ra[i] !== rb[i]) n++;
      out.push({ label, before: ra.length ? 'painted' : '—', after: rb.length ? `${n} row${n === 1 ? '' : 's'} changed` : 'cleared' });
    } else if (f.kind === 'list') {
      const la = Array.isArray(va) ? va : [], lb = Array.isArray(vb) ? vb : [];
      const one = (f.label ?? k).replace(/ies$/, 'y').replace(/s$/, '');
      if (la.length !== lb.length) out.push({ label: `${label}: count`, before: String(la.length), after: String(lb.length) });
      for (let i = 0; i < Math.min(la.length, lb.length); i++) out.push(...fieldChanges(f.of, la[i], lb[i], `${prefix}${one} ${i + 1} · `));
      for (let i = la.length; i < lb.length; i++) out.push({ label: `${prefix}${one} ${i + 1}`, before: '—', after: 'added' });
      for (let i = lb.length; i < la.length; i++) out.push({ label: `${prefix}${one} ${i + 1}`, before: 'was there', after: 'removed' });
    } else out.push({ label, before: brief(va), after: brief(vb) });
  }
  return out;
}

/** What changed between two content sets (path → parsed JSON). */
export function diffContent(before: Record<string, unknown>, after: Record<string, unknown>, locateFn: (p: string) => { coll: CollectionName; id: string } | null): RecordChange[] {
  const out: RecordChange[] = [];
  const titleOf = (coll: CollectionName, id: string, d: unknown) => {
    const t = (COLLECTIONS[coll] as Collection).title;
    const v = t && d && typeof d === 'object' ? (d as Record<string, unknown>)[t] : undefined;
    return typeof v === 'string' && v ? v : COLLECTIONS[coll].kind === 'single' ? COLLECTIONS[coll].label : id;
  };
  for (const p of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const at = locateFn(p);
    if (!at) continue;
    const a = before[p], b = after[p];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const title = titleOf(at.coll, at.id, b ?? a);
    if (a === undefined) out.push({ ...at, title, status: 'added', fields: [] });
    else if (b === undefined) out.push({ ...at, title, status: 'removed', fields: [] });
    else {
      const fields = fieldChanges(COLLECTIONS[at.coll].shape as Shape, a as Record<string, unknown>, b as Record<string, unknown>);
      if (fields.length) out.push({ ...at, title, status: 'changed', fields });
    }
  }
  return out;
}

/** A first draft of release notes from the changes (to be rewritten for players). */
export function notesDraft(changes: RecordChange[]): string {
  return changes.map((c) => {
    const what = `${c.title} (${singular(c.coll)})`;
    if (c.status !== 'changed') return `- ${c.status === 'added' ? 'New' : 'Removed'}: ${what}`;
    const nums = c.fields.filter((f) => /^-?[\d.]+$/.test(f.before) && /^-?[\d.]+$/.test(f.after));
    const rest = c.fields.length - nums.length;
    return `- ${what}: ${[...nums.map((f) => `${f.label.toLowerCase()} ${f.before} → ${f.after}`), rest ? `${rest} other change${rest > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}`;
  }).join('\n');
}

const GROUP_ORDER = ['Rules', 'Game data', 'Story', 'Maps', 'Assets'];

export function renderChanges(main: HTMLElement, aside: HTMLElement, o: { version: string; commit: string; date: string; message: string; changes: RecordChange[]; current: string; open: (coll: CollectionName, id: string) => void }) {
  const body = h('div', 'chg');
  const groups = new Map<string, RecordChange[]>();
  for (const c of o.changes) { const g = COLLECTIONS[c.coll].group; groups.set(g, [...(groups.get(g) ?? []), c]); }
  if (!o.changes.length) body.append(h('p', 'note', 'Nothing has changed in content since then.'));
  for (const g of [...groups.keys()].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))) {
    body.append(h('h2', 'bal-h', g));
    for (const c of groups.get(g)!) {
      const box = h('div', 'rv-file', h('div', 'rv-head', c.status === 'removed' ? h('span', '', c.title) : link(c.title, () => o.open(c.coll, c.id)), h('small', 'dim', ` ${singular(c.coll)} · ${c.id}`), h('span', `rv-tag ${c.status === 'added' ? 'new' : c.status === 'removed' ? 'deleted' : 'changed'}`, c.status === 'added' ? 'new' : c.status)));
      if (c.fields.length) {
        const t = h('table', 'chg-t');
        for (const f of c.fields) t.append(h('tr', '', h('td', '', f.label), h('td', 'was', f.before), h('td', '', '→'), h('td', 'now', f.after)));
        box.append(t);
      }
      body.append(box);
    }
  }
  const since = o.version ? `v${o.version}` : `the deployed build`;
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', `Since ${since}`), h('div', 'path', `${o.changes.length} record${o.changes.length === 1 ? '' : 's'} changed since ${o.commit}${o.date ? ` (${o.date})` : ''}: ${o.message}. Saved content, committed or not.`))),
    body,
  );
  const draft = h('textarea', 'chg-notes') as HTMLTextAreaElement;
  draft.value = notesDraft(o.changes);
  draft.rows = 14;
  draft.readOnly = true;
  draft.placeholder = 'Nothing yet.';
  const copy = h('button', '', 'Copy');
  copy.onclick = () => { draft.select(); void navigator.clipboard?.writeText(draft.value); };
  aside.replaceChildren(
    h('div', 'group', 'Release notes'),
    h('div', 'help-block', `Every push that changes the game is a release: package.json goes from ${o.current} and src/changelog.ts gets an entry. Here is what content changed, as a starting point; write the notes for players (what they will notice), not as a list of numbers.`),
    h('div', 'help-block', draft, copy),
  );
}
