/**
 * Dev-only content API for the editor (never part of a production build).
 *
 *   GET    /__content/files              → [{ path, hash }]
 *   GET    /__content/file?path=…        → { path, text, hash }
 *   PUT    /__content/file               { path, text, baseHash } → { hash }
 *   DELETE /__content/file               { path, baseHash }
 *   GET    /__content/git                → { changes: [{ status, path }] }
 *   POST   /__content/commit             { message } → { commit }
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

const run = promisify(execFile);
const MAX_BYTES = 1 << 20;
const PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.json$/;

const hashOf = (text: string) => createHash('sha1').update(text).digest('hex');

class HttpError extends Error {
  constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); }
}

export function contentServer(): Plugin {
  let root = '';
  let dir = '';

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
      case 'GET /__content/git': {
        const { stdout } = await git('status', '--porcelain=v1', '--untracked-files=all', '--', 'content');
        const changes = stdout.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).replace(/^content\//, '') }));
        const { stdout: last } = await git('log', '-1', '--format=%h %s (%cr)', '--', 'content');
        return { changes, last: last.trim() };
      }
      case 'POST /__content/commit': {
        const b = await body(req);
        const msg = typeof b.message === 'string' ? b.message.trim() : '';
        if (!msg) throw new HttpError(400, 'commit message required');
        await git('add', '-A', '--', 'content');
        const { stdout: staged } = await git('diff', '--cached', '--name-only', '--', 'content');
        if (!staged.trim()) throw new HttpError(400, 'nothing to commit');
        // Pathspec commit: only content/ goes in, whatever else is staged stays put.
        await git('commit', '-m', `Content: ${msg}\n\nSaved from the Exo Genesis editor.`, '--', 'content');
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
