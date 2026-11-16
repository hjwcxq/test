import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getJiangsuPrompts, getPrompts, getZhejiangPrompts } from '../api.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '../components.jsx';

const YEAR_OPTIONS = [null, 2022, 2023, 2024];

const REGIONS = {
  shanghai: {
    key: 'shanghai',
    tab: '上海卷',
    tabHint: '2022—2024 真题',
    eyebrow: '题库 · 上海卷',
    title: '上海卷高考作文真题',
    description: '点击卡片查看完整解题内容；支持按年份与关键词检索。',
    searchPlaceholder: '检索题目原文、关键词或立意…',
  },
  jiangsu: {
    key: 'jiangsu',
    tab: '江苏高考作文',
    tabHint: '新课标I卷 · 2022—2024',
    eyebrow: '题库 · 江苏高考作文',
    title: '江苏高考作文真题',
    description:
      '江苏语文高考采用新课标I卷，收录 2022—2024 年真题材料、写作要求、审题立意与写作提示；支持按年份与关键词检索。',
    searchPlaceholder: '检索材料、审题立意或写作提示…',
  },
  zhejiang: {
    key: 'zhejiang',
    tab: '浙江高考作文',
    tabHint: '浙江卷 / 新课标I卷 · 2022—2024',
    eyebrow: '题库 · 浙江高考作文',
    title: '浙江高考作文真题',
    description:
      '浙江 2022 年使用浙江卷，2023—2024 年使用新课标I卷；收录近三年真题材料、写作要求、审题立意、关键词拆解、结构提纲与评分关注点，卡片按年份从近到远排列。',
    searchPlaceholder: '检索材料、审题立意或关键词…',
  },
};

function parseLibraryParams(params) {
  let region = params.get('region');
  let notice = '';

  if (region && !REGIONS[region]) {
    notice = '题库参数无效，已为你显示上海卷题目。';
    region = 'shanghai';
  }
  if (!region) region = 'shanghai';

  let year = null;
  const rawYear = params.get('year');
  if (rawYear !== null && String(rawYear).trim() !== '') {
    const parsed = Number(String(rawYear).trim());
    if (YEAR_OPTIONS.includes(parsed)) {
      year = parsed;
    } else {
      notice = '年份参数无效，已为你显示全部年份；可选 2022、2023 或 2024 年。';
    }
  }

  return { region, year, notice };
}

