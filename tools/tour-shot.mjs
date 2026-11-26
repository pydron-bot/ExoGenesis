/**
 * Stills of the title tour's special stops (the system view, the star, the belt run, a comet, a ring pass).
 *   node tools/tour-shot.mjs [--url http://localhost:5176/] [--out shots/tour] [--kinds sun,belt,comet,rings,overview] [--w 1280 --h 720] [--gpu]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const url = arg('--url', (process.env.SMOKE_URL ?? 'http://localhost:5176/'));
const out = arg('--out', 'shots/tour');
const kinds = arg('--kinds', 'sun,belt,comet,rings,overview').split(',');
mkdirSync(out, { recursive: true });
const gpu = process.argv.includes('--gpu') ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: ['--use-gl=angle', ...gpu] });
const page = await browser.newPage({ viewport: { width: Number(arg('--w', 1280)), height: Number(arg('--h', 720)) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?sw=0&tour=1&bloom=1&zoomblur=0`);
await page.waitForFunction(() => window.__exo?.ready && window.__exo.title, null, { timeout: 300000 });
for (const k of kinds) {
  // send the tour there now (a trip as depart() makes one)
  const ok = await page.evaluate((k) => {
    const T = window.__exo.title, sys = window.__exo.system, sc = sys.scenic();
    const to = k === 'overview' ? { name: 'SYSTEM VIEW', sub: '', radius: 0, pos: sys.starPos, kind: 'overview' }
      : k === 'sun' ? { name: 'THE STAR', sub: '', radius: sc.star.radius, pos: sc.star.pos, kind: 'sun' }
      : k === 'belt' ? { name: 'THE BELT', sub: '', radius: 0, pos: T.beltPos, kind: 'belt' }
      : k === 'comet' ? (sc.comets[0] && { name: sc.comets[0].name, sub: '', radius: sc.comets[0].radius, pos: sc.comets[0].pos, kind: 'comet' })
      : (sc.ringed[0] && { name: sc.ringed[0].name, sub: '', radius: sc.ringed[0].radius, pos: sc.ringed[0].pos, kind: 'rings', normal: sc.ringed[0].normal });
    if (!to) return false;
    T.beltR = sc.belt;
    const d0 = window.__exo.cam.dist;
    T.trip = { from: T.at, to, u: 0, dur: 5, d0, d1: d0, peak: Math.max(d0, T.at ? 1e5 : 2e4), yaw0: window.__exo.cam.yaw, yaw1: window.__exo.cam.yaw };
    return true;
  }, k);
  if (!ok) { console.log(`${k}: none in this system`); continue; }
  await page.waitForFunction(() => !window.__exo.title.trip, null, { timeout: 300000, polling: 300 });
  await page.waitForTimeout(Number(arg('--wait', 5000)));
  const tele = await page.evaluate(() => document.querySelector('.t-tele')?.textContent);
  await page.screenshot({ path: `${out}/tour-${k}.png` });
  console.log(`${k}: ${tele}`);
}
await browser.close();
