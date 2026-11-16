import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPrompt } from '../api.js';
import { Badge, CopyButton, ErrorState, LoadingState, Section } from '../components.jsx';
import { jiangsuPromptToText, promptToText, zhejiangPromptToText } from '../exportText.js';

function ZhejiangDetail({ prompt }) {
  return (
    <div className="page detail-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">题目库</Link>
        <span aria-hidden="true">/</span>
        <span>浙江高考作文</span>
        <span aria-hidden="true">/</span>
        <span>{prompt.year} 年 {prompt.title}</span>
      </nav>

      <header className="detail-head">
        <div>
          <div className="detail-badges">
            <span className="year-seal">{prompt.year}</span>
            <Badge tone="soft">{prompt.province}</Badge>
            <Badge tone="soft">{prompt.paper}</Badge>
            <Badge tone="seal">{prompt.title}</Badge>
          </div>
          <h1>{prompt.title} · 审题立意与写作指导</h1>
          <p className="muted">
            浙江 2022 年高考语文使用浙江卷，2023—2024 年使用新课标I卷；以下为指导内容，不代表官方评分标准。
          </p>
        </div>
        <div className="detail-actions">
          <CopyButton text={zhejiangPromptToText(prompt)} label="复制审题与写作指导" />
        </div>
      </header>

      <Section index={1} title="作文材料" description="先通读材料，圈出核心概念、事例共性与写作指令。">
        <blockquote className="original-text material-text">{prompt.material}</blockquote>
      </Section>

      <Section index={2} title="写作要求" description="文体、角度与字数边界决定文章的基本形态，落笔前务必确认。">
        <p className="requirements-text">{prompt.requirements}</p>
      </Section>

      <Section index={3} title="审题立意" description="先解释题目在问什么，再确定文章的中心判断。">
        <p className="lead-text">{prompt.concept}</p>
        <ol className="number-list">
          {(prompt.reviewPoints || []).map((point, i) => <li key={i}>{point}</li>)}
        </ol>
      </Section>

      <Section index={4} title="关键词拆解" description="为每个核心概念划定内涵与外延，避免行文中概念滑动。">
        <div className="card-grid card-grid-2">
          {(prompt.keywords || []).map((k, i) => (
            <div className="card mini-card" key={i}>
              <h3 className="mini-title">{k.term}</h3>
              <p>{k.analysis}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        index={5}
        title="立意方向"
        description={`共 ${prompt.angles?.length || 0} 个方向，标注切题度与层次，可按自己的积累选择主论点。`}
      >
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

      <Section
        index={6}
        title="结构提纲"
        description={prompt.structure?.wordBudget ? `建议篇幅：${prompt.structure.wordBudget}；每段的功能与配比可直接作为提纲骨架。` : '每段的功能与配比可直接作为提纲骨架。'}
      >
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

      <Section index={7} title="素材与表达建议" description="素材按方向迁移，例证之后补一句分析；表达上保持克制与分寸。">
        <h3 className="mini-title">素材方向</h3>
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
        <div className="outline-list">
          {(prompt.writingTips || []).map((tip, i) => (
            <div className="outline-row" key={i}>
              <div className="outline-head">
                <span className="outline-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>表达建议 {i + 1}</h3>
              </div>
              <p>{tip}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={8} title="常见误区" description="对照检查，比多写一个素材更能减少失分。">
        <div className="pitfall-list">
          {(prompt.pitfalls || []).map((p, i) => (
            <div className="pitfall" key={i}>
              <p><span className="label label-warn">常见误区</span>{p.mistake}</p>
              <p><span className="label label-good">升格建议</span>{p.upgrade}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={9} title="评分关注点" description="用于自评与修改，不代表官方评分细则。">
        <ul className="number-list">
          {(prompt.scoringPoints || []).map((point, i) => <li key={i}>{point}</li>)}
        </ul>
      </Section>

      <Section index={10} title="来源与核验" description="题目材料与写作要求依据公开试题文本整理。">
        <p className="source-note">{prompt.source}</p>
        <p className="muted small">
          浙江省 2022 年使用浙江卷，2023 年起使用新课标I卷，作文题与同卷省份一致。本页审题与写作指导为学习内容，如与官方文本有个别文字差异，以官方发布为准。
        </p>
      </Section>

      <footer className="detail-foot">
        <Link className="btn btn-outline" to="/">← 返回题目库</Link>
        <Link className="btn btn-primary" to="/analyze">剖析我自己的题目 →</Link>
      </footer>
    </div>
  );
}

function JiangsuDetail({ prompt }) {
  return (
    <div className="page detail-page">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/">题目库</Link>
        <span aria-hidden="true">/</span>
        <span>江苏高考作文</span>
        <span aria-hidden="true">/</span>
        <span>{prompt.year} 年 {prompt.title}</span>
      </nav>

      <header className="detail-head">
        <div>
          <div className="detail-badges">
            <span className="year-seal">{prompt.year}</span>
            <Badge tone="soft">{prompt.province}</Badge>
            <Badge tone="soft">{prompt.paper}</Badge>
            <Badge tone="seal">{prompt.title}</Badge>
          </div>
          <h1>{prompt.title} · 审题立意与写作提示</h1>
          <p className="muted">江苏语文高考采用新课标I卷；以下为指导内容，不代表官方评分标准。</p>
        </div>
        <div className="detail-actions">
          <CopyButton text={jiangsuPromptToText(prompt)} label="复制审题与写作提示" />
        </div>
      </header>

      <Section index={1} title="题目材料" description="先通读材料，圈出核心概念与限制条件。">
        <blockquote className="original-text material-text">{prompt.material}</blockquote>
      </Section>

      <Section index={2} title="写作要求" description="写作指令决定文体、角度与字数边界，落笔前务必确认。">
        <p className="requirements-text">{prompt.requirements}</p>
      </Section>

      <Section index={3} title="审题立意" description="先解释题目在问什么，再确定文章的中心判断。">
        <p className="lead-text">{prompt.concept}</p>
        <ol className="number-list">
          {(prompt.reviewPoints || []).map((point, i) => <li key={i}>{point}</li>)}
        </ol>
      </Section>

      <Section index={4} title="写作提示" description="按提示组织段落与论证，避免只罗列例子或空喊口号。">
        <div className="outline-list">
          {(prompt.writingTips || []).map((tip, i) => (
            <div className="outline-row" key={i}>
              <div className="outline-head">
                <span className="outline-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>写作提示 {i + 1}</h3>
              </div>
              <p>{tip}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index={5} title="来源" description="题目材料与写作要求依据公开试题文本整理。">
        <p className="source-note">{prompt.source}</p>
        <p className="muted small">江苏语文高考采用新课标I卷。本页审题与写作提示为学习指导内容，如与官方文本有个别文字差异，以官方发布为准。</p>
      </Section>

      <footer className="detail-foot">
        <Link className="btn btn-outline" to="/">← 返回题目库</Link>
        <Link className="btn btn-primary" to="/analyze">剖析我自己的题目 →</Link>
      </footer>
    </div>
  );
}

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

  if (prompt.province === '江苏') {
    return <JiangsuDetail prompt={prompt} />;
  }

  if (prompt.province === '浙江') {
    return <ZhejiangDetail prompt={prompt} />;
  }

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
