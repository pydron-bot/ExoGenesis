import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/**
 * sw.js: the service worker that makes the game an installable, offline-capable
 * app (manifest: public/manifest.webmanifest; registered by src/pwa.ts). Written
 * after the build so it can precache every file the game needs (not the editor).
 * The cache is named after a hash of those files, so each release gets its own
 * and the old one is dropped. Logic: src/sw-template.js.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  return {
    name: 'exo-service-worker',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const files = walk(outDir)
        .map((abs) => path.relative(outDir, abs).split(path.sep).join('/'))
        .filter((f) => f !== 'sw.js' && !/^editor\.html$|^assets\/editor-|^content-manifest\.json$|(^|\/)\.gitkeep$/.test(f))
        .sort();
      const h = createHash('sha1');
      for (const f of files) h.update(f).update(readFileSync(path.join(outDir, f)));
      const precache = ['./', ...files.filter((f) => f !== 'index.html')];
      const src = readFileSync('src/sw-template.js', 'utf8')
        .replace('const CACHE = __CACHE__;', `const CACHE = ${JSON.stringify(`exo-${h.digest('hex').slice(0, 12)}`)};`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(precache)};`);
      writeFileSync(path.join(outDir, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  // '/' locally, '/ExoGenesis/' when the Pages workflow builds it for deeek.org/ExoGenesis/.
  base: process.env.EXO_BASE ?? '/',
  // the version without bundling package.json (src/changelog.ts)
  define: { __VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  plugins: [contentServer(), contentManifest(), serviceWorker()],
  server: { host: true, port: 5176, strictPort: true, allowedHosts: ['hive1', '.ts.net'] },
  preview: { host: true, port: 4176 },
  build: {
    chunkSizeWarningLimit: 900,
    // the editor ships too: on deeek.org it saves by committing to GitHub (src/editor/github.ts)
    rolldownOptions: {
      input: { main: 'index.html', editor: 'editor.html', domination: 'domination.html' },
      // three.js in a chunk of its own: it only changes when three is upgraded, so its file name
      // (and the browser's / service worker's copy of it) survives releases. Without this it shares
      // a chunk with the content and changelog, which change every release.
      output: { codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] } },
    },
  },
});
