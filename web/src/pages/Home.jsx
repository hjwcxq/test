import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  analyzeTopic,
  getJiangsuPrompts,
  getPrompts,
  getZhejiangPrompts,
} from '../api.js';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '../components.jsx';
import { MAX_TOPIC_LENGTH } from '../constants.js';
import { saveResult } from '../storage.js';

const YEAR_OPTIONS = [null, 2022, 2023, 2024];

/**
 * 三套内置题库。name 是列表与地区入口使用的短标签（上海 / 江苏 / 浙江），
 * 单独成元素以便地区总览一眼可见；卡片徽标保留完整的“上海卷 / 江苏 · 新课标I卷”信息。
 */
const REGIONS = [
  {
    key: 'shanghai',
    name: '上海',
    badge: '上海卷',
    description: '上海卷近三年真题，逐题给出审题要点、立意分层与结构框架。',
  },
  {
    key: 'jiangsu',
    name: '江苏',
    badge: '江苏 · 新课标I卷',
    description: '江苏新课标I卷近三年真题，附材料、写作要求、审题立意与写作提示。',
  },
  {
    key: 'zhejiang',
    name: '浙江',
    badge: '浙江 · 浙江卷 / 新课标I卷',
    description: '浙江近三年真题，附关键词拆解、立意方向、结构提纲与评分关注点。',
  },
];

