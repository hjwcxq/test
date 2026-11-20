import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_FILE_PATH,
  UNAVAILABLE_LABEL,
  formatVersionLabel,
  resolveReleaseInfo,
} from '../server/version.js';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * 开发服务器预览时把项目发布记录中的版本与发布时间写进首屏 HTML，
 * 避免看到占位符。生产构建保留 `__APP_VERSION_LABEL__`，由服务端
 * 在每次请求时按 .delivery-release.json 注入。
 */
function injectReleaseLabel() {
  return {
    name: 'wensi-inject-release-label',
    apply: 'serve',
    transformIndexHtml(html) {
      const info = resolveReleaseInfo(RELEASE_FILE_PATH);
      const label = info.available
        ? formatVersionLabel(info.version, info.releasedAt)
        : UNAVAILABLE_LABEL;
      return html.replaceAll('__APP_VERSION_LABEL__', label);
    },
  };
}

export default defineConfig({
  root: webRoot,
  // 相对 base：同一份产物在 / 与 /apps/p1/ 下都能加载静态资源。
  base: './',
  plugins: [react(), injectReleaseLabel()],
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
