/**
 * 应用版本解析。
 *
 * 页面展示的版本号跟随「实际交付版本」：部署/构建阶段注入什么版本，页面就展示什么版本，
 * 因此每次上线后无需再改代码。代码中只保留一个兜底值，用于本地开发或未注入版本时避免出现空版本。
 *
 * 取值规则（按优先级从高到低）：
 * 1. 部署或构建注入的环境变量（APP_VERSION / VITE_APP_VERSION 等）；
 * 2. 构建阶段写入 dist/version.json 的版本；
 * 3. 兜底版本 DELIVERY_VERSION（最近一次成功交付记录）。
 *
 * 返回值统一规范化为 `vX` 形式，供服务端注入 index.html 与 /health 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_VERSION_PATH = path.resolve(here, '../dist/version.json');

/** 兜底版本：未注入任何构建/部署版本时展示（最近一次成功交付记录）。 */
export const DELIVERY_VERSION = 'v10';

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
 * 解析当前应展示的版本号：优先使用部署/构建注入的实际交付版本，
 * 未注入时回退到构建产物中的版本，最后才使用兜底版本。
 */
export function resolveVersion(env = process.env, buildInfo = readBuildInfo()) {
  return envVersion(env) || normalizeVersion(buildInfo?.version) || DELIVERY_VERSION;
}
