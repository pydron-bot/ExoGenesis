/**
 * Editor tools that work across the whole content set:
 *   - `refsTo`: every record that points at a record (any `ref` field, lists too)
 *   - `lineDiff` + `renderReview`: what each uncommitted file changes, before Commit
 *   - `renderBalance`: units and buildings side by side, sortable, with derived
 *     numbers (damage per second, per alloy)
 *   - `searchContent`: which records mention a word (names, ids, any text)
 * DOM helpers only; main.ts owns state and the API.
 */
import { COLLECTIONS, type BuildingDef, type CollectionName, type UnitDef } from '../content/defs';
import type { Field, Shape } from '../content/schema';
import { h } from './dom';


export interface RecordRef { coll: CollectionName; id: string; field: string }

/** Every place a record of `toColl` with id `id` is referred to, across all content. */
export function refsTo(all: { coll: CollectionName; id: string; data: unknown }[], toColl: string, id: string): RecordRef[] {
  const out: RecordRef[] = [];
  const walk = (shape: Shape, d: unknown, at: { coll: CollectionName; id: string }, prefix: string) => {
    if (!d || typeof d !== 'object') return;
    const rec = d as Record<string, unknown>;
    for (const [k, f] of Object.entries(shape) as [string, Field][]) {
      const v = rec[k];
      if (f.kind === 'ref' && f.to === toColl && v === id) out.push({ ...at, field: prefix + (f.label ?? k) });
      else if (f.kind === 'list' && Array.isArray(v)) v.forEach((item, n) => walk(f.of, item, at, `${prefix}${f.label ?? k} ${n + 1} · `));
    }
  };
  for (const r of all) walk(COLLECTIONS[r.coll].shape, r.data, r, '');
  return out;
}

// ---------- diff ----------
export type DiffOp = { op: ' ' | '+' | '-'; line: string };

/** Line diff (LCS). Fine for content files, which are a few hundred lines at most. */
export function lineDiff(a: string, b: string): DiffOp[] {
  const A = a.split('\n'), B = b.split('\n');
  // trim the shared head and tail first: most edits touch a few lines
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const n = a2.length, m = b2.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a2[i] === b2[j]) { mid.push({ op: ' ', line: a2[i] }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { mid.push({ op: '+', line: b2[j] }); j++; }
    else { mid.push({ op: '-', line: a2[i] }); i++; }
  }
  return [...A.slice(0, s).map((line) => ({ op: ' ' as const, line })), ...mid, ...A.slice(A.length - e).map((line) => ({ op: ' ' as const, line }))];
}

export interface ReviewFile { status: string; path: string; before: string | null; after: string | null; binary?: boolean }

/** The Review page: each uncommitted file and its diff (3 lines of context; long grid rows shortened). */
export function renderReview(main: HTMLElement, files: ReviewFile[], open: (path: string) => void) {
  const body = h('div', 'review');
  if (!files.length) body.append(h('p', 'note', 'Nothing to commit: every change is committed.'));
  for (const f of files) {
    const label = f.status === 'D' || f.after === null ? 'deleted' : f.status === 'A' || f.status === '??' || f.before === null ? 'new' : 'changed';
    const name = h('a', 'fl-link', f.path);
    name.href = '#';
    name.onclick = (e) => { e.preventDefault(); open(f.path); };
    const box = h('div', 'rv-file', h('div', 'rv-head', name, h('span', `rv-tag ${label}`, label)));
    if (f.binary) box.append(h('div', 'note', 'Media file (binary): not shown.'));
    else {
      const ops = lineDiff(f.before ?? '', f.after ?? '');
      const changed = ops.map((o, i) => (o.op !== ' ' ? i : -1)).filter((i) => i >= 0);
      const keep = new Set<number>();
      for (const i of changed) for (let k = i - 3; k <= i + 3; k++) keep.add(k);
      const pre = h('pre', 'rv-diff');
      let gap = false;
      ops.forEach((o, i) => {
        if (!keep.has(i)) { if (!gap) pre.append(h('div', 'rv-gap', '⋯')); gap = true; return; }
        gap = false;
        const line = o.line.length > 160 ? `${o.line.slice(0, 157)}…` : o.line;
        pre.append(h('div', o.op === '+' ? 'add' : o.op === '-' ? 'del' : '', `${o.op} ${line}`));
      });
      if (!changed.length) pre.append(h('div', 'note', 'Only whitespace or ordering changed.'));
      box.append(pre);
    }
    body.append(box);
  }
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Review changes'), h('div', 'path', `${files.length} uncommitted file${files.length === 1 ? '' : 's'}: what Commit will save. Click a file to open it.`))),
    body,
  );
}

// ---------- balance ----------
interface Col<T> { key: string; label: string; get: (d: T) => number | string | undefined; fmt?: (v: number) => string; title?: string }
const f1 = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
const dps = (d: { damage?: number; cooldown?: number }) => (d.damage && d.cooldown ? d.damage / d.cooldown : undefined);

