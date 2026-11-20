/**
 * 应用版本解析（运行时唯一来源）。
 *
 * 版本与发布时间只来自项目自己维护的发布记录 `.delivery-release.json`：
 *   { "schema": 1, "version": "v1.1.0", "released_at": "2026-11-20T17:03:38+08:00" }
 *
 * 这份记录与 package.json 同仓、同版本控制，并随构建产物进入镜像。
 * 后端每次请求都重新读取它，不缓存为进程启动时间，也不读取交付中心的
 * 数据库、聊天、交付批次、中心接口或中心版本环境变量。
 *
 * 记录缺失、JSON 非法、schema 不符或字段缺失时返回明确的不可用状态，
 * 不回退任何历史版本、不按交付任务数量推算版本、不编造发布时间。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录的应用发布记录（唯一版本依据）。 */
export const RELEASE_FILE_PATH = path.resolve(here, '../.delivery-release.json');

/** 当前发布记录格式版本。 */
export const RELEASE_SCHEMA = 1;

/** 页面在发布记录不可用时的可识别提示。 */
export const UNAVAILABLE_LABEL = '应用版本信息不可用';
export const UNAVAILABLE_DETAIL = '应用版本信息不可用，请检查发布记录';

/**
 * 规范化为 `vX`：去掉已有前缀，过滤不安全字符（版本号会写进内联脚本），
 * 空值返回空字符串。
 */
export function normalizeVersion(raw) {
  if (raw === undefined || raw === null) return '';
  let value = String(raw).trim();
  if (!value || value === '__APP_VERSION__' || value === '版本信息未知') return '';
  value = value.replace(/^[vV]\s*/, '').trim();
  value = value
    .replace(/[^0-9A-Za-z._+~-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!value) return '';
  return `v${value}`;
}

const DISPLAY_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const ISO_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

function validParts(year, month, day, hour, minute) {
  return (
    Number(year) >= 1970 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31 &&
    Number(hour) <= 23 &&
    Number(minute) <= 59
  );
}

/**
 * 把发布记录里的带时区 ISO8601 时间转成页面展示的「YYYY-MM-DD HH:MM」。
 *
 * 直接采用记录中写明的日期与时分（即发布者所在时区的真实发布时间），
 * 不做时区换算；这样重复构建、进程重启都不会让时间漂移。
 * 非法或缺失时区的时间返回空字符串。
 */
export function normalizeReleasedAt(raw) {
  if (raw === undefined || raw === null) return '';
  const value = String(raw).trim();
  const matched = value.match(ISO_TIME_PATTERN);
  if (!matched) return '';
  const [, year, month, day, hour, minute] = matched;
  if (!validParts(year, month, day, hour, minute)) return '';
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** 校验页面展示用时间是否已是「YYYY-MM-DD HH:MM」。 */
export function isDisplayTime(raw) {
  if (typeof raw !== 'string') return false;
  const matched = raw.trim().match(DISPLAY_TIME_PATTERN);
  if (!matched) return false;
  const [, year, month, day, hour, minute] = matched;
  return validParts(year, month, day, hour, minute);
}

/**
 * 读取发布记录。返回 `{ ok: true, version, releasedAt, releasedAtIso }`
 * 或 `{ ok: false, reason: 'missing' | 'invalid' }`。
 */
export function readReleaseRecord(file = RELEASE_FILE_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.schema !== RELEASE_SCHEMA) return { ok: false, reason: 'invalid' };

  const version = normalizeVersion(parsed.version);
  const releasedAt = normalizeReleasedAt(parsed.released_at);
  if (!version || !releasedAt) return { ok: false, reason: 'invalid' };

  return {
    ok: true,
    version,
    releasedAt,
    releasedAtIso: String(parsed.released_at).trim(),
  };
}

/**
 * 解析当前应用版本。每次都重新读取发布记录，发布记录被替换后无需重启即可生效；
 * 不可用时返回明确状态，绝不回退旧版本。
 */
export function resolveReleaseInfo(file = RELEASE_FILE_PATH) {
  const record = readReleaseRecord(file);
  if (record.ok) {
    return {
      available: true,
      version: record.version,
      releasedAt: record.releasedAt,
      releasedAtIso: record.releasedAtIso,
      reason: null,
    };
  }
  return {
    available: false,
    version: '',
    releasedAt: '',
    releasedAtIso: '',
    reason: record.reason,
  };
}

/**
 * 页面顶部展示文案：「应用版本：v1.1.0 · 发布时间：2026-11-20 17:03」。
 * 尚未拿到版本时显示可识别的不可用提示，不显示任何旧版本号。
 */
export function formatVersionLabel(version, releasedAt) {
  const versionText = normalizeVersion(version);
  if (!versionText) return UNAVAILABLE_LABEL;
  if (isDisplayTime(releasedAt)) {
    return `应用版本：${versionText} · 发布时间：${releasedAt.trim()}`;
  }
  return `应用版本：${versionText} · 发布时间不可用`;
}
