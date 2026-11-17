/**
 * Exo Genesis content editor. In dev it talks to the dev server's /__content API;
 * on deeek.org the same API is answered by GitHub (./github.ts).
 *
 * Schema-driven: every collection in src/content/defs.ts gets a list and a form
 * for free. Saves are conflict-checked against the file on disk; commits go to
 * the local git repo (content/ and public/media/ only).
 */
import './editor.css';
import { COLLECTIONS, CONDITION_HELP, type BuildingDef, type UnitDef, EFFECT_HELP, ID_RE, PREVIEW_KEY, locate, pathOf, type Collection, type CollectionName, type Condition, type ConditionDef, type EffectDef, type MissionDef, type StoryDef, type StoryEffect } from '../content/defs';
import { applies, blank, type Field, type IdIndex, type Issue, type ListField } from '../content/schema';
import { renderFlow } from './flow';
import { renderPlanet } from './planet';
import { balanceRunPanel } from './balance-run';
import { playSetup, setupPanel } from './playsetup';
import { timelinePanel } from './timeline';
import { applyInterface } from '../ui-theme';
import { analyzeFlow } from './flow';
import { buildDb, REQUIRED, requiredIssues } from '../content/db';
import { collectText, diffContent, renameRefs, renderChanges, renderCompare, renderProblems, renderText, setAt, type PathIssue, type Rec, type TextEntry } from './pages';
import { refsTo, renderBalance, renderReview, searchContent, type ReviewFile } from './tools';
import { MapEditor } from './map';
import { ACCEPT_ALL, AssetPanel, pickFiles, renderBuiltin, renderLibrary, uploadFiles, type AssetHost, type MediaInfo, type Usage } from './assets';
import { BUILTINS } from '../assets/builtin';
import { CHANGELOG } from '../changelog';
import type { AssetDef } from '../content/defs';
import { mediaUrl, setMediaOverride, type CharacterDef, type InterfaceDef, type LandingDef } from '../content/defs';
import { BRANCH, REPO, checkToken, ghFetch, localMediaUrl, mode, token } from './github';

/** Dev server on hive1, or the deployed site (GitHub-backed). */
const WEB = !import.meta.env.DEV;
if (WEB) setMediaOverride(localMediaUrl);

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
let assetPanel: AssetPanel | null = null;
let viewHandle: { dispose(): void } | null = null;
/** The landing's timeline, while Cinematics → Landing is open. */
let timeline: { el: HTMLElement; update(): void } | null = null;
/** What the main pane shows when no record is open. */
let view: 'none' | 'library' | PageName | { builtin: string } = 'none';
/** The Compare page's records. */
let compareAt: { coll: CollectionName; a: string; b: string } | null = null;
/** The Text page's filter, kept while you move between pages. */
const textState = { q: '', warnOnly: false };
/** Undo history of the open record: serialized drafts, `at` = the one showing. */
let hist: { stack: string[]; at: number; t: number; key: string } | null = null;
/** Sidebar search (empty = the normal lists). */
let searchQ = '';
const media = new Map<string, MediaInfo>();
const isMap = () => cur?.coll === 'regions';

/** Tear down whatever owns the main pane (map, viewers) before showing something else. */
function teardown() {
  mapEd?.dispose();
  mapEd = null;
  assetPanel?.dispose();
  assetPanel = null;
  viewHandle?.dispose();
  viewHandle = null;
  timeline = null;
  $('main').classList.remove('map-mode');
}

