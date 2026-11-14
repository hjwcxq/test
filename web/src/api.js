import { apiUrl } from './base.js';

export class ApiError extends Error {
  constructor(message, status = 0, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后点击重试。', 0, 'NETWORK_ERROR');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || `请求失败（HTTP ${response.status}），请稍后点击重试。`;
    throw new ApiError(message, response.status, payload?.error?.code || 'HTTP_ERROR');
  }

  return payload;
}

export function getPrompts() {
  return request('/api/prompts');
}

export function getPrompt(id) {
  return request(`/api/prompts/${encodeURIComponent(id)}`);
}

export function analyzeTopic(topic) {
  return request('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ topic }),
  });
}