function haystack(prompt) {
  return [
    prompt.title,
    prompt.region,
    prompt.province,
    prompt.paper,
    String(prompt.year),
    prompt.original,
    prompt.material,
    prompt.requirements,
    prompt.overview,
    prompt.concept,
    prompt.conceptRelations,
    prompt.source,
    ...(prompt.tags || []),
    ...(prompt.reviewPoints || []),
    ...(prompt.writingTips || []),
    ...(prompt.keywords || []).map((k) => k.term),
    ...(prompt.angles || []).map((a) => a.title),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const [initialParams] = useState(() => parseLibraryParams(searchParams));

  const [shanghaiPrompts, setShanghaiPrompts] = useState([]);
  const [jiangsuPrompts, setJiangsuPrompts] = useState([]);
  const [zhejiangPrompts, setZhejiangPrompts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [region, setRegion] = useState(initialParams.region);
  const [year, setYear] = useState(initialParams.year);
  const [keyword, setKeyword] = useState('');
  const [paramNotice, setParamNotice] = useState(initialParams.notice);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [shanghaiData, jiangsuData, zhejiangData] = await Promise.all([
        getPrompts(),
        getJiangsuPrompts(),
        getZhejiangPrompts(),
      ]);
      setShanghaiPrompts(Array.isArray(shanghaiData) ? shanghaiData : []);
      setJiangsuPrompts(Array.isArray(jiangsuData) ? jiangsuData : []);
      setZhejiangPrompts(Array.isArray(zhejiangData) ? zhejiangData : []);
      setStatus('ready');
    } catch (err) {
      setError(err?.message || '题目库加载失败，请稍后重试。');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = REGIONS[region];
  const prompts =
    region === 'zhejiang' ? zhejiangPrompts : region === 'jiangsu' ? jiangsuPrompts : shanghaiPrompts;

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    const list = prompts.filter((p) => {
      if (year && p.year !== year) return false;
      if (needle && !haystack(p).includes(needle)) return false;
      return true;
    });
    // 浙江题库按年份从近到远排列，其余题库沿用接口的年份升序。
    return region === 'zhejiang' ? [...list].sort((a, b) => b.year - a.year) : list;
  }, [prompts, year, keyword, region]);

  const hasFilter = Boolean(year || keyword.trim());

  const switchRegion = (nextRegion) => {
    if (nextRegion === region) return;
    setRegion(nextRegion);
    setKeyword('');
    setParamNotice('');
  };

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-mark" aria-hidden="true">文</div>
        <div className="hero-copy">
          <p className="eyebrow">高考作文 · 思路研习</p>
          <h1>把一道题目，拆成可落笔的思路</h1>
          <p className="hero-lead">
            收录 2022—2024 年上海卷、江苏新课标I卷与浙江高考作文真题，逐题给出审题要点、关键词拆解、分层立意、
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
          <p>上海卷、江苏新课标I卷与浙江近三年真题逐题拆解：从「审题要点」到「评分关注点」，每一栏都可直接使用。</p>
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
        <div className="region-tabs" role="group" aria-label="选择题库">
          {Object.values(REGIONS).map((item) => {
            const count =
              item.key === 'jiangsu'
                ? jiangsuPrompts.length
                : item.key === 'zhejiang'
                  ? zhejiangPrompts.length
                  : shanghaiPrompts.length;
            return (
              <button
                key={item.key}
                type="button"
                className={`region-tab ${region === item.key ? 'region-tab-active' : ''}`}
                onClick={() => switchRegion(item.key)}
                aria-pressed={region === item.key}
              >
                <span className="region-tab-label">{item.tab}</span>
                <span className="region-tab-hint">
                  {item.tabHint}
                  {count ? ` · ${count} 题` : ''}
                </span>
              </button>
            );
          })}
        </div>

        <div className="library-head">
          <div>
            <p className="eyebrow">{active.eyebrow}</p>
            <h2>{active.title}</h2>
            <p className="muted">{active.description}</p>
          </div>
          <Badge tone="seal">共 {prompts.length || 3} 题</Badge>
        </div>

        {paramNotice && (
          <div className="notice-banner" role="alert">
            <span>{paramNotice}</span>
            <button type="button" className="notice-close" onClick={() => setParamNotice('')} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}

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
              placeholder={active.searchPlaceholder}
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
            {filtered.map((p) => {
              const isJiangsu = region === 'jiangsu';
              const isZhejiang = region === 'zhejiang';
              const excerpt = isJiangsu || isZhejiang ? p.material : p.original;
              const badgeText = isJiangsu || isZhejiang ? `${p.province} · ${p.paper}` : p.region;
              const footText = isZhejiang
                ? `${p.keywords?.length || 0} 个关键词 · ${p.angles?.length || 0} 个立意方向`
                : isJiangsu
                  ? `${p.reviewPoints?.length || 0} 条审题要点 · ${p.writingTips?.length || 0} 条写作提示`
                  : `${p.angles?.length || 0} 个立意角度 · ${p.structure?.sections?.length || 0} 段结构框架`;
              return (
                <Link className="prompt-card card" to={`/prompts/${p.id}`} key={p.id}>
                  <div className="prompt-card-top">
                    <span className="year-seal">{p.year}</span>
                    <Badge tone="soft">{badgeText}</Badge>
                  </div>
                  <h3>{p.title}</h3>
                  <p className="prompt-excerpt">{excerpt}</p>
                  <div className="tag-row">
                    {(p.tags || []).slice(0, 4).map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className="prompt-card-foot">
                    <span>{footText}</span>
                    <span className="arrow" aria-hidden="true">查看解题 →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
