/**
 * Exo Genesis content editor (dev only: needs the dev server's /__content API).
 *
 * Schema-driven: every collection in src/content/defs.ts gets a list and a form
 * for free. Saves are conflict-checked against the file on disk; commits go to
 * the local git repo (content/ only).
 */
import './editor.css';
import { COLLECTIONS, ID_RE, locate, pathOf, type Collection, type CollectionName } from '../content/defs';
import { blank, validate, type Field, type IdIndex, type Issue } from '../content/schema';
import { MapEditor } from './map';

interface FileRec { path: string; hash: string; data: unknown; parseError?: string }
interface Current {
  coll: CollectionName;
  id: string;
  path: string;
  baseHash: string;
  saved: Record<string, unknown>;
  draft: Record<string, unknown>;
  /** Set when the file changed on disk while we had unsaved edits. */
  stale?: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string | null)[]) => {
  const el = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const k of kids) if (k !== null) el.append(k);
  return el;
};

const files = new Map<string, FileRec>();
let cur: Current | null = null;
let mapEd: MapEditor | null = null;
const isMap = () => cur?.coll === 'regions';

// ---------- API ----------
class ApiError extends Error {
  constructor(public status: number, msg: string, public data: Record<string, unknown>) { super(msg); }
}
async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  if (method !== 'GET') busy++;
  const r = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json', 'x-exo-editor': '1' } : { 'x-exo-editor': '1' },
    body: body ? JSON.stringify(body) : undefined,
  }).finally(() => { if (method !== 'GET') busy--; });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? r.statusText, data);
  return data as T;
}

function toast(msg: string, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = bad ? 'show bad' : 'show';
  clearTimeout((toast as unknown as { t: number }).t);
  (toast as unknown as { t: number }).t = window.setTimeout(() => (t.className = ''), bad ? 6000 : 2500);
}

// ---------- data helpers ----------
const coll = (name: CollectionName): Collection => COLLECTIONS[name];

function recordsOf(name: CollectionName): { id: string; path: string; rec: FileRec }[] {
  const out = [];
  for (const rec of files.values()) {
    const at = locate(rec.path);
    if (at?.coll === name) out.push({ id: at.id, path: rec.path, rec });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function idIndex(): IdIndex {
  const ids: IdIndex = {};
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) ids[name] = new Set(recordsOf(name).map((r) => r.id));
  return ids;
}

function titleOf(name: CollectionName, id: string, data: unknown): string {
  const t = coll(name).title;
  const v = t && data && typeof data === 'object' ? (data as Record<string, unknown>)[t] : undefined;
  return typeof v === 'string' && v ? v : id;
}

/** Stable, schema-ordered JSON so diffs stay small and readable. */
function serialize(name: CollectionName, data: Record<string, unknown>): string {
  const shape = coll(name).shape;
  const o: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(shape)) {
    const v = data[k];
    if (v === undefined || (f.optional && v === '')) continue;
    o[k] = v;
  }
  for (const [k, v] of Object.entries(data)) if (!(k in shape) && v !== undefined) o[k] = v;
  return JSON.stringify(o, null, 2) + '\n';
}

const dirty = () => !!cur && serialize(cur.coll, cur.draft) !== serialize(cur.coll, cur.saved);
const issues = (): Issue[] => (cur ? validate(coll(cur.coll).shape, cur.draft, idIndex()) : []);

async function loadAll() {
  const list = await api<{ path: string; hash: string }[]>('GET', '/__content/files');
  const seen = new Set<string>();
  for (const { path, hash } of list) {
    seen.add(path);
    if (files.get(path)?.hash === hash) continue;
    const f = await api<{ text: string; hash: string }>('GET', `/__content/file?path=${encodeURIComponent(path)}`);
    let data: unknown = null, parseError: string | undefined;
    try { data = JSON.parse(f.text); } catch (e) { parseError = (e as Error).message; }
    files.set(path, { path, hash: f.hash, data, parseError });
  }
  for (const p of [...files.keys()]) if (!seen.has(p)) files.delete(p);
}

