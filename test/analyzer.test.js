import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TOPIC_LENGTH,
  analyzeLocal,
  detectQuestionType,
  extractConcepts,
  buildAngles,
  buildOutline,
} from '../server/analyzer.js';

const CASES = [
  {
    name: '思辨关系类',
    topic:
      '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？请写一篇文章，谈谈你对这个问题的认识和思考。要求：（1）自拟题目；（2）不少于800字。',
    expected: '思辨关系类',
  },
  {
    name: '现象评论类',
    topic:
      '如今，越来越多的人习惯在社交平台上展示自己的生活，对此你怎么看？请写一篇文章，谈谈你的认识。要求：（1）自拟题目；（2）不少于800字。',
    expected: '现象评论类',
  },
  {
    name: '名言警句类',
    topic:
      '有人说：“未经审视的人生是不值得过的。”这句话引发了你怎样的思考？请写一篇文章，谈谈你的认识。要求：（1）自拟题目；（2）不少于800字。',
    expected: '名言警句类',
  },
  {
    name: '成长体验类',
    topic:
      '那一次，我第一次独自离家，在陌生的城市里重新认识了自己。请以「成长」为话题，写一篇不少于800字的文章，谈谈你的经历与思考。',
    expected: '成长体验类',
  },
];

test('题型识别：四类典型题目均判定正确，并给出非空依据', () => {
  for (const item of CASES) {
    const detected = detectQuestionType(item.topic);
    assert.equal(detected.name, item.expected, `${item.name} 判定错误`);
    assert.ok(detected.code, '题型 code 不能为空');
    assert.ok(detected.summary.length > 0, '题型说明不能为空');
    assert.ok(detected.reason.length > 0, '判定依据不能为空');
  }
});

test('题目长度上限为 2000 字', () => {
  assert.equal(MAX_TOPIC_LENGTH, 2000);
});

test('剖析结果结构完整：立意 >= 3、提纲非空、各字段齐全', () => {
  for (const item of CASES) {
    const result = analyzeLocal(item.topic);
    assert.equal(result.topic, item.topic);
    assert.equal(result.engine, 'local');
    assert.equal(result.questionType.name, item.expected);

    assert.ok(Array.isArray(result.coreConcepts) && result.coreConcepts.length >= 2, '核心概念至少 2 个');
    for (const c of result.coreConcepts) {
      assert.ok(c.term && c.role && c.explanation, '概念字段不能为空');
    }

    assert.ok(Array.isArray(result.constraints) && result.constraints.length >= 3, '限制条件不能为空');
    for (const c of result.constraints) assert.ok(c.length > 0);

    assert.ok(result.angles.length >= 3, `${item.name} 立意方向必须至少 3 个`);
    for (const a of result.angles) {
      assert.ok(a.title && a.level && a.fit && a.description, '立意字段不能为空');
      assert.ok(a.description.length > 20, '立意描述不能是占位短句');
    }

    assert.ok(result.outline.length >= 4, `${item.name} 分段提纲不能为空`);
    for (const s of result.outline) {
      assert.ok(s.section && s.function && s.ratio && s.guidance, '提纲字段不能为空');
    }

    assert.ok(result.materials.length >= 2, '素材方向不能为空');
    for (const m of result.materials) {
      assert.ok(m.direction && m.examples.length >= 1, '素材字段不能为空');
    }
    assert.ok(result.writingTips.length >= 3, '写作建议不能为空');
    assert.ok(result.risks.length >= 3, '风险提示不能为空');
  }
});

test('剖析引擎是纯函数：同输入稳定同输出，且立意/提纲会嵌入题面概念', () => {
  const topic = CASES[0].topic;
  assert.deepEqual(analyzeLocal(topic), analyzeLocal(topic));

  const result = analyzeLocal(topic);
  const text = JSON.stringify(result.angles) + JSON.stringify(result.outline);
  assert.ok(text.includes('好奇心'), '立意与提纲应引用题眼概念');
  assert.ok(text.includes('陌生世界'), '立意与提纲应引用题面概念');
  assert.ok(result.questionType.signals.length > 0, '应记录命中的题型特征');
});

test('核心概念抽取：题眼优先、无占位内容', () => {
  const type = detectQuestionType(CASES[0].topic);
  const concepts = extractConcepts(CASES[0].topic, type);
  assert.equal(concepts[0].term, '好奇心', '「仅仅是因为 X 吗」中的 X 应作为题眼排在第一位');
  assert.ok(concepts.every((c) => !/TODO|占位|待补充/.test(c.term)));

  const angles = buildAngles(CASES[0].topic, type, concepts);
  const outline = buildOutline(CASES[0].topic, type, concepts);
  assert.ok(angles.length >= 3);
  assert.ok(outline.length >= 4);
});

test('极短题目也能返回完整结构，不抛异常、不出现空字段', () => {
  for (const topic of ['作文', '谈谈读书', '？']) {
    const result = analyzeLocal(topic);
    assert.ok(result.questionType.name.length > 0);
    assert.ok(result.coreConcepts.length >= 2);
    assert.ok(result.angles.length >= 3);
    assert.ok(result.outline.length >= 4);
    assert.ok(result.constraints.length >= 3);
  }
});
