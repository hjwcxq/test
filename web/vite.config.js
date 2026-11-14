import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: webRoot,
  // 相对 base：同一份产物在 / 与 /apps/p1/ 下都能加载静态资源。
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(webRoot, '../dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
