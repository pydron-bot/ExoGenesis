import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { contentServer } from './devtools/content-server.ts';

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
/**
 * Region terrain grids (height, ground, flora: run-length strings, ~2 MB for every region together) leave the bundle in
 * production: each region's go to `assets/grids-<id>-<hash>.json` and the bundled record keeps only their address
 * (`grids`), fetched for the region being played (src/content/index.ts `loadRegionGrids`). Dev and the tools keep
 * them inline. The editor works from its own copy of the files, so it doesn't need them.
 */
function regionGrids(): Plugin {
  let base = '/';
  return {
    name: 'exo-region-grids',
    apply: 'build',
    enforce: 'pre',
    configResolved(c) { base = c.base; },
    transform(code, id) {
      const m = /[\\/]content[\\/]regions[\\/]([a-z0-9_-]+)\.json$/.exec(id.split('?')[0]);
      if (!m) return null;
      const rec = JSON.parse(code) as Record<string, unknown>;
      const grids: Record<string, unknown> = {};
      for (const k of ['height', 'ground', 'flora']) if (rec[k] !== undefined) { grids[k] = rec[k]; delete rec[k]; }
      if (!Object.keys(grids).length) return null;
      const text = JSON.stringify(grids);
      const fileName = `assets/grids-${m[1]}-${createHash('sha1').update(text).digest('hex').slice(0, 10)}.json`;
      this.emitFile({ type: 'asset', fileName, source: text });
      rec.grids = base + fileName;
      return { code: JSON.stringify(rec), map: null };
    },
  };
}

/** Files only the editor uses: not precached for players (the editor is online-only). */
const EDITOR_ONLY = /^editor\.html$|^assets\/(editor|balance-worker|playthrough-worker)-|^content-manifest\.json$|(^|\/)\.gitkeep$/;

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
        .filter((f) => f !== 'sw.js' && !EDITOR_ONLY.test(f))
        .sort();
      const h = createHash('sha1');
      // per-file hashes for everything outside assets/ (media, icons, pages): a new release's worker copies
      // an unchanged file from the old cache instead of downloading it again (assets/* names carry a hash already)
      const hashes: Record<string, string> = {};
      for (const f of files) {
        const buf = readFileSync(path.join(outDir, f));
        h.update(f).update(buf);
        if (!f.startsWith('assets/') && f !== 'index.html') hashes[f] = createHash('sha1').update(buf).digest('hex').slice(0, 16);
      }
      const precache = ['./', ...files.filter((f) => f !== 'index.html')];
      const src = readFileSync('src/sw-template.js', 'utf8')
        .replace('const CACHE = __CACHE__;', `const CACHE = ${JSON.stringify(`exo-${h.digest('hex').slice(0, 12)}`)};`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(precache)};`)
        .replace('const HASHES = __HASHES__;', `const HASHES = ${JSON.stringify(hashes)};`);
      writeFileSync(path.join(outDir, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  // '/' locally, '/ExoGenesis/' when the Pages workflow builds it for deeek.org/ExoGenesis/.
  base: process.env.EXO_BASE ?? '/',
  // the version without bundling package.json (src/changelog.ts)
  define: { __VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  plugins: [contentServer(), regionGrids(), contentManifest(), serviceWorker()],
  // workers are bundled on their own: the sim worker's copy of the content leaves the grids out too
  worker: { plugins: () => [regionGrids()] },
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
      // The content JSON gets a named chunk too, so the file names say what they hold.
      output: { codeSplitting: { groups: [
        { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
        { name: 'content', test: /[\\/]content[\\/].*\.json$/ },
      ] } },
    },
  },
});