// ---------- API ----------
class ApiError extends Error {
  constructor(public status: number, msg: string, public data: Record<string, unknown>) { super(msg); }
}
async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  if (method !== 'GET') busy++;
  const raw = body instanceof Blob;
  const r = await (WEB ? ghFetch : fetch)(url, {
    method,
    headers: { 'x-exo-editor': '1', ...(body ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
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
/**
 * Everything content:check and the game's loader would report, on saved files
 * with `over` (the open draft) swapped in: schema checks, rules that span
 * records (a site trigger needs that site on a map…), records the game needs,
 * and media files that are missing.
 */
function contentIssues(over?: { path: string; data: unknown }): PathIssue[] {
  const fl: Record<string, unknown> = {};
  const out: PathIssue[] = [];
  for (const r of files.values()) {
    if (r.parseError) out.push({ path: r.path, field: '', msg: `invalid JSON: ${r.parseError}` });
    else fl[r.path] = r.data;
  }
  if (over) fl[over.path] = over.data;
  const { db, issues: found } = buildDb(fl);
  out.push(...found, ...requiredIssues(db));
  for (const [id, a] of Object.entries(db.assets ?? {})) {
    if (a && typeof a === 'object' && a.kind && a.file && !media.has(`${a.kind}/${a.file}`)) out.push({ path: pathOf('assets', id), field: 'file', msg: `public/media/${a.kind}/${a.file} is missing` });
  }
  return out;
}
let savedIssues: { sig: string; list: PathIssue[] } | null = null;
/** Problems in saved content (cached until a file changes). */
function savedProblems(): PathIssue[] {
  const sig = signature();
  if (savedIssues?.sig !== sig) savedIssues = { sig, list: contentIssues() };
  return savedIssues.list;
}
const issues = (): Issue[] => (cur ? contentIssues({ path: cur.path, data: cur.draft }).filter((i) => i.path === cur!.path) : []);

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
  const m = await api<{ path: string; hash: string; bytes: number }[]>('GET', '/__content/media');
  media.clear();
  for (const x of m) media.set(x.path, { hash: x.hash, bytes: x.bytes });
}

// ---------- sidebar ----------
/** Every record, for search and "used by". */
function allRecords(singles = false): Rec[] {
  return (Object.keys(COLLECTIONS) as CollectionName[]).filter((c) => singles || coll(c).kind === 'many').flatMap((c) => recordsOf(c).map((r) => ({ coll: c, id: r.id, title: titleOf(c, r.id, r.rec.data), data: r.rec.data })));
}

function sideSearch(): HTMLInputElement {
  let box = document.getElementById('side-search') as HTMLInputElement | null;
  if (box) return box;
  box = h('input', { id: 'side-search', type: 'search', placeholder: 'Search all content…  ( / )' });
  box.oninput = () => { searchQ = box!.value; renderSide(); };
  box.onkeydown = (e) => { if (e.key === 'Escape') { box!.value = ''; searchQ = ''; renderSide(); box!.blur(); } };
  $('side').before(h('div', { id: 'side-top' }, box));
  return box;
}

function renderSide() {
  sideSearch();
  const side = $('side');
  side.replaceChildren();
  if (searchQ.trim()) {
    const hits = searchContent(allRecords(), searchQ);
    side.append(h('div', { cls: 'group', textContent: hits.length ? `${hits.length} match${hits.length > 1 ? 'es' : ''}` : 'No matches' }));
    for (const r of hits) {
      const el = h('button', { cls: `item search-hit${cur?.coll === r.coll && cur.id === r.id ? ' on' : ''}` },
        h('span', { textContent: r.title }), h('small', { textContent: coll(r.coll).label.replace(/s$/, '').toLowerCase() }));
      if (r.snippet) el.append(h('div', { cls: 'snip', textContent: r.snippet }));
      el.onclick = () => open(r.coll, r.id);
      side.append(el);
    }
    return;
  }
  const groups = new Map<string, CollectionName[]>();
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) {
    const g = coll(name).group;
    groups.set(g, [...(groups.get(g) ?? []), name]);
  }
  const bad = new Set(savedProblems().map((i) => i.path));
  const tool = (page: PageName, label: string, note: string, cls = '') => {
    const b = h('button', { cls: `item${view === page && !cur ? ' on' : ''}${cls ? ` ${cls}` : ''}` }, h('span', { textContent: label }), h('small', { textContent: note }));
    b.onclick = () => showPage(page);
    return b;
  };
  side.append(
    h('div', { cls: 'group', textContent: 'Checks' }),
    tool('problems', bad.size ? `Problems in ${bad.size} file${bad.size > 1 ? 's' : ''}` : 'No problems', bad.size ? 'fix' : 'ok', bad.size ? 'bad' : ''),
    tool('text', 'Text', 'spelling'),
    tool('changes', 'Since last release', 'what changed'),
  );
  for (const [g, names] of groups) {
    side.append(h('div', { cls: 'group', textContent: g }));
    if (g === 'Game data') {
      const bal = h('button', { cls: view === 'balance' && !cur ? 'item on' : 'item' }, h('span', { textContent: 'Balance table' }), h('small', { textContent: 'compare' }));
      bal.onclick = () => showPage('balance');
      side.append(bal);
    }
    if (g === 'Maps') side.append(tool('planet', 'Planet', 'all regions'));
    if (g === 'Story') {
      const fl = h('button', { cls: view === 'flow' && !cur ? 'item on' : 'item' }, h('span', { textContent: 'Story flow' }), h('small', { textContent: 'overview' }));
      fl.onclick = () => showPage('flow');
      side.append(fl);
    }
    for (const name of names) {
      const c = coll(name);
      if (c.kind === 'single') {
        side.append(item(name, name, c.label, pathOf(name, name)));
        continue;
      }
      if (name === 'assets') {
        const lib = h('button', { cls: view === 'library' && !cur ? 'item on' : 'item' }, h('span', { textContent: 'Library' }), h('small', { textContent: `${recordsOf('assets').length + BUILTINS.length}` }));
        lib.onclick = () => showLibrary();
        side.append(lib);
      }
      const head = h('div', { cls: 'coll' }, h('span', { textContent: name === 'assets' ? 'Files' : c.label }));
      const add = h('button', { cls: 'mini', textContent: name === 'assets' ? '+ Upload' : '+ New', title: name === 'assets' ? 'Add model, image or audio files' : `New ${c.label.toLowerCase().replace(/s$/, '')}` });
      add.onclick = name === 'assets' ? () => void pickFiles(ACCEPT_ALL, true).then(addFiles) : () => newRecord(name);
      head.append(add);
      side.append(head);
      for (const r of recordsOf(name)) side.append(item(name, r.id, titleOf(name, r.id, r.rec.data), r.path));
    }
  }
  function item(name: CollectionName, id: string, label: string, path: string) {
    const rec = files.get(path);
    const el = h('button', { cls: 'item' }, h('span', { textContent: label }), coll(name).kind === 'many' ? h('small', { textContent: id }) : null);
    if (!rec || bad.has(path)) el.classList.add('bad');
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
  teardown();
  view = 'none';
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
  hist = { stack: [JSON.stringify(data)], at: 0, t: 0, key: '' };
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
      let opts = f.kind === 'choice' ? [...f.values] : [...(idIndex()[f.to] ?? [])].sort();
      // asset fields only offer assets of the right kind (models unless the field says otherwise)
      if (f.kind === 'ref' && f.to === 'assets') opts = opts.filter((id) => (files.get(pathOf('assets', id))?.data as AssetDef | undefined)?.kind === (f.assetKind ?? 'model'));
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
    case 'list':
      if (isMap()) return h('span', { cls: 'note', textContent: 'Edited in the map view' });
      return listControl(d, key, f, onChange);
    case 'grid':
      return h('span', { cls: 'note', textContent: 'Edited in the map view' });
  }
}

/** Story effects: "When" as the event's own moments (it fires, or one of its choices). */
function whenSelect(item: Record<string, unknown>, onChange: () => void): HTMLElement {
  const el = h('select');
  fillWhen(el, Number(item.after ?? 0));
  el.onchange = () => { item.after = Number(el.value); onChange(); };
  return el;
}
function fillWhen(el: HTMLSelectElement, v: number) {
  const choices = ((cur?.draft.choices as { label?: string }[] | undefined) ?? []);
  el.replaceChildren(h('option', { value: '0', textContent: 'When it fires' }));
  choices.forEach((c, n) => el.append(h('option', { value: String(n + 1), textContent: `After “${c.label || `choice ${n + 1}`}”` })));
  if (v > choices.length) el.append(h('option', { value: String(v), textContent: `After choice ${v} (missing)` }));
  el.value = String(v);
}

/** Singular label for a list's items ("Choices" → "Choice"). */
const itemName = (f: Field, key: string) => (f.label ?? key).replace(/ies$/, 'y').replace(/s$/, '');

/**
 * A list of small records as stacked cards: each item's fields (only the ones
 * that apply), move up / down, remove, and an Add button. Structural edits, and
 * changes to a field others depend on, re-render the list.
 */
function listControl(d: Record<string, unknown>, key: string, f: ListField, onChange: () => void): HTMLElement {
  const box = h('div', { cls: 'list-ctl' });
  const deps = new Set(Object.values(f.of).map((x) => x.when?.field).filter(Boolean) as string[]);
  const items = () => (Array.isArray(d[key]) ? (d[key] as Record<string, unknown>[]) : []);
  const commit = (next: Record<string, unknown>[]) => {
    if (next.length || !f.optional) d[key] = next; else delete d[key];
    render();
    onChange();
  };
  const render = () => {
    box.replaceChildren();
    const list = items();
    list.forEach((item, n) => {
      const card = h('div', { cls: 'item-card' });
      const btn = (text: string, title: string, fn: () => void, off = false) => {
        const b = h('button', { textContent: text, title, type: 'button', disabled: off });
        b.onclick = (e) => { e.preventDefault(); fn(); };
        return b;
      };
      card.append(h('div', { cls: 'item-head' },
        h('b', { textContent: `${itemName(f, key)} ${n + 1}` }),
        btn('↑', 'Move up', () => { const l = [...list]; [l[n - 1], l[n]] = [l[n], l[n - 1]]; commit(l); }, n === 0),
        btn('↓', 'Move down', () => { const l = [...list]; [l[n + 1], l[n]] = [l[n], l[n + 1]]; commit(l); }, n === list.length - 1),
        btn('✕', 'Remove', () => commit(list.filter((_, i) => i !== n))),
      ));
      for (const [k, sub] of Object.entries(f.of)) {
        if (!applies(sub, item)) continue;
        const row = h('label', { cls: 'mini-row' });
        row.dataset.item = `${key}[${n}].${k}`;
        const help = () => (sub.kind === 'choice' && sub.helps ? sub.helps[item[k] as string] ?? sub.help : sub.help) ?? '';
        const helpEl = h('span', { cls: 'help', textContent: help() });
        const ctl = cur?.coll === 'story' && key === 'effects' && k === 'after'
          ? whenSelect(item, () => { onChange(); })
          : control(item, k, sub, () => { if (deps.has(k)) render(); helpEl.textContent = help(); onChange(); });
        row.append(h('span', { cls: 'lbl', textContent: sub.label ?? k }), ctl, cur?.coll === 'story' && k === 'after' ? '' : helpEl, h('span', { cls: 'issue' }));
        card.append(row);
      }
      box.append(card);
    });
    const full = f.max !== undefined && list.length >= f.max;
    const add = h('button', { textContent: `+ Add ${itemName(f, key).toLowerCase()}`, type: 'button', disabled: full });
    add.onclick = (e) => { e.preventDefault(); commit([...list, blank(f.of)]); };
    box.append(add);
  };
  render();
  return box;
}

// ---------- story events: card preview, what it does, play test ----------
function storyPanel(): HTMLElement {
  const play = h('button', { cls: 'primary', textContent: '▶ Play test this event', title: 'Opens the game on the event\'s region (Touchdown if it has none), starting deployed, and fires this event straight away: unsaved edits included. Your own colony is left alone.' });
  play.onclick = () => playTest('story');
  return h('div', { cls: 'story-panel' }, h('div', { cls: 'story-card', id: 'story-card' }), h('div', { cls: 'story-sum', id: 'story-sum' }), h('div', { cls: 'actions' }, play), testSetup());
}

/** "when the clock reaches Sol (Sol 2)" for a condition. */
function conditionText(kind: Condition | undefined, c: ConditionDef): string {
  if (!kind) return '?';
  const param = kind === 'time' ? `Sol ${c.sol ?? '?'}` : kind === 'built' ? `${c.count && c.count > 1 ? `${c.count}× ` : ''}${c.building ?? '?'}`
    : ['colonists', 'packs', 'units', 'drones', 'firstAge', 'acceptance', 'distrust'].includes(kind) ? String(c.count ?? 1) : kind === 'site' ? `site "${c.site ?? '?'}"`
    : kind === 'contact' || kind === 'trust' ? c.group ?? '?' : kind === 'flag' ? `flag "${c.flag ?? '?'}"` : kind === 'after' ? `"${c.event ?? '?'}"`
    : kind === 'mission' ? `"${c.mission ?? '?'}"` : '';
  return `${CONDITION_HELP[kind]}${param ? ` (${param})` : ''}`;
}

/** "add 60 alloys" for an effect. */
function effectText(e: Partial<EffectDef>): string {
  if (!e.kind) return '?';
  return EFFECT_HELP[e.kind as StoryEffect].replace('Amount', String(e.amount ?? '?')).replace('the Flag', `flag "${e.flag ?? '?'}"`).replace('the Group', e.group ?? '?').replace('the Event', `"${e.event ?? '?'}"`).replace('(Text)', e.text ? `: “${e.text.slice(0, 60)}${e.text.length > 60 ? '…' : ''}”` : '');
}

/** Ids of records in `coll` whose data passes `test`. */
const whoRefs = <T,>(coll: CollectionName, test: (d: T) => boolean) => recordsOf(coll).filter((r) => r.rec.data && test(r.rec.data as T)).map((r) => r.id);

/** A sentence for an event's trigger, and one per effect. */
function storySummary(ev: Partial<StoryDef>): string[] {
  const out = [`Fires ${conditionText(ev.trigger, ev)}${ev.delay ? `, ${ev.delay} s later` : ''}${ev.region ? `, only in ${ev.region}` : ''}${ev.unless ? `, unless flag "${ev.unless}" is set` : ''}. Once per game.`];
  for (const e of ev.effects ?? []) {
    const when = e.after ? `After “${ev.choices?.[e.after - 1]?.label ?? `choice ${e.after}`}”` : 'When it fires';
    out.push(`${when}: ${effectText(e)}`);
  }
  // who waits on this one, and who starts it
  const id = cur?.id;
  const after = whoRefs<StoryDef>('story', (d) => d.trigger === 'after' && d.event === id);
  const started = whoRefs<StoryDef>('story', (d) => !!d.effects?.some((e) => e.kind === 'event' && e.event === id));
  const missions = whoRefs<MissionDef>('missions', (d) => d.onStart === id || d.onDone === id || !!d.rewards?.some((e) => e.kind === 'event' && e.event === id));
  if (after.length) out.push(`Followed by: ${after.join(', ')}`);
  if (started.length) out.push(`Started by: ${started.join(', ')}`);
  if (missions.length) out.push(`Missions that fire it: ${missions.join(', ')}`);
  return out;
}

// ---------- missions: what it asks, what follows, play test ----------
function missionPanel(): HTMLElement {
  const play = h('button', { cls: 'primary', textContent: '▶ Play test this mission', title: 'Opens the game on the mission\'s region (Touchdown if it has none), starting deployed, with the missions before it counted as done and this one under way: unsaved edits included. Your own colony is left alone.' });
  play.onclick = () => playTest('mission');
  return h('div', { cls: 'story-panel' }, h('div', { cls: 'story-sum', id: 'story-sum' }), h('div', { cls: 'actions' }, play), testSetup());
}

function missionSummary(m: Partial<MissionDef>): string[] {
  const id = cur?.id;
  const out = [`Starts ${m.after ? `when “${m.after}” is complete` : 'when the colony deploys'}${m.region ? `, only in ${m.region}` : ''}${m.onStart ? `, and fires “${m.onStart}”` : ''}.`];
  (m.objectives ?? []).forEach((o, i) => out.push(`${i + 1}. ${o.text || '(no text)'}: done ${conditionText(o.kind, o)}`));
  if (!m.objectives?.length) out.push('No objectives yet: it would be done the moment it starts.');
  for (const e of m.rewards ?? []) out.push(`Reward: ${effectText(e)}`);
  if (m.onDone) out.push(`When done, fires “${m.onDone}”`);
  const next = whoRefs<MissionDef>('missions', (d) => d.after === id);
  const events = whoRefs<StoryDef>('story', (d) => d.trigger === 'mission' && d.mission === id);
  out.push(next.length ? `Followed by: ${next.join(', ')}` : 'Nothing follows it.');
  if (events.length) out.push(`Story events waiting on it: ${events.join(', ')}`);
  return out;
}

/** Name, role and portrait for a line, as the game draws it ({first} shown as a sample name). */
function speakerEl(character?: string, speaker?: string): { el: HTMLElement | null; color: string } {
  const ch = character ? files.get(pathOf('characters', character))?.data as CharacterDef | undefined : undefined;
  const name = ch?.name ?? speaker;
  if (!name) return { el: null, color: '' };
  const a = ch?.portrait ? files.get(pathOf('assets', ch.portrait))?.data as AssetDef | undefined : undefined;
  const el = h('div', { cls: 'who' },
    a?.kind === 'image' ? h('img', { cls: 'por', src: mediaUrl(a), alt: '' }) : null,
    h('span', { textContent: sampleFirst(name) }, ch?.role ? h('small', { textContent: sampleFirst(ch.role) }) : null));
  if (ch?.color) el.style.color = ch.color;
  return { el, color: ch?.color ?? '' };
}
/** Every line a character speaks, across story events (a card's text, conversation lines, radio messages). */
function linesOf(id: string): { ev: string; title: string; text: string }[] {
  const out: { ev: string; title: string; text: string }[] = [];
  for (const r of recordsOf('story')) {
    const ev = r.rec.data as StoryDef | null;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.character === id) out.push({ ev: r.id, title: ev.title, text: ev.text });
    for (const l of ev.lines ?? []) if (l.character === id || (!l.character && !l.speaker && ev.character === id)) out.push({ ev: r.id, title: ev.title, text: l.text });
  }
  return out;
}

/** Characters: a sample card in their colours (from the draft), and everything they say. */
function renderCharacter() {
  const card = document.getElementById('char-card'), list = document.getElementById('char-lines');
  if (!card || !list || !cur) return;
  const ch = cur.draft as Partial<CharacterDef>;
  const lines = linesOf(cur.id);
  const a = ch.portrait ? files.get(pathOf('assets', ch.portrait))?.data as AssetDef | undefined : undefined;
  const who = h('div', { cls: 'who' }, a?.kind === 'image' ? h('img', { cls: 'por', src: mediaUrl(a), alt: '' }) : null,
    h('span', { textContent: sampleFirst(ch.name || '…') }, ch.role ? h('small', { textContent: sampleFirst(ch.role) }) : null));
  if (ch.color) who.style.color = ch.color;
  const page = h('div', { cls: 'story-page' }, who, h('div', { cls: 't', textContent: lines[0]?.title ?? 'A story card' }), h('p', { textContent: sampleFirst(lines[0]?.text ?? 'What they say goes here.') }));
  if (ch.color) page.style.borderColor = ch.color;
  card.replaceChildren(page, ...(ch.name?.includes('{first}') ? [h('div', { cls: 'note', textContent: '{first} becomes the first pod-born colonist\'s name (a sample here)' })] : []));
  list.replaceChildren(h('div', { cls: 'group', textContent: lines.length ? `Says ${lines.length} line${lines.length > 1 ? 's' : ''}` : 'Says nothing yet: pick them as the Character on a story event' }),
    ...lines.map((l) => {
      const link = h('a', { cls: 'fl-link', href: `#story/${l.ev}.json`, textContent: l.title });
      link.onclick = (e) => { e.preventDefault(); open('story', l.ev); };
      return h('div', { cls: 'char-line' }, link, h('div', { textContent: l.text }));
    }));
}

/** The preview stands in a sample name for {first}. */
const sampleFirst = (t: string) => t.replaceAll('{first}', 'Ada');

function renderStoryPreview() {
  const card = document.getElementById('story-card'), sum = document.getElementById('story-sum');
  if (!card || !sum || !cur) return;
  const ev = cur.draft as Partial<StoryDef>;
  // every page of the conversation, as the game shows them one at a time
  const pages = [{ character: ev.character, speaker: ev.speaker, text: ev.text ?? '' }, ...(ev.lines ?? []).map((l) => ({
    character: l.character ?? (l.speaker ? undefined : ev.character), speaker: l.speaker ?? (l.character ? undefined : ev.speaker), text: l.text ?? '',
  }))];
  const radio = ev.style === 'radio';
  card.classList.toggle('radio', radio);
  card.replaceChildren(...pages.map((pg, n) => {
    const who = speakerEl(pg.character, pg.speaker ?? (radio ? 'Transmission' : undefined));
    const last = n === pages.length - 1;
    const btns = radio ? [] : !last ? [h('button', { textContent: 'Next ›' }), h('span', { cls: 'pg', textContent: `${n + 1} / ${pages.length}` })]
      : ev.choices?.length ? ev.choices.map((c) => h('button', { textContent: sampleFirst(c.label || '…') })) : [h('button', { textContent: 'Continue' })];
    const page = h('div', { cls: 'story-page' }, who.el, h('div', { cls: 't', textContent: sampleFirst(ev.title || 'Untitled') }), h('p', { textContent: sampleFirst(pg.text) }), btns.length ? h('div', { cls: 'grp' }, ...btns) : null);
    if (who.color) page.style.borderColor = who.color;
    return page;
  }), ...(ev.pause && !radio ? [h('div', { cls: 'note', textContent: 'Pauses the game while open' })] : []),
  ...(radio ? [h('div', { cls: 'note', textContent: 'A radio message: shown in the corner, closes by itself' })] : []),
  ...([ev.text, ev.title, ...(ev.lines ?? []).map((l) => l.text)].some((t) => t?.includes('{first}')) ? [h('div', { cls: 'note', textContent: '{first} shows as a sample name here' })] : []));
  sum.replaceChildren(...storySummary(ev).map((line) => h('div', { textContent: line })));
  // effects' "When" lists follow the choices as they're edited
  for (const sel of document.querySelectorAll<HTMLSelectElement>('[data-item^="effects["][data-item$=".after"] select')) {
    if (document.activeElement !== sel) fillWhen(sel, Number(sel.value));
  }
}

/** The play test setup form, offering this content's buildings and flags. */
function testSetup(): HTMLElement {
  const data = <T,>(c: CollectionName) => Object.fromEntries(recordsOf(c).filter((r) => r.rec.data && typeof r.rec.data === 'object').map((r) => [r.id, r.rec.data as T]));
  const blds = Object.entries(data<BuildingDef>('buildings')).filter(([, b]) => b.role !== 'core' && b.buildable !== false).map(([id, b]) => ({ id, name: b.name }));
  const flags = [...analyzeFlow(data<MissionDef>('missions'), data<StoryDef>('story')).flags.keys()].sort();
  return setupPanel(blds, flags);
}

/** Open a scratch game on the record's region (unsaved edits included) that fires the event / starts the mission. */
function playTest(kind: 'story' | 'mission') {
  if (!cur) return;
  const rec = cur.draft as { region?: string };
  const region = rec.region && files.get(pathOf('regions', rec.region)) ? rec.region : 'touchdown';
  const def = files.get(pathOf('regions', region))?.data;
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify({ id: region, def, [kind]: { id: cur.id, def: cur.draft }, setup: playSetup() }));
  } catch (e) { toast(`Couldn't hand it to the game: ${(e as Error).message}`, true); return; }
  window.open(`${import.meta.env.BASE_URL}?preview=1&intro=0`, 'exo-playtest');
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
  if (!isMap()) {
    const undo = h('button', { textContent: '↶', title: 'Undo (Ctrl+Z)', id: 'undo' });
    const redo = h('button', { textContent: '↷', title: 'Redo (Ctrl+Shift+Z)', id: 'redo' });
    undo.onclick = () => undoStep(-1);
    redo.onclick = () => undoStep(1);
    actions.prepend(undo, redo);
  }
  if (c.kind === 'many') {
    const dup = h('button', { textContent: 'Duplicate' });
    dup.onclick = () => void newRecord(cur!.coll, cur!.draft);
    const ren = h('button', { textContent: 'Rename', title: 'Give it a new id (file name) and update everything that refers to it' });
    ren.onclick = () => void doRename();
    const cmp = h('button', { textContent: 'Compare', title: `Side by side with another ${c.label.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}` });
    cmp.onclick = () => {
      if (!cur || !confirmDiscard()) return;
      const ids = recordsOf(cur.coll).map((r) => r.id);
      const other = ids[(ids.indexOf(cur.id) + 1) % ids.length];
      showCompare(cur.coll, cur.id, other, true);
    };
    const del = h('button', { cls: 'danger', textContent: 'Delete' });
    del.onclick = () => void doDelete();
    actions.append(dup, ren, cmp, del);
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
    const inhabitants = Object.fromEntries([...(idIndex().inhabitants ?? [])].map((id) => [id, files.get(pathOf('inhabitants', id))?.data as { land?: number }]));
    const rd = <T,>(c: CollectionName, id: string) => files.get(pathOf(c, id))?.data as T | undefined;
    const rules = { coreRange: rd<BuildingDef>('buildings', 'core')?.range ?? 45, buildRadius: rd<{ buildRadius: number }>('colony', 'colony')?.buildRadius ?? 30, packSpeed: rd<UnitDef>('units', 'swarmer')?.speed ?? 6 };
    mapEd = new MapEditor(host, $('aside'), { id: at.id, draft: at.draft, changed, control, inhabitants, rules });
    changed();
    return;
  }
  const form = h('div', { cls: 'form' });
  for (const [key, f] of Object.entries(c.shape)) {
    // a list holds many inputs and buttons: a <label> round it would steal clicks
    const row = h(f.kind === 'list' ? 'div' : 'label', { cls: 'row' });
    row.dataset.key = key;
    row.append(
      h('span', { cls: 'lbl', textContent: f.label ?? key }, f.optional ? h('small', { textContent: ' optional' }) : null),
      h('span', { cls: 'ctl' }, control(cur.draft, key, f, changed), f.kind === 'num' && f.unit ? h('span', { cls: 'unit', textContent: f.unit }) : null, h('span', { cls: 'was' })),
      h('span', { cls: 'help', textContent: f.help ?? '' }),
      h('span', { cls: 'issue' }),
    );
    form.append(row);
  }
  let panel: HTMLElement | null = null;
  if (cur.coll === 'story') panel = storyPanel();
  if (cur.coll === 'missions') panel = missionPanel();
  timeline = null;
  if (cur.coll === 'landing') {
    timeline = timelinePanel({
      draft: () => cur!.draft as unknown as LandingDef,
      changed,
      rerender: () => renderForm(),
      reveal(field) {
        const row = document.querySelector<HTMLElement>(`[data-item="${field}"]`) ?? document.querySelector<HTMLElement>(`.row[data-key="${field}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
      },
      play(from) {
        try {
          localStorage.setItem(PREVIEW_KEY, JSON.stringify({ id: 'touchdown', def: files.get(pathOf('regions', 'touchdown'))?.data, landing: cur!.draft }));
        } catch (e) { toast(`Couldn't hand it to the game: ${(e as Error).message}`, true); return; }
        window.open(`${import.meta.env.BASE_URL}?preview=1&title=0${from > 0 ? `&cine=${from.toFixed(1)}` : ''}`, 'exo-playtest');
      },
    });
    panel = timeline.el;
  }
  if (cur.coll === 'interface') {
    const play = h('button', { cls: 'primary', textContent: '▶ Open the game with this look', title: 'A fresh game on Touchdown with these settings (unsaved edits too)' });
    play.onclick = () => {
      try { localStorage.setItem(PREVIEW_KEY, JSON.stringify({ id: 'touchdown', def: files.get(pathOf('regions', 'touchdown'))?.data, interface: cur!.draft })); } catch (e) { toast(`Couldn't hand it to the game: ${(e as Error).message}`, true); return; }
      window.open(`${import.meta.env.BASE_URL}?preview=1&intro=0`, 'exo-playtest');
    };
    const mock = h('div', { cls: 'ui-mock', id: 'ui-mock', innerHTML: `
      <div class="m-brand">EXO GENESIS <span>// ACCORD CARETAKER · M1</span></div>
      <div class="m-res"><span class="r"><b>2.0</b>/4.3 MW</span><span class="r"><b>◆ 211</b></span><span class="r warn"><b>❄ 120</b> embryos · 92%</span><span class="r">SOL 1 · 08:55 ☀</span><span class="r bad">⚠ 6 hostiles</span></div>
      <div class="m-goals"><div class="gh">TOUCHDOWN</div><ul><li class="done">Land</li><li class="now">Build a Solar Array to power the cryo bank</li></ul></div>
      <div class="m-card"><div class="who">THE DIRECTOR<small>Sol Mission Control</small></div><div class="t">MISSION BRIEFING</div><p>Accord, this is Mission Control. Power first. Everything else after.</p><div class="grp"><button>Continue</button></div></div>
      <div class="m-log"><div class="ev">Solar Array online · +2.0 MW at noon</div><div class="ev warn">Predators sighted to the north-east</div><div class="ev bad">Turret destroyed</div></div>
      <div class="m-bar"><button>⚒ Build</button><button class="on">▶</button><button>Surface</button><button>Planet</button></div>` });
    panel = h('div', { cls: 'story-panel' }, mock, h('div', { cls: 'actions' }, play), h('div', { cls: 'note', textContent: 'A sketch of the HUD with these settings; the game shows the real thing. Interface size and the log settings show in the game only.' }));
  }
  if (cur.coll === 'characters') panel = h('div', { cls: 'story-panel' }, h('div', { cls: 'story-card', id: 'char-card' }), h('div', { cls: 'char-lines', id: 'char-lines' }));
  if (cur.coll === 'assets') {
    assetPanel = new AssetPanel(cur.id, cur.draft as unknown as AssetDef, assetHost, async () => { await doSave(); return !dirty(); });
    panel = assetPanel.root;
    // the file and kind are managed by upload / Replace file
    (form.querySelector('.row[data-key=file] input') as HTMLInputElement).readOnly = true;
    (form.querySelector('.row[data-key=kind] select') as HTMLSelectElement).disabled = true;
    if ((cur.draft as unknown as AssetDef).kind !== 'model') {
      for (const k of ['scale', 'yaw', 'lift']) form.querySelector(`.row[data-key=${k}]`)?.remove();
    }
  }
  main.replaceChildren(
    h('div', { cls: 'head' }, h('div', {}, title, h('div', { cls: 'path', textContent: `content/${cur.path}` })), actions),
    h('div', { cls: 'stale', id: 'stale', textContent: 'This file changed on disk while you were editing. Saving will ask before overwriting.' }),
    ...(panel ? [panel] : []),
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
    // fields that don't apply (a `when` not met) are hidden
    row.style.display = shape[k] && !applies(shape[k], cur.draft) ? 'none' : '';
    const fk = shape[k];
    if (fk?.kind === 'choice' && fk.helps) row.querySelector('.help')!.textContent = fk.helps[cur.draft[k] as string] ?? fk.help ?? '';
    const msg = iss.filter((i) => i.field === k || i.field.startsWith(`${k}[`)).map((i) => (i.field === k ? i.msg : `${i.field.slice(k.length)}: ${i.msg}`)).join('; ');
    row.querySelector('.issue')!.textContent = msg;
    row.classList.toggle('invalid', !!msg);
    const was = JSON.stringify(cur.saved[k]) !== JSON.stringify(cur.draft[k]);
    row.classList.toggle('changed', was);
    row.querySelector('.was')!.textContent = was ? `was ${fmt(cur.saved[k])}` : '';
  }
  record();
  const ub = document.getElementById('undo') as HTMLButtonElement | null;
  if (ub && hist) { ub.disabled = hist.at === 0; ($('redo') as HTMLButtonElement).disabled = hist.at >= hist.stack.length - 1; }
  const isDirty = dirty();
  ($('save') as HTMLButtonElement).disabled = !isDirty;
  ($('revert') as HTMLButtonElement).disabled = !isDirty;
  $('stale').classList.toggle('show', !!cur.stale);
  if (coll(cur.coll).kind === 'many') document.querySelector('#main h1')!.textContent = titleOf(cur.coll, cur.id, cur.draft);
  document.title = `${isDirty ? '● ' : ''}Exo Genesis Editor`;
  document.querySelector('#side .item.on')?.classList.toggle('dirty', isDirty);

  assetPanel?.update(cur.draft as unknown as AssetDef);
  if (cur.coll === 'story') renderStoryPreview();
  if (cur.coll === 'characters') renderCharacter();
  timeline?.update();
  if (cur.coll === 'interface') { const m = document.getElementById('ui-mock'); if (m) applyInterface(cur.draft as unknown as InterfaceDef, m); }
  if (cur.coll === 'missions') document.getElementById('story-sum')?.replaceChildren(...missionSummary(cur.draft as Partial<MissionDef>).map((line) => h('div', { textContent: line })));
  if (isMap()) {
    $('main').querySelector('.map-issues')?.remove();
    if (iss.length) $('main').querySelector('.head')!.after(h('div', { cls: 'map-issues', textContent: iss.map((i) => `${i.field}: ${i.msg}`).join(' · ') }));
    return;
  }
  // aside: problems + the exact JSON that will be written
  for (const r of document.querySelectorAll<HTMLElement>('.list-ctl [data-item]')) {
    const msg = iss.filter((i) => i.field === r.dataset.item).map((i) => i.msg).join('; ');
    r.querySelector('.issue')!.textContent = msg;
    r.classList.toggle('invalid', !!msg);
  }
  const extra = iss.filter((i) => !(i.field in shape) && !Object.keys(shape).some((k) => i.field.startsWith(`${k}[`)));
  const used = coll(cur.coll).kind === 'many' ? refsTo(allRecords(), cur.coll, cur.id) : [];
  const usedEls = used.map((u) => {
    const b = h('button', { cls: 'used-by' }, h('span', { textContent: titleOf(u.coll, u.id, files.get(pathOf(u.coll, u.id))?.data) }), h('small', { textContent: `${coll(u.coll).label.replace(/s$/, '').toLowerCase()} · ${u.field}` }));
    b.onclick = () => open(u.coll, u.id);
    return b;
  });
  $('aside').replaceChildren(
    ...(coll(cur.coll).kind === 'many' && cur.coll !== 'assets' ? [h('div', { cls: 'group', textContent: used.length ? `Used by ${used.length}` : 'Used by nothing' }), ...usedEls] : []),
    h('div', { cls: 'group', textContent: iss.length ? `${iss.length} problem${iss.length > 1 ? 's' : ''}` : 'No problems' }),
    ...extra.map((i) => h('div', { cls: 'issue', textContent: `${i.field || '(file)'}: ${i.msg}` })),
    h('div', { cls: 'group', textContent: 'File preview' }),
    h('pre', { textContent: serialize(cur.coll, cur.draft) }),
  );
}

