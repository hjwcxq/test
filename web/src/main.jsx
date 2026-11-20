import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { syncVersionLabel } from './versionLabel.js';
import './styles.css';

// 使用 HashRouter：客户端路由不依赖服务端路径回退，
// 在根路径与 /apps/p1/ 基础路径下刷新子页面都不会 404。
createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);

// 页面打开后读取当前实际生效的交付版本与交付时间；失败时展示明确提示，
// 不回退到首屏 HTML 中可能过期的版本号。
void syncVersionLabel();
