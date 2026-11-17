/**
 * The editor's content API, backed by GitHub instead of the dev server.
 *
 * On deeek.org there's no dev server, so `ghFetch` answers the same
 * /__content/* requests the dev server does (see devtools/content-server.ts),
 * against a working copy kept in this browser:
 *
 *   base     = the repo's tree at the head of `main` (refreshed every 30 s)
 *   pending  = saved-but-uncommitted edits, in IndexedDB (survive a reload)
 *
 * Saves only touch `pending`, so they're instant and free; Commit turns all of
 * them into one commit on `main` via the git data API, which redeploys the site.
 * Hashes are git blob shas. Conflicts work like the dev server's: a save needs
 * the hash it started from, and a commit refuses a file that changed on GitHub
 * since it was edited here, unless told to overwrite.
 *
 * Auth is a fine-grained personal access token (Contents: read and write on
 * this repo only), pasted once per browser and kept in localStorage.
 *
 * Without a token ("file" mode) the base is the content snapshot the site was
 * built with (content-manifest.json, see vite.config.ts), there's no Commit,
 * and changes leave as an export file that tools/import-changes.mjs applies on
 * hive1. Export works in both modes.
 */
export const REPO = 'pydron-bot/ExoGenesis';
export const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO}`;
const TOKEN_KEY = 'exo.editor.token';
const CONTENT_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.json$/;
const MEDIA_RE = /^(model|image|audio)\/[a-z0-9][a-z0-9_-]*\.([a-z0-9]+)$/;
const REFRESH_MS = 30_000;
const MODE_KEY = 'exo.editor.mode';
export const EXPORT_FORMAT = 'exo-changes/1';

/** 'github' (token, commits) or 'file' (no token, export only). */
export const mode = {
  get: (): 'github' | 'file' => { try { return localStorage.getItem(MODE_KEY) === 'file' ? 'file' : 'github'; } catch { return 'github'; } },
  set: (m: 'github' | 'file') => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } },
};
let fileMode = false;
/** The site's build-time content snapshot (file mode). */
let manifestTexts = new Map<string, string>();

export const token = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

// ---------- GitHub REST ----------
class GhError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token.get()}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new GhError(r.status, (data as { message?: string }).message ?? r.statusText);
  return data as T;
}

/** Checks the token can read and write this repo. Returns the problem, or null when it's fine. */
export async function checkToken(): Promise<string | null> {
  try {
    const r = await gh<{ permissions?: { push?: boolean } }>('GET', '');
    if (r.permissions && !r.permissions.push) return `That token can read ${REPO} but not write to it (needs Contents: Read and write).`;
    return null;
  } catch (e) {
    const s = (e as GhError).status;
    if (s === 401) return 'GitHub rejected that token (expired, revoked or mistyped).';
    if (s === 404) return `That token can't see ${REPO}. Give it access to that repository.`;
    return `Couldn't reach GitHub: ${(e as Error).message}`;
  }
}

// ---------- IndexedDB: pending edits + a blob text cache ----------
type Pending =
  | { kind: 'text'; text: string; sha: string; orig: string | null }
  | { kind: 'bin'; blob: Blob; sha: string; orig: string | null }
  | { kind: 'del'; orig: string };