// ---------- sidebar ----------
function renderSide() {
  const side = $('side');
  side.replaceChildren();
  const groups = new Map<string, CollectionName[]>();
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) {
    const g = coll(name).group;
    groups.set(g, [...(groups.get(g) ?? []), name]);
  }
  const ids = idIndex();
  for (const [g, names] of groups) {
    side.append(h('div', { cls: 'group', textContent: g }));
    for (const name of names) {
      const c = coll(name);
      if (c.kind === 'single') {
        side.append(item(name, name, c.label, pathOf(name, name)));
        continue;
      }
      const head = h('div', { cls: 'coll' }, h('span', { textContent: c.label }));
      const add = h('button', { cls: 'mini', textContent: '+ New', title: `New ${c.label.toLowerCase().replace(/s$/, '')}` });
      add.onclick = () => newRecord(name);
      head.append(add);
      side.append(head);
      for (const r of recordsOf(name)) side.append(item(name, r.id, titleOf(name, r.id, r.rec.data), r.path));
    }
  }
  function item(name: CollectionName, id: string, label: string, path: string) {
    const rec = files.get(path);
    const bad = !rec || rec.parseError || validate(coll(name).shape, rec.data, ids).length > 0;
    const el = h('button', { cls: 'item' }, h('span', { textContent: label }), coll(name).kind === 'many' ? h('small', { textContent: id }) : null);
    if (bad) el.classList.add('bad');
    if (cur?.path === path) el.classList.add('on');
    if (cur?.path === path && dirty()) el.classList.add('dirty');
    el.onclick = () => open(name, id);
    return el;
  }
}

// ---------- open / form ----------
function confirmDiscard() {
  return !dirty() || confirm('You have unsaved changes. Discard them?');
}

function open(name: CollectionName, id: string, force = false) {
  if (!force && !confirmDiscard()) return;
  mapEd?.dispose();
  mapEd = null;
  const path = pathOf(name, id);
  const rec = files.get(path);
  if (!rec) { toast(`${path} not found`, true); return; }
  if (rec.parseError) {
    cur = null;
    $('main').replaceChildren(h('div', { cls: 'err' }, `${path} isn't valid JSON (${rec.parseError}). Fix it by hand, then reload.`));
    renderSide();
    return;
  }
  const data = (rec.data ?? {}) as Record<string, unknown>;
  cur = { coll: name, id, path, baseHash: rec.hash, saved: structuredClone(data), draft: structuredClone(data) };
  history.replaceState(null, '', `#${path}`);
  renderForm();
  renderSide();
}

function fmt(v: unknown) {
  return v === undefined || v === '' ? '—' : typeof v === 'string' ? `"${v}"` : String(v);
}

/** Input widget for one schema field of `d`; calls `onChange` after every edit. */
export function control(d: Record<string, unknown>, key: string, f: Field, onChange: () => void): HTMLElement {
  const set = (v: unknown) => { if (v === undefined) delete d[key]; else d[key] = v; onChange(); };
  switch (f.kind) {
    case 'num': {
      const el = h('input', { type: 'number', value: d[key] === undefined ? '' : String(d[key]) });
      if (f.min !== undefined) el.min = String(f.min);
      if (f.max !== undefined) el.max = String(f.max);
      el.step = String(f.step ?? (f.int ? 1 : 'any'));
      el.oninput = () => set(el.value === '' ? undefined : Number(el.value));
      return el;
    }
    case 'str': {
      const el = f.multiline ? h('textarea', { rows: 3 }) : h('input', { type: 'text' });
      el.value = typeof d[key] === 'string' ? (d[key] as string) : '';
      el.oninput = () => set(el.value === '' && f.optional ? undefined : el.value);
      return el;
    }
    case 'bool': {
      const el = h('input', { type: 'checkbox', checked: d[key] === true });
      el.onchange = () => set(el.checked);
      return el;
    }
    case 'choice':
    case 'ref': {
      const opts = f.kind === 'choice' ? [...f.values] : [...(idIndex()[f.to] ?? [])].sort();
      const el = h('select');
      if (f.optional || !opts.includes(d[key] as string)) el.append(h('option', { value: '', textContent: '—' }));
      for (const o of opts) el.append(h('option', { value: o, textContent: o }));
      el.value = typeof d[key] === 'string' ? (d[key] as string) : '';
      el.onchange = () => set(el.value === '' ? undefined : el.value);
      return el;
    }
    case 'color': {
      const el = h('input', { type: 'color', value: typeof d[key] === 'string' ? (d[key] as string) : '#ffffff' });
      el.oninput = () => set(el.value);
      return el;
    }
    case 'grid':
    case 'list':
      return h('span', { cls: 'note', textContent: 'Edited in the map view' });
  }
}