// ---------- undo ----------
/** The field being typed in ("hp", "choices[0].label"), so a burst of typing is one undo step. */
function focusKey(): string {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !(a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && ['text', 'number', 'search'].includes((a as HTMLInputElement).type)))) return '';
  const row = a.closest<HTMLElement>('[data-item], [data-key]');
  return row ? row.dataset.item ?? row.dataset.key ?? '' : '';
}

/** Note the draft in the undo history if it changed (typing in one field within a second merges). */
function record() {
  if (!cur || !hist || isMap()) return;
  const s = JSON.stringify(cur.draft);
  if (s === hist.stack[hist.at]) return;
  const key = focusKey(), now = performance.now();
  hist.stack.length = hist.at + 1;
  if (key && key === hist.key && now - hist.t < 1000 && hist.at > 0) hist.stack[hist.at] = s;
  else {
    hist.stack.push(s);
    hist.at++;
    if (hist.stack.length > 200) { hist.stack.shift(); hist.at--; }
  }
  hist.t = now;
  hist.key = key;
}

/** Step back (-1) or forward (+1) through the open record's history. */
function undoStep(dir: -1 | 1) {
  if (!cur || !hist || isMap()) return;
  const to = hist.at + dir;
  if (to < 0 || to >= hist.stack.length) return;
  const a = document.activeElement as HTMLElement | null;
  const row = a?.closest<HTMLElement>('[data-item], [data-key]');
  const sel = row ? (row.dataset.item ? `[data-item="${row.dataset.item}"]` : `.row[data-key="${row.dataset.key}"]`) : '';
  hist.at = to;
  hist.key = '';
  cur.draft = JSON.parse(hist.stack[to]);
  renderForm();
  renderSide();
  if (sel) document.querySelector<HTMLElement>(`${sel} input, ${sel} textarea, ${sel} select`)?.focus();
}

