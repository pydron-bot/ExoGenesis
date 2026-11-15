/**
 * Validate everything under content/ against src/content/defs.ts.
 *   npm run content:check      (exit 1 on any problem)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const { module: m } = await runnerImport(path.join(root, 'src/content/db.ts'));

async function walk(dir, sub = '') {
  const out = {};
  for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await walk(dir, rel));
    else if (e.name.endsWith('.json')) out[rel] = await fs.readFile(path.join(dir, rel), 'utf8');
  }
  return out;
}

const texts = await walk(path.join(root, 'content'));
const files = {};
const issues = [];
for (const [p, t] of Object.entries(texts)) {
  try { files[p] = JSON.parse(t); } catch (e) { issues.push({ path: p, field: '', msg: `invalid JSON: ${e.message}` }); }
}
const { db, issues: found } = m.buildDb(files);
issues.push(...found, ...m.requiredIssues(db));
for (const [id, a] of Object.entries(db.assets ?? {})) {
  if (!a?.kind || !a?.file) continue;
  const f = path.join(root, 'public/media', a.kind, a.file);
  if (!(await fs.stat(f).then(() => true, () => false))) issues.push({ path: `assets/${id}.json`, field: 'file', msg: `public/media/${a.kind}/${a.file} is missing` });
}
for (const i of issues) console.log(`FAIL  ${i.path}${i.field ? ` · ${i.field}` : ''}: ${i.msg}`);
console.log(issues.length ? `${issues.length} problem(s) in ${Object.keys(texts).length} files` : `OK  ${Object.keys(texts).length} content files valid`);
process.exit(issues.length ? 1 : 0);