/** Units and buildings in sortable tables. Click a header to sort; click a name to open it. */
export function renderBalance(main: HTMLElement, units: Record<string, UnitDef>, buildings: Record<string, BuildingDef>, open: (coll: CollectionName, id: string) => void) {
  const unitCols: Col<UnitDef>[] = [
    { key: 'faction', label: 'Side', get: (d) => d.faction },
    { key: 'cost', label: 'Cost', get: (d) => d.cost },
    { key: 'time', label: 'Build s', get: (d) => d.buildSeconds },
    { key: 'hp', label: 'HP', get: (d) => d.hp },
    { key: 'speed', label: 'Speed', get: (d) => d.speed, fmt: f1 },
    { key: 'range', label: 'Range', get: (d) => d.range, fmt: f1 },
    { key: 'dmg', label: 'Damage', get: (d) => d.damage, fmt: f1 },
    { key: 'cd', label: 'Cooldown', get: (d) => d.cooldown, fmt: (v) => v.toFixed(2) },
    { key: 'dps', label: 'DPS', get: (d) => dps(d), fmt: f1, title: 'Damage per second (one target; splash and chains not counted)' },
    { key: 'dpsa', label: 'DPS / 100 ◆', get: (d) => (d.cost && dps(d) ? (dps(d)! / d.cost) * 100 : undefined), fmt: f1, title: 'Damage per second for every 100 alloys spent' },
    { key: 'hpa', label: 'HP / 100 ◆', get: (d) => (d.cost ? (d.hp / d.cost) * 100 : undefined), fmt: (v) => v.toFixed(0), title: 'Hit points for every 100 alloys spent' },
    { key: 'sight', label: 'Sight', get: (d) => d.sight, fmt: f1 },
  ];
  const bCols: Col<BuildingDef>[] = [
    { key: 'role', label: 'Role', get: (d) => d.role },
    { key: 'cost', label: 'Cost', get: (d) => d.cost },
    { key: 'time', label: 'Build s', get: (d) => d.buildSeconds },
    { key: 'hp', label: 'HP', get: (d) => d.hp },
    { key: 'mw', label: 'MW', get: (d) => d.powerMW, fmt: f1, title: 'Positive generates (solar at noon), negative draws' },
    { key: 'mwa', label: 'MW / 100 ◆', get: (d) => (d.powerMW > 0 && d.cost ? (d.powerMW / d.cost) * 100 : undefined), fmt: f1, title: 'Power generated for every 100 alloys' },
    { key: 'range', label: 'Fire range', get: (d) => d.fireRange, fmt: f1 },
    { key: 'dps', label: 'DPS', get: (d) => dps(d), fmt: f1 },
    { key: 'dpsa', label: 'DPS / 100 ◆', get: (d) => (d.cost && dps(d) ? (dps(d)! / d.cost) * 100 : undefined), fmt: f1 },
    { key: 'clear', label: 'Clearance', get: (d) => d.clearance, fmt: f1 },
    { key: 'other', label: 'Also', get: (d) => [d.storage && `${d.storage} MJ`, d.mineRate && `${d.mineRate} ◆/s`, d.housing && `${d.housing} homes`, d.biomassRate && `${d.biomassRate} 🌱/s`, d.repairRate && `${d.repairRate} hp/s`].filter(Boolean).join(' · ') || undefined },
  ];
  const table = <T extends { name: string }>(coll: CollectionName, recs: Record<string, T>, cols: Col<T>[]) => {
    const state = { key: cols[0].key, dir: 1 };
    const wrap = h('div', 'bal-wrap');
    const draw = () => {
      const col = cols.find((c) => c.key === state.key)!;
      const rows = Object.entries(recs).filter(([, d]) => d && typeof d === 'object').sort(([ia, a], [ib, b]) => {
        const x = col.get(a), y = col.get(b);
        if (x === undefined && y === undefined) return ia.localeCompare(ib);
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * state.dir;
      });
      const t = h('table', 'bal');
      const head = h('tr', '', h('th', '', 'Name'));
      for (const c of cols) {
        const th = h('th', c.key === state.key ? 'on' : '', `${c.label}${c.key === state.key ? (state.dir > 0 ? ' ▲' : ' ▼') : ''}`);
        if (c.title) th.title = c.title;
        th.onclick = () => { state.dir = state.key === c.key ? -state.dir : typeof c.get(rows[0]?.[1]) === "number" ? -1 : 1; state.key = c.key; draw(); };
        head.append(th);
      }
      t.append(head);
      for (const [id, d] of rows) {
        const a = h('a', 'fl-link', d.name);
        a.href = '#';
        a.onclick = (e) => { e.preventDefault(); open(coll, id); };
        const tr = h('tr', '', h('td', '', a));
        for (const c of cols) {
          const v = c.get(d);
          tr.append(h('td', typeof v === 'number' ? 'num' : '', v === undefined ? '—' : typeof v === 'number' ? (c.fmt ? c.fmt(v) : String(v)) : v));
        }
        t.append(tr);
      }
      wrap.replaceChildren(t);
    };
    draw();
    return wrap;
  };
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Balance'), h('div', 'path', 'Units and buildings side by side. Click a column to sort; click a name to edit it. Saved values only.'))),
    h('h2', 'bal-h', 'Units'), table('units', units, unitCols),
    h('h2', 'bal-h', 'Buildings'), table('buildings', buildings, bCols),
  );
}

// ---------- search ----------
/** Records whose name, id or any text value contains `q` (case-insensitive), with the first matching snippet. */
export function searchContent(all: { coll: CollectionName; id: string; title: string; data: unknown }[], q: string): { coll: CollectionName; id: string; title: string; snippet: string }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: { coll: CollectionName; id: string; title: string; snippet: string }[] = [];
  for (const r of all) {
    if (r.title.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle)) { out.push({ ...r, snippet: '' }); continue; }
    let hit = '';
    const scan = (v: unknown) => {
      if (hit) return;
      if (typeof v === 'string') {
        // skip grids (long run-length rows) and only match real text
        const i = v.length < 2000 ? v.toLowerCase().indexOf(needle) : -1;
        if (i >= 0) hit = `${i > 30 ? '…' : ''}${v.slice(Math.max(0, i - 30), i + needle.length + 40)}${i + needle.length + 40 < v.length ? '…' : ''}`;
      } else if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v === 'object') Object.values(v).forEach(scan);
    };
    scan(r.data);
    if (hit) out.push({ ...r, snippet: hit });
  }
  return out;
}
