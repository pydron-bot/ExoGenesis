import { defineConfig } from 'vite';
import { contentServer } from './devtools/content-server';

export default defineConfig({
  // '/' locally, '/ExoGenesis/' when the Pages workflow builds it for deeek.org/ExoGenesis/.
  base: process.env.EXO_BASE ?? '/',
  plugins: [contentServer()],
  server: { host: true, port: 5176, strictPort: true, allowedHosts: ['hive1', '.ts.net'] },
  preview: { host: true, port: 4176 },
  build: {
    chunkSizeWarningLimit: 900,
    // the editor ships too: on deeek.org it saves by committing to GitHub (src/editor/github.ts)
    rolldownOptions: { input: { main: 'index.html', editor: 'editor.html' } },
  },
});
