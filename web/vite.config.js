import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersion } from '../server/version.js';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(webRoot, '..');

/**
 * 构建期版本号：与运行期共用同一套解析规则。
 * 优先取构建/部署注入的实际交付版本，未注入时使用兜底版本，
 * 因此每次发版无需修改代码中的版本号。
 */
function resolveBuildVersion(env) {
  return resolveVersion(env, null);
}

/** 把版本写入 dist/version.json，运行阶段（未注入环境变量时）从这里读取。 */
function emitBuildVersion(buildVersion, commit) {
  return {
    name: 'wensi-emit-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(
          {
            version: buildVersion,
            builtAt: new Date().toISOString(),
            commit: commit || null,
          },
          null,
          2
        )}\n`,
      });
    },
  };
}

/**
 * 开发服务器预览时把构建期版本写进首屏 HTML，避免看到占位符；
 * 生产构建保留 `__APP_VERSION_TEXT__`，由服务端按部署版本注入（运行时可覆盖）。
 */
function injectVersionText(buildVersion) {
  return {
    name: 'wensi-inject-version-text',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replaceAll('__APP_VERSION_TEXT__', buildVersion);
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env 中的版本变量与进程环境变量都参与解析，进程环境变量优先。
  const env = { ...loadEnv(mode, projectRoot, ''), ...process.env };
  const buildVersion = resolveBuildVersion(env);
  const commit = env.GIT_COMMIT || env.GIT_SHA || env.COMMIT_SHA || null;

  return {
    root: webRoot,
    // 相对 base：同一份产物在 / 与 /apps/p1/ 下都能加载静态资源。
    base: './',
    plugins: [react(), emitBuildVersion(buildVersion, commit), injectVersionText(buildVersion)],
    build: {
      outDir: path.resolve(webRoot, '../dist'),
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
    },
  };
});