function parseLibraryParams(params) {
  let notice = '';
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
  return { year, notice };
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

/** 地区入口跳转到该地区最近一年的真题详情，避免入口本身无反馈。 */
function latestPrompt(list) {
  return [...list].sort((a, b) => b.year - a.year)[0];
}

function excerptOf(prompt) {
  if (prompt.province === '江苏' || prompt.province === '浙江') return prompt.material;
  return prompt.original;
}

function footTextOf(prompt) {
  if (prompt.province === '浙江') {
    return `${prompt.keywords?.length || 0} 个关键词 · ${prompt.angles?.length || 0} 个立意方向`;
  }
  if (prompt.province === '江苏') {
    return `${prompt.reviewPoints?.length || 0} 条审题要点 · ${prompt.writingTips?.length || 0} 条写作提示`;
  }
  return `${prompt.angles?.length || 0} 个立意角度 · ${prompt.structure?.sections?.length || 0} 段结构框架`;
}

function PromptCard({ prompt, region }) {
  return (
    <Link className="prompt-card card" to={`/prompts/${prompt.id}`}>
      <div className="prompt-card-top">
        <span className="year-seal">{prompt.year} 年</span>
        <Badge tone="soft">{region.badge}</Badge>
      </div>
      <h3>{prompt.title}</h3>
      <p className="prompt-excerpt">{excerptOf(prompt)}</p>
      <div className="tag-row">
        {(prompt.tags || []).slice(0, 4).map((tag) => (
          <span className="tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="prompt-card-foot">
        <span>{footTextOf(prompt)}</span>
        <span className="arrow" aria-hidden="true">查看解题 →</span>
      </div>
    </Link>
  );
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [initialParams] = useState(() => parseLibraryParams(searchParams));

  const [datasets, setDatasets] = useState({ shanghai: [], jiangsu: [], zhejiang: [] });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [year, setYear] = useState(initialParams.year);
  const [keyword, setKeyword] = useState('');
  const [paramNotice, setParamNotice] = useState(initialParams.notice);

  const [topic, setTopic] = useState('');
  const [topicError, setTopicError] = useState('');
  const [analyzeError, setAnalyzeError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [shanghaiData, jiangsuData, zhejiangData] = await Promise.all([
        getPrompts(),
        getJiangsuPrompts(),
        getZhejiangPrompts(),
      ]);
      setDatasets({
        shanghai: Array.isArray(shanghaiData) ? shanghaiData : [],
        jiangsu: Array.isArray(jiangsuData) ? jiangsuData : [],
        zhejiang: Array.isArray(zhejiangData) ? zhejiangData : [],
      });
      setStatus('ready');
    } catch (err) {
      setError(err?.message || '真题题库加载失败，请稍后点击重试。');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const needle = keyword.trim().toLowerCase();

  const groups = useMemo(
    () =>
      REGIONS.map((region) => {
        const source = datasets[region.key] || [];
        const list = source.filter((p) => {
          if (year && p.year !== year) return false;
          if (needle && !haystack(p).includes(needle)) return false;
          return true;
        });
        // 浙江题库按年份从近到远排列，其余题库沿用接口的年份升序。
        const prompts =
          region.key === 'zhejiang' ? [...list].sort((a, b) => b.year - a.year) : list;
        return { ...region, total: source.length, prompts };
      }),
    [datasets, year, needle]
  );

  const totalPrompts = groups.reduce((sum, group) => sum + group.total, 0);
  const visiblePrompts = groups.reduce((sum, group) => sum + group.prompts.length, 0);
  const hasFilter = Boolean(year || needle);

  const scrollToLibrary = () => {
    const target = document.getElementById('library');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitTopic = async () => {
    const value = topic.trim();
    if (!value) {
      setTopicError('作文题目不能为空，请输入或粘贴题目后再提交。');
      setAnalyzeError('');
      return;
    }
    if (value.length > MAX_TOPIC_LENGTH) {
      setTopicError(`题目不能超过 ${MAX_TOPIC_LENGTH} 字，当前 ${value.length} 字，请精简后重试。`);
      return;
    }

    setTopicError('');
    setAnalyzeError('');
    setAnalyzing(true);
    try {
      const result = await analyzeTopic(value);
      saveResult(result);
      navigate('/result');
    } catch (err) {
      setAnalyzeError(err?.message || '剖析失败，服务暂时不可用，请稍后重试。');
      setAnalyzing(false);
    }
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
            <button type="button" className="btn btn-outline" onClick={scrollToLibrary}>
              浏览真题题库
            </button>
          </div>
          <p className="hero-note">内置真题均配一篇完整精彩范文与四维点评；自定义剖析聚焦解题思路，不生成整篇范文，也不作评分或逐句批改。</p>
        </div>
      </section>

      <section className="feature-row" aria-label="产品能力">
        <Card className="feature-card">
          <h3>真题精解</h3>
          <p>上海卷、江苏新课标I卷与浙江近三年真题逐题拆解：从「审题要点」到「评分关注点」，每道题另附一篇完整范文与立意、结构、语言点评。</p>
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
            <p className="eyebrow">内置真题</p>
            <h2>真题题库</h2>
            <p className="muted">
              上海、江苏、浙江近三年高考作文真题共 9 道，逐题附写作指导、范文与点评；点击地区或题目即可查看。
            </p>
          </div>
          <Badge tone="seal">共 {totalPrompts || 9} 题</Badge>
        </div>

        {paramNotice && (
          <div className="notice-banner" role="alert">
            <span>{paramNotice}</span>
            <button type="button" className="notice-close" onClick={() => setParamNotice('')} aria-label="关闭提示">
              ×
            </button>
          </div>
        )}

        <div className="region-overview" aria-label="地区题库入口">
          {groups.map((group) => {
            const latest = latestPrompt(group.prompts.length ? group.prompts : datasets[group.key] || []);
            return (
              <Link
                key={group.key}
                className="region-overview-card card"
                to={latest ? `/prompts/${latest.id}` : '/'}
              >
                <span className="region-name">{group.name}</span>
                <span className="region-overview-meta">
                  {group.total} 题 · 2022—2024
                </span>
                <span className="region-overview-cta" aria-hidden="true">查看真题 →</span>
              </Link>
            );
          })}
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
              placeholder="检索题目原文、关键词或地区…"
              onChange={(e) => setKeyword(e.target.value)}
            />
            {keyword && (
              <button type="button" className="clear-btn" onClick={() => setKeyword('')} aria-label="清空检索词">
                ×
              </button>
            )}
          </label>
        </div>

        {status === 'loading' && <LoadingState text="正在载入真题题库…" />}

        {status === 'error' && (
          <ErrorState title="真题题库加载失败" message={error} onRetry={load} />
        )}

        {status === 'ready' && visiblePrompts === 0 && (
          <EmptyState
            title={hasFilter ? '没有找到匹配的题目' : '题库暂时为空'}
            description={
              hasFilter
                ? '当前年份或关键词下没有匹配的真题，换个词试试，或清除筛选条件。'
                : '内置真题未能载入，请点击「重新加载」再试一次。'
            }
            action={
              hasFilter ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setYear(null);
                    setKeyword('');
                  }}
                >
                  清除筛选条件
                </button>
              ) : (
                <button type="button" className="btn btn-outline" onClick={load}>
                  重新加载
                </button>
              )
            }
          />
        )}

        {status === 'ready' &&
          groups.map((group) =>
            group.prompts.length > 0 ? (
              <div className="region-group" key={group.key} id={`region-${group.key}`}>
                <div className="region-group-head">
                  <h3>{group.name}真题</h3>
                  <p className="muted">{group.description}</p>
                  <Badge tone="soft">{group.prompts.length} 题</Badge>
                </div>
                <div className="card-grid">
                  {group.prompts.map((prompt) => (
                    <PromptCard key={prompt.id} prompt={prompt} region={group} />
                  ))}
                </div>
              </div>
            ) : null
          )}
      </section>

      <section className="quick-analyze" aria-label="自定义题目剖析">
        <div className="quick-analyze-head">
          <p className="eyebrow">自定义剖析</p>
          <h2>新增一道题目，立即生成写作剖析</h2>
          <p className="muted">粘贴任意作文题，系统会判定题型、抽取概念与限制条件，并给出立意与提纲。</p>
        </div>
        <Card className="input-card">
          <div className="input-card-head">
            <label htmlFor="home-topic-input">作文题目</label>
            <span className={`counter ${topic.length > MAX_TOPIC_LENGTH ? 'counter-over' : ''}`} aria-live="polite">
              {topic.length} / {MAX_TOPIC_LENGTH} 字
            </span>
          </div>
          <textarea
            id="home-topic-input"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (topicError) setTopicError('');
              if (analyzeError) setAnalyzeError('');
            }}
            placeholder={'在此粘贴或输入作文题目，支持多行。\n例如：关于坚持与变通'}
            rows={5}
            spellCheck={false}
          />
          {topicError && <p className="field-error" role="alert">{topicError}</p>}
          {analyzeError && <p className="field-error" role="alert">{analyzeError}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={submitTopic} disabled={analyzing}>
              {analyzing ? '正在分析…' : '开始分析'}
            </button>
            <Link className="btn btn-ghost" to="/analyze">进入完整剖析页 →</Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