function renderForm() {
  if (!cur) return;
  const c = coll(cur.coll);
  const main = $('main');
  const title = h('h1', { textContent: c.kind === 'many' ? titleOf(cur.coll, cur.id, cur.draft) : c.label });
  const save = h('button', { cls: 'primary', textContent: 'Save', title: 'Save (Ctrl+S)', id: 'save' });
  const revert = h('button', { textContent: 'Revert', id: 'revert' });
  save.onclick = () => void doSave();
  revert.onclick = () => { if (cur && confirmDiscard()) open(cur.coll, cur.id, true); };
  const actions = h('div', { cls: 'actions' }, save, revert);
  if (c.kind === 'many') {
    const dup = h('button', { textContent: 'Duplicate' });
    dup.onclick = () => void newRecord(cur!.coll, cur!.draft);
    const del = h('button', { cls: 'danger', textContent: 'Delete' });
    del.onclick = () => void doDelete();
    actions.append(dup, del);
  }
  main.classList.toggle('map-mode', isMap());
  if (isMap()) {
    const host = h('div', { cls: 'map-host' });
    main.replaceChildren(
      h('div', { cls: 'head' }, h('div', {}, title, h('div', { cls: 'path', textContent: `content/${cur.path}` })), actions),
      h('div', { cls: 'stale', id: 'stale', textContent: 'This file changed on disk while you were editing. Saving will ask before overwriting.' }),
      host,
    );
    const at = cur;
    mapEd = new MapEditor(host, $('aside'), { draft: at.draft, changed, control });
    changed();
    return;
  }
  const form = h('div', { cls: 'form' });
  for (const [key, f] of Object.entries(c.shape)) {
    const row = h('label', { cls: 'row' });
    row.dataset.key = key;
    row.append(
      h('span', { cls: 'lbl', textContent: f.label ?? key }, f.optional ? h('small', { textContent: ' optional' }) : null),
      h('span', { cls: 'ctl' }, control(cur.draft, key, f, changed), f.kind === 'num' && f.unit ? h('span', { cls: 'unit', textContent: f.unit }) : null, h('span', { cls: 'was' })),
      h('span', { cls: 'help', textContent: f.help ?? '' }),
      h('span', { cls: 'issue' }),
    );
    form.append(row);
  }
  main.replaceChildren(
    h('div', { cls: 'head' }, h('div', {}, title, h('div', { cls: 'path', textContent: `content/${cur.path}` })), actions),
    h('div', { cls: 'stale', id: 'stale', textContent: 'This file changed on disk while you were editing. Saving will ask before overwriting.' }),
    form,
  );
  changed();
}

