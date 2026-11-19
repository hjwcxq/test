import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  CopyButton,
  CustomEssaySection,
  EmptyState,
  LoadingState,
  Section,
} from '../components.jsx';
import { analyzeTopic } from '../api.js';
import { MAX_TOPIC_LENGTH } from '../constants.js';
import { resultToText } from '../exportText.js';
import { loadResult, saveResult } from '../storage.js';

const MIN_LOADING_MS = 1200;

function waitAtLeast(startedAt) {
  const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

export default function Result() {
  const [result, setResult] = useState(() => loadResult());
  const [topic, setTopic] = useState('');
  const [topicError, setTopicError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | error

  if (status === 'submitting') {
    return (
      <div className="page result-page">
        <LoadingState text="正在生成范文…" />
      </div>
    );
  }

  if (!result || !result.questionType || !Array.isArray(result.angles)) {
    return (
      <div className="page">
        <EmptyState
          title="还没有剖析结果"
          description="剖析结果只在当前会话展示。请粘贴一道作文题开始剖析，或先浏览真题题库。"
          action={
            <div className="error-actions">
              <Link className="btn btn-primary" to="/analyze">去剖析题目</Link>
              <Link className="btn btn-outline" to="/">浏览题目库</Link>
            </div>
          }
        />
      </div>
    );
  }

  const enhanced = result.essayEngine === 'llm';

  const submitAnother = async () => {
    const value = topic.trim();
    if (!value) {
      setTopicError('请输入作文题目');
      return;
    }
    if (value.length > MAX_TOPIC_LENGTH) {
      setTopicError(`题目不能超过 ${MAX_TOPIC_LENGTH} 字，当前 ${value.length} 字，请精简后重试。`);
      return;
    }

    const previous = result;
    setTopicError('');
    setSubmitError('');
    setStatus('submitting'); // 生成期间隐藏旧范文，避免展示上一题内容
    setResult(null);
    const startedAt = Date.now();
    try {
      const next = await analyzeTopic(value);
      await waitAtLeast(startedAt);
      saveResult(next);
      setResult(next);
      setTopic('');
      setStatus('idle');
    } catch (err) {
      await waitAtLeast(startedAt);
      // 生成失败时恢复原有剖析内容，只给出可重试提示，不展示空白范文。
      setResult(previous);
      setSubmitError(err?.message || '范文生成失败，请稍后点击重试。');
      setStatus('error');
    }
  };

  return (
    <div className="page result-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">题目库</Link>
        <span aria-hidden="true">/</span>
        <Link to="/analyze">自定义剖析</Link>
        <span aria-hidden="true">/</span>
        <span>剖析结果</span>
      </nav>

      <header className="detail-head">
        <div>
          <div className="detail-badges">
            <Badge tone="seal">{result.questionType.name}</Badge>
            <Badge tone="soft">
              {enhanced ? '本地剖析 + 模型范文' : '本地剖析 + 本地范文组件'}
            </Badge>
          </div>
          <h1>题目剖析结果</h1>
          <p className="muted">以下包含思路指导与一篇示范范文及点评，范文仅供学习参考。</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={resultToText(result)} label="复制剖析与范文" />
        </div>
      </header>

      <blockquote className="original-text result-original">{result.topic}</blockquote>

      <Section index={1} title="题型判定" description="判定依据来自题面的句式与特征词，可据此选择论证路径。">
        <Card className="type-card">
          <div className="type-head">
            <h3>{result.questionType.name}</h3>
            {(result.questionType.signals || []).map((s) => <span className="tag" key={s}>{s}</span>)}
          </div>
          <p>{result.questionType.summary}</p>
          <p className="muted small">{result.questionType.reason}</p>
        </Card>
      </Section>

      <Section index={2} title="核心概念" description="先界定再使用；题眼概念应贯穿全文。">
        <div className="card-grid card-grid-2">
          {(result.coreConcepts || []).map((c, i) => (
            <div className="card mini-card" key={i}>
              <div className="mini-head">
                <h3 className="mini-title">{c.term}</h3>
                <Badge tone="soft">{c.role}</Badge>
              </div>
              <p>{c.explanation}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={3} title="限制条件" description="动手前逐条核对，防止无意识偏题。">
        <ul className="plain-list boxed-list">
          {(result.constraints || []).map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </Section>

      <Section
        index={4}
        title="立意角度"
        description={`立意方向共 ${result.angles?.length || 0} 个，按层次与切题度选择主论点。`}
      >
        <div className="angle-list">
          {(result.angles || []).map((a, i) => (
            <article className="card angle-card" key={i}>
              <div className="angle-top">
                <span className="angle-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{a.title}</h3>
              </div>
              <div className="angle-meta">
                <Badge tone="seal">{a.level}</Badge>
                <Badge tone="soft">{a.fit}</Badge>
              </div>
              <p>{a.description}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section index={5} title="结构思路" description="分段提纲给出段落功能与字数配比，可直接作为写作骨架。">
        <div className="outline-list">
          {(result.outline || []).map((s, i) => (
            <div className="outline-row" key={i}>
              <div className="outline-head">
                <span className="outline-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.section}</h3>
                <Badge tone="soft">{s.ratio}</Badge>
              </div>
              <p><span className="label">段落功能</span>{s.function}</p>
              <p><span className="label">写作提示</span>{s.guidance}</p>
            </div>
          ))}
        </div>
      </Section>

      <CustomEssaySection essay={result.essay} review={result.review} index={6} />

      <Section index={8} title="论证与素材建议" description="按方向迁移，例证之后记得补一句分析。">
        <div className="card-grid card-grid-2">
          {(result.materials || []).map((m, i) => (
            <div className="card mini-card" key={i}>
              <h3 className="mini-title">{m.direction}</h3>
              <ul className="plain-list">
                {(m.examples || []).map((ex, j) => <li key={j}>{ex}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section index={9} title="写作建议" description="成篇前的最后检查清单。">
        <ul className="plain-list boxed-list">
          {(result.writingTips || []).map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </Section>

      <Section index={10} title="风险提示" description="对照检查，避开最常见的偏题方式。">
        <ul className="plain-list boxed-list warn-list">
          {(result.risks || []).map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </Section>

      {result.aiNotes && (
        <Section index={11} title="增强补充（可选模型通道）" description="仅在服务端配置模型密钥时由增强通道给出。">
          <div className="ai-notes">{result.aiNotes}</div>
        </Section>
      )}

      <Section
        index={12}
        title="再剖析一道题"
        description="换一个题目重新提交，范文与点评会随新题目一起更新。"
        className="result-analyze-section"
      >
        <Card className="input-card result-analyze-card">
          <div className="input-card-head">
            <label htmlFor="result-topic-input">作文题目</label>
            <span className="counter" aria-live="polite">
              {topic.length} / {MAX_TOPIC_LENGTH} 字
            </span>
          </div>
          <textarea
            id="result-topic-input"
            data-testid="custom-topic-input"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (topicError) setTopicError('');
              if (submitError) {
                setSubmitError('');
                setStatus('idle');
              }
            }}
            placeholder="粘贴或输入另一道作文题，重新生成剖析与范文"
            rows={12}
            spellCheck={false}
          />
          {topicError && (
            <p className="field-error" role="alert" data-testid="topic-error">
              {topicError}
            </p>
          )}
          {submitError && (
            <p className="field-error" role="alert">
              {submitError}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="analyze-button"
              onClick={submitAnother}
              disabled={status === 'submitting'}
            >
              开始分析
            </button>
            <span className="form-hint">提交后会重新生成立意、结构、范文与点评。</span>
          </div>
        </Card>
      </Section>

      <footer className="detail-foot">
        <Link className="btn btn-outline" to="/analyze">← 再剖析一题</Link>
        <Link className="btn btn-primary" to="/">返回题目库</Link>
      </footer>
    </div>
  );
}
