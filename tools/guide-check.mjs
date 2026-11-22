/**
 * The Field Guide keeps up with the game: every release from the guide's launch (0.73.0) on says which guide pages
 * it added or changed (`guide` in src/changelog.ts), and those pages say so too (`updated`, or `since` for a new
 * page, in content/guide/<id>.json). Part of `npm run build`. Rules (docs/TECH.md "Field Guide"):
 *   - every page a release lists exists;
 *   - every page's `since` and `updated` name a release in the changelog, no older than the launch, and
 *     `updated` is not older than `since`;
 *   - every release from the launch on has a `guide` field; a feature release (minor or major) lists at least one
 *     page; a patch may say `guide: []`;
 *   - a page listed in release V has `updated ?? since` === V, and every page whose `updated ?? since` is V is
 *     listed in V. The launch release only has to list what it names (it may list just `orientation`): every page
 *     with `since: "0.73.0"` and no `updated` counts as part of it.
 *
 *   node tools/guide-check.mjs        (exit 1 on any problem)
 * `guideProblems(changelog, pages)` is exported for tools/guide-smoke.mjs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The first release with a Field Guide. */
export const GUIDE_LAUNCH = '0.73.0';

const semver = (v) => (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const older = (a, b) => cmp(semver(a), semver(b)) < 0;

/**
 * @param {{ version: string; title?: string; guide?: string[] }[]} log the changelog, newest first
 * @param {Record<string, { since?: string; updated?: string }>} pages guide pages by id
 * @returns {string[]} problems, each saying what to change
 */
export function guideProblems(log, pages) {
  const out = [];
  const releases = new Set(log.map((r) => r.version));
  const newest = log[0]?.version;
  const file = (id) => `content/guide/${id}.json`;
  const versionOf = (g) => g.updated ?? g.since;
  // pages: their versions are real releases
  for (const [id, g] of Object.entries(pages)) {
    if (!g.since) { out.push(`${file(id)}: no "since": add "since": "${newest}" (the release it was added in)`); continue; }
    for (const f of ['since', 'updated']) {
      const v = g[f];
      if (v === undefined) continue;
      if (!semver(v)) out.push(`${file(id)}: "${f}" is "${v}", not a version (write x.y.z, e.g. "${newest}")`);
      else if (!releases.has(v)) out.push(`${file(id)}: "${f}" is ${v}, which is not a release in src/changelog.ts (the newest is ${newest}): use ${newest} if the page is part of the release you are making`);
      else if (older(v, GUIDE_LAUNCH)) out.push(`${file(id)}: "${f}" is ${v}, before the Field Guide existed (${GUIDE_LAUNCH}): use the release that adds or changes the page`);
    }
    if (semver(g.since) && semver(g.updated) && older(g.updated, g.since)) out.push(`${file(id)}: "updated" (${g.updated}) is older than "since" (${g.since})`);
  }
  log.forEach((r, i) => {
    const V = r.version;
    const listed = r.guide;
    // every page a release lists exists (any release)
    for (const id of listed ?? []) if (!pages[id]) out.push(`${V} lists guide page "${id}" in its guide field, but there is no ${file(id)}: add the page, or fix the id`);
    if (!semver(V) || older(V, GUIDE_LAUNCH)) return;
    if (!Array.isArray(listed)) {
      out.push(`${V} ("${r.title ?? ''}") has no guide field: add guide: ['<page ids>'] to its entry in src/changelog.ts, the Field Guide pages it added or changed (set each page's "updated" to "${V}"), or guide: [] for a patch that changes nothing a player needs to learn`);
      return;
    }
    const prev = semver(log[i + 1]?.version);
    const feature = !prev || semver(V)[0] !== prev[0] || semver(V)[1] !== prev[1];
    if (feature && !listed.length) out.push(`${V} is a feature release (minor or major) but lists no Field Guide pages: add or revise the page in content/guide/ that covers what it changes, set its "updated": "${V}" (or "since": "${V}" for a new page), and add its id to the release's guide field in src/changelog.ts`);
    // both directions: what it lists says V; what says V is listed
    for (const id of listed) {
      const g = pages[id];
      if (g && versionOf(g) !== V) out.push(`${V} lists "${id}", but ${file(id)} says it last changed in ${versionOf(g) ?? '(nothing)'}: set "updated": "${V}" there, or take "${id}" off ${V}'s guide list`);
    }
    if (V === GUIDE_LAUNCH) return; // the launch: every page new in it counts as listed
    for (const [id, g] of Object.entries(pages)) {
      if (versionOf(g) === V && !listed.includes(id)) out.push(`${file(id)} says it changed in ${V} ("${g.updated ? 'updated' : 'since'}"), but release ${V} doesn't list it: add '${id}' to its guide field in src/changelog.ts`);
    }
  });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { runnerImport } = await import('vite');
  const code = path.resolve(import.meta.dirname, '..');
  const root = path.resolve(process.env.EXO_ROOT ?? code);
  const { module: m } = await runnerImport(path.join(code, 'src/changelog.ts'));
  const dir = path.join(root, 'content/guide');
  const pages = {};
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* no guide yet */ }
  for (const f of files) {
    try { pages[f.slice(0, -5)] = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.error(`guide check: content/guide/${f}: invalid JSON: ${e.message}`); process.exit(1); }
  }
  const problems = guideProblems(m.CHANGELOG, pages);
  if (problems.length) { console.error(`guide check (every release updates the Field Guide):\n  ${problems.join('\n  ')}`); process.exit(1); }
  const r = m.CHANGELOG[0];
  console.log(`OK  Field Guide: ${files.length} pages · v${r.version} lists ${r.guide?.length ? r.guide.join(', ') : 'none'}`);
}
