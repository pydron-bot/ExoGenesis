/**
 * Designs the cast's voices with ElevenLabs Voice Design (offline: the game never calls ElevenLabs).
 * Reads tools/voice/cast.json; writes three previews per voice to tools/.cache/voice-design/<id>/ and a
 * review page (review.html, the audio inlined) to listen and choose from. Then keep the chosen one, which
 * saves it on the account as "Exo Genesis – <name>" and writes its voice id into cast.json.
 *
 *   node tools/voice/design.mjs [--only marrow,bede] [--force]      previews (skips voices already designed)
 *   node tools/voice/design.mjs --keep <id> <1|2|3>                 save preview n as the voice
 *   node tools/voice/design.mjs --review                            rebuild review.html only
 *
 * A `remix` voice (Meridian) is designed as a change to another voice once that one is kept.
 * Key: $ELEVENLABS_API_KEY, else ~/.config/elevenlabs/api_key (keep it out of the repo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { api, castFile, readCast, writeCast } from './eleven.mjs';

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const flag = (k) => argv.includes(k);
const cacheDir = path.resolve(import.meta.dirname, '../.cache/voice-design');
const cast = readCast();

if (flag('--keep')) {
  const i = argv.indexOf('--keep'), id = argv[i + 1], n = Number(argv[i + 2]);
  const c = cast.cast[id];
  const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, id, 'previews.json'), 'utf8'));
  const p = meta.previews[n - 1];
  if (!c || !p) { console.error(`No preview ${n} for ${id}`); process.exit(1); }
  const res = await api('/v1/text-to-voice', { voice_name: `Exo Genesis – ${c.name}`, voice_description: meta.description.slice(0, 1000), generated_voice_id: p.generated_voice_id });
  c.voice = res.voice_id;
  writeCast(cast);
  console.log(`${id}: kept preview ${n} as ${res.voice_id} ("Exo Genesis – ${c.name}"), written to ${path.relative(process.cwd(), castFile)}`);
  process.exit(0);
}

if (!flag('--review')) {
  const only = arg('--only')?.split(',');
  for (const [id, c] of Object.entries(cast.cast)) {
    if (only && !only.includes(id)) continue;
    const dir = path.join(cacheDir, id);
    if (!flag('--force') && (c.voice || fs.existsSync(path.join(dir, 'previews.json')))) continue;
    let res;
    if (c.remix) {
      const base = cast.cast[c.remix]?.voice;
      if (!base) { console.log(`${id}: waiting for ${c.remix} to be kept (a remix of it)`); continue; }
      res = await api(`/v1/text-to-voice/${base}/remix`, { voice_description: c.description, text: c.sample });
    } else {
      res = await api('/v1/text-to-voice/design', { model_id: 'eleven_ttv_v3', voice_description: c.description, text: c.sample });
    }
    fs.mkdirSync(dir, { recursive: true });
    const previews = res.previews.map((p, n) => {
      fs.writeFileSync(path.join(dir, `${n + 1}.mp3`), Buffer.from(p.audio_base_64, 'base64'));
      return { generated_voice_id: p.generated_voice_id, secs: p.duration_secs };
    });
    fs.writeFileSync(path.join(dir, 'previews.json'), JSON.stringify({ description: c.description, sample: c.sample, remix: c.remix, previews }, null, 2));
    console.log(`${id}: ${previews.length} previews`);
  }
}

// the review page: every voice's previews, inlined, to listen to anywhere
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const cards = [];
for (const [id, c] of Object.entries(cast.cast)) {
  const f = path.join(cacheDir, id, 'previews.json');
  if (!fs.existsSync(f)) continue;
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  const takes = meta.previews.map((p, n) => {
    const b64 = fs.readFileSync(path.join(cacheDir, id, `${n + 1}.mp3`)).toString('base64');
    return `<div class="take"><span class="n">${n + 1}</span><audio controls preload="none" src="data:audio/mpeg;base64,${b64}"></audio></div>`;
  }).join('');
  cards.push(`<section><h2>${esc(c.name)} <code>${esc(id)}</code>${c.voice ? ' <span class="kept">kept</span>' : ''}</h2>
<p class="desc">${esc(meta.description)}${meta.remix ? ` <em>(a remix of ${esc(meta.remix)})</em>` : ''}</p>
<p class="sample">“${esc(meta.sample)}”</p>${takes}</section>`);
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exo Genesis Voices</title><style>
:root{--bg:#0f1216;--fg:#e6e9ee;--mut:#9aa3ad;--card:#181d23;--line:#2a313a;--acc:#7fd1b9}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f6f7f9;--fg:#1b1f24;--mut:#5b6470;--card:#fff;--line:#dde1e6;--acc:#1f8a6d}}
:root[data-theme="light"]{--bg:#f6f7f9;--fg:#1b1f24;--mut:#5b6470;--card:#fff;--line:#dde1e6;--acc:#1f8a6d}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:720px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.lede{color:var(--mut);margin:0 0 24px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 16px}
h2{font-size:17px;margin:0 0 6px}code{color:var(--mut);font-size:13px}.kept{color:var(--acc);font-size:13px}
.desc{color:var(--mut);font-size:13px;margin:0 0 8px}.sample{font-style:italic;margin:0 0 10px}
.take{display:flex;align-items:center;gap:10px;margin:6px 0}.n{font-weight:600;width:1.2em;color:var(--acc)}audio{width:100%;max-width:100%}
</style></head><body><main><h1>Exo Genesis voices</h1>
<p class="lede">Three designed previews per character. Pick a number for each (or "none, redo"), and say what's off for any redo.</p>
${cards.join('\n')}</main></body></html>`;
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(cacheDir, 'review.html'), html);
console.log(`review: ${path.join(cacheDir, 'review.html')}`);
