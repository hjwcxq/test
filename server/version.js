/**
 * 应用版本解析。
 *
 * 当前交付基线以最近一次成功交付记录为准：v8。
 * 页面必须展示 v8，不能被遗留的部署环境变量（例如 v7）或旧构建产物回退成更旧的版本。
 *
 * 取值规则：
 * 1. 部署环境变量或构建产物只有在大版本高于 8 时才允许覆盖基线；
 * 2. 其余情况统一返回交付基线 v8（含 8.x 这类同属当前交付线的版本）。
 *
 * 返回值统一规范化为 `vX` 形式，供服务端注入 index.html 与 /health 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_VERSION_PATH = path.resolve(here, '../dist/version.json');

/** 当前交付基线版本（最近一次成功交付记录）。 */
export const DELIVERY_VERSION = 'v8';

/**
 * 部署平台可能使用的版本环境变量名，按优先级从高到低。
 * 注意：提交哈希（GIT_COMMIT 等）只是构建元数据，不是交付版本，不能作为版本号展示。
 */
export const VERSION_ENV_KEYS = [
  'APP_VERSION',
  'VITE_APP_VERSION',
  'DELIVERY_VERSION',
  'DEPLOYMENT_VERSION',
  'RELEASE_VERSION',
  'BUILD_VERSION',
  'VERSION',
];

let buildInfoCache;

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

/** 取版本号中的主版本号（v8.1.2 → 8）；无法识别时返回 -1。 */
export function versionMajor(version) {
  const matched = String(version || '').match(/^v(\d+)/);
  return matched ? Number(matched[1]) : -1;
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

/**
 * 解析当前应展示的版本号。
 *
 * 只有当环境变量或构建产物的大版本严格高于当前交付基线（8）时，
 * 才认为出现了更新的交付并展示它；v7 等旧版本一律回落到 v8。
 */
export function resolveVersion(env = process.env, buildInfo = readBuildInfo()) {
  const baselineMajor = versionMajor(DELIVERY_VERSION);
  for (const candidate of [envVersion(env), normalizeVersion(buildInfo?.version)]) {
    if (candidate && versionMajor(candidate) > baselineMajor) return candidate;
  }
  return DELIVERY_VERSION;
}
