import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

createRoot(root).render(<App />);

// 开发模式下暴露 store，便于自动化测试与调试（生产构建不会包含）
if (import.meta.env.DEV) {
  import('./store/store').then((m) => {
    (window as any).__cardforge = m;
  });
}
