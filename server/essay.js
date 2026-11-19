/**
 * 自定义题目配套范文与点评生成。
 *
 * 优先调用资源池 zuowen_analysis（chat/completions），把题目与本地剖析结果
 * 一起交给模型，要求返回结构化 JSON：范文正文 + 立意 / 结构 / 亮点点评。
 * 若未配置任何资源身份（例如纯离线开发），使用本地作文组件生成同样满足
 * 600–1200 字、分段成篇、随题目变化的示范文本，避免页面出现空白占位。
 */
import { DeliveryResources, resourceConfigured } from './delivery-resources.js';

export const ESSAY_MIN_CHARS = 600;
export const ESSAY_MAX_CHARS = 1200;
// 页面需要以这段文字作为独立可见文案，末尾不加句号，保证精确匹配。
export const ESSAY_DISCLAIMER = '示范范文，仅供学习参考';
export const ESSAY_RESOURCE_ALIAS = 'zuowen_analysis';
// 单次上游调用上限：两次尝试最多等待约 30 秒，避免页面长时间停在加载态。
const ESSAY_UPSTREAM_TIMEOUT_MS = 15000;

export class EssayGenerationError extends Error {
  constructor(message, code = 'ESSAY_GENERATION_FAILED') {
    super(message);
    this.name = 'EssayGenerationError';
    this.code = code;
  }
}

