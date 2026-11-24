/**
 * Asset browser end-to-end: export a built-in to .glb, upload it with an image
 * and a sound, check previews, fit/scale, assign the model to the Solar Array
 * and the Tank, and confirm the game and skirmish load it. Then delete one.
 * Restores content/ and public/media/ exactly afterwards.
 *   node tools/asset-smoke.mjs [--url http://localhost:5176/]
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5176/';

// ---- snapshot content/ + public/media/ ----
async function snapshot(dir, sub = '', out = new Map()) {
  for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => [])) {
    const rel = path.join(sub, e.name);
    if (e.isDirectory()) await snapshot(dir, rel, out);
    else out.set(rel, await fs.readFile(path.join(dir, rel)));
  }
  return out;
}
const dirs = [path.join(root, 'content'), path.join(root, 'public/media')];
const before = await Promise.all(dirs.map((d) => snapshot(d)));
async function restore() {
  for (const [i, d] of dirs.entries()) {
    for (const rel of (await snapshot(d)).keys()) if (!before[i].has(rel)) await fs.unlink(path.join(d, rel));
    for (const [rel, buf] of before[i]) await fs.writeFile(path.join(d, rel), buf);
  }
}

// ---- fixtures: a PNG and a WAV ----
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'exo-assets-'));
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 4; raw[o + 1] = y * 4; raw[o + 2] = (x ^ y) & 1 ? 200 : 60; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds, hz) {
  const sr = 22050, n = Math.floor(sr * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / sr) * hz * Math.PI * 2) * 12000 * (1 - i / n)), 44 + i * 2);
  return b;
}
await fs.writeFile(path.join(tmp, 'Test Panel.png'), png(64, 64));
await fs.writeFile(path.join(tmp, 'beep.wav'), wav(0.5, 660));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
const errors = [];
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.stat(path.join(root, p)).then(() => true, () => false);

try {
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(`editor: ${e.message}`));
  ed.on('dialog', (d) => d.accept());

  // 1. export a built-in
  await ed.goto(`${url}editor.html#builtin/tank`);
  await ed.waitForSelector('.viewer canvas');
  check(/96 triangles/.test(await ed.textContent('.stats')), 'built-in tank shows its stats');
  const [dl] = await Promise.all([ed.waitForEvent('download'), ed.click('text=Download .glb')]);
  const glb = path.join(tmp, 'Scout Tank.glb');
  await dl.saveAs(glb);
  const head = (await fs.readFile(glb)).subarray(0, 4).toString();
  check(head === 'glTF', `Download .glb gives a binary glTF (${(await fs.stat(glb)).size} bytes)`);

  // 2. upload three files through the picker
  await ed.goto(`${url}editor.html#library`);
  await ed.waitForSelector('.asset-card');
  // counts per kind before the upload (the library isn't empty: content/assets has the Blender set)
  const count = async (kind) => Number((await ed.$$eval('.chip', (c) => c.map((x) => x.textContent))).find((t) => t.startsWith(kind))?.split(' ')[1] ?? 0);
  const before = { Models: await count('Models'), Images: await count('Images'), Audio: await count('Audio') };
  const [chooser] = await Promise.all([ed.waitForEvent('filechooser'), ed.click('button.mini:has-text("Upload")')]);
  await chooser.setFiles([glb, path.join(tmp, 'Test Panel.png'), path.join(tmp, 'beep.wav')]);
  await ed.waitForFunction((n) => [...document.querySelectorAll('.chip')].some((c) => c.textContent === `Models ${n}`), before.Models + 1, { timeout: 15000 });
  check(await exists('public/media/model/scout-tank.glb') && await exists('content/assets/scout-tank.json'), 'model uploaded: public/media/model/scout-tank.glb + record');
  check(await exists('public/media/image/test-panel.png') && await exists('public/media/audio/beep.wav'), 'image and audio uploaded');
  const chips = await ed.$$eval('.chip', (c) => c.map((x) => x.textContent));
  check(chips.includes(`Images ${before.Images + 1}`) && chips.includes(`Audio ${before.Audio + 1}`), `library counts (${chips.join(', ')})`);
  await wait(2500);
  check(await ed.locator('.asset-card:has-text("Scout Tank") img[src^="data:image/png"]').count() === 1, 'model card has a rendered thumbnail');

  // 3. previews
  await ed.click('.asset-card:has-text("Test Panel")');
  await ed.waitForFunction(() => /64 × 64 px/.test(document.querySelector('.asset-panel .stats')?.textContent ?? ''), null, { timeout: 10000 });
  check(true, 'image preview reports 64 × 64 px');
  check(await ed.locator('.row[data-key=scale]').count() === 0, 'image form hides model-only fields');
  await ed.goto(`${url}editor.html#assets/beep.json`);
  await ed.waitForFunction(() => /^0\.50 s · mono$/.test(document.querySelector('.asset-panel .stats')?.textContent ?? ''), null, { timeout: 10000 });
  check(true, 'audio preview decodes: 0.50 s, mono');

  // 4. model: fit against the solar array, save
  await ed.goto(`${url}editor.html#assets/scout-tank.json`);
  await ed.waitForFunction(() => /triangles/.test(document.querySelector('.asset-panel .stats')?.textContent ?? ''), null, { timeout: 15000 });
  await ed.selectOption('.viewer-tools select', 'solar');
  await ed.click('text=Fit to comparison');
  const scale = Number(await ed.inputValue('.row[data-key=scale] input'));
  check(scale > 0 && scale !== 1, `Fit to comparison set Import scale to ${scale}`);
  check((await ed.textContent('.row[data-key=scale] .was')) === 'was 1', 'fit shows as an unsaved change');
  await ed.click('text=Turn 90°');
  check((await ed.inputValue('.row[data-key=yaw] input')) === '90', 'Turn 90° sets rotation');
  await ed.keyboard.press('Control+s');
  await wait(800);
  const rec = JSON.parse(await fs.readFile(path.join(root, 'content/assets/scout-tank.json'), 'utf8'));
  check(rec.scale === scale && rec.yaw === 90 && rec.kind === 'model' && rec.file === 'scout-tank.glb', 'asset record saved with the fit');

  // 5. assign to the Solar Array and the Tank
  for (const [coll, id] of [['buildings', 'solar'], ['units', 'tank']]) {
    await ed.goto(`${url}editor.html#${coll}/${id}.json`);
    await ed.waitForSelector('.row[data-key=model] select');
    const opts = await ed.$$eval('.row[data-key=model] option', (o) => o.map((x) => x.value));
    check(opts.includes('scout-tank') && !opts.includes('test-panel') && !opts.includes('beep'), `${id}: Model offers only models (${opts.filter(Boolean).join(', ')})`);
    await ed.selectOption('.row[data-key=model] select', 'scout-tank');
    await ed.keyboard.press('Control+s');
    await wait(600);
  }
  let valid = true;
  try { execFileSync('node', [path.join(root, 'tools/content-check.mjs')], { stdio: 'pipe' }); } catch (e) { valid = false; console.log(String(e.stdout)); }
  check(valid, 'content:check passes with the new assets');

  // 6. the game uses it
  const game = await ctx.newPage();
  game.on('pageerror', (e) => errors.push(`game: ${e.message}`));
  await game.goto(`${url}?intro=0&new=1`);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await game.waitForFunction(() => !!__exo.region.models.solar, null, { timeout: 30000 });
  check(true, 'game loaded the asset as the Solar Array model');
  await game.goto(`${url}?mode=skirmish`);
  await game.waitForFunction(() => window.__exo?.ready, null, { timeout: 120000 });
  await game.waitForFunction(() => Array.isArray(__exo.skirmish.army.models[1]?.material), null, { timeout: 30000 });
  check(await game.evaluate(() => !!__exo.skirmish.army.models[1]), 'skirmish tanks use the asset up close (the built-in, with its glow strips, stays for the zoomed-out view)');

  // 7. used-by + delete
  await ed.goto(`${url}editor.html#assets/scout-tank.json`);
  await ed.waitForSelector('.used-row button');
  const used = await ed.textContent('.used-row');
  check(/Tank \(units\)/.test(used) && /Solar Array \(buildings\)/.test(used), `used-by lists both (${used.trim()})`);
  await ed.waitForFunction(() => /fine for a unit/.test(document.querySelector('.perf')?.textContent ?? ''), null, { timeout: 15000 });
  check(true, 'unit triangle budget check shown');
  await ed.goto(`${url}editor.html#assets/test-panel.json`);
  await ed.waitForSelector('button.danger');
  await ed.click('button.danger');
  await wait(800);
  check(!(await exists('content/assets/test-panel.json')) && !(await exists('public/media/image/test-panel.png')), 'Delete removed the record and the file');
} finally {
  await restore();
  await fs.rm(tmp, { recursive: true, force: true });
}
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
