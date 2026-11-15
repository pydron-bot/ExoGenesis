import { defineConfig } from 'vite';
import { contentServer } from './devtools/content-server';

export default defineConfig({
  plugins: [contentServer()],
  server: { host: true, port: 5176, strictPort: true, allowedHosts: ['hive1', '.ts.net'] },
  preview: { host: true, port: 4176 },
  build: { chunkSizeWarningLimit: 900 },
});
