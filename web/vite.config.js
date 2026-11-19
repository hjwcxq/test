import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envVersion, normalizeVersion } from '../server/version.js';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(webRoot, '..');

/**
 * 构建期版本号：
 * - 优先使用部署/构建注入的环境变量（APP_VERSION、VITE_APP_VERSION、BUILD_VERSION、GIT_COMMIT 等）；
 * - 未提供时用「package 版本 + 构建时间戳」生成唯一版本，保证每次构建/部署都会变化，
 *   绝不会把某个固定旧版本硬编码进页面。
 */
function resolveBuildVersion(env) {
  const fromEnv = envVersion(env);
  if (fromEnv) return fromEnv;

  let pkgVersion = '0.0.0';
  try {
    pkgVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || pkgVersion;
  } catch {
    // 使用兜底版本
  }

  const commit = env.GIT_COMMIT || env.GIT_SHA || env.COMMIT_SHA;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '.').replace('Z', '');
  const suffix = commit ? commit.slice(0, 7) : `build.${stamp}`;
  return normalizeVersion(`${pkgVersion}+${suffix}`) || 'v0.0.0';
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

export default defineConfig(({ mode }) => {
  // .env 中的版本变量与进程环境变量都参与解析，进程环境变量优先。
  const env = { ...loadEnv(mode, projectRoot, ''), ...process.env };
  const buildVersion = resolveBuildVersion(env);
  const commit = env.GIT_COMMIT || env.GIT_SHA || env.COMMIT_SHA || null;

  return {
    root: webRoot,
    // 相对 base：同一份产物在 / 与 /apps/p1/ 下都能加载静态资源。
    base: './',
    plugins: [react(), emitBuildVersion(buildVersion, commit)],
    // 静态服务器未注入 window.__APP_VERSION__ 时（如直接预览构建产物）使用构建期版本。
    define: {
      __APP_VERSION__: JSON.stringify(buildVersion),
    },
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
