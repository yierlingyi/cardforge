import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { TopBar, TabBar, Sidebar, StatusBar, BottomPanel } from './Shell';
import { ImportModal, ExportModal, SearchModal, Toasts } from './modals';
import { useModals } from './common';
import HomePage from './pages/HomePage';
import CharacterPage from './pages/CharacterPage';
import WorldbookPage from './pages/WorldbookPage';
import RegexPage from './pages/RegexPage';
import ScriptsPage from './pages/ScriptsPage';
import MvuPage from './pages/MvuPage';
import PreviewPage from './pages/PreviewPage';
import ValidationPage from './pages/ValidationPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; info: string }> {
  state = { error: null as Error | null, info: '' };
  static getDerivedStateFromError(error: Error) {
    return { error, info: '' };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack || '' });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--text)' }}>
          <h2 style={{ marginTop: 0 }}>界面渲染出错</h2>
          <p className="faint">这是一次未捕获的渲染异常。你的数据仍保存在本地，不会丢失。</p>
          <pre className="code-pre" style={{ maxHeight: 200 }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button className="btn primary mt10" onClick={() => location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Page() {
  const page = useStore((s) => s.page);
  switch (page) {
    case 'character':
      return <CharacterPage />;
    case 'worldbook':
      return <WorldbookPage />;
    case 'regex':
      return <RegexPage />;
    case 'scripts':
      return <ScriptsPage />;
    case 'mvu':
      return <MvuPage />;
    case 'preview':
      return <PreviewPage />;
    case 'validation':
      return <ValidationPage />;
    case 'history':
      return <HistoryPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

export default function App() {
  const init = useStore((s) => s.init);
  const started = useRef(false);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setUi = useStore((s) => s.setUi);
  const modals = useModals();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === 'Escape') {
          // 让各弹窗自行处理，这里只处理全局面板
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      const inCode = target?.closest('.cm-editor');
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          useStore.getState().saveNow();
          break;
        case 'k':
          e.preventDefault();
          useStore.getState().setUi({ searchOpen: true });
          break;
        case 'o':
          e.preventDefault();
          modals.set({ importOpen: true });
          break;
        case 'e':
          e.preventDefault();
          modals.set({ exportOpen: true });
          break;
        case 'b':
          e.preventDefault();
          setUi({ sidebarOpen: !useStore.getState().sidebarOpen });
          break;
        case 'z':
          if (inCode) return; // 让 CodeMirror 处理自身撤销
          e.preventDefault();
          if (e.shiftKey) useStore.getState().redo();
          else useStore.getState().undo();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modals, setUi]);

  return (
    <div className="app">
      <TopBar />
      <TabBar />
      <div className={`main ${sidebarOpen ? '' : 'no-sidebar'}`}>
        {sidebarOpen ? <Sidebar /> : null}
        <div className="work">
          <ErrorBoundary>
            <Page />
          </ErrorBoundary>
          <BottomPanel />
        </div>
      </div>
      <StatusBar />
      <ImportModal />
      <ExportModal />
      <SearchModal />
      <Toasts />
      <button
        className="btn ghost icon"
        onClick={() => setUi({ sidebarOpen: !sidebarOpen })}
        title="折叠 / 展开侧栏 (Ctrl+B)"
        style={{ position: 'fixed', left: 4, bottom: 30, zIndex: 50, opacity: 0.5 }}
      >
        {sidebarOpen ? '«' : '»'}
      </button>
    </div>
  );
}
