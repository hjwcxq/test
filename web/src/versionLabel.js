/**
 * 页面版本标注的运行时同步。
 *
 * 页面打开后主动读取应用自身提供的 /version.json（服务端禁止缓存），
 * 用当前实际生效的版本与交付时间覆盖首屏文本；读取失败会重试一次，
 * 仍失败时显示可识别的提示，绝不再显示构建时或上一版的旧版本号。
 */
import { apiUrl } from './base.js';

export const VERSION_ENDPOINT = apiUrl('/version.json');
export const LOADING_LABEL = '版本信息获取中…';
export const ERROR_LABEL = '版本信息获取失败，请刷新重试';

const VERSION_PATTERN = /^v[0-9A-Za-z._+~-]+$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** 与 server/version.js 的展示格式保持一致。 */
export function formatVersionLabel(version, deliveredAt) {
  const versionText = typeof version === 'string' ? version.trim() : '';
  const timeText = typeof deliveredAt === 'string' ? deliveredAt.trim() : '';
  if (!VERSION_PATTERN.test(versionText)) return LOADING_LABEL;
  if (TIME_PATTERN.test(timeText)) {
    return `当前版本：${versionText} · 交付时间：${timeText}`;
  }
  return `当前版本：${versionText} · 交付时间获取失败`;
}

/**
 * 校验版本接口返回体。版本号必须存在且格式合法；时间允许为空（页面会提示
 * 时间获取失败），但存在时必须是「日期 + 时分」。
 */
export function parseDeliveryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('版本接口返回格式异常');
  }
  const version = typeof payload.version === 'string' ? payload.version.trim() : '';
  const deliveredAt =
    typeof payload.deliveredAt === 'string' ? payload.deliveredAt.trim() : '';
  if (!VERSION_PATTERN.test(version)) throw new Error('版本号缺失或格式异常');
  if (deliveredAt && !TIME_PATTERN.test(deliveredAt)) throw new Error('交付时间格式异常');
  return { version, deliveredAt };
}

async function requestOnce(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`版本接口 HTTP ${response.status}`);
    return parseDeliveryPayload(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function render(element, info) {
  if (!element) return;
  element.textContent = formatVersionLabel(info.version, info.deliveredAt);
  element.dataset.versionState = info.deliveredAt ? 'ready' : 'partial';
}

function renderError(element) {
  if (!element) return;
  element.textContent = ERROR_LABEL;
  element.dataset.versionState = 'error';
}

let pending = null;

/**
 * 读取并渲染版本信息；失败重试一次。返回 { ok, info, label } 便于测试。
 * 同一页面并发调用会复用同一个 Promise，避免重复请求互相覆盖文本。
 */
export function syncVersionLabel({ retryDelayMs = 500 } = {}) {
  if (pending) return pending;
  const element = typeof document !== 'undefined' ? document.getElementById('app-version') : null;
  if (element) element.dataset.versionState = 'loading';

  pending = (async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const info = await requestOnce();
        render(element, info);
        if (typeof window !== 'undefined') window.__APP_VERSION__ = info.version;
        return { ok: true, info, label: formatVersionLabel(info.version, info.deliveredAt) };
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    renderError(element);
    return { ok: false, error: lastError, label: ERROR_LABEL };
  })().finally(() => {
    pending = null;
  });

  return pending;
}
