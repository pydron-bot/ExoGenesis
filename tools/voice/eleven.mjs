/** Shared by the voice tools: the ElevenLabs key and API, and tools/voice/cast.json. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const castFile = path.join(import.meta.dirname, 'cast.json');
export const readCast = () => JSON.parse(fs.readFileSync(castFile, 'utf8'));
export const writeCast = (c) => fs.writeFileSync(castFile, JSON.stringify(c, null, 2) + '\n');

export let key = process.env.ELEVENLABS_API_KEY;
const keyFile = path.join(os.homedir(), '.config/elevenlabs/api_key');
if (!key && fs.existsSync(keyFile)) key = fs.readFileSync(keyFile, 'utf8').trim();

/** POST JSON to the API; `raw` returns the response bytes (audio) instead of JSON. */
export async function api(route, body, { raw = false, query = '' } = {}) {
  if (!key) throw new Error(`No API key: set ELEVENLABS_API_KEY or put it in ${keyFile}`);
  const res = await fetch(`https://api.elevenlabs.io${route}${query}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}