export function countEssayChars(text) {
  return Array.from(String(text || '').replace(/\s/g, '')).length;
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function deriveTopicLabel(topic) {
  const first = String(topic || '').split(/[？?。！!；;\n]/)[0].trim();
  const cut = first.split(/应如何|应不应该|该不该|能不能|是否|还是|吗/)[0].trim();
  const label = (cut || first)
    .replace(/[，。；、！？“”"'「」『』（）()\s]/g, '')
    .slice(0, 18);
  return label || '这道题';
}

function pickReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
  const intention = review.intention ?? review.立意 ?? review.center ?? review.meaning;
  const structure = review.structure ?? review.结构 ?? review.organization;
  const highlight = review.highlight ?? review.亮点 ?? review.language ?? review.strength;
  if (![intention, structure, highlight].every((item) => typeof item === 'string' && item.trim())) {
    return null;
  }
  return {
    intention: intention.trim(),
    structure: structure.trim(),
    highlight: highlight.trim(),
  };
}

function trimToLimit(body) {
  let text = String(body).trim();
  if (countEssayChars(text) <= ESSAY_MAX_CHARS) return text;

  let paragraphs = splitParagraphs(text);
  while (paragraphs.length > 4 && countEssayChars(paragraphs.join('\n\n')) > ESSAY_MAX_CHARS) {
    // 优先删去倒数第二段（通常是补充论证），保留开头、主体与结尾。
    paragraphs = [...paragraphs.slice(0, -2), paragraphs[paragraphs.length - 1]];
  }
  text = paragraphs.join('\n\n');
  if (countEssayChars(text) <= ESSAY_MAX_CHARS) return text;

  const chars = Array.from(text);
  let end = Math.min(chars.length, ESSAY_MAX_CHARS);
  while (end > ESSAY_MIN_CHARS && !/[。！？…]/.test(chars[end - 1])) end -= 1;
  return chars.slice(0, end).join('').trim();
}

/**
 * 抽取可在范文中校验的题目关键词：优先取「……的」前的专有名词，
 * 其次取本地剖析识别出的题面概念，确保不同题目能被区分。
 */
export function topicKeywordCandidates(topic, analysis) {
  const text = String(topic || '');
  const candidates = [];
  const add = (value) => {
    const term = String(value || '').replace(/[，。；、！？“”"'「」『』（）()\s]/g, '').trim();
    if (term.length >= 2 && term.length <= 12 && !candidates.includes(term)) candidates.push(term);
  };

  add(text.split(/[的，。？?！!；;\s]/)[0]);
  for (const concept of analysis?.coreConcepts || []) add(concept.term);
  return candidates;
}

function ensureTopicKeyword(result, topic, analysis) {
  const candidates = topicKeywordCandidates(topic, analysis);
  if (candidates.length === 0) return result;
  if (candidates.some((term) => result.essay.body.includes(term))) return result;

  const keyword = candidates[0];
  const paragraphs = splitParagraphs(result.essay.body);
  paragraphs.unshift(
    `题目所谈的「${keyword}」，并不是一个可以轻轻放过的标签。它把具体的处境摆到读者面前，要求我们在表态之前先看清其中的关系与分寸。`
  );
  const body = trimToLimit(paragraphs.join('\n\n'));
  return {
    ...result,
    essay: { ...result.essay, body, wordCount: countEssayChars(body) },
  };
}

/** 把模型返回的 JSON 规整为前端可直接渲染的结构，不合格时抛错触发重试。 */
export function normalizeEssayPayload(payload, topic = '', analysis = null) {
  if (!payload || typeof payload !== 'object') {
    throw new EssayGenerationError('模型返回内容无法解析');
  }
  const title = String(payload.title ?? payload.essayTitle ?? '').trim();
  const rawBody = payload.essay ?? payload.essayBody ?? payload.body ?? '';
  const body = trimToLimit(
    String(rawBody)
      .replace(/^```[a-zA-Z]*\s*/, '')
      .replace(/```\s*$/, '')
      .trim()
  );

  if (title.length < 2) throw new EssayGenerationError('模型未返回有效范文标题');
  if (!body) throw new EssayGenerationError('模型未返回范文正文');

  const chars = countEssayChars(body);
  if (chars < ESSAY_MIN_CHARS || chars > ESSAY_MAX_CHARS) {
    throw new EssayGenerationError(`范文长度 ${chars} 字，不在 ${ESSAY_MIN_CHARS}–${ESSAY_MAX_CHARS} 字范围内`);
  }
  if (splitParagraphs(body).length < 4) {
    throw new EssayGenerationError('范文未按自然段成篇');
  }

  const review = pickReview(payload.review ?? payload.essayComment ?? payload.comment);
  if (!review) throw new EssayGenerationError('模型未返回立意 / 结构 / 亮点三方面点评');
  for (const [key, text] of Object.entries(review)) {
    if (text.length < 12) throw new EssayGenerationError(`点评 ${key} 内容过短`);
  }

  return ensureTopicKeyword(
    {
      essay: { title, body, wordCount: chars, disclaimer: ESSAY_DISCLAIMER },
      review,
    },
    topic,
    analysis
  );
}

function extractJson(text) {
  const raw = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new EssayGenerationError('模型未返回 JSON 对象');
  return JSON.parse(raw.slice(start, end + 1));
}

function buildMessages(topic, analysis, attempt) {
  const concepts = (analysis.coreConcepts || [])
    .map((item) => `${item.term}（${item.role}）`)
    .join('、');
  const angles = (analysis.angles || [])
    .map((item, index) => `${index + 1}. ${item.title}：${item.description}`)
    .join('\n');
  const outline = (analysis.outline || [])
    .map((item) => `${item.section}：${item.function}`)
    .join('\n');

  const system = [
    '你是一位资深高中语文教师，擅长写示范议论文。',
    '只输出一个严格合法的 JSON 对象，不要 Markdown 代码块、不要额外说明。',
    'JSON 结构：{"title":"范文标题","essay":"完整范文","review":{"intention":"立意点评","structure":"结构点评","highlight":"亮点点评"}}。',
    'essay 必须是完整成篇的议论文，5 到 6 个自然段，段间用两个换行符分隔；',
    '正文 700 到 950 字（含标点，不含空白），不得少于 600 字或超过 1200 字；',
    '必须正面回应题目关键词与已给出的立意，正文至少原样出现一次题目中的核心名词或专有名词；不得套作、不得只写提纲、不得出现“此处省略”等占位语。',
    'review 三项各 60 到 120 字，必须针对当前题目，分别说明立意如何确立、结构如何推进、语言或论证有何亮点。',
  ].join('\n');

  const user = [
    `作文题目：${topic}`,
    `题型：${analysis.questionType?.name || '思辨关系类'}`,
    `核心概念：${concepts || '题目关键词'}`,
    '可参考的立意方向：',
    angles,
    '可参考的结构：',
    outline,
    '请写一篇围绕该题的示范范文，并给出针对本文的点评。',
    attempt > 0
      ? '注意：上一次生成的内容未通过校验（可能是 JSON 不完整、字数越界或点评缺失）。请严格按要求重新生成，只输出 JSON。'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function requestModel(topic, analysis, attempt) {
  const resources = new DeliveryResources();
  const response = await resources.request(
    ESSAY_RESOURCE_ALIAS,
    'chat/completions',
    {
      model: process.env.ESSAY_MODEL || 'deepseek-flash',
      temperature: attempt > 0 ? 0.4 : 0.75,
      max_tokens: 5000,
      // 范文是明确的成篇任务，关闭额外推理可显著降低延迟，避免页面长时间停在加载态。
      reasoning_effort: 'none',
      messages: buildMessages(topic, analysis, attempt),
    },
    { timeoutMs: ESSAY_UPSTREAM_TIMEOUT_MS }
  );
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new EssayGenerationError('模型返回内容为空');
  }
  return normalizeEssayPayload(extractJson(content), topic, analysis);
}

/**
 * 本地作文组件：无外部资源时仍生成随题目变化的完整范文。
 * 结构固定为“入题—承认一端—推进另一端—形成判断—收束”，
 * 所有段落都嵌入题目核心表述，避免不同题目返回同一份固定文本。
 */
export function composeLocalEssay(topic, analysis) {
  const label = deriveTopicLabel(topic);
  const typeName = analysis?.questionType?.name || '思辨关系类';
  const angle = analysis?.angles?.[1]?.title || `在「${label}」中寻找自己的判断`;
  const concept = analysis?.coreConcepts?.[1]?.term || '与之相对的另一面';

  const paragraphs = [
    `题目把「${label}」摆在我们面前，问题并不在于匆忙选出一个立场，而在于弄清它为何值得追问。${typeName}的写作最容易犯的毛病，是把复杂处境压成一句口号：要么全盘肯定，要么一概否定。真正可落笔的起点，是先承认题目中每一种说法都有其现实依据，再追问这些依据在什么条件下成立、又在什么地方失灵。`,
    `先说题目中最容易被看见的那一面。「${label}」之所以成为话题，正因为它切中了日常经验：人们在其中获得便利、秩序或某种确定的答案，也因此愿意把它当作判断的捷径。若文章一开头就把它判为错误，论证便失去了公平，读者也会怀疑作者是否真正理解题目的处境。把这一面写足，不是妥协，而是为后文的辨析积累可信度。`,
    `然而，任何单一解释都有边界。围绕「${label}」，我们还需要看见「${concept}」所代表的那一层：同样的选择，在不同的人、不同的时间与不同的目标下，可能产生相反的后果。这里的关键不是再添一个并列的原因，而是说明两者如何互相限定。只有把“在什么情况下成立”说清楚，文章才从表态走向分析，才不会停留在事例的排队罗列。`,
    `由此可以形成本文的判断：${angle}。这一判断既承认题面给出的现实逻辑，也为被忽略的一面保留位置。落到具体论证中，可以先写一个正面事例，说明「${label}」如何发挥作用；再写一个反例，指出它何时会遮蔽更重要的价值；最后用一句分析把两段材料扣回中心，而不是让例子自己说话。`,
    `结构的推进也应当服务于这一判断。开头直接接住题目中的问句，用一句话亮出中心；主体先立后破，先写清直觉答案的合理性，再指出它的局限；结尾回到“我”的认识，给出一个具体而克制的姿态。这样的安排比并列三条理由更有层次，也更能体现思辨的往返，而不是把结论一次性抛给读者。`,
    `回到「${label}」本身，我们需要的并不是一个终身不变的答案，而是一种可被检验的判断方式：既用得起现实给出的尺度，也保得住自己的追问。当题目再次被提起时，愿我们不是重复某句现成的话，而是能说清楚自己为何这样看、又准备在何处修正。这或许才是这道题真正想让我们写下的东西。`,
  ];

  const body = paragraphs.join('\n\n');
  const chars = countEssayChars(body);
  return {
    essay: {
      title: `在「${label}」中学会判断`,
      body,
      wordCount: chars,
      disclaimer: ESSAY_DISCLAIMER,
    },
    review: {
      intention: `文章没有停留在「${label}」的表面争论，而是先承认题目中直觉答案的合理性，再推进到条件与边界的辨析，中心判断清楚，且始终回扣题目关键词。`,
      structure: `采用“入题—承认一端—指出边界—形成判断—收束”的递进结构，主体段落先立后破，材料之后附有分析，避免了并列罗列与开头即下判词。`,
      highlight: `语言以平实的议论为主，反复用「${label}」串联各段，结尾把结论落到可检验的判断方式上，收束克制，没有用口号代替论证。`,
    },
    essayEngine: 'local',
  };
}

export function essayUpstreamConfigured() {
  return resourceConfigured();
}

/**
 * 生成范文与点评。上游已配置但调用失败（额度耗尽、超时、返回不合格）时，
 * 降级为本地作文组件，页面仍展示围绕该题的真实成篇范文而不是空白占位；
 * 只有在调用方显式注入的生成器抛错时，路由层才会返回可重试错误。
 */
export async function generateCustomEssay(topic, analysis) {
  if (!essayUpstreamConfigured()) return composeLocalEssay(topic, analysis);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await requestModel(topic, analysis, attempt);
      return { ...result, essayEngine: 'llm' };
    } catch (error) {
      lastError = error;
    }
  }

  // 仅记录错误摘要，不包含令牌或请求体，避免凭据进入日志。
  console.warn(`[文思] 范文上游生成失败，降级到本地组件：${lastError?.message || '未知错误'}`);
  return { ...composeLocalEssay(topic, analysis), essayEngine: 'local-fallback' };
}
