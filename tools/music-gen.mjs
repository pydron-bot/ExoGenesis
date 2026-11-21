/**
 * Generates music drafts with the ElevenLabs Music API (offline: the game never calls it).
 * Reads tools/music-prompts.json, writes MP3s to music-drafts/ (git-ignored). Listen, then
 * copy the keepers into public/media/audio/.
 *
 *   node tools/music-gen.mjs [--only title,night] [--force] [--dry-run] [--model music_v2_5]
 *
 * Key: $ELEVENLABS_API_KEY, else ~/.config/elevenlabs/api_key (keep it out of the repo).
 * Skips tracks that already have a draft unless --force. Each generation uses quota
 * (Starter: ~17 min a month), so --dry-run first shows the total minutes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const flag = (k) => argv.includes(k);
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'music-drafts');
const model = arg('--model', 'music_v2_5');
const format = arg('--format', 'mp3_44100_128');

const { tracks } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'music-prompts.json'), 'utf8'));
const only = arg('--only')?.split(',');
const todo = tracks.filter((t) => (!only || only.includes(t.name)) && (flag('--force') || !fs.existsSync(path.join(outDir, `${t.name}.mp3`))));

const minutes = todo.reduce((s, t) => s + t.seconds, 0) / 60;
console.log(`${todo.length} track(s), ${minutes.toFixed(1)} min of quota: ${todo.map((t) => t.name).join(', ') || '(none)'}`);
if (flag('--dry-run') || !todo.length) process.exit(0);

let key = process.env.ELEVENLABS_API_KEY;
const keyFile = path.join(os.homedir(), '.config/elevenlabs/api_key');
if (!key && fs.existsSync(keyFile)) key = fs.readFileSync(keyFile, 'utf8').trim();
if (!key) {
  console.error(`No API key: set ELEVENLABS_API_KEY or put it in ${keyFile}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const t of todo) {
  process.stdout.write(`${t.name} (${t.seconds}s)… `);
  const t0 = Date.now();
  const res = await fetch(`https://api.elevenlabs.io/v1/music?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: t.prompt, music_length_ms: t.seconds * 1000, model_id: model, force_instrumental: true }),
  });
  if (!res.ok) {
    console.log(`failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(outDir, `${t.name}.mp3`), buf);
  const songId = [...res.headers].find(([k]) => /song/i.test(k));
  fs.writeFileSync(
    path.join(outDir, `${t.name}.json`),
    JSON.stringify({ ...t, model, format, songId: songId?.[1] ?? null, at: new Date().toISOString() }, null, 2),
  );
  console.log(`${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s${songId ? `, ${songId[0]}=${songId[1]}` : ''}`);
}
