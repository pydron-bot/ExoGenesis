/**
 * Installable app end to end: the manifest and icons load, Chrome finds the
 * page installable, the service worker takes over and precaches the game, the
 * game boots with the network off, and the editor is left alone.
 *
 * Needs a production build served under the Pages base (the worker is
 * production-only):
 *   EXO_BASE=/ExoGenesis/ npm run build && EXO_BASE=/ExoGenesis/ npx vite preview --port 4176
 *   node tools/pwa-smoke.mjs [--url http://localhost:4176/ExoGenesis/]
 */
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4176/ExoGenesis/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const booted = (p = page) => p.waitForFunction(() => document.body.classList.contains('loaded'), null, { timeout: 120000 }).then(() => true, () => false);

// ---------- manifest + icons ----------
await page.goto(url);
check(await booted(), 'game boots online');
const cdp = await ctx.newCDPSession(page);
const { url: mUrl, errors: mErrors, data } = await cdp.send('Page.getAppManifest');
check(mUrl.endsWith('/ExoGenesis/manifest.webmanifest') || mUrl.endsWith('/manifest.webmanifest'), `manifest linked (${mUrl})`);
check(!mErrors.length, `manifest parses${mErrors.length ? ': ' + mErrors.map((e) => e.message).join('; ') : ''}`);
const manifest = JSON.parse(data);
check(manifest.display === 'fullscreen' && manifest.icons.some((i) => i.purpose === 'maskable'), 'full-screen, with a maskable icon');
const base = new URL('./', mUrl);
for (const i of manifest.icons) {
  const r = await page.request.get(new URL(i.src, base).href);
  check(r.ok() && (r.headers()['content-type'] ?? '').startsWith('image/'), `icon ${i.src} ${i.sizes} (${r.status()})`);
}
const apple = await page.evaluate(() => document.querySelector('link[rel=apple-touch-icon]')?.href);
check(!!apple && (await page.request.get(apple)).ok(), 'apple-touch-icon');

// ---------- service worker ----------
const ctl = await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 30000 }).then(() => true, () => false);
check(ctl, 'service worker registered and controlling the page');
const cached = await page.evaluate(async () => {
  const keys = (await caches.keys()).filter((k) => k.startsWith('exo-'));
  const c = await caches.open(keys[0]);
  const reqs = (await c.keys()).map((r) => new URL(r.url).pathname);
  return { keys, reqs };
});
check(cached.keys.length === 1, `one cache for this build (${cached.keys.join(', ')})`);
check(cached.reqs.some((p) => /\/assets\/main-.*\.js$/.test(p)) && cached.reqs.some((p) => /\/assets\/worker-.*\.js$/.test(p)), 'game code precached');
check(cached.reqs.some((p) => p.includes('/media/')), 'media precached');
check(!cached.reqs.some((p) => p.endsWith('editor.html') || /\/assets\/editor-/.test(p)), 'editor not precached');
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
check(!installabilityErrors.length, `installable${installabilityErrors.length ? ': ' + installabilityErrors.map((e) => e.errorId).join(', ') : ''}`);

// ---------- offline ----------
await ctx.setOffline(true);
await page.goto(`${url}?title=0`).catch(() => {});
check(await booted(), 'game boots offline (from the cache), test URL query kept working');
const ed = await ctx.newPage();
const edRes = await ed.goto(new URL('editor.html', url).href).then(() => 'loaded', (e) => e.message);
check(edRes !== 'loaded', 'editor is online-only (not served from the cache)');
await ed.close();
await ctx.setOffline(false);

// ---------- back online: the page comes from the network again ----------
const fromSw = await page.goto(url).then((r) => r?.fromServiceWorker());
check(await booted(), 'game boots online again');
check(fromSw === true, 'online loads go through the worker (network first)');

check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
