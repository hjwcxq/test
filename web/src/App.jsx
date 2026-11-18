import React from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { EmptyState, ErrorState } from './components.jsx';
import Home from './pages/Home.jsx';
import Detail from './pages/Detail.jsx';
import Analyze from './pages/Analyze.jsx';
import Result from './pages/Result.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[文思] 页面渲染异常：', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page">
          <ErrorState
            title="页面出现异常"
            message="渲染时发生错误，已阻止白屏。请刷新页面重试；若持续出现，可返回题目库重新进入。"
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="页面不存在"
        description="这个地址没有对应内容，可能是链接已失效。"
        action={<Link className="btn btn-primary" to="/">返回题目库</Link>}
      />
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link className="brand" to="/">
            <span className="brand-seal" aria-hidden="true">文</span>
            <span className="brand-text">
              <strong>文思</strong>
              <small>高考作文指导</small>
            </span>
          </Link>
          <nav className="main-nav" aria-label="主导航">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-active' : '')}>
              题目库
            </NavLink>
            <NavLink to="/analyze" className={({ isActive }) => (isActive ? 'nav-active' : '')}>
              自定义剖析
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="container main-content">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/prompts/:id" element={<Detail />} />
            <Route path="/analyze" element={<Analyze />} />
            <Route path="/result" element={<Result />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span>文思 · 把一道题目，拆成可落笔的思路</span>
        </div>
      </footer>
    </div>
  );
}