// ---------- rename ----------
/** New id for the open record: writes it under the new name, points every reference at it, removes the old file. */
async function doRename() {
  if (!cur || coll(cur.coll).kind !== 'many') return;
  if (dirty()) { toast('Save or revert your changes first', true); return; }
  const c = cur.coll, from = cur.id, fromPath = cur.path;
  if (REQUIRED[c]?.includes(from)) { toast(`The game's code refers to "${from}" by name, so it keeps this id`, true); return; }
  const to = prompt(`New id for "${titleOf(c, from, cur.saved)}" (lowercase letters, digits, - or _; becomes the file name):`, from)?.trim();
  if (!to || to === from) return;
  if (!ID_RE.test(to)) { toast('Ids are lowercase letters, digits, - and _ (start with a letter or digit)', true); return; }
  if (files.has(pathOf(c, to))) { toast(`${to} already exists`, true); return; }
  const changes = renameRefs(allRecords(true), c, from, to);
  const saves = ['units', 'buildings', 'regions', 'story', 'missions'].includes(c)
    ? '\n\nSaved games remember this id. A colony saved before the rename may lose track of it (a building of this kind, an event already seen, a mission done).' : '';
  const list = changes.map((r) => `  • ${r.title} (${coll(r.coll).label.toLowerCase()})`).join('\n');
  if (!confirm(`Rename ${from} → ${to}?\n\n${changes.length ? `Also updates ${changes.length} record${changes.length > 1 ? 's' : ''} that refer to it:\n${list}` : 'Nothing refers to it.'}${saves}`)) return;
  const data = structuredClone(cur.saved);
  try {
    await api('PUT', '/__content/file', { path: pathOf(c, to), text: serialize(c, data), baseHash: null });
    for (const r of changes) {
      const p = pathOf(r.coll, r.id);
      await api('PUT', '/__content/file', { path: p, text: serialize(r.coll, r.data as Record<string, unknown>), baseHash: files.get(p)!.hash });
    }
    await api('DELETE', '/__content/file', { path: fromPath, baseHash: cur.baseHash });
    await loadAll();
    open(c, to, true);
    toast(`Renamed ${from} → ${to}${changes.length ? ` and updated ${changes.length} record${changes.length > 1 ? 's' : ''}` : ''}`);
  } catch (e) {
    toast(`Rename stopped: ${(e as Error).message}. Some files may have changed: see Review.`, true);
    await loadAll();
    renderSide();
  }
  void refreshGit();
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
  const asset = cur.coll === 'assets' ? (cur.saved as unknown as AssetDef) : null;
  const users = asset ? usedBy(cur.id) : [];
  const what = asset ? `content/${cur.path} and public/media/${asset.kind}/${asset.file}` : `content/${cur.path}`;
  const warn = users.length ? `\n\nStill used by ${users.map((u) => u.name).join(', ')}: they'll show a content error until you change their Model (or sound file).` : '';
  if (!confirm(`Delete ${what}? (Recoverable from git until you commit.)${warn}`)) return;
  try {
    await api('DELETE', '/__content/file', { path: cur.path, baseHash: cur.baseHash });
    files.delete(cur.path);
    const mp = asset ? `${asset.kind}/${asset.file}` : '';
    if (asset && media.has(mp)) await api('DELETE', '/__content/media', { path: mp, baseHash: media.get(mp)!.hash });
    toast(`Deleted ${what}`);
    teardown();
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
    st.onclick = n ? () => showPage('review') : null;
    st.title = n ? `${st.title}\n\nClick to review the changes` : st.title;
    ($('commit') as HTMLButtonElement).disabled = n === 0;
    if (WEB) { ($('discard') as HTMLButtonElement).disabled = n === 0; ($('export') as HTMLButtonElement).disabled = n === 0; }
  } catch { /* dev server restarting */ }
}

