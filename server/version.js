/**
 * 应用版本与交付时间解析。
 *
 * 版本号与交付时间来自同一条「交付记录」，不再分别维护两个常量：
 * 1. 部署或构建注入的环境变量（APP_VERSION + APP_DELIVERY_TIME，一次交付同时给出）；
 * 2. 构建阶段写入 dist/version.json 的交付记录；
 * 3. 仓库根目录 delivery.json（本次交付的版本与交付时间）。
 *
 * 三层都按「记录」整体取值：版本与时间要么来自同一次注入，要么来自同一份构建产物，
 * 要么来自同一个 delivery.json，避免出现版本已更新而时间仍是上一版的情况。
 * 页面以「日期 时:分」展示交付时间，便于核对当前打开的是否为最近一次交付。
 * 所有来源都缺失时返回空版本，页面显示「版本信息未知」，绝不回退到上一版旧值。
 *
 * 返回值统一规范化为 `vX` 形式，供服务端注入 index.html 与 /health 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_VERSION_PATH = path.resolve(here, '../dist/version.json');

/** 仓库根目录的交付记录文件：版本号与交付时间写在同一个对象里。 */
export const DELIVERY_META_PATH = path.resolve(here, '../delivery.json');

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

/** 交付时间可能使用的环境变量名，按优先级从高到低。 */
export const DELIVERY_TIME_ENV_KEYS = ['APP_DELIVERY_TIME', 'DELIVERY_TIME', 'DELIVERED_AT'];

/**
 * 读取交付记录（默认 delivery.json）：版本号与交付时间必须来自同一份文件。
 * 文件缺失或格式非法时返回 null，由调用方展示明确的未知状态。
 */
export function readDeliveryMeta(file = DELIVERY_META_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { version: parsed.version, deliveredAt: parsed.deliveredAt };
  } catch {
    return null;
  }
}

const repositoryDeliveryMeta = readDeliveryMeta();

/** 两位补零，模块初始化时派生交付时间即需要。 */
const pad2 = (value) => String(value).padStart(2, '0');

/**
 * 兜底版本与交付时间：唯一来源是仓库交付记录 delivery.json，
 * 两者取自同一条记录，不再各自维护常量。
 */
export const DELIVERY_VERSION = normalizeVersion(repositoryDeliveryMeta?.version);
export const DELIVERY_TIME = normalizeDeliveryTime(repositoryDeliveryMeta?.deliveredAt);

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
 * 解析当前应展示的交付记录：按「环境变量 → 构建产物 → 仓库 delivery.json」整体取值，
 * 返回的 version 与 deliveredAt 始终来自同一层，不会出现版本与时间各自回退的情况。
 * 全部缺失时两者为空，页面显示「版本信息未知」。
 */
export function resolveDeliveryInfo(
  env = process.env,
  buildInfo = readBuildInfo(),
  meta = readDeliveryMeta()
) {
  const injectedVersion = envVersion(env);
  const injectedTime = envDeliveryTime(env);
  if (injectedVersion || injectedTime) {
    // 只注入版本时，只有交付记录中的版本与之一致才补齐同一版本的交付时间，
    // 绝不把新版本与上一版的时间拼在一起。
    let deliveredAt = injectedTime;
    if (!deliveredAt && injectedVersion === normalizeVersion(meta?.version)) {
      deliveredAt = normalizeDeliveryTime(meta?.deliveredAt);
    }
    return { version: injectedVersion, deliveredAt, source: 'env' };
  }

  const builtVersion = normalizeVersion(buildInfo?.version);
  const builtTime = normalizeDeliveryTime(buildInfo?.deliveredAt);
  if (builtVersion || builtTime) {
    return { version: builtVersion, deliveredAt: builtTime, source: 'build' };
  }

  return {
    version: normalizeVersion(meta?.version),
    deliveredAt: normalizeDeliveryTime(meta?.deliveredAt),
    source: meta ? 'repository' : 'missing',
  };
}

/** 解析当前应展示的版本号（与交付时间同源）。 */
export function resolveVersion(env = process.env, buildInfo = readBuildInfo(), meta) {
  return resolveDeliveryInfo(env, buildInfo, meta).version;
}

/**
 * 规范化为「YYYY-MM-DD HH:MM」：只保留交付时刻的日期与时分。
 * 支持 `2026-11-19 10:34`、`2026-11-19T10:34`、ISO 时间戳等写法；
 * 无法识别（或会写进 HTML 的危险字符）时返回空字符串，由调用方回退。
 */
export function normalizeDeliveryTime(raw) {
  if (raw === undefined || raw === null) return '';
  const value = String(raw).trim();
  if (!value || value === '__APP_DELIVERY_TIME__') return '';
  const matched = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{1,2})/);
  if (!matched) return '';
  const [, year, month, day, hour, minute] = matched;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hourNumber > 23 ||
    minuteNumber > 59
  ) {
    return '';
  }
  return `${year}-${pad2(monthNumber)}-${pad2(dayNumber)} ${pad2(hourNumber)}:${pad2(minuteNumber)}`;
}

/** 仅从环境变量解析交付时间。 */
export function envDeliveryTime(env = process.env) {
  for (const key of DELIVERY_TIME_ENV_KEYS) {
    const normalized = normalizeDeliveryTime(env?.[key]);
    if (normalized) return normalized;
  }
  return '';
}

/** 解析当前应展示的交付时间（与版本号同源）。 */
export function resolveDeliveryTime(env = process.env, buildInfo = readBuildInfo(), meta) {
  return resolveDeliveryInfo(env, buildInfo, meta).deliveredAt;
}

/**
 * 生成页面顶部展示文案：版本号 + 交付时间（日期 + 时分）。
 * 版本记录缺失时明确显示「版本信息未知」，不使用任何上一版旧值。
 */
export function formatVersionLabel(version, deliveryTime) {
  const versionText = String(version ?? '').trim();
  const timeText = normalizeDeliveryTime(deliveryTime);
  if (!versionText || versionText === '__APP_VERSION__') return '版本信息未知';
  if (timeText) return `当前版本：${versionText} · 交付时间：${timeText}`;
  return `当前版本：${versionText}`;
}
