import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPrompt } from '../api.js';
import { Badge, CopyButton, ErrorState, LoadingState, Section } from '../components.jsx';
import { promptToText } from '../exportText.js';

export default function Detail() {
  const { id } = useParams();
  const [prompt, setPrompt] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const data = await getPrompt(id);
      setPrompt(data);
      setStatus('ready');
    } catch (err) {
      setError(err?.message || '解题内容加载失败，请稍后重试。');
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'loading') {
    return <div className="page"><LoadingState text="正在载入解题内容…" /></div>;
  }

  if (status === 'error') {
    return (
      <div className="page">
        <Link className="back-link" to="/">← 返回题目库</Link>
        <ErrorState title="解题内容加载失败" message={error} onRetry={load} />
      </div>
    );
  }

  if (!prompt) return null;

  return (
    <div className="page detail-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">题目库</Link>
        <span aria-hidden="true">/</span>
        <span>{prompt.year} 年 {prompt.region}</span>
        <span aria-hidden="true">/</span>
        <span>{prompt.title}</span>
      </nav>

      <header className="detail-head">
        <div>
          <div className="detail-badges">
            <span className="year-seal">{prompt.year}</span>
            <Badge tone="soft">{prompt.region}</Badge>
            <Badge tone="seal">{prompt.title}</Badge>
          </div>
          <h1>{prompt.title} · 解题思路全解</h1>
          <p className="muted">结构框架建议：{prompt.structure?.wordBudget}</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={promptToText(prompt)} label="复制解题内容" />
        </div>
      </header>

      <Section index={1} title="题目原文" description="先读全题，注意限制条件与写作指令。">
        <blockquote className="original-text">{prompt.original}</blockquote>
      </Section>

      <Section index={2} title="审题要点" description="先解释题目在问什么，再决定往哪里展开。">
        <p className="lead-text">{prompt.overview}</p>
        <ol className="number-list">
          {(prompt.reviewPoints || []).map((point, i) => <li key={i}>{point}</li>)}
        </ol>
      </Section>

      <Section index={3} title="关键词拆解" description="给每个核心概念划定内涵与外延，避免行文时概念滑动。">
        <div className="card-grid card-grid-2">
          {(prompt.keywords || []).map((k, i) => (
            <div className="card mini-card" key={i}>
              <h3 className="mini-title">{k.term}</h3>
              <p>{k.analysis}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={4} title="概念关系" description="辨清概念之间是并列、递进、转化还是张力互补。">
        <p className="lead-text">{prompt.conceptRelations}</p>
      </Section>

      <Section index={5} title="立意角度分层" description={`共 ${prompt.angles?.length || 0} 个角度，标注切题度与层次，可按自己的擅长选择主论点。`}>
        <div className="angle-list">
          {(prompt.angles || []).map((a, i) => (
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

      <Section index={6} title="结构框架" description="每一段的段落功能与字数配比，可直接作为提纲骨架。">
        <div className="outline-list">
          {(prompt.structure?.sections || []).map((s, i) => (
            <div className="outline-row" key={i}>
              <div className="outline-head">
                <span className="outline-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.part}</h3>
                <Badge tone="soft">{s.ratio}</Badge>
              </div>
              <p><span className="label">段落功能</span>{s.function}</p>
              <p><span className="label">写作提示</span>{s.guidance}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={7} title="素材方向" description="按方向迁移，例证之后记得补一句分析。">
        <div className="card-grid card-grid-2">
          {(prompt.materials || []).map((m, i) => (
            <div className="card mini-card" key={i}>
              <h3 className="mini-title">{m.direction}</h3>
              <ul className="plain-list">
                {(m.examples || []).map((ex, j) => <li key={j}>{ex}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section index={8} title="常见偏题误区与升格建议" description="对照检查，往往比多写一个素材更能提分。">
        <div className="pitfall-list">
          {(prompt.pitfalls || []).map((p, i) => (
            <div className="pitfall" key={i}>
              <p><span className="label label-warn">常见误区</span>{p.mistake}</p>
              <p><span className="label label-good">升格建议</span>{p.upgrade}</p>
            </div>
          ))}
        </div>
      </Section>

      <footer className="detail-foot">
        <Link className="btn btn-outline" to="/">← 返回题目库</Link>
        <Link className="btn btn-primary" to="/analyze">剖析我自己的题目 →</Link>
      </footer>
    </div>
  );
}
