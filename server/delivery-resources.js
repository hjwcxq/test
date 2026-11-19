/**
 * 交付资源访问客户端（服务端专用）。
 *
 * 参照公开 SDK 实现：开发/验证阶段从 DELIVERY_RESOURCE_CONTEXT_FILE 读取
 * Bridge 自动续期的任务上下文；运行阶段从 DELIVERY_RESOURCE_IDENTITY_FILE
 * 读取挂载身份，再向中心换取短期资源令牌。令牌只保存在进程内存，绝不落盘、
 * 不写日志、不返回给浏览器。
 */
import { readFile } from 'node:fs/promises';

export class DeliveryResources {
  constructor({
    identityFile = process.env.DELIVERY_RESOURCE_IDENTITY_FILE,
    contextFile = process.env.DELIVERY_RESOURCE_CONTEXT_FILE,
  } = {}) {
    this.identityFile = identityFile;
    this.contextFile = contextFile;
    this.grant = null;
    this.grantRequest = null;
  }

  async post(url, token, body = {}, { timeoutMs = 60000 } = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`资源服务调用失败（HTTP ${response.status}）`);
    return response;
  }

  async loadGrant() {
    if (this.contextFile) {
      return JSON.parse(await readFile(this.contextFile, 'utf8'));
    }

    if (!this.identityFile) throw new Error('未配置交付资源身份文件');
    if (this.grant && Date.parse(this.grant.expires_at) > Date.now() + 60000) {
      return this.grant;
    }
    if (!this.grantRequest) {
      this.grantRequest = (async () => {
        const identity = JSON.parse(await readFile(this.identityFile, 'utf8'));
        const response = await this.post(
          `${identity.center_url}/api/runtime/resource-grants`,
          identity.identity_token,
          { deployment_id: identity.deployment_id }
        );
        this.grant = await response.json();
        return this.grant;
      })().finally(() => {
        this.grantRequest = null;
      });
    }
    return this.grantRequest;
  }

  async access(alias) {
    const grant = await this.loadGrant();
    const resource = (grant?.resources || []).find((item) => item.alias === alias);
    if (!resource) throw new Error(`未绑定服务资源：${alias}`);
    return { ...resource, token: grant.token };
  }

  async request(alias, operation, payload, options) {
    const resource = await this.access(alias);
    const path = String(operation).replace(/^\/+/, '');
    return this.post(`${resource.gateway_url}/${path}`, resource.token, payload, options);
  }
}

export function resourceConfigured() {
  return Boolean(
    process.env.DELIVERY_RESOURCE_CONTEXT_FILE || process.env.DELIVERY_RESOURCE_IDENTITY_FILE
  );
}
