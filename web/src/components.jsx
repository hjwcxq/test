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

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}
