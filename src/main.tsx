import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// 注意：这里刻意不使用 StrictMode。
// App 首次启动时会向 IndexedDB 写入演示世界，StrictMode 的双次挂载
// 会导致该初始化副作用执行两遍，从而产生重复的演示数据。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
