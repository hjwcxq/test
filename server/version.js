/**
 * 应用版本解析。
 *
 * 版本号不允许硬编码在页面里，而是按以下优先级取值：
 * 1. 部署时注入的运行时环境变量（Bridge / 容器平台通常在发布时注入）；
 * 2. 构建阶段写入 dist/version.json 的版本（构建 args 见 Dockerfile / vite.config.js）；
 * 3. 兜底的 package.json 版本号（仅在既无环境变量也无构建产物时出现）。
 *
 * 返回值统一规范化为 `vX` 形式，供服务端注入 index.html 与 /health 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_VERSION_PATH = path.resolve(here, '../dist/version.json');
const PACKAGE_PATH = path.resolve(here, '../package.json');

/** 部署平台可能使用的版本环境变量名，按优先级从高到低。 */
export const VERSION_ENV_KEYS = [
  'APP_VERSION',
  'VITE_APP_VERSION',
  'DELIVERY_VERSION',
  'DEPLOYMENT_VERSION',
  'RELEASE_VERSION',
  'BUILD_VERSION',
  'GIT_COMMIT',
  'GIT_SHA',
  'COMMIT_SHA',
  'VERSION',
];

let buildInfoCache;
let packageVersionCache;

/** 读取构建阶段产出的 version.json；不存在时返回 null。 */
export function readBuildInfo() {
  if (buildInfoCache !== undefined) return buildInfoCache;
  try {
    buildInfoCache = JSON.parse(fs.readFileSync(DIST_VERSION_PATH, 'utf8'));
  } catch {
    buildInfoCache = null;
  }
  return buildInfoCache;
}

function packageVersion() {
  if (packageVersionCache) return packageVersionCache;
  try {
    packageVersionCache = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')).version || '0.0.0';
  } catch {
    packageVersionCache = '0.0.0';
  }
  return packageVersionCache;
}

/**
 * 规范化为 `vX`：去掉已有前缀，过滤不安全字符（版本号会写进内联脚本），
 * 空值返回空字符串。
 */
export function normalizeVersion(raw) {
  if (raw === undefined || raw === null) return '';
  let value = String(raw).trim();
  if (!value || value === '__APP_VERSION__') return '';
  value = value.replace(/^[vV]\s*/, '').trim();
  value = value
    .replace(/[^0-9A-Za-z._+~-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!value) return '';
  return `v${value}`;
}

/** 仅从环境变量解析版本，供构建阶段与运行阶段共用。 */
export function envVersion(env = process.env) {
  for (const key of VERSION_ENV_KEYS) {
    const normalized = normalizeVersion(env?.[key]);
    if (normalized) return normalized;
  }
  return '';
}

/** 解析当前应展示的版本号。 */
export function resolveVersion(env = process.env, buildInfo = readBuildInfo()) {
  const fromEnv = envVersion(env);
  if (fromEnv) return fromEnv;

  const fromBuild = normalizeVersion(buildInfo?.version);
  if (fromBuild) return fromBuild;

  return normalizeVersion(packageVersion()) || 'v0.0.0';
}
