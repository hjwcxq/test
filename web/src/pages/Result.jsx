import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, CopyButton, EmptyState, Section } from '../components.jsx';
import { resultToText } from '../exportText.js';
import { loadResult } from '../storage.js';

export default function Result() {
  const result = loadResult();

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

  const enhanced = result.engine === 'llm-enhanced';

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
            <Badge tone="soft">{enhanced ? '本地引擎 + 可选模型增强' : '本地结构化启发式引擎'}</Badge>
          </div>
          <h1>题目剖析结果</h1>
          <p className="muted">以下为思路指导，不生成整篇范文，也不作评分。</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={resultToText(result)} label="复制剖析结果" />
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

      <Section index={4} title="立意方向" description={`共 ${result.angles?.length || 0} 个方向，按层次与切题度选择主论点。`}>
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

      <Section index={5} title="分段提纲" description="段落功能与字数配比，可直接作为写作骨架。">
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

      <Section index={6} title="论证与素材建议" description="按方向迁移，例证之后记得补一句分析。">
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

      <Section index={7} title="写作建议" description="成篇前的最后检查清单。">
        <ul className="plain-list boxed-list">
          {(result.writingTips || []).map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </Section>

      <Section index={8} title="风险提示" description="对照检查，避开最常见的偏题方式。">
        <ul className="plain-list boxed-list warn-list">
          {(result.risks || []).map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </Section>

      {result.aiNotes && (
        <Section index={9} title="增强补充（可选模型通道）" description="仅在服务端配置模型密钥时由增强通道给出。">
          <div className="ai-notes">{result.aiNotes}</div>
        </Section>
      )}

      <footer className="detail-foot">
        <Link className="btn btn-outline" to="/analyze">← 再剖析一题</Link>
        <Link className="btn btn-primary" to="/">返回题目库</Link>
      </footer>
    </div>
  );
}
