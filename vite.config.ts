import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5176, strictPort: true, allowedHosts: ['hive1', '.ts.net'] },
  preview: { host: true, port: 4176 },
  build: { chunkSizeWarningLimit: 900 },
});
