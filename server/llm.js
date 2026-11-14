import { analyzeLocal, MAX_TOPIC_LENGTH } from './analyzer.js';

const TIMEOUT_MS = 4000;

/** 仅当显式配置了密钥与接口地址时才启用增强通道。 */
export function llmConfigured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_API_URL);
}

async function requestEnhancement(topic, local) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(process.env.LLM_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content:
              '你是一位上海高考作文指导教师。只输出「补充思路」，不要写整篇范文、不要打分、不要批改。用简体中文，控制在 300 字以内，分 3 条以内，每条以「·」开头。',
          },
          {
            role: 'user',
            content: [
              `作文题目：${topic.slice(0, MAX_TOPIC_LENGTH)}`,
              `题型判定：${local.questionType.name}`,
              `本地已给出的核心概念：${local.coreConcepts.map((c) => c.term).join('、')}`,
              `本地已给出的立意：${local.angles.map((a) => a.title).join('；')}`,
              '请补充：一个本地可能没有覆盖的立意角度、一个贴题的具体素材、一条最容易踩的偏题风险。',
            ].join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM 返回内容为空');
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对外剖析入口：本地引擎始终先出结果（保证离线可用），
 * 仅在配置密钥时尝试增强；任何失败都静默回退本地结果，不阻塞交付。
 */
export async function analyzeTopic(topic) {
  const local = analyzeLocal(topic);
  if (!llmConfigured()) return local;

  try {
    const aiNotes = await requestEnhancement(local.topic, local);
    return { ...local, engine: 'llm-enhanced', aiNotes };
  } catch {
    return local;
  }
}
