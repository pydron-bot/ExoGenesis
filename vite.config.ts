import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { contentServer } from './devtools/content-server';

/**
 * content-manifest.json: the content/ and public/media/ this build was made
 * from, as git blob shas (+ the JSON text), so the deployed editor can work
 * without a GitHub token and exports can say exactly what they were based on.
 */
function contentManifest(): Plugin {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  return {
    name: 'exo-content-manifest',
    apply: 'build',
    generateBundle() {
      const files: Record<string, { sha: string; size: number; text?: string }> = {};
      for (const top of ['content', 'public/media']) {
        for (const abs of walk(top)) {
          const rel = abs.split(path.sep).join('/');
          const buf = readFileSync(abs);
          const sha = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
          files[rel] = { sha, size: buf.length, ...(rel.endsWith('.json') ? { text: buf.toString('utf8') } : {}) };
        }
      }
      let commit = process.env.GITHUB_SHA ?? '', message = '';
      try {
        commit ||= execSync('git rev-parse HEAD').toString().trim();
        message = execSync(`git log -1 --format=%s ${commit}`).toString().trim();
      } catch { commit ||= 'unknown'; }
      this.emitFile({ type: 'asset', fileName: 'content-manifest.json', source: JSON.stringify({ commit, message, files }) });
    },
  };
}

export default defineConfig({
  // '/' locally, '/ExoGenesis/' when the Pages workflow builds it for deeek.org/ExoGenesis/.
  base: process.env.EXO_BASE ?? '/',
  plugins: [contentServer(), contentManifest()],
  server: { host: true, port: 5176, strictPort: true, allowedHosts: ['hive1', '.ts.net'] },
  preview: { host: true, port: 4176 },
  build: {
    chunkSizeWarningLimit: 900,
    // the editor ships too: on deeek.org it saves by committing to GitHub (src/editor/github.ts)
    rolldownOptions: { input: { main: 'index.html', editor: 'editor.html' } },
  },
});
