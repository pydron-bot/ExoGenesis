#!/usr/bin/env node
/**
 * Runs the smoke tests and prints a pass/fail table.
 *
 *   npm test                                   # the headless checks (no browser, no dev server): what CI runs
 *   node tools/run-tests.mjs --browser         # also the browser smokes, against a dev server it starts on a free port
 *   node tools/run-tests.mjs --browser --url http://localhost:5176/   # ... or against one that's already running
 *   node tools/run-tests.mjs roster lead       # just these (names without -smoke.mjs)
 *   node tools/run-tests.mjs --list            # what's in each group
 *
 * Browser smokes read the address from SMOKE_URL (set here for each one). They run one at a time:
 * some edit content/ and restore it afterwards, and the dev server reloads when they do.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createServer } from 'node:net';

/** Smokes with no browser at all. */
const HEADLESS = ['campaign', 'gameplay', 'inhabit', 'lead', 'medbay', 'roster', 'golden'];
/** Smokes whose first half is headless: run with --headless-only (guide-smoke calls it --headless). */
const HEADLESS_HALF = ['ability', 'areas', 'autopilot', 'chronicle', 'cinematic', 'climax', 'daily', 'dilemma', 'frontier',
  'guide', 'mission', 'opening', 'relations', 'story-gaps', 'story', 'story-tools', 'travel', 'tree', 'voices'];
/** Need a production build on vite preview under /ExoGenesis/ (see each file): not run by --browser. */
const PREVIEW_ONLY = ['pwa', 'editor-web'];
/** Slow or measurement-only: run by name. */
const MANUAL = ['perf'];

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const browser = args.includes('--browser');
const all = readdirSync('tools').filter((f) => f.endsWith('-smoke.mjs')).map((f) => f.slice(0, -'-smoke.mjs'.length));
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--url' && args[i - 1] !== '--timeout');
const TIMEOUT = Number(opt('--timeout') ?? 600) * 1000;

const browserOnly = all.filter((n) => !HEADLESS.includes(n) && !HEADLESS_HALF.includes(n) && !PREVIEW_ONLY.includes(n) && !MANUAL.includes(n));
if (args.includes('--list')) {
  console.log(`headless:          ${HEADLESS.join(' ')}`);
  console.log(`headless half:     ${HEADLESS_HALF.join(' ')}  (full run with --browser)`);
  console.log(`browser:           ${browserOnly.join(' ')}`);
  console.log(`preview build:     ${PREVIEW_ONLY.join(' ')}  (by name, see the file)`);
  console.log(`manual:            ${MANUAL.join(' ')}`);
  process.exit(0);
}

/** [name, extra args] to run. */
let plan;
if (named.length) {
  const bad = named.filter((n) => !all.includes(n));
  if (bad.length) { console.error(`no such smoke: ${bad.join(', ')} (see --list)`); process.exit(2); }
  plan = named.map((n) => [n, browser || !HEADLESS_HALF.includes(n) ? [] : [n === 'guide' ? '--headless' : '--headless-only']]);
} else if (browser) {
  plan = [...HEADLESS.map((n) => [n, []]), ...HEADLESS_HALF.map((n) => [n, []]), ...browserOnly.map((n) => [n, []])];
} else {
  plan = [...HEADLESS.map((n) => [n, []]), ...HEADLESS_HALF.map((n) => [n, [n === 'guide' ? '--headless' : '--headless-only']])];
}
plan = plan.filter(([n]) => all.includes(n));

const needsServer = plan.some(([n, a]) => !HEADLESS.includes(n) && !a.length);
let url = opt('--url') ?? process.env.SMOKE_URL;
let server;
if (needsServer && !url) {
  const port = await freePort();
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  url = `http://localhost:${port}/`;
  await waitFor(url);
  console.log(`dev server on ${url}`);
}
const stop = () => { if (server) try { process.kill(-server.pid); } catch { /* gone */ } };
process.on('SIGINT', () => { stop(); process.exit(130); });

const results = [];
for (const [name, extra] of plan) {
  const t0 = Date.now();
  const { code, tail } = await run(name, extra);
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ name: name + (extra.length ? ' (headless)' : ''), ok: code === 0, s, tail });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${s.padStart(6)} s${extra.length ? '  headless' : ''}`);
  if (code !== 0) console.log(tail.split('\n').map((l) => `      ${l}`).join('\n'));
}
stop();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` · failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);

function run(name, extra) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(url ? { SMOKE_URL: url } : {}) };
    const p = spawn(process.execPath, [`tools/${name}-smoke.mjs`, ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (d) => { out = (out + d).slice(-20000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const timer = setTimeout(() => { keep(`\n(timed out after ${TIMEOUT / 1000} s)`); p.kill('SIGKILL'); }, TIMEOUT);
    p.on('close', (code) => {
      clearTimeout(timer);
      // the lines that failed, else the last few
      const lines = out.trim().split('\n');
      const bad = lines.filter((l) => /^\s*(FAIL|✗)|Error|FAILED/.test(l));
      resolve({ code: code ?? 1, tail: (bad.length ? bad : lines).slice(-8).join('\n') });
    });
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(u) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(u)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server didn't start at ${u}`);
}