/** Refresh everything that depends on the draft without rebuilding inputs (keeps focus). */
function changed() {
  if (!cur) return;
  const iss = issues();
  const shape = coll(cur.coll).shape;
  for (const row of document.querySelectorAll<HTMLElement>('.row')) {
    const k = row.dataset.key!;
    const msg = iss.filter((i) => i.field === k).map((i) => i.msg).join('; ');
    row.querySelector('.issue')!.textContent = msg;
    row.classList.toggle('invalid', !!msg);
    const was = JSON.stringify(cur.saved[k]) !== JSON.stringify(cur.draft[k]);
    row.classList.toggle('changed', was);
    row.querySelector('.was')!.textContent = was ? `was ${fmt(cur.saved[k])}` : '';
  }
  const isDirty = dirty();
  ($('save') as HTMLButtonElement).disabled = !isDirty;
  ($('revert') as HTMLButtonElement).disabled = !isDirty;
  $('stale').classList.toggle('show', !!cur.stale);
  if (coll(cur.coll).kind === 'many') document.querySelector('#main h1')!.textContent = titleOf(cur.coll, cur.id, cur.draft);
  document.title = `${isDirty ? '● ' : ''}Exo Genesis Editor`;
  document.querySelector('#side .item.on')?.classList.toggle('dirty', isDirty);

  if (isMap()) {
    $('main').querySelector('.map-issues')?.remove();
    if (iss.length) $('main').querySelector('.head')!.after(h('div', { cls: 'map-issues', textContent: iss.map((i) => `${i.field}: ${i.msg}`).join(' · ') }));
    return;
  }
  // aside: problems + the exact JSON that will be written
  const extra = iss.filter((i) => !(i.field in shape));
  $('aside').replaceChildren(
    h('div', { cls: 'group', textContent: iss.length ? `${iss.length} problem${iss.length > 1 ? 's' : ''}` : 'No problems' }),
    ...extra.map((i) => h('div', { cls: 'issue', textContent: `${i.field || '(file)'}: ${i.msg}` })),
    h('div', { cls: 'group', textContent: 'File preview' }),
    h('pre', { textContent: serialize(cur.coll, cur.draft) }),
  );
}

