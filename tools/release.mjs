#!/usr/bin/env node
/**
 * Starts a release: bumps package.json (and the lockfile), adds an entry at the top of src/changelog.ts and marks the
 * Field Guide pages it touches, then runs version:check and guide:check. Edit the notes afterwards if you like.
 *
 *   npm run release -- minor "Title" --note "What players see" --note "Another line" --guide saves,options
 *   npm run release -- patch "Fixes" --note "..."            # guide: [] (a patch that teaches nothing new)
 *   npm run release -- minor "Title" --guide auto             # the guide pages changed since the last commit
 *   ... --dry-run                                             # print what it would do
 *
 * New guide pages (no "since" yet) get "since": the new version; existing ones get "updated".
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flagVals = (k) => args.flatMap((a, i) => (args[i - 1] === k ? [a] : []));
const pos = args.filter((a, i) => !a.startsWith('--') && !['--note', '--guide', '--date'].includes(args[i - 1]));
const [kind, title] = pos;
const dry = args.includes('--dry-run');
if (!['major', 'minor', 'patch'].includes(kind) || !title) {
  console.error('usage: npm run release -- <minor|patch|major> "Title" [--note "..."]... [--guide id,id | auto] [--dry-run]');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const version = kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
const date = flagVals('--date')[0] ?? new Date().toISOString().slice(0, 10);
const notes = flagVals('--note');

let guide = (flagVals('--guide')[0] ?? '').split(',').filter(Boolean);
if (guide.length === 1 && guide[0] === 'auto') {
  const changed = execSync('git status --porcelain -- content/guide', { encoding: 'utf8' }).split('\n')
    .map((l) => l.slice(3).trim()).filter((f) => f.endsWith('.json'));
  guide = changed.map((f) => f.replace(/^content\/guide\//, '').replace(/\.json$/, ''));
}
for (const id of guide) if (!existsSync(`content/guide/${id}.json`)) { console.error(`no content/guide/${id}.json`); process.exit(2); }
if (kind !== 'patch' && !guide.length) console.warn('note: a feature release must list at least one guide page (--guide); guide:check will say so');

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, '’')}'`;
const entry = [
  '  {',
  `    version: '${version}',`,
  `    date: '${date}',`,
  `    title: ${q(title)},`,
  '    notes: [',
  ...(notes.length ? notes : ['TODO: what changed, for players']).map((n) => `      ${q(n)},`),
  '    ],',
  `    guide: [${guide.map((g) => `'${g}'`).join(', ')}],`,
  '  },',
].join('\n');

console.log(`${pkg.version} → ${version} (${kind}), ${date}: ${title}`);
console.log(entry);
for (const id of guide) console.log(`content/guide/${id}.json: ${JSON.parse(readFileSync(`content/guide/${id}.json`, 'utf8')).since ? 'updated' : 'since'} = ${version}`);
if (dry) process.exit(0);

execFileSync('npm', ['version', version, '--no-git-tag-version'], { stdio: 'ignore' });
const log = readFileSync('src/changelog.ts', 'utf8');
const marker = 'export const CHANGELOG: Release[] = [\n';
if (!log.includes(marker)) { console.error('src/changelog.ts: CHANGELOG array not found'); process.exit(1); }
writeFileSync('src/changelog.ts', log.replace(marker, marker + entry + '\n'));
for (const id of guide) {
  const f = `content/guide/${id}.json`;
  const g = JSON.parse(readFileSync(f, 'utf8'));
  if (g.since) g.updated = version; else g.since = version;
  writeFileSync(f, JSON.stringify(g, null, 2) + '\n');
}
let ok = true;
for (const t of ['version-check', 'guide-check']) {
  try { execFileSync(process.execPath, [`tools/${t}.mjs`], { stdio: 'inherit' }); } catch { ok = false; }
}
if (!notes.length) console.log('\nnow write the notes in src/changelog.ts (they say TODO)');
process.exit(ok ? 0 : 1);
