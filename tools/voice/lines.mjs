/**
 * Voices the story (docs/VOICE.md): every spoken line of the story cards and cinematics whose speaker has a
 * voice in tools/voice/cast.json, with ElevenLabs text to speech (offline: the game never calls ElevenLabs).
 * Writes public/media/voice/<who>/<key>.mp3 and public/media/voice/index.json (key → file and length), and
 * keeps tools/voice/lines.json, the ledger of what each file says and in which voice: a line is generated again
 * only when its text or voice changes (or with --redo). Lines with {first}/{who} in them are skipped (their
 * words change per game).
 *
 *   node tools/voice/lines.mjs --cine cine-signal,cine-marrow [--story director-briefing] [--who marrow]
 *   node tools/voice/lines.mjs --all [--dry-run]       everything voiced; --dry-run counts the credits first
 *   node tools/voice/lines.mjs --redo <key,key>        a new take of these lines (keys from lines.json)
 *   node tools/voice/lines.mjs --prune                 delete files of lines no longer in the story
 *   add --fit to retime the cinematics a run touches to their recordings (then check them in the editor)
 *
 * Each character has a fixed seed, so the same words come out the same way (the Director's three briefings).
 * Key: $ELEVENLABS_API_KEY, else ~/.config/elevenlabs/api_key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { api, readCast } from './eleven.mjs';

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const list = (k) => arg(k)?.split(',').filter(Boolean);
const flag = (k) => argv.includes(k);
const root = path.resolve(import.meta.dirname, '../..');
const outDir = path.join(root, 'public/media/voice');
const ledgerFile = path.join(import.meta.dirname, 'lines.json');
const MODEL = arg('--model') ?? 'eleven_v4';

/** FNV-1a, 32 bits, as hex: the same as voiceKey in src/voice.ts. */
export function voiceKey(who, text) {
  let h = 0x811c9dc5;
  const s = `${who}\n${text.trim()}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const load = (coll) => fs.readdirSync(path.join(root, 'content', coll)).filter((f) => f.endsWith('.json'))
  .map((f) => ({ id: f.slice(0, -5), d: JSON.parse(fs.readFileSync(path.join(root, 'content', coll, f), 'utf8')) }));

/** Every spoken line: who says it (as the game keys it), the text, and where it is. */
function storyLines() {
  const out = [];
  for (const { id, d } of load('story')) {
    out.push({ who: d.character ?? d.speaker, text: d.text, coll: 'story', id });
    for (const l of d.lines ?? []) {
      const character = l.character ?? (l.speaker ? undefined : d.character), speaker = l.speaker ?? (l.character ? undefined : d.speaker);
      out.push({ who: character ?? speaker, text: l.text, coll: 'story', id });
    }
  }
  for (const { id, d } of load('cinematics')) {
    for (const l of d.lines ?? []) out.push({ who: l.character ?? l.speaker, text: l.text, coll: 'cinematics', id, at: l.at, for: l.for, n: (d.lines ?? []).indexOf(l) });
  }
  return out.filter((l) => l.who && l.text?.trim());
}

const cast = readCast().cast;
/** The cast entry (and its id) for who says a line: a character id, or a speaker name a cast entry claims. */
const castOf = (who) => (cast[who] ? [who, cast[who]] : Object.entries(cast).find(([, c]) => c.speaker === who)) ?? [];
const seedOf = (who) => parseInt(voiceKey(who, 'seed'), 16) % 4294967295;

const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
const all = storyLines();

const cines = list('--cine'), stories = list('--story'), whos = list('--who'), redo = list('--redo') ?? [];
const chosen = (l) => flag('--all') || redo.length > 0 || (cines?.includes(l.id) && l.coll === 'cinematics') || (stories?.includes(l.id) && l.coll === 'story') || whos?.includes(castOf(l.who)[0]);
const todo = [], skipped = { noVoice: new Set(), filled: 0 };
const seen = new Set();
for (const l of all) {
  if (!chosen(l)) continue;
  const [cid, c] = castOf(l.who);
  if (!c?.voice) { skipped.noVoice.add(l.who); continue; }
  if (/\{\w+\}/.test(l.text)) { skipped.filled++; continue; }
  const key = voiceKey(l.who, l.text);
  if (seen.has(key)) continue;
  seen.add(key);
  const have = ledger[key];
  const fresh = have && have.voice === c.voice && fs.existsSync(path.join(outDir, have.f));
  if (fresh && !redo.includes(key)) continue;
  if (redo.length && !redo.includes(key)) continue;
  todo.push({ ...l, key, cid, voice: c.voice });
}

const chars = todo.reduce((s, l) => s + l.text.length, 0);
console.log(`${todo.length} line(s) to voice, ${chars} characters (about that many credits with ${MODEL})`);
if (skipped.noVoice.size) console.log(`  no voice yet for: ${[...skipped.noVoice].join(', ')}`);
if (skipped.filled) console.log(`  skipped ${skipped.filled} line(s) with {first}/{who} in them`);

if (!flag('--dry-run')) {
  for (const l of todo) {
    const buf = await api(`/v1/text-to-speech/${l.voice}`, { text: l.text.trim(), model_id: MODEL, seed: redo.includes(l.key) ? undefined : seedOf(l.who) }, { raw: true, query: '?output_format=mp3_44100_128' });
    const f = `${l.cid}/${l.key}.mp3`;
    fs.mkdirSync(path.join(outDir, l.cid), { recursive: true });
    const old = ledger[l.key]?.f;
    if (old && old !== f) fs.rmSync(path.join(outDir, old), { force: true });
    fs.writeFileSync(path.join(outDir, f), buf);
    // 128 kbit/s constant: the length from the size
    const s = Math.round((buf.length * 8 / 128000) * 100) / 100;
    ledger[l.key] = { who: l.who, text: l.text.trim(), voice: l.voice, model: MODEL, f, s, from: `${l.coll}/${l.id}` };
    console.log(`  ${l.key} ${l.cid.padEnd(10)} ${s.toFixed(1).padStart(5)} s  ${l.text.trim().slice(0, 70)}`);
  }
}

// --prune: lines whose words or speaker have changed since they were voiced
if (flag('--prune')) {
  const live = new Set(all.map((l) => voiceKey(l.who, l.text)));
  for (const [k, e] of Object.entries(ledger)) {
    if (live.has(k)) continue;
    fs.rmSync(path.join(outDir, e.f), { force: true });
    delete ledger[k];
    console.log(`  pruned ${k} (${e.from}: ${e.text.slice(0, 50)})`);
  }
}

if (!flag('--dry-run')) {
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(ledgerFile, JSON.stringify(sorted, null, 2) + '\n');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(Object.fromEntries(Object.entries(sorted).map(([k, e]) => [k, { f: e.f, s: e.s }]))) + '\n');
}

// cinematic timing (the ones named, and any this run voiced): a recording that runs into the next line, or past its subtitle
// --fit: retime those cinematics to their recordings: a line starts at least 0.4 s after the voice before it ends,
// and its subtitle shows until its voice is done (plus 0.4 s). Lines without a recording keep their times.
if (flag('--fit') && !flag('--dry-run')) {
  const ids = new Set([...(cines ?? []), ...todo.filter((l) => l.coll === 'cinematics').map((l) => l.id),
    ...all.filter((l) => l.coll === 'cinematics' && (whos?.includes(castOf(l.who)[0]))).map((l) => l.id)]);
  for (const id of ids) {
    const file = path.join(root, 'content/cinematics', `${id}.json`), d = JSON.parse(fs.readFileSync(file, 'utf8'));
    let end = 0, moved = 0;
    for (const l of d.lines ?? []) {
      const e = ledger[voiceKey(l.character ?? l.speaker ?? '', l.text ?? '')];
      const at = Math.round(Math.max(l.at, end + (end ? 0.4 : 0)) * 20) / 20;
      if (at !== l.at) { l.at = at; moved++; }
      if (e) {
        const f = Math.round((e.s + 0.4) * 10) / 10;
        if (l.for !== undefined && l.for < f) { l.for = f; moved++; }
        end = l.at + e.s;
      } else end = 0;
    }
    if (!moved) continue;
    fs.writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
    const over = end - (d.length - (d.fadeOut ?? 0));
    console.log(`  fitted ${id}${over > 0 ? `: the last line now runs ${over.toFixed(1)} s into the fade-out (length ${d.length} s)` : ''}`);
  }
}

const touched = new Set([...(cines ?? []), ...todo.filter((l) => l.coll === 'cinematics').map((l) => l.id)]);
for (const id of touched) {
  const ls = all.filter((l) => l.coll === 'cinematics' && l.id === id).sort((a, b) => a.at - b.at);
  ls.forEach((l, i) => {
    const e = ledger[voiceKey(l.who, l.text)];
    if (!e) return;
    const gap = ls[i + 1] ? ls[i + 1].at - l.at : Infinity, shown = l.for ?? (Number.isFinite(gap) ? gap : 5);
    if (e.s > gap - 0.2) console.log(`  ${id} @ ${l.at} s: ${e.s} s of voice, but the next line is ${gap.toFixed(1)} s later`);
    else if (e.s > shown + 0.3) console.log(`  ${id} @ ${l.at} s: ${e.s} s of voice, subtitle shows for ${shown} s`);
  });
}
