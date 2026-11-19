import { analyzeLocal } from './analyzer.js';
import { essayUpstreamConfigured, generateCustomEssay } from './essay.js';

/** 是否配置了外部文本生成资源（资源池或旧版 LLM 环境变量）。 */
export function llmConfigured() {
  return essayUpstreamConfigured();
}

/**
 * 对外剖析入口：本地引擎先给出完整思路，再为自定义题目生成一篇示范范文与点评。
 * 范文生成失败时向上抛出 EssayGenerationError，由路由层转换成可重试错误，
 * 不会返回空白范文或占位文本。
 */
export async function analyzeTopic(topic, options = {}) {
  const local = analyzeLocal(topic);
  const generator = options.essayGenerator || generateCustomEssay;
  const { essay, review, essayEngine } = await generator(local.topic, local);
  return {
    ...local,
    essay,
    review,
    essayEngine: essayEngine || 'local',
  };
}
