/**
 * The deployed editor's GitHub backend, end to end, against a mock GitHub API
 * seeded from this checkout's HEAD (nothing reaches github.com):
 * sign-in, load, save stays local, survives a reload, commit, a GitHub-side
 * change caught at commit and overwritten on request, media upload, discard.
 *
 * Needs a production build served under the Pages base:
 *   EXO_BASE=/ExoGenesis/ npm run build && EXO_BASE=/ExoGenesis/ npx vite preview --port 4176
 *   node tools/editor-web-smoke.mjs [--url http://localhost:4176/ExoGenesis/editor.html]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4176/ExoGenesis/editor.html';
const API = 'https://api.github.com/repos/pydron-bot/ExoGenesis';
const TOKEN = 'github_pat_test';

// ---------- mock GitHub: objects in memory, seeded from git ----------
const git = (...a) => execFileSync('git', a, { cwd: new URL('..', import.meta.url), maxBuffer: 1 << 26 });
const blobs = new Map(); // sha -> Buffer
const trees = new Map(); // sha -> Map(path -> sha)
const commits = new Map(); // sha -> { tree, message, parents }
const blobSha = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
let n = 0;
const fakeSha = (kind) => createHash('sha1').update(`${kind}${n++}${Math.random()}`).digest('hex');
const seed = new Map();
for (const line of git('ls-tree', '-r', 'HEAD').toString().trim().split('\n')) {
  const [meta, path] = line.split('\t');
  const sha = meta.split(' ')[2];
  if (!path.startsWith('content/') && !path.startsWith('public/media/')) continue;
  blobs.set(sha, git('cat-file', 'blob', sha));
  seed.set(path, sha);
}
const t0 = fakeSha('tree'); trees.set(t0, seed);
const c0 = fakeSha('commit'); commits.set(c0, { tree: t0, message: 'seed', parents: [] });
let head = c0;
const log = [];

/** Another device commits a change to `path` (moves head). */
function remoteCommit(path, text) {
  const buf = Buffer.from(text); const s = blobSha(buf); blobs.set(s, buf);
  const t = new Map(trees.get(commits.get(head).tree)); t.set(path, s);
  const ts = fakeSha('tree'); trees.set(ts, t);
  const c = fakeSha('commit'); commits.set(c, { tree: ts, message: 'remote edit', parents: [head] });
  head = c;
}
const headTree = () => trees.get(commits.get(head).tree);
const headText = (p) => blobs.get(headTree().get(p))?.toString();

async function github(route) {
  const req = route.request();
  const u = new URL(req.url());
  const path = u.pathname.replace('/repos/pydron-bot/ExoGenesis', '');
  const m = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const send = (status, data, raw) => route.fulfill({ status, headers: { ...cors, 'content-type': raw ? 'text/plain' : 'application/json' }, body: raw ?? JSON.stringify(data) });
  if (m === 'OPTIONS') return send(204, {});
  if (req.headers().authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' });
  log.push(`${m} ${path}`);
  if (m === 'GET' && path === '') return send(200, { permissions: { push: true } });
  if (m === 'GET' && path === '/git/ref/heads/main') return send(200, { object: { sha: head } });
  let x;
  if (m === 'GET' && (x = path.match(/^\/git\/commits\/(\w+)$/))) { const c = commits.get(x[1]); return send(200, { tree: { sha: c.tree }, message: c.message }); }
  if (m === 'GET' && (x = path.match(/^\/git\/trees\/(\w+)$/))) {
    return send(200, { truncated: false, tree: [...trees.get(x[1])].map(([p, s]) => ({ path: p, type: 'blob', sha: s, size: blobs.get(s).length })) });
  }
  if (m === 'GET' && (x = path.match(/^\/git\/blobs\/(\w+)$/))) return send(200, null, blobs.get(x[1]).toString());
  if (m === 'POST' && path === '/git/blobs') {
    const buf = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'); const s = blobSha(buf); blobs.set(s, buf);
    return send(201, { sha: s });
  }
  if (m === 'POST' && path === '/git/trees') {
    const t = new Map(trees.get(body.base_tree));
    for (const e of body.tree) { if (e.sha === null) { if (!t.has(e.path)) return send(422, { message: 'GitHub refuses to delete a missing path' }); t.delete(e.path); } else t.set(e.path, e.sha); }
    const s = fakeSha('tree'); trees.set(s, t); return send(201, { sha: s });
  }
  if (m === 'POST' && path === '/git/commits') { const s = fakeSha('commit'); commits.set(s, { tree: body.tree, message: body.message, parents: body.parents }); return send(201, { sha: s }); }
  if (m === 'PATCH' && path === '/git/refs/heads/main') {
    if (!commits.get(body.sha).parents.includes(head)) return send(422, { message: 'Update is not a fast forward' });
    head = body.sha; return send(200, { object: { sha: head } });
  }
  return send(404, { message: `mock: no route ${m} ${path}` });
}

// ---------- checks ----------
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route(`${API}**`, github);
await ctx.route(API, github);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const dialogs = []; let answer = true;
page.on('dialog', (d) => { dialogs.push(d.message()); void (answer ? d.accept() : d.dismiss()); });
const status = () => page.textContent('#git-status');
const edApi = (method, u, body) => page.evaluate(([m, u2, b]) => window.__editor.api(m, u2, b), [method, u, body]);
const waitStatus = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('git-status').textContent), re.source, { timeout: 15000 });