async function doCommit() {
  const input = $<HTMLInputElement>('commit-msg');
  const message = input.value.trim();
  if (!message) { input.focus(); toast('Write a short description first', true); return; }
  if (dirty() && !confirm('The open record has unsaved changes, which won\'t be included. Commit anyway?')) return;
  try {
    let r: { commit: string; files: number };
    try {
      r = await api<typeof r>('POST', '/__content/commit', { message });
    } catch (e) {
      if (!(WEB && e instanceof ApiError && e.status === 409)) throw e;
      if (!confirm(`Some files ${e.message}.\n\nOK = commit yours over them\nCancel = don't commit (Discard drops your changes)`)) return;
      r = await api<typeof r>('POST', '/__content/commit?overwrite=1', { message });
    }
    input.value = '';
    toast(`Committed ${r.files} file${r.files > 1 ? 's' : ''} as ${r.commit}${WEB ? ' · the game updates in a minute or two' : ''}`);
    void refreshGit();
  } catch (e) {
    toast(`Commit failed: ${(e as Error).message}`, true);
  }
}

async function doDiscard() {
  if (!confirm('Drop every uncommitted change made in this browser? This can\'t be undone.')) return;
  await api('POST', '/__content/discard');
  if (cur) open(cur.coll, cur.id, true);
  await poll();
  toast('Discarded uncommitted changes');
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
    if (isPage(view) && view !== 'text' && view !== 'planet' && !cur && signature() !== librarySig) { PAGES[view](); librarySig = signature(); }
    if (view === 'library' && !cur && signature() !== librarySig) {
      renderLibrary($('main'), $('aside'), assetHost);
      librarySig = signature();
    }
    renderSide();
    await refreshGit();
  } catch { /* dev server restarting */ }
}

