import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { getJiangsuPrompts, getPrompts, getZhejiangPrompts } from '../api.js';
import { EmptyState, ErrorState, LoadingState } from '../components.jsx';

/**
 * 地区入口的稳定落点。
 *
 * 首页地区卡片始终指向 /region/<key>，不依赖题库是否已经载入，因此首屏
 * 渲染出的链接就是有效地址。点击后先展示可靠的加载态，等该地区题目返回
 * 再跳转到最近一年的真题详情；加载失败时给出错误提示与重试入口，绝不
 * 退回首页或跳到一个不存在的页面。
 */
const SOURCES = {
  shanghai: { name: '上海', load: getPrompts },
  jiangsu: { name: '江苏', load: getJiangsuPrompts },
  zhejiang: { name: '浙江', load: getZhejiangPrompts },
};

function latestPrompt(list) {
  return [...list].sort((a, b) => b.year - a.year)[0];
}

export default function Region() {
  const { region } = useParams();
  const source = SOURCES[region];
  const name = source ? source.name : '该地区';

  const [status, setStatus] = useState(source ? 'loading' : 'missing');
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(null);

  const load = useCallback(async () => {
    if (!source) {
      setStatus('missing');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const data = await source.load();
      const list = Array.isArray(data) ? data : [];
      const latest = latestPrompt(list);
      if (!latest || !latest.id) {
        setStatus('empty');
        return;
      }
      setResolved({ region, id: latest.id });
      setStatus('ready');
    } catch (err) {
      setError(err?.message || `${name}真题加载失败，请稍后点击重试。`);
      setStatus('error');
    }
  }, [source, name, region]);

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'missing') {
    return (
      <div className="page">
        <EmptyState
          title="地区入口不存在"
          description="这个地区还没有对应的真题入口，请返回题目库重新选择。"
          action={<Link className="btn btn-primary" to="/">返回题目库</Link>}
        />
      </div>
    );
  }

  if (status === 'ready' && resolved && resolved.region === region) {
    return <Navigate to={`/prompts/${resolved.id}`} replace />;
  }

  if (status === 'error') {
    return (
      <div className="page">
        <Link className="back-link" to="/">← 返回题目库</Link>
        <ErrorState title={`${name}真题加载失败`} message={error} onRetry={load} />
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="page">
        <Link className="back-link" to="/">← 返回题目库</Link>
        <EmptyState
          title={`${name}真题暂时为空`}
          description="该地区暂未读取到题目数据，请点击重新加载再试一次。"
          action={<button type="button" className="btn btn-outline" onClick={load}>重新加载</button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <LoadingState text={`正在载入${name}真题…`} />
    </div>
  );
}
