/**
 * Dev-only content API for the editor (never part of a production build).
 *
 *   GET    /__content/files              → [{ path, hash }]
 *   GET    /__content/file?path=…        → { path, text, hash }
 *   PUT    /__content/file               { path, text, baseHash } → { hash }
 *   DELETE /__content/file               { path, baseHash }
 *   GET    /__content/media              → [{ path, bytes, hash }]   (public/media/<kind>/<file>)
 *   PUT    /__content/media?path=…&baseHash=…   raw file bytes → { hash, bytes }
 *   DELETE /__content/media              { path, baseHash }
 *   GET    /__content/git                → { changes: [{ status, path }] }
 *   GET    /__content/orig?path=…        → { text | null }   (the last committed version, for a diff)
 *   POST   /__content/commit             { message } → { commit }   (content/ + public/media/)
 *   GET    /__content/release            → { version, commit, date, message, files: { path: text } }
 *                                           (content/ at the last release: the newest commit that changed package.json)
 *
 * Writes are conflict-checked: `baseHash` must match the file on disk (null =
 * "create; must not exist"), so the editor can never silently overwrite a change
 * made in another tab or by hand. Paths are confined to content/ and to .json.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';
import { ASSET_EXT, type AssetKind } from '../src/content/defs';

const run = promisify(execFile);
const MAX_BYTES = 1 << 20;
const PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.json$/;

const MAX_MEDIA = 64 << 20;
const MEDIA_RE = /^(model|image|audio)\/[a-z0-9][a-z0-9_-]*\.([a-z0-9]+)$/;
const TRACKED = ['content', 'public/media'];

const hashOf = (data: string | Buffer) => createHash('sha1').update(data).digest('hex');

class HttpError extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}

export function contentServer(): Plugin {
  let root = '';
  let dir = '';
  let media = '';
  const hashCache = new Map<string, string>();
  let releaseCache: { sha: string; out: unknown } | null = null;

  const resolveMedia = (rel: unknown) => {
    const m = typeof rel === 'string' ? rel.match(MEDIA_RE) : null;
    if (!m || !ASSET_EXT[m[1] as AssetKind].includes(m[2])) throw new HttpError(400, `bad media path: ${String(rel)}`);
    const abs = path.resolve(media, rel as string);
    if (!abs.startsWith(media + path.sep)) throw new HttpError(400, 'path escapes public/media/');
    return abs;
  };
  const readBufOrNull = async (abs: string) => {
    try { return await fs.readFile(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  };
  async function rawBody(req: IncomingMessage): Promise<Buffer> {
    let n = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      n += (c as Buffer).length;
      if (n > MAX_MEDIA) throw new HttpError(413, `files are limited to ${MAX_MEDIA >> 20} MB`);
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  const resolve = (rel: unknown) => {
    if (typeof rel !== 'string' || !PATH_RE.test(rel)) throw new HttpError(400, `bad path: ${String(rel)}`);
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep)) throw new HttpError(400, 'path escapes content/');
    return abs;
  };
  const readOrNull = async (abs: string) => {
    try { return await fs.readFile(abs, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  };
  async function list(sub = ''): Promise<string[]> {
    const out: string[] = [];
    for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await list(rel)));
      else if (e.name.endsWith('.json')) out.push(rel);
    }
    return out.sort();
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let n = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      n += (c as Buffer).length;
      if (n > MAX_BYTES) throw new HttpError(413, 'too large');
      chunks.push(c as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'body must be JSON'); }
  }
  const git = (...args: string[]) => run('git', ['-C', root, ...args], { maxBuffer: MAX_BYTES });

  async function handle(req: IncomingMessage) {
    const url = new URL(req.url ?? '/', 'http://x');
    const route = `${req.method} ${url.pathname}`;
    if (req.method !== 'GET') {
      // Refuse cross-site writes: browsers always send Origin on these.
      const origin = req.headers.origin;
      if (!origin || new URL(origin).host !== req.headers.host || req.headers['x-exo-editor'] !== '1') {
        throw new HttpError(403, 'editor requests only');
      }
    }
    switch (route) {
      case 'GET /__content/files': {
        const files = await list();
        return Promise.all(files.map(async (p) => ({ path: p, hash: hashOf(await fs.readFile(path.join(dir, p), 'utf8')) })));
      }
      case 'GET /__content/file': {
        const p = url.searchParams.get('path');
        const text = await readOrNull(resolve(p));
        if (text === null) throw new HttpError(404, 'no such file');
        return { path: p, text, hash: hashOf(text) };
      }
      case 'GET /__content/orig': {
        const p = url.searchParams.get('path');
        resolve(p); // confines it to content/*.json
        try {
          const { stdout } = await git('show', `HEAD:content/${p}`);
          return { text: stdout };
        } catch { return { text: null }; }
      }
      case 'PUT /__content/file': {
        const b = await body(req);
        const abs = resolve(b.path);
        if (typeof b.text !== 'string') throw new HttpError(400, 'text required');
        try { JSON.parse(b.text); } catch (e) { throw new HttpError(400, `not valid JSON: ${(e as Error).message}`); }
        const cur = await readOrNull(abs);
        const curHash = cur === null ? null : hashOf(cur);
        if (curHash !== (b.baseHash ?? null)) {
          throw new HttpError(409, cur === null ? 'file was deleted' : b.baseHash ? 'file changed on disk since you opened it' : 'file already exists', { hash: curHash, text: cur });
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.${process.pid}.tmp`;
        await fs.writeFile(tmp, b.text);
        await fs.rename(tmp, abs);
        return { hash: hashOf(b.text) };
      }
      case 'DELETE /__content/file': {
        const b = await body(req);
        const abs = resolve(b.path);
        const cur = await readOrNull(abs);
        if (cur === null) throw new HttpError(404, 'no such file');
        if (hashOf(cur) !== b.baseHash) throw new HttpError(409, 'file changed on disk since you opened it', { hash: hashOf(cur), text: cur });
        await fs.unlink(abs);
        return { ok: true };
      }
      case 'GET /__content/media': {
        const out: { path: string; bytes: number; hash: string }[] = [];
        for (const kind of Object.keys(ASSET_EXT)) {
          const d = path.join(media, kind);
          const names = await fs.readdir(d).catch(() => [] as string[]);
          for (const name of names.sort()) {
            const rel = `${kind}/${name}`;
            if (!MEDIA_RE.test(rel)) continue;
            const st = await fs.stat(path.join(d, name));
            const key = `${rel}|${st.mtimeMs}|${st.size}`;
            let hash = hashCache.get(key);
            if (!hash) { hash = hashOf(await fs.readFile(path.join(d, name))); hashCache.set(key, hash); }
            out.push({ path: rel, bytes: st.size, hash });
          }
        }
        return out;
      }
      case 'PUT /__content/media': {
        const rel = url.searchParams.get('path');
        const abs = resolveMedia(rel);
        const baseHash = url.searchParams.get('baseHash') || null;
        const buf = await rawBody(req);
        if (!buf.length) throw new HttpError(400, 'empty file');
        const cur = await readBufOrNull(abs);
        const curHash = cur === null ? null : hashOf(cur);
        if (curHash !== baseHash) throw new HttpError(409, cur === null ? 'file was deleted' : baseHash ? 'file changed on disk' : 'file already exists', { hash: curHash });
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.${process.pid}.tmp`;
        await fs.writeFile(tmp, buf);
        await fs.rename(tmp, abs);
        return { path: rel, hash: hashOf(buf), bytes: buf.length };
      }
      case 'DELETE /__content/media': {
        const b = await body(req);
        const abs = resolveMedia(b.path);
        const cur = await readBufOrNull(abs);
        if (cur === null) throw new HttpError(404, 'no such file');
        if (hashOf(cur) !== b.baseHash) throw new HttpError(409, 'file changed on disk', { hash: hashOf(cur) });
        await fs.unlink(abs);
        return { ok: true };
      }
      case 'GET /__content/git': {
        const { stdout } = await git('status', '--porcelain=v1', '--untracked-files=all', '--', ...TRACKED);
        const changes = stdout.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).replace(/^content\//, '') }));
        const { stdout: last } = await git('log', '-1', '--format=%h %s (%cr)', '--', ...TRACKED);
        return { changes, last: last.trim() };
      }
      case 'GET /__content/release': {
        const { stdout: line } = await git('log', '-1', '--format=%H%x09%cs%x09%s', '--', 'package.json');
        const [sha, date, message] = line.trim().split('\t');
        if (!sha) throw new HttpError(404, 'no release found');
        if (releaseCache?.sha !== sha) {
          const { stdout: pkg } = await git('show', `${sha}:package.json`);
          const { stdout: names } = await git('ls-tree', '-r', '--name-only', sha, '--', 'content');
          const files: Record<string, string> = {};
          for (const n of names.split('\n').filter((x) => x.endsWith('.json'))) files[n.slice(8)] = (await git('show', `${sha}:${n}`)).stdout;
          releaseCache = { sha, out: { version: JSON.parse(pkg).version ?? '', commit: sha.slice(0, 7), date, message, files } };
        }
        return releaseCache.out;
      }
      case 'POST /__content/commit': {
        const b = await body(req);
        const msg = typeof b.message === 'string' ? b.message.trim() : '';
        if (!msg) throw new HttpError(400, 'commit message required');
        await git('add', '-A', '--', ...TRACKED);
        const { stdout: staged } = await git('diff', '--cached', '--name-only', '--', ...TRACKED);
        if (!staged.trim()) throw new HttpError(400, 'nothing to commit');
        // Pathspec commit: only content/ and media go in, whatever else is staged stays put.
        await git('commit', '-m', `Content: ${msg}\n\nSaved from the Exo Genesis editor.`, '--', ...TRACKED);
        const { stdout: head } = await git('log', '-1', '--format=%h');
        return { commit: head.trim(), files: staged.trim().split('\n').length };
      }
    }
    throw new HttpError(404, 'unknown route');
  }

  return {
    name: 'exo-content-server',
    apply: 'serve',
    configResolved(c) {
      root = c.root;
      dir = path.join(root, 'content');
      media = path.join(root, 'public', 'media');
    },
    configureServer(server) {
      server.middlewares.use('/__content', (req, res) => {
        // connect strips the mount prefix; put it back for routing.
        req.url = `/__content${req.url ?? ''}`;
        handle(req).then(
          (out) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)); },
          (e: unknown) => {
            const he = e instanceof HttpError ? e : new HttpError(500, String((e as Error)?.message ?? e));
            res.statusCode = he.status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: he.message, ...he.extra }));
          },
        );
      });
    },
  };
}