// ---------- assets ----------
function usedBy(assetId: string): Usage[] {
  const out: Usage[] = [];
  for (const c of ['units', 'buildings'] as const) {
    for (const r of recordsOf(c)) {
      const d = r.rec.data as { model?: string } | null;
      if (d?.model === assetId) out.push({ coll: c, id: r.id, name: titleOf(c, r.id, d) });
    }
  }
  const snd = files.get(pathOf('sound', 'sound'))?.data as Record<string, unknown> | undefined;
  if (snd && Object.values(snd).includes(assetId)) out.push({ coll: 'sound', id: 'sound', name: 'Sound rules' });
  return out;
}

const assetHost: AssetHost = {
  records: () => recordsOf('assets').filter((r) => r.rec.data && !r.rec.parseError).map((r) => ({ id: r.id, data: r.rec.data as AssetDef })),
  media: () => media,
  usedBy,
  builtinUse(b) {
    if (!b.usedBy) return {};
    const rec = files.get(pathOf(b.usedBy.coll, b.usedBy.id));
    if (!rec?.data) return {};
    const d = rec.data as { model?: string };
    return { user: { ...b.usedBy, name: titleOf(b.usedBy.coll, b.usedBy.id, d) }, replacedBy: d.model };
  },
  openRecord: (c, id) => open(c, id),
  openBuiltin: (id) => showBuiltin(id),
  api,
  toast,
  refresh: async () => { await loadAll(); renderSide(); await refreshGit(); },
};

