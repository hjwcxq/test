/** 把结构化内容导出为可直接粘贴到笔记 / 文档中的纯文本（含立意与提纲）。 */

/** 追加“精彩范文”段落；自定义剖析结果没有范文字段，调用时自然跳过。 */
function pushEssay(prompt, push) {
  if (!prompt?.essayTitle || !prompt?.essayBody) return;
  push('—— 精彩范文 ——');
  push(prompt.essayTitle);
  for (const paragraph of String(prompt.essayBody).split(/\n\s*\n/)) {
    if (paragraph.trim()) push(paragraph.trim());
  }
  const comment = prompt.essayComment || {};
  const labels = { intention: '立意', structure: '结构', language: '语言', takeaway: '借鉴' };
  for (const [key, label] of Object.entries(labels)) {
    if (comment[key]) push(`点评·${label}：${comment[key]}`);
  }
  if (prompt.essayDisclaimer) push(prompt.essayDisclaimer);
}

export function resultToText(result) {
  if (!result) return '';
  const lines = [];
  const push = (...items) => lines.push(...items, '');

  push('【文思 · 作文题目剖析】');
  push(`题目：${result.topic || ''}`);
  push(`题型判定：${result.questionType?.name || ''}`);
  if (result.questionType?.summary) push(`题型说明：${result.questionType.summary}`);
  if (result.questionType?.reason) push(`判定依据：${result.questionType.reason}`);

  push('—— 核心概念 ——');
  for (const c of result.coreConcepts || []) {
    push(`· ${c.term}（${c.role}）：${c.explanation}`);
  }

  push('—— 限制条件 ——');
  for (const item of result.constraints || []) push(`· ${item}`);

  push('—— 立意方向 ——');
  (result.angles || []).forEach((a, i) => {
    push(`${i + 1}. ${a.title}｜${a.level}｜${a.fit}`);
    push(`   ${a.description}`);
  });

  push('—— 分段提纲 ——');
  (result.outline || []).forEach((s) => {
    push(`【${s.section}】${s.ratio}`);
    push(`   段落功能：${s.function}`);
    push(`   写作提示：${s.guidance}`);
  });

  push('—— 论证与素材建议 ——');
  for (const m of result.materials || []) {
    push(`· ${m.direction}`);
    for (const ex of m.examples || []) push(`   - ${ex}`);
  }

  push('—— 写作建议 ——');
  for (const t of result.writingTips || []) push(`· ${t}`);

  push('—— 风险提示 ——');
  for (const t of result.risks || []) push(`· ${t}`);

  if (result.aiNotes) {
    push('—— 增强补充（可选模型通道） ——');
    push(result.aiNotes);
  }

  push(`剖析引擎：${result.engine === 'llm-enhanced' ? '本地引擎 + 可选模型增强' : '本地结构化启发式引擎'}`);
  return lines.join('\n').trim() + '\n';
}

export function jiangsuPromptToText(prompt) {
  if (!prompt) return '';
  const lines = [];
  const push = (...items) => lines.push(...items, '');

  push('【文思 · 江苏高考作文审题指导】');
  push(`${prompt.year} 年 ${prompt.province}｜${prompt.paper}｜${prompt.title}`);

  push('—— 题目材料 ——');
  push(prompt.material);

  push('—— 写作要求 ——');
  push(prompt.requirements);

  push('—— 审题立意 ——');
  push(prompt.concept);
  for (const point of prompt.reviewPoints || []) push(`· ${point}`);

  push('—— 写作提示 ——');
  (prompt.writingTips || []).forEach((tip, i) => push(`${i + 1}. ${tip}`));

  pushEssay(prompt, push);

  push('—— 来源 ——');
  push(prompt.source);

  push('说明：审题与写作提示为学习指导内容，不代表官方评分标准。');
  return lines.join('\n').trim() + '\n';
}

export function zhejiangPromptToText(prompt) {
  if (!prompt) return '';
  const lines = [];
  const push = (...items) => lines.push(...items, '');

  push('【文思 · 浙江高考作文审题与写作指导】');
  push(`${prompt.year} 年 ${prompt.province}｜${prompt.paper}｜${prompt.title}`);

  push('—— 作文材料 ——');
  push(prompt.material);

  push('—— 写作要求 ——');
  push(prompt.requirements);

  push('—— 审题立意 ——');
  push(prompt.concept);
  for (const point of prompt.reviewPoints || []) push(`· ${point}`);

  push('—— 关键词拆解 ——');
  for (const k of prompt.keywords || []) push(`· ${k.term}：${k.analysis}`);

  push('—— 立意方向 ——');
  (prompt.angles || []).forEach((a, i) => {
    push(`${i + 1}. ${a.title}｜${a.level}｜${a.fit}`);
    push(`   ${a.description}`);
  });

  push(`—— 结构提纲（${prompt.structure?.wordBudget || ''}） ——`);
  for (const s of prompt.structure?.sections || []) {
    push(`【${s.part}】${s.ratio}`);
    push(`   段落功能：${s.function}`);
    push(`   写作提示：${s.guidance}`);
  }

  push('—— 素材与表达建议 ——');
  for (const m of prompt.materials || []) {
    push(`· ${m.direction}`);
    for (const ex of m.examples || []) push(`   - ${ex}`);
  }
  (prompt.writingTips || []).forEach((tip, i) => push(`${i + 1}. ${tip}`));

  push('—— 常见误区与升格建议 ——');
  (prompt.pitfalls || []).forEach((p, i) => {
    push(`${i + 1}. 误区：${p.mistake}`);
    push(`   升格：${p.upgrade}`);
  });

  push('—— 评分关注点 ——');
  for (const point of prompt.scoringPoints || []) push(`· ${point}`);

  pushEssay(prompt, push);

  push('—— 来源与核验 ——');
  push(prompt.source);

  push('说明：审题、写作指导与评分关注点为学习内容，不代表官方评分标准。');
  return lines.join('\n').trim() + '\n';
}

export function promptToText(prompt) {
  if (!prompt) return '';
  const lines = [];
  const push = (...items) => lines.push(...items, '');

  push('【文思 · 上海高考作文解题】');
  push(`${prompt.year} 年 ${prompt.region}｜${prompt.title}`);
  push('—— 题目原文 ——');
  push(prompt.original);

  push('—— 审题要点 ——');
  push(prompt.overview);
  for (const p of prompt.reviewPoints || []) push(`· ${p}`);

  push('—— 关键词拆解 ——');
  for (const k of prompt.keywords || []) push(`· ${k.term}：${k.analysis}`);

  push('—— 概念关系 ——');
  push(prompt.conceptRelations);

  push('—— 立意角度分层 ——');
  (prompt.angles || []).forEach((a, i) => {
    push(`${i + 1}. ${a.title}｜${a.level}｜${a.fit}`);
    push(`   ${a.description}`);
  });

  push(`—— 结构框架（${prompt.structure?.wordBudget || ''}） ——`);
  for (const s of prompt.structure?.sections || []) {
    push(`【${s.part}】${s.ratio}`);
    push(`   段落功能：${s.function}`);
    push(`   写作提示：${s.guidance}`);
  }

  push('—— 素材方向 ——');
  for (const m of prompt.materials || []) {
    push(`· ${m.direction}`);
    for (const ex of m.examples || []) push(`   - ${ex}`);
  }

  push('—— 常见偏题误区与升格建议 ——');
  (prompt.pitfalls || []).forEach((p, i) => {
    push(`${i + 1}. 误区：${p.mistake}`);
    push(`   升格：${p.upgrade}`);
  });

  pushEssay(prompt, push);

  return lines.join('\n').trim() + '\n';
}
