/**
 * Applies an editor export (exo-changes-*.json, from Export on the deeek.org
 * editor) to this checkout's content/ and public/media/.
 *
 * Every change carries the git blob sha the file had when it was edited; a file
 * that has changed here since then is a conflict, and nothing is written unless
 * --force. Paths are confined to content/*.json and public/media/<kind>/<file>.
 * Runs the content check afterwards.
 *
 *   node tools/import-changes.mjs <file> [--dry-run] [--force] [--commit] [--root <dir>]
 *
 * --commit commits just those paths as "Content: <message from the export>".
 *
 * A content file changed on both sides is merged field by field when it can be: the version the editor started
 * from comes out of git by its sha (`git cat-file`), and only fields changed both here and in the export, to
 * different values, are a conflict. Warns first if the checkout has uncommitted changes or is behind origin.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root');
if (!file) { console.error('usage: node tools/import-changes.mjs <exo-changes.json> [--dry-run] [--force] [--commit] [--root <dir>]'); process.exit(2); }
const root = path.resolve(opt('--root') ?? path.join(import.meta.dirname, '..'));

const CONTENT_RE = /^content\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.json$/;
const MEDIA_RE = /^public\/media\/(model|image|audio)\/[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/;
const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.format !== 'exo-changes/1' || !Array.isArray(data.changes)) { console.error(`${file}: not an Exo Genesis editor export`); process.exit(2); }
console.log(`export from ${data.exported ?? '?'} based on ${String(data.base).slice(0, 7)}${data.message ? ` — "${data.message}"` : ''}: ${data.changes.length} change(s)`);

// the checkout: CLAUDE.md says pull first, so say so when it looks stale
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
if (git('rev-parse', '--git-dir') !== null) {
  const dirty = git('status', '--porcelain', '--', 'content', 'public/media');
  if (dirty) console.log(`warning: uncommitted changes under content/ or public/media/:\n  ${dirty.split('\n').slice(0, 8).join('\n  ')}`);
  git('fetch', '--quiet', 'origin');
  const behind = Number(git('rev-list', '--count', 'HEAD..@{u}') ?? 0);
  if (behind) console.log(`warning: ${behind} commit(s) behind ${git('rev-parse', '--abbrev-ref', '@{u}')}: git pull --rebase first`);
}

/** Three-way merge of JSON values: null and a list of conflicting field paths, or the merged value. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge3(base, ours, theirs, at = '') {
  if (same(ours, theirs)) return { value: ours, clash: [] };
  if (same(base, ours)) return { value: theirs, clash: [] };
  if (same(base, theirs)) return { value: ours, clash: [] };
  if (isObj(base) && isObj(ours) && isObj(theirs)) {
    const value = {}, clash = [];
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const r = merge3(base[k], ours[k], theirs[k], at ? `${at}.${k}` : k);
      clash.push(...r.clash);
      if (r.value !== undefined) value[k] = r.value;
    }
    return { value, clash };
  }
  return { value: ours, clash: [at || '(whole file)'] };
}

const plan = [], conflicts = [];
for (const c of data.changes) {
  if (typeof c.path !== 'string' || !(CONTENT_RE.test(c.path) || MEDIA_RE.test(c.path))) { console.error(`refusing path ${JSON.stringify(c.path)}`); process.exit(2); }
  let buf = null;
  if (c.op === 'write') {
    buf = typeof c.text === 'string' ? Buffer.from(c.text, 'utf8') : typeof c.base64 === 'string' ? Buffer.from(c.base64, 'base64') : null;
    if (!buf) { console.error(`${c.path}: write with no data`); process.exit(2); }
    if (c.sha && blobSha(buf) !== c.sha) { console.error(`${c.path}: data doesn't match its sha (damaged file?)`); process.exit(2); }
    if (CONTENT_RE.test(c.path)) try { JSON.parse(buf.toString('utf8')); } catch (e) { console.error(`${c.path}: not valid JSON (${e.message})`); process.exit(2); }
  } else if (c.op !== 'delete') { console.error(`${c.path}: unknown op ${c.op}`); process.exit(2); }
  const abs = path.join(root, c.path);
  const now = existsSync(abs) ? blobSha(readFileSync(abs)) : null;
  const want = c.op === 'delete' ? null : blobSha(buf);
  if (now === want) { plan.push({ ...c, abs, buf, skip: true }); continue; } // already applied
  if (now !== (c.orig ?? null)) {
    // both sides changed a content file: merge field by field against the version the editor started from
    const baseText = c.op === 'write' && now && c.orig && CONTENT_RE.test(c.path) ? git('cat-file', '-p', c.orig) : null;
    if (baseText !== null) {
      const r = merge3(JSON.parse(baseText), JSON.parse(readFileSync(abs, 'utf8')), JSON.parse(buf.toString('utf8')));
      if (!r.clash.length) {
        plan.push({ ...c, abs, buf: Buffer.from(JSON.stringify(r.value, null, 2) + '\n'), merged: true });
        continue;
      }
      conflicts.push(`${c.path} (changed here too; both changed: ${r.clash.join(', ')})`);
    } else conflicts.push(`${c.path} (${now === null ? 'deleted here' : c.orig === null ? 'created here too' : 'changed here'} since it was edited)`);
  }
  plan.push({ ...c, abs, buf });
}

for (const p of plan) console.log(`  ${p.skip ? '=' : p.op === 'delete' ? 'D' : p.orig ? 'M' : 'A'}  ${p.path}${p.skip ? '  (already applied)' : p.merged ? '  (merged with changes made here)' : ''}`);
if (conflicts.length) {
  console.log(`\nconflicts:\n  ${conflicts.join('\n  ')}`);
  if (!flag('--force')) { console.log('\nnothing written (--force applies the export over them)'); process.exit(1); }
}
if (flag('--dry-run')) { console.log('\ndry run: nothing written'); process.exit(0); }

const todo = plan.filter((p) => !p.skip);
for (const p of todo) {
  if (p.op === 'delete') { if (existsSync(p.abs)) unlinkSync(p.abs); }
  else { mkdirSync(path.dirname(p.abs), { recursive: true }); writeFileSync(p.abs, p.buf); }
}
console.log(`\nwrote ${todo.length} file(s)`);

try {
  execFileSync('node', [path.join(import.meta.dirname, 'content-check.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, EXO_ROOT: root } });
} catch {
  console.log('\ncontent check FAILED: the files are written but the game will show a content error until fixed');
  process.exit(1);
}

if (flag('--commit') && todo.length) {
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
  const paths = todo.map((p) => p.path);
  git('add', '-A', '--', ...paths);
  git('commit', '-m', `Content: ${data.message || 'edits from the web editor'}\n\nImported from an Exo Genesis editor export (based on ${String(data.base).slice(0, 7)}, ${data.exported ?? '?'}).`, '--', ...paths);
}