function showLibrary(force = false) {
  if (!force && !confirmDiscard()) return;
  teardown();
  cur = null;
  view = 'library';
  history.replaceState(null, '', '#library');
  renderLibrary($('main'), $('aside'), assetHost);
  librarySig = signature();
  renderSide();
}

// ---------- whole-content pages: story flow, balance table, review ----------
function drawFlow() {
  const data = <T,>(c: CollectionName) => Object.fromEntries(recordsOf(c).filter((r) => r.rec.data && typeof r.rec.data === 'object').map((r) => [r.id, r.rec.data as T]));
  renderFlow($('main'), $('aside'), { missions: data<MissionDef>('missions'), story: data<StoryDef>('story'), open: (l) => open(l.coll, l.id) });
}
function drawBalance() {
  const data = <T,>(c: CollectionName) => Object.fromEntries(recordsOf(c).filter((r) => r.rec.data && typeof r.rec.data === 'object').map((r) => [r.id, r.rec.data as T]));
  renderBalance($('main'), data<UnitDef>('units'), data<BuildingDef>('buildings'), (c, id) => open(c, id));
  $('main').append(balanceRunPanel({
    files: () => Object.fromEntries([...files.values()].filter((f) => !f.parseError).map((f) => [f.path, f.data])),
    regions: recordsOf('regions').map((r) => r.id),
  }));
  $('aside').replaceChildren(h('div', { cls: 'group', textContent: 'Reading the table' }), h('div', { cls: 'help-block', textContent:
    'DPS = damage ÷ cooldown, against one target (splash, chains and minimum range aren\'t counted). "/ 100 ◆" columns divide by cost, so they show value for money. Fauna have no cost. Built-in rules (drone cost, pack sizes) are in Rules.' }));
}
async function drawReview() {
  const g = await api<{ changes: { status: string; path: string }[] }>('GET', '/__content/git');
  const out: ReviewFile[] = [];
  for (const c of g.changes) {
    const isJson = !c.path.startsWith('public/') && c.path.endsWith('.json');
    if (!isJson) { out.push({ status: c.status, path: c.path, before: null, after: null, binary: true }); continue; }
    const before = (await api<{ text: string | null }>('GET', `/__content/orig?path=${encodeURIComponent(c.path)}`).catch(() => ({ text: null }))).text;
    const after = c.status === 'D' ? null : (await api<{ text: string }>('GET', `/__content/file?path=${encodeURIComponent(c.path)}`).catch(() => null))?.text ?? null;
    out.push({ status: c.status, path: c.path, before, after });
  }
  if (view !== 'review' || cur) return;
  renderReview($('main'), out, (p) => { const at = locate(p); if (at) open(at.coll, at.id); });
  $('aside').replaceChildren(h('div', { cls: 'group', textContent: 'Commit' }), h('div', { cls: 'help-block', textContent:
    'Write what changed in the box at the top and press Commit. Unsaved edits in an open record are not included: save them first.' }));
}
function drawProblems() {
  renderProblems($('main'), $('aside'), savedProblems(), (p) => { const at = locate(p); return at ? titleOf(at.coll, at.id, files.get(p)?.data) : p; }, (p) => { const at = locate(p); if (at) open(at.coll, at.id); });
}
function drawCompare() {
  if (!compareAt) return;
  const { coll: c } = compareAt;
  renderCompare($('main'), $('aside'), {
    coll: c, a: compareAt.a, b: compareAt.b,
    ids: recordsOf(c).map((r) => r.id),
    data: (id) => files.get(pathOf(c, id))?.data,
    title: (id) => titleOf(c, id, files.get(pathOf(c, id))?.data),
    open: (id) => open(c, id),
    pick: (a, b) => showCompare(c, a, b, true),
  });
}
function showCompare(c: CollectionName, a: string, b: string, force = false) {
  compareAt = { coll: c, a, b };
  showPage('compare', force, `compare/${c}/${a}/${b}`);
}
function drawText() {
  renderText($('main'), $('aside'), {
    entries: collectText(allRecords()),
    open: (c, id) => open(c, id),
    save: saveText,
  }, textState);
}
/** Text page: write one string back into its record's file. */
async function saveText(e: TextEntry, text: string): Promise<boolean> {
  const p = pathOf(e.coll, e.id), rec = files.get(p);
  if (!rec?.data) return false;
  const data = structuredClone(rec.data) as Record<string, unknown>;
  setAt(data, e.field, text);
  const out = serialize(e.coll, data);
  try {
    const r = await api<{ hash: string }>('PUT', '/__content/file', { path: p, text: out, baseHash: rec.hash });
    files.set(p, { path: p, hash: r.hash, data: JSON.parse(out) });
    librarySig = signature(); // our own save: don't redraw the page under the cursor
    toast(`Saved ${e.label} in content/${p}`);
    void refreshGit();
    return true;
  } catch (err) {
    toast(`Save failed: ${(err as Error).message}${err instanceof ApiError && err.status === 409 ? ' (changed elsewhere: reload the page)' : ''}`, true);
    return false;
  }
}
async function drawChanges() {
  $('main').replaceChildren(h('div', { cls: 'head' }, h('h1', { textContent: 'Since last release' })), h('p', { cls: 'note', textContent: 'Loading the last release…' }));
  try {
    const r = await api<{ version: string; commit: string; date: string; message: string; files: Record<string, string> }>('GET', '/__content/release');
    const before: Record<string, unknown> = {};
    for (const [p, t] of Object.entries(r.files)) { try { before[p] = JSON.parse(t); } catch { /* invalid then: shows as changed */ } }
    const after: Record<string, unknown> = {};
    for (const f of files.values()) if (!f.parseError) after[f.path] = f.data;
    if (view !== 'changes' || cur) return;
    renderChanges($('main'), $('aside'), { ...r, changes: diffContent(before, after, locate), current: CHANGELOG[0]?.version ?? '?', open: (c, id) => open(c, id) });
  } catch (e) {
    if (view === 'changes' && !cur) $('main').replaceChildren(h('div', { cls: 'head' }, h('h1', { textContent: 'Since last release' })), h('p', { cls: 'err', textContent: `Couldn't load the last release: ${(e as Error).message}` }));
  }
}
function drawPlanet() {
  viewHandle?.dispose();
  viewHandle = renderPlanet($('main'), $('aside'), {
    regions: recordsOf('regions').filter((r) => r.rec.data && typeof r.rec.data === 'object').map((r) => {
      const d = r.rec.data as { name?: string; siteLat?: number; siteLon?: number };
      return { id: r.id, name: d.name || r.id, lat: d.siteLat ?? 0, lon: d.siteLon ?? 0 };
    }),
    open: (id) => open('regions', id),
    async save(moves) {
      for (const m of moves) {
        const p = pathOf('regions', m.id), rec = files.get(p);
        if (!rec?.data) continue;
        const data = structuredClone(rec.data) as Record<string, unknown>;
        if (m.lat || m.lon) { data.siteLat = m.lat; data.siteLon = m.lon; } else { delete data.siteLat; delete data.siteLon; }
        const text = serialize('regions', data);
        try {
          const r = await api<{ hash: string }>('PUT', '/__content/file', { path: p, text, baseHash: rec.hash });
          files.set(p, { path: p, hash: r.hash, data: JSON.parse(text) });
        } catch (e) { toast(`Couldn't save ${m.id}: ${(e as Error).message}`, true); return; }
      }
      librarySig = signature();
      toast(`Saved ${moves.length} region position${moves.length > 1 ? 's' : ''}`);
      void refreshGit();
    },
  });
}
const PAGES = {
  flow: drawFlow, balance: drawBalance, review: () => void drawReview(), problems: drawProblems, compare: drawCompare, text: drawText,
  changes: () => void drawChanges(), planet: drawPlanet,
} as const;
type PageName = keyof typeof PAGES;
const isPage = (v: unknown): v is PageName => typeof v === 'string' && v in PAGES;
function showPage(page: PageName, force = false, hash: string = page) {
  if (!force && !confirmDiscard()) return;
  teardown();
  cur = null;
  view = page;
  history.replaceState(null, '', `#${hash}`);
  PAGES[page]();
  librarySig = signature();
  renderSide();
}

