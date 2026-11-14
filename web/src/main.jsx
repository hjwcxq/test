import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// 使用 HashRouter：客户端路由不依赖服务端路径回退，
// 在根路径与 /apps/p1/ 基础路径下刷新子页面都不会 404。
createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);
