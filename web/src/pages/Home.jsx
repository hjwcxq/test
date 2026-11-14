import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPrompts } from '../api.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '../components.jsx';

const YEAR_OPTIONS = [null, 2022, 2023, 2024];

function haystack(prompt) {
  return [
    prompt.title,
    prompt.region,
    String(prompt.year),
    prompt.original,
    prompt.overview,
    ...(prompt.tags || []),
    ...(prompt.keywords || []).map((k) => k.term),
    ...(prompt.angles || []).map((a) => a.title),
  ]
    .join(' ')
    .toLowerCase();
}

export default function Home() {
  const [prompts, setPrompts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [year, setYear] = useState(null);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const data = await getPrompts();
      setPrompts(Array.isArray(data) ? data : []);
      setStatus('ready');
    } catch (err) {
      setError(err?.message || '题目库加载失败，请稍后重试。');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return prompts.filter((p) => {
      if (year && p.year !== year) return false;
      if (needle && !haystack(p).includes(needle)) return false;
      return true;
    });
  }, [prompts, year, keyword]);

  const hasFilter = Boolean(year || keyword.trim());

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-mark" aria-hidden="true">文</div>
        <div className="hero-copy">
          <p className="eyebrow">上海高考作文 · 思路研习</p>
          <h1>把一道题目，拆成可落笔的思路</h1>
          <p className="hero-lead">
            收录 2022—2024 年上海卷高考作文真题，逐题给出审题要点、关键词拆解、分层立意、
            结构框架与素材方向；也可以粘贴任意作文题，即时得到题型判定、立意分层与分段提纲。
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/analyze">开始自定义剖析</Link>
            <a className="btn btn-outline" href="#library">浏览真题题库</a>
          </div>
          <p className="hero-note">首版聚焦「解题与写作思路指导」：不生成整篇范文，不作评分或逐句批改。</p>
        </div>
      </section>

      <section className="feature-row" aria-label="产品能力">
        <Card className="feature-card">
          <h3>真题精解</h3>
          <p>三年上海卷逐题拆解：从「审题要点」到「常见偏题误区与升格建议」，每一栏都可直接使用。</p>
        </Card>
        <Card className="feature-card">
          <h3>任意题目剖析</h3>
          <p>识别思辨关系、现象评论、名言警句、成长体验等题型，抽取核心概念与限制条件，输出分层立意。</p>
        </Card>
        <Card className="feature-card">
          <h3>可复制的思路</h3>
          <p>剖析结果与真题解题内容均可一键复制为纯文本，方便带进笔记或作文本里继续推敲。</p>
        </Card>
      </section>

      <section className="library" id="library">
        <div className="library-head">
          <div>
            <p className="eyebrow">题库 · 2022—2024</p>
            <h2>上海卷高考作文真题</h2>
            <p className="muted">点击卡片查看完整解题内容；支持按年份与关键词检索。</p>
          </div>
          <Badge tone="seal">共 {prompts.length || 3} 题</Badge>
        </div>

        <div className="filters">
          <div className="year-filters" role="group" aria-label="按年份筛选">
            {YEAR_OPTIONS.map((y) => (
              <button
                key={y ?? 'all'}
                type="button"
                className={`chip ${year === y ? 'chip-active' : ''}`}
                onClick={() => setYear(y)}
                aria-pressed={year === y}
              >
                {y ?? '全部年份'}
              </button>
            ))}
          </div>
          <label className="search-box">
            <span className="sr-only">按关键词检索题目</span>
            <input
              type="search"
              value={keyword}
              placeholder="检索题目原文、关键词或立意…"
              onChange={(e) => setKeyword(e.target.value)}
            />
            {keyword && (
              <button type="button" className="clear-btn" onClick={() => setKeyword('')} aria-label="清空检索词">
                ×
              </button>
            )}
          </label>
        </div>

        {status === 'loading' && <LoadingState text="正在载入题目库…" />}

        {status === 'error' && (
          <ErrorState
            title="题目库加载失败"
            message={error}
            onRetry={load}
          />
        )}

        {status === 'ready' && filtered.length === 0 && (
          <EmptyState
            title={hasFilter ? '没有找到匹配的题目' : '题库暂时为空'}
            description={
              hasFilter
                ? '当前年份或关键词下没有匹配的真题，换个词试试，或清除筛选条件。'
                : '请点击「重新加载」再试一次。'
            }
            action={
              <button type="button" className="btn btn-outline" onClick={() => { setYear(null); setKeyword(''); }}>
                清除筛选条件
              </button>
            }
          />
        )}

        {status === 'ready' && filtered.length > 0 && (
          <div className="card-grid">
            {filtered.map((p) => (
              <Link className="prompt-card card" to={`/prompts/${p.id}`} key={p.id}>
                <div className="prompt-card-top">
                  <span className="year-seal">{p.year}</span>
                  <Badge tone="soft">{p.region}</Badge>
                </div>
                <h3>{p.title}</h3>
                <p className="prompt-excerpt">{p.original}</p>
                <div className="tag-row">
                  {(p.tags || []).slice(0, 4).map((tag) => (
                    <span className="tag" key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="prompt-card-foot">
                  <span>{p.angles?.length || 0} 个立意角度 · {p.structure?.sections?.length || 0} 段结构框架</span>
                  <span className="arrow" aria-hidden="true">查看解题 →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
