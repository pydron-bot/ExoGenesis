/**
 * Shared bits for the tools/ scripts (smokes, shots, benches).
 *
 *   import { launch, DEV_URL, checker } from './lib/harness.mjs';
 *   const browser = await launch();             // software WebGL (SwiftShader): works anywhere, headless
 *   const browser = await launch({ gpu: true }); // the real GPU (Vulkan), for perf numbers
 *   const { check, done } = checker();          // check(ok, msg) prints PASS/FAIL; done() exits 1 if any failed
 *
 * DEV_URL: the dev server smokes test against. tools/run-tests.mjs sets SMOKE_URL to the one it starts.
 */
import { chromium } from 'playwright';

export const DEV_URL = process.env.SMOKE_URL ?? `http://localhost:${process.env.PORT ?? 5176}/`;

/** Chromium flags: software WebGL by default, the GPU with `gpu`. */
export const glArgs = (gpu = false) => ['--use-gl=angle', ...(gpu ? ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])];

/**
 * Page timeouts: Playwright's 30 s defaults are too short for a cold dev server on a busy machine (SwiftShader
 * renders on the CPU). Every page from launch() gets these instead (SMOKE_TIMEOUT, in seconds, overrides).
 */
const NAV_MS = Number(process.env.SMOKE_TIMEOUT ?? 120) * 1000;
const ACT_MS = Math.max(30000, NAV_MS / 2);
function patient(page) { page.setDefaultNavigationTimeout(NAV_MS); page.setDefaultTimeout(ACT_MS); return page; }

export async function launch({ gpu = false, args = [] } = {}) {
  const browser = await chromium.launch({ args: [...glArgs(gpu), ...args] });
  const newPage = browser.newPage.bind(browser), newContext = browser.newContext.bind(browser);
  browser.newPage = async (...a) => patient(await newPage(...a));
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    const np = ctx.newPage.bind(ctx);
    ctx.newPage = async () => patient(await np());
    ctx.on('page', patient);
    return ctx;
  };
  return browser;
}

export function checker() {
  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; return ok; };
  const done = () => { console.log(failed ? `\n${failed} FAILED` : '\nall checks passed'); process.exit(failed ? 1 : 0); };
  return { check, done, get failed() { return failed; } };
}

/**
 * The opening's Mission Briefing (content/story/director-briefing.json) comes up a couple of seconds after deploying and
 * pauses the game behind a card. Smokes that aren't about it call this once after page load: it answers that one card
 * whenever it shows (no other card is touched). Survives reloads of the same page.
 */
export async function answerBriefing(page) {
  const install = () => {
    if (window.__briefingAnswerer) return;
    window.__briefingAnswerer = setInterval(() => {
      const b = document.querySelector('#contact.on button[data-s^="director-briefing:"]');
      if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }, 150);
  };
  await page.addInitScript(install);
  await page.evaluate(install).catch(() => {});
}
