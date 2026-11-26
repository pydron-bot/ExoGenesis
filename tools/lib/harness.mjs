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

export function launch({ gpu = false, args = [] } = {}) {
  return chromium.launch({ args: [...glArgs(gpu), ...args] });
}

export function checker() {
  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; return ok; };
  const done = () => { console.log(failed ? `\n${failed} FAILED` : '\nall checks passed'); process.exit(failed ? 1 : 0); };
  return { check, done, get failed() { return failed; } };
}
