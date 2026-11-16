/**
 * package.json's version must be the newest entry in src/changelog.ts, and the
 * changelog must run newest-first with real dates and notes. Part of `npm run build`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const { module: m } = await runnerImport(path.join(root, 'src/changelog.ts'));
const log = m.CHANGELOG;
const problems = [];
const semver = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
if (!log.length) problems.push('changelog is empty');
else if (log[0].version !== pkg.version) problems.push(`package.json is ${pkg.version} but the newest changelog entry is ${log[0].version}: bump one to match`);
log.forEach((r, i) => {
  const v = semver(r.version);
  if (!v) problems.push(`${r.version}: not x.y.z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) problems.push(`${r.version}: bad date ${r.date}`);
  if (!r.title?.trim()) problems.push(`${r.version}: no title`);
  if (!r.notes?.length || r.notes.some((n) => !n.trim())) problems.push(`${r.version}: needs notes`);
  const next = log[i + 1];
  if (next && v && semver(next.version) && cmp(v, semver(next.version)) <= 0) problems.push(`${r.version} must be newer than ${next.version} below it`);
  if (next && r.date < next.date) problems.push(`${r.version} is dated before ${next.version}`);
});
if (problems.length) { console.error(`version check:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`OK  v${pkg.version} · ${log.length} releases in the changelog`);