await page.goto(url);
await page.waitForSelector('#signin');
check(true, 'sign-in shows without a token');
await page.fill('#signin input', 'wrong-token');
await page.click('#signin button');
await page.waitForFunction(() => document.querySelector('#signin .err')?.textContent);
check(/rejected/.test(await page.textContent('#signin .err')), 'a bad token is refused with a reason');
await page.fill('#signin input', TOKEN);
await page.click('#signin button');
await page.waitForSelector('#empty');
await page.waitForFunction(() => window.__editor?.files.size > 0);
check(await page.evaluate(() => window.__editor.files.has('units/rover.json')), 'content loads from GitHub');
check(/Open game/.test(await page.textContent('#open-game')) && (await page.getAttribute('#open-game', 'href')) === '/ExoGenesis/?intro=0', 'Open game points at the deployed game');

// edit + save stays local
await page.evaluate(() => { location.hash = '#units/rover.json'; });
await page.waitForFunction(() => window.__editor.cur?.id === 'rover');
const before = await page.evaluate(() => window.__editor.cur.saved.hp);
await page.evaluate((v) => { window.__editor.cur.draft.hp = v; }, before + 7);
const writesBefore = log.filter((l) => !l.startsWith('GET')).length;
await page.keyboard.press('Control+s');
await waitStatus(/1 uncommitted/);
check(log.filter((l) => !l.startsWith('GET')).length === writesBefore, 'save writes nothing to GitHub');
await page.reload();
await page.waitForFunction(() => window.__editor?.files.size > 0);
await waitStatus(/1 uncommitted/);
check(await page.evaluate(() => window.__editor.files.get('units/rover.json').data.hp) === before + 7, 'unsaved-to-GitHub edit survives a reload');

// commit
await page.fill('#commit-msg', 'tune rover hp');
await page.click('#commit');
await waitStatus(/All committed/);
check(JSON.parse(headText('content/units/rover.json')).hp === before + 7, 'commit lands on main');
check(/^Content: tune rover hp/.test(commits.get(head).message), 'commit message matches the dev editor');

// conflict: edit here, someone else commits the same file, then commit here
await page.evaluate(() => { location.hash = ''; location.hash = '#units/rover.json'; });
await page.waitForFunction(() => window.__editor.cur?.saved.hp !== undefined);
await page.evaluate((v) => { window.__editor.cur.draft.hp = v; }, before + 20);
await page.keyboard.press('Control+s');
await waitStatus(/1 uncommitted/);
const theirs = JSON.parse(headText('content/units/rover.json')); theirs.hp = before + 99;
remoteCommit('content/units/rover.json', JSON.stringify(theirs, null, 2) + '\n');
answer = false; dialogs.length = 0;
await page.fill('#commit-msg', 'mine');
await page.click('#commit');
await page.waitForFunction(() => true);
await page.waitForTimeout(1500);
check(dialogs.some((d) => /changed on GitHub/.test(d)) && JSON.parse(headText('content/units/rover.json')).hp === before + 99, 'a GitHub-side change is caught at commit (cancel keeps theirs)');
answer = true;
await page.click('#commit');
await waitStatus(/All committed/);
check(JSON.parse(headText('content/units/rover.json')).hp === before + 20, '…and OK commits over it');

// media: upload stays local until commit, preview uses the browser copy
const glb = Buffer.from('glTF fake bytes').toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await window.__editor.api('PUT', '/__content/media?path=model/smoke-test.glb', new Blob([bytes]));
}, glb);
const media = await edApi('GET', '/__content/media');
check(media.some((m) => m.path === 'model/smoke-test.glb' && m.bytes === 15), 'media upload shows in the working copy');
await page.fill('#commit-msg', 'add media');
await waitStatus(/1 uncommitted/);
await page.click('#commit');
await waitStatus(/All committed/);
check(headText('public/media/model/smoke-test.glb') === 'glTF fake bytes', 'binary media commits intact (base64)');

// delete + discard
await edApi('DELETE', '/__content/media', { path: 'model/smoke-test.glb', baseHash: blobSha(Buffer.from('glTF fake bytes')) });
await waitStatus(/1 uncommitted/);
await page.click('#discard');
await waitStatus(/All committed/);
check(headTree().has('public/media/model/smoke-test.glb'), 'Discard drops local changes without touching GitHub');

check(!log.some((l) => /refs|blobs|trees|commits/.test(l) && l.startsWith('PUT')), 'no stray writes');
check(errs.length === 0, `no page errors ${errs.join(' | ')}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