// ---------- save / delete / new ----------
async function doSave() {
  if (!cur || !dirty()) return;
  const iss = issues();
  if (iss.length && !confirm(`This has ${iss.length} problem(s) — the game will refuse to start until they're fixed:\n\n${iss.map((i) => `${i.field}: ${i.msg}`).join('\n')}\n\nSave anyway?`)) return;
  const text = serialize(cur.coll, cur.draft);
  try {
    const r = await api<{ hash: string }>('PUT', '/__content/file', { path: cur.path, text, baseHash: cur.baseHash });
    accept(r.hash, text);
    toast(`Saved content/${cur.path}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const theirs = e.data.hash as string | null;
      if (theirs && confirm(`content/${cur.path} was changed elsewhere since you opened it.\n\nOK = overwrite with your version\nCancel = keep theirs (you can Revert to load it)`)) {
        const r = await api<{ hash: string }>('PUT', '/__content/file', { path: cur.path, text, baseHash: theirs });
        accept(r.hash, text);
        toast(`Saved content/${cur.path} (overwrote the other change)`);
      } else {
        cur.stale = true;
        changed();
      }
      return;
    }
    toast(`Save failed: ${(e as Error).message}`, true);
  }
  function accept(hash: string, text: string) {
    cur!.baseHash = hash;
    cur!.saved = structuredClone(cur!.draft);
    cur!.stale = false;
    files.set(cur!.path, { path: cur!.path, hash, data: JSON.parse(text) });
    changed();
    renderSide();
    void refreshGit();
  }
}

async function doDelete() {
  if (!cur) return;
  if (!confirm(`Delete content/${cur.path}? (Recoverable from git until you commit.)`)) return;
  try {
    await api('DELETE', '/__content/file', { path: cur.path, baseHash: cur.baseHash });
    files.delete(cur.path);
    toast(`Deleted content/${cur.path}`);
    mapEd?.dispose();
    mapEd = null;
    $('main').classList.remove('map-mode');
    cur = null;
    $('main').replaceChildren(h('div', { id: 'empty', textContent: 'Deleted.' }));
    $('aside').replaceChildren();
    history.replaceState(null, '', '#');
    renderSide();
    void refreshGit();
  } catch (e) {
    toast(`Delete failed: ${(e as Error).message}`, true);
  }
}

async function newRecord(name: CollectionName, from?: Record<string, unknown>) {
  if (!confirmDiscard()) return;
  const c = coll(name);
  const id = prompt(`Id for the new ${c.label.toLowerCase().replace(/s$/, '')} (lowercase letters, digits, - or _; becomes the file name):`)?.trim();
  if (!id) return;
  if (!ID_RE.test(id)) { toast('Ids are lowercase letters, digits, - and _ (start with a letter or digit)', true); return; }
  if (files.has(pathOf(name, id))) { toast(`${id} already exists`, true); return; }
  const data = from ? structuredClone(from) : blank(c.shape);
  if (c.title) data[c.title] = from ? `${String(from[c.title] ?? id)} copy` : id.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const text = serialize(name, data);
  try {
    const r = await api<{ hash: string }>('PUT', '/__content/file', { path: pathOf(name, id), text, baseHash: null });
    files.set(pathOf(name, id), { path: pathOf(name, id), hash: r.hash, data });
    open(name, id, true);
    toast(`Created content/${pathOf(name, id)}`);
    void refreshGit();
  } catch (e) {
    toast(`Create failed: ${(e as Error).message}`, true);
  }
}

// ---------- git ----------
async function refreshGit() {
  try {
    const g = await api<{ changes: { status: string; path: string }[]; last: string }>('GET', '/__content/git');
    const n = g.changes.length;
    const st = $('git-status');
    st.textContent = n ? `${n} uncommitted change${n > 1 ? 's' : ''}` : 'All committed';
    st.title = n ? g.changes.map((c) => `${c.status}  ${c.path}`).join('\n') : `Last: ${g.last}`;
    st.classList.toggle('pending', n > 0);
    ($('commit') as HTMLButtonElement).disabled = n === 0;
  } catch { /* dev server restarting */ }
}

async function doCommit() {
  const input = $<HTMLInputElement>('commit-msg');
  const message = input.value.trim();
  if (!message) { input.focus(); toast('Write a short description first', true); return; }
  if (dirty() && !confirm('The open record has unsaved changes, which won\'t be included. Commit anyway?')) return;
  try {
    const r = await api<{ commit: string; files: number }>('POST', '/__content/commit', { message });
    input.value = '';
    toast(`Committed ${r.files} file${r.files > 1 ? 's' : ''} as ${r.commit}`);
    void refreshGit();
  } catch (e) {
    toast(`Commit failed: ${(e as Error).message}`, true);
  }
}

// ---------- watch for changes made elsewhere ----------
let busy = 0;
async function poll() {
  if (busy) return;
  try {
    await loadAll();
    if (cur) {
      const rec = files.get(cur.path);
      if (!rec) {
        cur.stale = true;
      } else if (rec.hash !== cur.baseHash) {
        if (dirty()) cur.stale = true;
        else { open(cur.coll, cur.id, true); toast(`content/${cur.path} changed on disk; reloaded`); }
      }
      changed();
    }
    renderSide();
    await refreshGit();
  } catch { /* dev server restarting */ }
}

// ---------- boot ----------
$('commit').onclick = () => void doCommit();
$('commit-msg').onkeydown = (e) => { if (e.key === 'Enter') void doCommit(); };
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void doSave(); }
});
addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });

await loadAll();
renderSide();
await refreshGit();
const at = locate(decodeURIComponent(location.hash.slice(1)));
if (at) open(at.coll, at.id);
setInterval(() => void poll(), 4000);

declare global { interface Window { __editor: unknown } }
window.__editor = { get cur() { return cur; }, get map() { return mapEd; }, files, dirty };