function showBuiltin(id: string) {
  if (!confirmDiscard()) return;
  teardown();
  cur = null;
  view = { builtin: id };
  history.replaceState(null, '', `#builtin/${id}`);
  viewHandle = renderBuiltin($('main'), $('aside'), assetHost, id);
  renderSide();
}

async function addFiles(list: File[]) {
  if (!list.length) return;
  const made = await uploadFiles(assetHost, list);
  if (made.length === 1) open('assets', made[0], true);
  else if (made.length) showLibrary(true);
}

/** Changes when anything the library shows changes (so polling only redraws when needed). */
let librarySig = '';
const signature = () => [...files.values()].map((f) => f.hash).join() + [...media.values()].map((m) => m.hash).join();

// drop files anywhere to add them
addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  if (!confirmDiscard()) return;
  void addFiles([...e.dataTransfer.files]);
});

// ---------- web: GitHub sign-in or file mode ----------
/** File mode: no token, no Commit; changes leave as an export file for tools/import-changes.mjs. */
const fileMode = () => mode.get() === 'file';

async function doExport() {
  if (dirty() && !confirm('The open record has unsaved changes, which won\'t be included. Export anyway?')) return;
  try {
    const message = $<HTMLInputElement>('commit-msg').value.trim();
    const data = await api<{ changes: unknown[] }>('POST', '/__content/export', { message });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: `exo-changes-${stamp}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast(`Exported ${data.changes.length} change${data.changes.length > 1 ? 's' : ''}. Send the file to Claude; they clear here once the game is redeployed with them.`);
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, true);
  }
}

/** Until the editor has a working token or file mode is chosen, the main pane asks (and nothing else loads). */
async function webSetup() {
  const game = $<HTMLAnchorElement>('open-game');
  game.href = `${import.meta.env.BASE_URL}?intro=0`;
  const git = $('git');
  const exp = h('button', { id: 'export', textContent: 'Export', title: 'Download every uncommitted change as one file for Claude to import', disabled: true });
  exp.onclick = () => void doExport();
  const discard = h('button', { id: 'discard', textContent: 'Discard', title: 'Drop uncommitted changes made in this browser', disabled: true });
  discard.onclick = () => void doDiscard();
  const out = fileMode()
    ? h('button', { cls: 'mini', textContent: 'Connect GitHub', title: 'Use a GitHub token to commit directly' })
    : h('button', { cls: 'mini', textContent: 'Sign out', title: 'Forget the GitHub token in this browser' });
  out.onclick = fileMode()
    ? () => { mode.set('github'); location.reload(); }
    : () => { if (confirm('Forget the GitHub token in this browser? Uncommitted changes stay here.')) { token.clear(); location.reload(); } };
  git.append(exp, discard, out);
  const emptyHtml = fileMode()
    ? 'Pick something on the left. You\'re editing the deployed content without GitHub: saves stay in this browser, and <b>Export</b> downloads them as one file for Claude to import. They clear here once the game is redeployed with them.'
    : `Pick something on the left. Saves stay in this browser until you <b>Commit</b>, which pushes them to <code>${REPO}</code>; the game here updates a minute or two later. <b>Export</b> downloads them as a file instead.`;
  $('empty').innerHTML = emptyHtml;
  if (fileMode()) {
    $('commit').style.display = 'none';
    $<HTMLInputElement>('commit-msg').placeholder = 'Describe your changes (goes in the export)';
    $('commit-msg').onkeydown = (e) => { if (e.key === 'Enter') void doExport(); };
    return;
  }
  let problem = token.get() ? await checkToken() : '';
  while (problem !== null) {
    problem = await new Promise<string | null>((done) => {
      const input = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
      input.style.width = '100%';
      const go = h('button', { cls: 'primary', textContent: 'Connect' });
      const msg = h('p', { cls: 'err' });
      if (problem) msg.textContent = problem;
      const submit = async () => {
        const t = input.value.trim();
        if (!t) return;
        token.set(t);
        go.disabled = true;
        const p = await checkToken();
        if (p) token.clear();
        done(p);
      };
      go.onclick = () => void submit();
      input.onkeydown = (e) => { if (e.key === 'Enter') void submit(); };
      const noToken = h('button', { id: 'no-token', textContent: 'Work without GitHub (export a file)' });
      noToken.onclick = () => { mode.set('file'); location.reload(); };
      const link = h('a', { href: `https://github.com/settings/personal-access-tokens/new`, target: '_blank', rel: 'noopener', textContent: 'Create a fine-grained token' });
      $('main').replaceChildren(h('div', { id: 'signin' },
        h('h2', { textContent: 'Connect to GitHub' }),
        h('p', { textContent: `The editor saves by committing to ${REPO} (${BRANCH}). It needs a token that can write to that repo; it stays in this browser only.` }),
        h('ol', {},
          h('li', {}, link, ' (GitHub → Settings → Developer settings).'),
          h('li', { textContent: `Resource owner: ${REPO.split('/')[0]}. Repository access: only ${REPO.split('/')[1]}.` }),
          h('li', { textContent: 'Permissions → Contents: Read and write. Nothing else.' }),
          h('li', { textContent: 'Generate, copy, paste it here.' }),
        ),
        input, go, msg,
        h('p', { cls: 'or', textContent: 'Or edit without a token: changes download as a file you send to Claude, who imports and commits them.' }),
        noToken,
      ));
      input.focus();
    });
  }
  $('main').replaceChildren(h('div', { id: 'empty', innerHTML: emptyHtml }));
}

// ---------- boot ----------
$('commit').onclick = () => void doCommit();
$('commit-msg').onkeydown = (e) => { if (e.key === 'Enter') void doCommit(); };
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void doSave(); }
  const t = e.target as HTMLElement | null;
  // record undo (the map view has its own): not in the commit message or search boxes
  const inForm = !t || !t.closest('#top, #side-top, .tx-list');
  if (cur && !isMap() && inForm && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    undoStep(e.key.toLowerCase() === 'y' || e.shiftKey ? 1 : -1);
    return;
  }
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  if (e.key === '/' && !typing && !isMap()) { e.preventDefault(); sideSearch().focus(); }
});
addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });

if (WEB) await webSetup();
await loadAll();
renderSide();
await refreshGit();
/** Show whatever the URL hash names (#units/rover.json, #library, #builtin/tank). */
function routeTo(hash: string) {
  const route = decodeURIComponent(hash.slice(1));
  const at = locate(route);
  if (at) open(at.coll, at.id);
  else if (route === 'library') showLibrary();
  else if (route.startsWith('compare/')) {
    const [, c, a, b] = route.split('/');
    if (c in COLLECTIONS && a && b) showCompare(c as CollectionName, a, b);
  } else if (isPage(route) && route !== 'compare') showPage(route);
  else if (route.startsWith('builtin/')) showBuiltin(route.slice(8));
}
routeTo(location.hash);
addEventListener('hashchange', () => routeTo(location.hash));
setInterval(() => void poll(), 4000);

declare global { interface Window { __editor: unknown } }
window.__editor = { get cur() { return cur; }, get map() { return mapEd; }, get assetPanel() { return assetPanel; }, files, media, dirty, api };