let dbp: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('exogenesis-editor', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('pending'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function store<T>(name: 'pending' | 'blobs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(name, mode);
    const req = fn(tx.objectStore(name));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- working copy ----------
interface TreeEntry { sha: string; size: number }
let base: Map<string, TreeEntry> = new Map();
let head = '';
let lastMsg = '';
let fetchedAt = 0;
let pending = new Map<string, Pending>();
let loaded: Promise<void> | null = null;
/** Object URLs for media uploaded or replaced this session (the site serves the old file until it redeploys). */
const localMedia = new Map<string, string>();

async function gitSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchHead(): Promise<{ commit: string; tree: string; message: string }> {
  const ref = await gh<{ object: { sha: string } }>('GET', `/git/ref/heads/${BRANCH}`);
  const c = await gh<{ tree: { sha: string }; message: string }>('GET', `/git/commits/${ref.object.sha}`);
  return { commit: ref.object.sha, tree: c.tree.sha, message: c.message };
}

async function fetchTree(treeSha: string): Promise<Map<string, TreeEntry>> {
  const t = await gh<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>('GET', `/git/trees/${treeSha}?recursive=1`);
  const m = new Map<string, TreeEntry>();
  for (const e of t.tree) {
    if (e.type === 'blob' && (e.path.startsWith('content/') || e.path.startsWith('public/media/'))) m.set(e.path, { sha: e.sha, size: e.size ?? 0 });
  }
  return m;
}

async function fetchManifest(): Promise<{ commit: string; message: string; files: Record<string, { sha: string; size: number; text?: string }> }> {
  const r = await fetch(`${import.meta.env.BASE_URL}content-manifest.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`content snapshot: ${r.status}`);
  return r.json();
}

async function refresh(force = false) {
  if (!force && Date.now() - fetchedAt < (fileMode ? 5 * REFRESH_MS : REFRESH_MS)) return;
  fetchedAt = Date.now();
  let h: { commit: string; message: string; tree?: string; files?: Awaited<ReturnType<typeof fetchManifest>>['files'] };
  if (fileMode) h = await fetchManifest();
  else h = await fetchHead();
  if (h.commit !== head) {
    if (h.files) {
      base = new Map(Object.entries(h.files).map(([p, f]) => [p, { sha: f.sha, size: f.size }]));
      manifestTexts = new Map(Object.entries(h.files).filter(([, f]) => typeof f.text === 'string').map(([p, f]) => [p, f.text!]));
    } else base = await fetchTree(h.tree!);
    head = h.commit;
    lastMsg = `${h.commit.slice(0, 7)} ${h.message.split('\n')[0]}${fileMode ? ' (deployed)' : ''}`;
    // a pending edit that now matches the repo (e.g. committed from another device) is done
    for (const [p, e] of pending) {
      const now = base.get(p)?.sha ?? null;
      if ((e.kind === 'del' && now === null) || (e.kind !== 'del' && e.sha === now)) { pending.delete(p); void store('pending', 'readwrite', (s) => s.delete(p)); }
    }
  }
}

function ensureLoaded() {
  return (loaded ??= (async () => {
    fileMode = mode.get() === 'file';
    const keys = (await store<IDBValidKey[]>('pending', 'readonly', (s) => s.getAllKeys())) ?? [];
    const vals = (await store<Pending[]>('pending', 'readonly', (s) => s.getAll())) ?? [];
    pending = new Map(keys.map((k, i) => [String(k), vals[i]]));
    for (const [p, e] of pending) if (e.kind === 'bin') localMedia.set(p.slice('public/media/'.length), URL.createObjectURL(e.blob));
    await refresh(true);
  })().catch((e) => { loaded = null; throw e; }));
}

/** sha of a path in the working copy, or null if it doesn't exist. */
function shaOf(p: string): string | null {
  const e = pending.get(p);
  if (e) return e.kind === 'del' ? null : e.sha;
  return base.get(p)?.sha ?? null;
}
function paths(prefix: string): string[] {
  const out = new Set<string>();
  for (const p of base.keys()) if (p.startsWith(prefix)) out.add(p);
  for (const p of pending.keys()) if (p.startsWith(prefix)) out.add(p);
  return [...out].filter((p) => shaOf(p) !== null).sort();
}

async function setPending(p: string, e: Pending | null) {
  // an edit back to exactly what the repo has isn't a change
  const orig = base.get(p)?.sha ?? null;
  if (e && ((e.kind === 'del' && orig === null) || (e.kind !== 'del' && e.sha === orig))) e = null;
  if (e) { pending.set(p, e); await store('pending', 'readwrite', (s) => s.put(e, p)); }
  else { pending.delete(p); await store('pending', 'readwrite', (s) => s.delete(p)); }
}
/** The sha an edit of `p` started from, kept across further edits so a commit can spot GitHub-side changes. */
const origOf = (p: string): string | null => {
  const e = pending.get(p);
  return e ? e.orig : base.get(p)?.sha ?? null;
};

async function readText(p: string, original = false): Promise<string> {
  const e = original ? undefined : pending.get(p);
  if (e?.kind === 'text') return e.text;
  const sha = base.get(p)?.sha;
  if (!sha) throw new HttpErr(404, 'no such file');
  if (fileMode) {
    const t = manifestTexts.get(p);
    if (t === undefined) throw new HttpErr(404, 'not in the content snapshot');
    return t;
  }
  const hit = await store<string>('blobs', 'readonly', (s) => s.get(sha));
  if (typeof hit === 'string') return hit;
  const r = await fetch(`${API}/git/blobs/${sha}`, { headers: { accept: 'application/vnd.github.raw+json', authorization: `Bearer ${token.get()}` } });
  if (!r.ok) throw new HttpErr(r.status, `GitHub: ${r.statusText}`);
  const text = await r.text();
  await store('blobs', 'readwrite', (s) => s.put(text, sha));
  return text;
}

/** Where the editor should load a media file from: this session's upload if any, else the site's copy. */
export function localMediaUrl(rel: string): string | null {
  return localMedia.get(rel) ?? null;
}

// ---------- commit ----------
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Paths changed on GitHub since they were edited here. */
async function conflicts(tree: Map<string, TreeEntry>): Promise<string[]> {
  return [...pending].filter(([p, e]) => (tree.get(p)?.sha ?? null) !== e.orig).map(([p]) => p);
}

/** Every pending change as one self-contained file for tools/import-changes.mjs. */
async function exportChanges(message: string) {
  const changes = [];
  for (const [p, e] of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
    if (e.kind === 'del') changes.push({ path: p, op: 'delete', orig: e.orig });
    else if (e.kind === 'text') changes.push({ path: p, op: 'write', orig: e.orig, sha: e.sha, text: e.text });
    else changes.push({ path: p, op: 'write', orig: e.orig, sha: e.sha, base64: b64(new Uint8Array(await e.blob.arrayBuffer())) });
  }
  return { format: EXPORT_FORMAT, base: head, exported: new Date().toISOString(), message, changes };
}

async function commit(message: string, overwrite: boolean): Promise<{ commit: string; files: number }> {
  if (fileMode) throw new HttpErr(400, 'not connected to GitHub: use Export and send the file to Claude');
  if (!pending.size) throw new HttpErr(400, 'nothing to commit');
  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  for (const [p, e] of pending) {
    if (e.kind === 'del') { entries.push({ path: p, mode: '100644', type: 'blob', sha: null }); continue; }
    const body = e.kind === 'text'
      ? { content: e.text, encoding: 'utf-8' }
      : { content: b64(new Uint8Array(await e.blob.arrayBuffer())), encoding: 'base64' };
    const b = await gh<{ sha: string }>('POST', '/git/blobs', body);
    entries.push({ path: p, mode: '100644', type: 'blob', sha: b.sha });
  }
  for (let attempt = 0; ; attempt++) {
    const h = await fetchHead();
    const tree = h.commit === head ? base : await fetchTree(h.tree);
    const clash = await conflicts(tree);
    if (clash.length && !overwrite) {
      throw new HttpErr(409, `changed on GitHub since you edited them: ${clash.map((p) => p.replace(/^content\//, '')).join(', ')}`, { conflicts: clash });
    }
    // a delete of something already gone would make GitHub reject the tree
    const live = entries.filter((x) => x.sha !== null || tree.has(x.path));
    const t = await gh<{ sha: string }>('POST', '/git/trees', { base_tree: h.tree, tree: live });
    const c = await gh<{ sha: string }>('POST', '/git/commits', {
      message: `Content: ${message}\n\nSaved from the Exo Genesis editor (web).`,
      tree: t.sha,
      parents: [h.commit],
    });
    try {
      await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: c.sha, force: false });
    } catch (e) {
      // someone else committed in between: go round again on the new head
      if ((e as GhError).status === 422 && attempt < 2) continue;
      throw e;
    }
    const n = pending.size;
    pending.clear();
    await store('pending', 'readwrite', (s) => s.clear());
    await refresh(true);
    return { commit: c.sha.slice(0, 7), files: n };
  }
}

// ---------- the /__content/* API ----------
class HttpErr extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function handle(method: string, url: URL, body: unknown, raw: Blob | null): Promise<unknown> {
  await ensureLoaded();
  const route = `${method} ${url.pathname.replace(/^.*\/__content\//, '/__content/')}`;
  if (method === 'GET') await refresh();
  const b = (body ?? {}) as { path?: string; text?: string; baseHash?: string | null; message?: string };
  switch (route) {
    case 'GET /__content/files':
      return paths('content/').filter((p) => p.endsWith('.json')).map((p) => ({ path: p.slice(8), hash: shaOf(p) }));
    case 'GET /__content/file': {
      const rel = url.searchParams.get('path') ?? '';
      const p = `content/${rel}`;
      if (shaOf(p) === null) throw new HttpErr(404, 'no such file');
      return { path: rel, text: await readText(p), hash: shaOf(p) };
    }
    case 'GET /__content/orig': {
      // the version on GitHub (or in the site's snapshot), before this browser's changes
      const rel = url.searchParams.get('path') ?? '';
      const p = `content/${rel}`;
      if (!base.get(p)) return { text: null };
      return { text: await readText(p, true) };
    }
    case 'PUT /__content/file': {
      if (!b.path || !CONTENT_RE.test(b.path) || typeof b.text !== 'string') throw new HttpErr(400, 'bad path or text');
      const p = `content/${b.path}`;
      const cur = shaOf(p);
      if (cur !== (b.baseHash ?? null)) {
        throw new HttpErr(409, cur === null ? 'file was deleted' : b.baseHash ? 'file changed since you opened it' : 'file already exists', { hash: cur, text: cur ? await readText(p) : null });
      }
      const sha = await gitSha(new TextEncoder().encode(b.text));
      await setPending(p, { kind: 'text', text: b.text, sha, orig: origOf(p) });
      return { hash: sha };
    }
    case 'DELETE /__content/file': {
      const p = `content/${b.path ?? ''}`;
      const cur = shaOf(p);
      if (cur === null) throw new HttpErr(404, 'no such file');
      if (cur !== b.baseHash) throw new HttpErr(409, 'file changed since you opened it', { hash: cur });
      const orig = origOf(p);
      await setPending(p, orig === null ? null : { kind: 'del', orig });
      return {};
    }
    case 'GET /__content/media':
      return paths('public/media/').map((p) => {
        const e = pending.get(p);
        return { path: p.slice(13), hash: shaOf(p), bytes: e?.kind === 'bin' ? e.blob.size : base.get(p)?.size ?? 0 };
      });
    case 'PUT /__content/media': {
      const rel = url.searchParams.get('path') ?? '';
      if (!MEDIA_RE.test(rel) || !raw) throw new HttpErr(400, 'bad media path');
      if (raw.size > 64 << 20) throw new HttpErr(413, 'file too large (64 MB max)');
      const p = `public/media/${rel}`;
      const cur = shaOf(p), baseHash = url.searchParams.get('baseHash') || null;
      if (cur !== baseHash) throw new HttpErr(409, cur === null ? 'file was deleted' : baseHash ? 'file changed' : 'file already exists', { hash: cur });
      const blob = new Blob([await raw.arrayBuffer()]);
      const sha = await gitSha(new Uint8Array(await blob.arrayBuffer()));
      await setPending(p, { kind: 'bin', blob, sha, orig: origOf(p) });
      const old = localMedia.get(rel);
      if (old) URL.revokeObjectURL(old);
      localMedia.set(rel, URL.createObjectURL(blob));
      return { hash: sha, bytes: blob.size };
    }
    case 'DELETE /__content/media': {
      const p = `public/media/${b.path ?? ''}`;
      const cur = shaOf(p);
      if (cur === null) throw new HttpErr(404, 'no such file');
      if (cur !== b.baseHash) throw new HttpErr(409, 'file changed', { hash: cur });
      const orig = origOf(p);
      await setPending(p, orig === null ? null : { kind: 'del', orig });
      localMedia.delete(b.path ?? '');
      return {};
    }
    case 'GET /__content/git':
      return {
        changes: [...pending].map(([p, e]) => ({
          status: e.kind === 'del' ? 'D' : e.orig === null ? 'A' : 'M',
          path: p.replace(/^content\//, ''),
        })),
        last: lastMsg,
      };
    case 'POST /__content/export':
      if (!pending.size) throw new HttpErr(400, 'nothing to export');
      return exportChanges((b.message ?? '').trim());
    case 'POST /__content/discard': {
      for (const rel of [...localMedia.keys()]) if (pending.has(`public/media/${rel}`)) { URL.revokeObjectURL(localMedia.get(rel)!); localMedia.delete(rel); }
      pending.clear();
      await store('pending', 'readwrite', (s) => s.clear());
      return {};
    }
    case 'POST /__content/commit': {
      const msg = (b.message ?? '').trim();
      if (!msg) throw new HttpErr(400, 'commit message required');
      return commit(msg, url.searchParams.get('overwrite') === '1');
    }
  }
  throw new HttpErr(404, `unknown route ${route}`);
}

/** Drop-in for `fetch` on /__content/* URLs. */
export async function ghFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, location.href);
  const method = (init.method ?? 'GET').toUpperCase();
  const raw = init.body instanceof Blob ? init.body : null;
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  try {
    return json(200, await handle(method, url, body, raw));
  } catch (e) {
    if (e instanceof HttpErr) return json(e.status, { error: e.message, ...e.extra });
    if (e instanceof GhError) return json(e.status === 401 ? 401 : 502, { error: `GitHub: ${e.message}` });
    return json(500, { error: (e as Error).message });
  }
}
