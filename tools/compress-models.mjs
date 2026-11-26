#!/usr/bin/env node
/**
 * Meshopt-compress the game's models (public/media/model/*.glb) in place: about 2.3x smaller downloads.
 * The game decodes them in src/assets/models.ts (MeshoptDecoder + dequantize). Files that are already
 * compressed are skipped, so it's safe to run after adding a model in the editor.
 *
 *   node tools/compress-models.mjs [files...] [--dry-run]
 *
 * Uses @gltf-transform/cli through npx (downloaded on first use).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const dir = 'public/media/model';
const files = args.filter((a) => !a.startsWith('--'));
const list = files.length ? files : fs.readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => path.join(dir, f));

/** The glTF JSON chunk of a .glb. */
function gltfJson(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

let before = 0, after = 0, done = 0;
for (const f of list) {
  const j = gltfJson(f);
  if ((j.extensionsUsed ?? []).includes('EXT_meshopt_compression')) continue;
  const size = fs.statSync(f).size;
  if (dry) { console.log(`would compress ${f} (${(size / 1024).toFixed(0)} kB)`); continue; }
  const tmp = f + '.tmp.glb';
  execFileSync('npx', ['--yes', '@gltf-transform/cli@4.5.1', 'meshopt', f, tmp,
    '--level', 'medium', '--quantize-position', '16', '--quantize-normal', '12', '--quantize-texcoord', '14'], { stdio: 'ignore' });
  fs.renameSync(tmp, f);
  before += size; after += fs.statSync(f).size; done++;
  console.log(`${f}: ${(size / 1024).toFixed(0)} → ${(fs.statSync(f).size / 1024).toFixed(0)} kB`);
}
if (!dry) console.log(done ? `${done} model(s): ${(before / 1048576).toFixed(2)} → ${(after / 1048576).toFixed(2)} MB` : 'nothing to compress');
