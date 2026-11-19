import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { analyzeTopic } from '../api.js';
import { MAX_TOPIC_LENGTH } from '../constants.js';
import { saveResult } from '../storage.js';
import { Card } from '../components.jsx';

const EXAMPLES = [
  {
    label: '思辨关系类',
    text: '一个人乐意去探索陌生世界，仅仅是因为好奇心吗？请写一篇文章，谈谈你对这个问题的认识和思考。要求：（1）自拟题目；（2）不少于800字。',
  },
  {
    label: '现象评论类',
    text: '生活中，人们常用认可度判别事物，区分高下。请写一篇文章，谈谈你对“认可度”的认识和思考。要求：（1）自拟题目；（2）不少于800字。',
  },
  {
    label: '名言警句类',
    text: '有人说：“未经审视的人生是不值得过的。”这句话引发了你怎样的思考？请写一篇文章，谈谈你的认识。要求：（1）自拟题目；（2）不少于800字。',
  },
  {
    label: '成长体验类',
    text: '那一次，我第一次独自离家，在陌生的城市里重新认识了自己。请以「成长」为话题，写一篇不少于800字的文章，谈谈你的经历与思考。',
  },
];

const MIN_LOADING_MS = 1200;

function waitAtLeast(startedAt) {
  const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

function validate(text) {
  if (!text.trim()) return '请输入作文题目';
  if (text.length > MAX_TOPIC_LENGTH) {
    return `题目不能超过 ${MAX_TOPIC_LENGTH} 字，当前 ${text.length} 字，请精简后重试。`;
  }
  return '';
}

export default function Analyze() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [validation, setValidation] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | error
  const [error, setError] = useState('');

  const overLimit = text.length > MAX_TOPIC_LENGTH;

  const submit = async () => {
    const message = validate(text);
    setValidation(message);
    if (message) return;

    setStatus('submitting');
    setError('');
    const startedAt = Date.now();
    try {
      const result = await analyzeTopic(text);
      // 保证「正在生成范文…」至少可见一小段时间，避免瞬时返回导致加载态一闪而过。
      await waitAtLeast(startedAt);
      saveResult(result);
      navigate('/result');
    } catch (err) {
      await waitAtLeast(startedAt);
      setError(err?.message || '剖析失败，服务暂时不可用，请稍后重试。');
      setStatus('error');
    }
  };

  return (
    <div className="page analyze-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">题目库</Link>
        <span aria-hidden="true">/</span>
        <span>自定义题目剖析</span>
      </nav>

      <header className="page-head">
        <p className="eyebrow">自定义剖析</p>
        <h1>粘贴一道作文题，得到可落笔的思路</h1>
        <p className="muted">
          本地结构化启发式引擎会判定题型、抽取核心概念与限制条件，并给出分层立意、分段提纲、
          素材方向与风险提示；提交后还会围绕题目生成一篇示范范文与点评。无外部模型密钥时使用本地范文组件。
        </p>
      </header>

      <Card className="input-card">
        <div className="input-card-head">
          <label htmlFor="topic-input">作文题目</label>
          <span className={`counter ${overLimit ? 'counter-over' : ''}`} aria-live="polite">
            {text.length} / {MAX_TOPIC_LENGTH} 字
          </span>
        </div>

        <textarea
          id="topic-input"
          data-testid="custom-topic-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (validation) setValidation('');
            if (status === 'error') setStatus('idle');
          }}
          placeholder={'在此粘贴或输入作文题目，支持多行。\n例如：一个人乐意去探索陌生世界，仅仅是因为好奇心吗？'}
          rows={8}
          spellCheck={false}
        />

        {overLimit && (
          <p className="field-warn" role="alert">
            已超出 {text.length - MAX_TOPIC_LENGTH} 字，请精简后再提交。
          </p>
        )}
        {validation && (
          <p className="field-error" role="alert" data-testid="topic-error">
            {validation}
          </p>
        )}

        <div className="example-row">
          <span className="example-label">示例一键填充</span>
          <div className="example-chips">
            {EXAMPLES.map((example) => (
              <button
                type="button"
                className="chip chip-small"
                key={example.label}
                onClick={() => {
                  setText(example.text);
                  setValidation('');
                  if (status === 'error') setStatus('idle');
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="analyze-button"
            onClick={submit}
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? '正在分析…' : '开始分析'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setText(''); setValidation(''); setError(''); setStatus('idle'); }}
          >
            清空
          </button>
          <span className="form-hint">空题目、纯空白或超长输入会被拦截并给出提示。</span>
        </div>
      </Card>

      {status === 'submitting' && (
        <div className="state-block" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <p>正在生成范文…</p>
          <p className="muted small">同时剖析题面，生成立意与提纲；完成后会一起展示，请勿重复提交。</p>
        </div>
      )}

      {status === 'error' && (
        <div className="state-block state-error" role="alert">
          <div className="state-icon" aria-hidden="true">!</div>
          <h3>剖析失败</h3>
          <p>{error}</p>
          <div className="error-actions">
            <button type="button" className="btn btn-outline" onClick={submit}>重试剖析</button>
            <Link className="btn btn-ghost" to="/">返回题目库</Link>
          </div>
        </div>
      )}

      <section className="tips-strip">
        <h2>剖析结果包含</h2>
        <div className="tips-grid">
          <div><strong>题型判定</strong><span>思辨关系 / 现象评论 / 名言警句 / 成长体验等</span></div>
          <div><strong>概念与限制</strong><span>核心概念、题眼、字数与写作指令约束</span></div>
          <div><strong>立意分层</strong><span>至少 3 个方向，标注层次与切题度</span></div>
          <div><strong>分段提纲</strong><span>段落功能、字数配比与写作提示</span></div>
          <div><strong>示范范文</strong><span>围绕题目生成约 800 字完整文章，标注学习参考</span></div>
          <div><strong>范文点评</strong><span>从立意、结构、亮点三方面对照学习</span></div>
          <div><strong>素材与建议</strong><span>可迁移素材方向、论证建议</span></div>
          <div><strong>风险提示</strong><span>常见偏题点，避免写成占位式套话</span></div>
        </div>
      </section>
    </div>
  );
}
