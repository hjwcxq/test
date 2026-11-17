import React, { useEffect, useRef, useState } from 'react';

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续尝试兼容回退
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = '复制为纯文本', className = '' }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? 'ok' : 'fail');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2600);
  };

  return (
    <button type="button" className={`btn btn-primary copy-btn ${className}`} onClick={onClick}>
      <span aria-live="polite">
        {state === 'ok' ? '✓ 已复制到剪贴板' : state === 'fail' ? '复制失败，请长按选择文本' : label}
      </span>
    </button>
  );
}

export function LoadingState({ text = '正在加载，请稍候…' }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function ErrorState({ title = '加载失败', message, onRetry }) {
  return (
    <div className="state-block state-error" role="alert">
      <div className="state-icon" aria-hidden="true">!</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline" onClick={onRetry}>
          重新加载
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="state-block state-empty">
      <div className="state-icon" aria-hidden="true">空</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Section({ index, title, description, children, className = '' }) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head">
        {index != null && <span className="section-index">{String(index).padStart(2, '0')}</span>}
        <div>
          <h2>{title}</h2>
          {description && <p className="section-desc">{description}</p>}
        </div>
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/**
 * 内置题目的“精彩范文”独立板块：标题、完整正文、四维点评与学习参考声明。
 * 仅在题目带有范文数据时渲染，自定义剖析结果不会出现本板块。
 */
export function EssaySection({ prompt, index }) {
  if (!prompt || !prompt.essayTitle || !prompt.essayBody) return null;

  const paragraphs = String(prompt.essayBody)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;

  const comment = prompt.essayComment || {};
  const dimensions = [
    ['立意', comment.intention],
    ['结构', comment.structure],
    ['语言', comment.language],
    ['借鉴', comment.takeaway],
  ].filter(([, text]) => typeof text === 'string' && text.trim());

  const wordCount = Array.from(String(prompt.essayBody).replace(/\s/g, '')).length;
  const copyText = [prompt.essayTitle, '', prompt.essayBody, '', prompt.essayDisclaimer || '']
    .join('\n')
    .trim();

  return (
    <Section
      index={index}
      title="精彩范文"
      description="一篇完整示范作文，附立意、结构、语言与可借鉴处的点评，供对照学习。"
      className="essay-section"
    >
      <article className="essay-card">
        <div className="essay-card-top">
          <div>
            <p className="essay-eyebrow">示范写作 · 约 {wordCount} 字</p>
            <h3 className="essay-title">{prompt.essayTitle}</h3>
          </div>
          <CopyButton text={copyText} label="复制范文" />
        </div>
        <div className="essay-body">
          {paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </article>

      {dimensions.length > 0 && (
        <div className="essay-comment">
          <h3 className="mini-title">范文点评</h3>
          <div className="card-grid card-grid-2">
            {dimensions.map(([label, text]) => (
              <div className="card mini-card" key={label}>
                <h4 className="mini-title">{label}</h4>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {prompt.essayDisclaimer && (
        <p className="essay-disclaimer" role="note">{prompt.essayDisclaimer}</p>
      )}
    </Section>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}
