/**
 * Renders a music mood to a WAV, faster than real time, so it can be heard (or compared with a
 * reference track) without opening the game. Runs the real engine (src/audio/music.ts) in a
 * headless browser against an OfflineAudioContext, with its scheduler driven by a fake clock.
 *
 *   node tools/music-render.mjs <mood id | path/to/mood.json> [--seconds 90] [--out music-drafts/<name>.wav] [--seed N] [--url http://localhost:5176/]
 *
 * A .json path renders that file (say, an earlier version kept in music-drafts/) instead of content/music/<id>.json.
 *
 * Needs the dev server (it serves the TypeScript). Random choices differ run to run, as in the game, unless
 * --seed fixes them: the same seed plays the same notes, so two versions of a mood or of the engine compare fairly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const id = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!id) { console.error('usage: node tools/music-render.mjs <mood id> [--seconds 90] [--out file.wav]'); process.exit(1); }
const root = path.resolve(import.meta.dirname, '..');
const seconds = Number(arg('--seconds', 90));
const isFile = id.endsWith('.json');
const name = isFile ? path.basename(id, '.json') : id;
const out = path.resolve(root, arg('--out', `music-drafts/${name}.wav`));
const url = arg('--url', 'http://localhost:5176/');
const seed = arg('--seed', null);
const mood = JSON.parse(fs.readFileSync(isFile ? path.resolve(id) : path.join(root, 'content/music', `${id}.json`), 'utf8'));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  // a seeded Math.random (mulberry32), so a render can be repeated note for note
  if (seed !== null) await page.addInitScript((s) => {
    let a = s >>> 0;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, Number(seed));
  await page.goto(`${url}editor.html?sw=0`);
  const b64 = await page.evaluate(async ({ mood, seconds }) => {
    const { AmbientMusic } = await import('/src/audio/music.ts');
    const sr = 44100, tail = 6;
    const off = new OfflineAudioContext(2, Math.ceil((seconds + tail) * sr), sr);
    let clock = 0;
    // the engine reads currentTime to schedule ahead; give it a clock we step ourselves
    const c = new Proxy(off, { get: (t, p) => (p === 'currentTime' ? clock : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    const realInterval = window.setInterval;
    window.setInterval = () => 0;
    const master = off.createGain();
    master.gain.value = 0.8 * 0.6 * 2; // the game's master × music defaults, and a little makeup
    master.connect(off.destination);
    const m = new AmbientMusic(c, master, () => mood, 1, 1.5);
    window.setInterval = realInterval;
    for (clock = 0; clock < seconds; clock += 0.2) m.tick();
    // fade out over the last seconds
    master.gain.setValueAtTime(master.gain.value, seconds - 4);
    master.gain.linearRampToValueAtTime(0, seconds + 2);
    const buf = await off.startRendering();
    // 16-bit WAV
    const n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const data = new DataView(new ArrayBuffer(44 + n * 4));
    const s = (o, str) => [...str].forEach((x, i) => data.setUint8(o + i, x.charCodeAt(0)));
    s(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); s(8, 'WAVEfmt '); data.setUint32(16, 16, true);
    data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, sr, true); data.setUint32(28, sr * 4, true);
    data.setUint16(32, 4, true); data.setUint16(34, 16, true); s(36, 'data'); data.setUint32(40, n * 4, true);
    let peak = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
      const v = Math.max(-1, Math.min(1, ch[k][i]));
      peak = Math.max(peak, Math.abs(v));
      data.setInt16(44 + i * 4 + k * 2, v * 32767, true);
    }
    console.log(`peak ${peak.toFixed(3)}`);
    const bytes = new Uint8Array(data.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { wav: btoa(bin), peak, played: m.played };
  }, { mood, seconds });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64.wav, 'base64'));
  console.log(`${path.relative(root, out)}: ${seconds}s, peak ${b64.peak.toFixed(2)}${b64.peak >= 1 ? ' (CLIPPED)' : ''}, played ${JSON.stringify(b64.played)}`);
} finally {
  await browser.close();
}
