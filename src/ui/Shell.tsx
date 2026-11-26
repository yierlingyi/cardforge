import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { useModals, LevelBadge } from './common';
import { summarizeIssues } from '../core/validate';
import { estimateTokens } from '../core/card';
import { humanSize } from '../core/util';
import { FLAVOR_LABELS } from '../core/mvu';
import type { PageKey, ValidationIssue } from '../core/types';

const NAV: { group: string; items: { key: PageKey; label: string; icon: string }[] }[] = [
  {
    group: '编辑',
    items: [
      { key: 'character', label: '人物卡编辑', icon: '▤' },
      { key: 'worldbook', label: '世界书', icon: '▦' },
      { key: 'regex', label: '正则规则', icon: '⌗' },
      { key: 'scripts', label: '酒馆助手脚本', icon: '⧉' },
      { key: 'mvu', label: 'MVU 变量', icon: '◈' },
    ],
  },
  {
    group: '检查',
    items: [
      { key: 'preview', label: '前端预览', icon: '▷' },
      { key: 'validation', label: '数据校验', icon: '✓' },
      { key: 'history', label: '历史记录', icon: '↺' },
    ],
  },
  {
    group: '系统',
    items: [{ key: 'settings', label: '项目设置', icon: '⚙' }],
  },
];

export function TopBar() {
  const { doc, saveStatus, lastSavedAt, undo, redo, canUndo, canRedo, setPage, saveNow, settings, setSettings } = useStore();
  const modals = useModals();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  void clock;

  const dirty = saveStatus === 'dirty';
  const statusText =
    saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? `已保存 ${lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false }) : ''}` : dirty ? '未保存的更改' : saveStatus === 'error' ? '保存失败' : '就绪';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">CF</span>
        <span>CardForge</span>
        <small>人物卡 IDE</small>
      </div>
      <span className="vdivider" />
      <button className="btn ghost sm" onClick={() => setPage('settings')} title="项目设置">
        <span className="ellipsis" style={{ maxWidth: 260 }}>{doc.meta.name}</span>
        <span className="faint" style={{ fontSize: 10 }}>▾</span>
      </button>
      <span className="badge outline" title="导入时识别的格式版本">
        {(doc.card?.version || '—').toUpperCase()}
      </span>
      <span className="spacer" />

      <div className="row" style={{ gap: 2 }}>
        <button className="btn ghost sm icon" onClick={undo} disabled={!canUndo()} title="撤销 (Ctrl+Z)">↶</button>
        <button className="btn ghost sm icon" onClick={redo} disabled={!canRedo()} title="重做 (Ctrl+Shift+Z)">↷</button>
      </div>

      <button className="btn sm" onClick={() => useStore.getState().setUi({ searchOpen: true })} title="全局搜索 (Ctrl+K)">
        <span>⌕</span>
        <span>搜索</span>
        <span className="kbd">Ctrl K</span>
      </button>

      <button className="btn sm" onClick={() => modals.set({ importOpen: true })} title="导入 (Ctrl+O)">导入</button>
      <button className="btn sm primary" onClick={() => modals.set({ exportOpen: true })} title="导出 (Ctrl+E)">导出</button>

      <span className="vdivider" />
      <div className="row" style={{ gap: 6, minWidth: 0 }}>
        <span className={`dot ${saveStatus === 'saved' ? 'ok' : dirty ? 'dirty' : saveStatus === 'error' ? 'err' : saveStatus === 'saving' ? 'busy' : ''}`} />
        <span className="faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{statusText}</span>
        <button className="btn ghost sm icon" onClick={() => saveNow()} title="立即保存 (Ctrl+S)">⤓</button>
      </div>

      <button
        className="btn ghost sm icon"
        title={settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        onClick={() => setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
      >
        {settings.theme === 'dark' ? '☾' : '☀'}
      </button>
    </header>
  );
}

export function TabBar() {
  const { tabs, activeTabId, setTab, closeTab, setPage } = useStore();
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div key={t.id} className={`tab ${activeTabId === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
          <span>{t.label}</span>
          {t.id !== 'home' ? (
            <span
              className="x"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </span>
          ) : null}
        </div>
      ))}
      <button className="btn ghost sm icon" style={{ marginLeft: 4 }} onClick={() => setPage('home')} title="项目首页">⌂</button>
    </div>
  );
}

export function Sidebar() {
  const { doc, page, setPage, selectedWorldbook, select, settings } = useStore();
  const wb = doc.worldbooks;
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="nav-group">项目</div>
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={() => setPage('home')}>
          <span className="ni">◇</span>
          <span>项目首页</span>
        </button>

        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((it) => {
              const count =
                it.key === 'worldbook'
                  ? wb.length
                  : it.key === 'regex'
                  ? doc.regexes.reduce((n, p) => n + p.scripts.length, 0)
                  : it.key === 'scripts'
                  ? doc.scripts.reduce((n, c) => n + c.scripts.length, 0)
                  : it.key === 'validation'
                  ? doc.issues.filter((i) => i.level === 'error').length
                  : undefined;
              return (
                <button key={it.key} className={`nav-item ${page === it.key ? 'active' : ''}`} onClick={() => setPage(it.key)}>
                  <span className="ni">{it.icon}</span>
                  <span>{it.label}</span>
                  {count !== undefined && count > 0 ? <span className="count">{count}</span> : null}
                </button>
              );
            })}
          </div>
        ))}

        <div className="nav-group">世界书</div>
        {wb.length === 0 ? <div className="faint pad10" style={{ fontSize: 11 }}>尚未导入世界书</div> : null}
        {wb.map((w) => (
          <button
            key={w.name}
            className={`nav-item ${selectedWorldbook === w.name && page === 'worldbook' ? 'active' : ''}`}
            onClick={() => {
              select({ selectedWorldbook: w.name, selectedEntryUid: w.entries[0]?.uid ?? null });
              setPage('worldbook');
            }}
            title={`${w.name}（${w.entries.length} 条）`}
          >
            <span className="ni">▸</span>
            <span className="ellipsis">{w.name}</span>
            <span className="count">{w.entries.length}</span>
          </button>
        ))}

        <div className="divider" />
        <div className="pad10 faint" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
          <div className="row" style={{ gap: 5 }}>
            <span className={`dot ${settings.theme === 'dark' ? 'ok' : ''}`} />
            <span>本地模式 · 无网络请求</span>
          </div>
          <div style={{ marginTop: 4 }}>数据保存在浏览器 IndexedDB</div>
        </div>
      </div>
    </aside>
  );
}

export function StatusBar() {
  const { doc, saveStatus, lastSavedAt, setPage } = useStore();
  const counts = summarizeIssues(doc.issues);
  const entries = doc.worldbooks.reduce((n, w) => n + w.entries.length, 0);
  const chars = useMemo(() => {
    if (!doc.card) return 0;
    const d = doc.card.data;
    return (
      (d.description?.length || 0) +
      (d.first_mes?.length || 0) +
      (d.personality?.length || 0) +
      (d.scenario?.length || 0) +
      (d.mes_example?.length || 0)
    );
  }, [doc.card]);

  return (
    <footer className="statusbar">
      <span className="seg">
        <span className="dot ok" />
        本地模式
      </span>
      <span className="seg">UTF-8</span>
      <span className="seg">JSON</span>
      <span className="seg click" onClick={() => setPage('validation')} title="查看校验结果">
        ✕ {counts.error} △ {counts.warning} ⓘ {counts.info}
      </span>
      <span className="seg">
        世界书 {doc.worldbooks.length} 本 / {entries} 条
      </span>
      <span className="seg">正文 ≈ {estimateTokens(String(doc.card?.data?.description || '')) + estimateTokens(String(doc.card?.data?.first_mes || ''))} tok</span>
      <span className="seg">字符 {chars.toLocaleString()}</span>
      {doc.mvu ? <span className="seg">MVU: {FLAVOR_LABELS[doc.mvu.flavor]}</span> : null}
      <span className="spacer" />
      <span className="seg">
        {saveStatus === 'saved' && lastSavedAt ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : saveStatus === 'dirty' ? '未保存' : saveStatus === 'saving' ? '保存中…' : ''}
      </span>
      <span className="seg" title="项目 ID">
        {doc.meta.id.slice(0, 8)}
      </span>
    </footer>
  );
}

export function BottomPanel() {
  const { doc, bottomOpen, bottomTab, setUi, runValidation, logs, toast, select, setPage } = useStore();
  const [query, setQuery] = useState('');
  const timer = useRef<any>(null);
  const totalEntries = doc.worldbooks.reduce((n, w) => n + w.entries.length, 0);
  const autoPaused = totalEntries > 8000;

  useEffect(() => {
    if (autoPaused) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      runValidation();
    }, 700);
    return () => clearTimeout(timer.current);
  }, [doc.card, doc.worldbooks, doc.regexes, doc.scripts, doc.mvu, runValidation, autoPaused]);

  const issues = doc.issues.filter((i) => !query || i.message.includes(query) || i.path.includes(query));
  const counts = summarizeIssues(doc.issues);

  const goto = (issue: ValidationIssue) => {
    if (issue.scope === 'card') setPage('character');
    else if (issue.scope === 'worldbook' || issue.scope === 'image') {
      const m = String(issue.path).match(/^(.*) #(\d+)$/);
      if (m) select({ selectedWorldbook: m[1], selectedEntryUid: Number(m[2]) });
      setPage('worldbook');
    } else if (issue.scope === 'regex') setPage('regex');
    else if (issue.scope === 'scripts') setPage('scripts');
    else if (issue.scope === 'mvu') setPage('mvu');
  };

  if (!bottomOpen) {
    return (
      <div className="bottom collapsed">
        <div className="bottom-tabs">
          <button className="bottom-tab" onClick={() => setUi({ bottomOpen: true })}>
            ▴ 展开面板
          </button>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 11, paddingRight: 8 }}>
            ✕ {counts.error} △ {counts.warning}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bottom" style={{ height: 190 }}>
      <div className="bottom-tabs">
        <button className={`bottom-tab ${bottomTab === 'problems' ? 'active' : ''}`} onClick={() => setUi({ bottomTab: 'problems' })}>
          问题 <span className="badge err" style={{ height: 15, fontSize: 9.5 }}>{counts.error}</span>
          <span className="badge warn" style={{ height: 15, fontSize: 9.5 }}>{counts.warning}</span>
        </button>
        <button className={`bottom-tab ${bottomTab === 'search' ? 'active' : ''}`} onClick={() => setUi({ bottomTab: 'search' })}>
          面板搜索
        </button>
        <button className={`bottom-tab ${bottomTab === 'log' ? 'active' : ''}`} onClick={() => setUi({ bottomTab: 'log' })}>
          运行日志
        </button>
        <span className="spacer" />
        {bottomTab === 'problems' ? (
          <>
            <input
              className="input sm"
              style={{ width: 180, height: 21 }}
              placeholder="筛选问题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {autoPaused ? <span className="faint" style={{ fontSize: 10.5 }} title="条目数 > 8000，自动校验会拖慢编辑">已暂停自动校验</span> : null}
            <button
              className="btn ghost sm"
              onClick={() => {
                const t0 = performance.now();
                const n = runValidation();
                toast('info', `校验完成：${n.length} 条结果（${(performance.now() - t0).toFixed(0)}ms）`);
              }}
            >
              重新校验
            </button>
          </>
        ) : null}
        <button className="btn ghost sm icon" onClick={() => setUi({ bottomOpen: false })} title="收起">▾</button>
      </div>

      <div className="bottom-body">
        {bottomTab === 'problems' ? (
          issues.length === 0 ? (
            <div className="faint pad10" style={{ fontSize: 11.5 }}>没有发现问题。</div>
          ) : (
            issues.slice(0, 300).map((i, idx) => (
              <div className="issue-row" key={idx} onClick={() => goto(i)} title="点击定位">
                <span className={`ico ${i.level === 'error' ? 'err' : i.level === 'warning' ? 'warn' : 'info'}`}>
                  {i.level === 'error' ? '✕' : i.level === 'warning' ? '△' : 'ⓘ'}
                </span>
                <span className="where">{i.scope}</span>
                <span className="ellipsis" style={{ flex: 1 }}>{i.message}</span>
                <span className="where ellipsis" style={{ maxWidth: 240 }}>{i.path}</span>
              </div>
            ))
          )
        ) : bottomTab === 'search' ? (
          <div className="pad10">
            <div className="faint" style={{ fontSize: 11.5, marginBottom: 6 }}>当前页面的搜索结果会显示在各自页面内；这里是全局快捷检索。</div>
            <input
              className="input"
              placeholder="搜索字段名、条目备注、关键词、脚本文本…（回车打开全局搜索）"
              onKeyDown={(e) => {
                if (e.key === 'Enter') setUi({ searchOpen: true });
              }}
            />
          </div>
        ) : (
          <div>
            {logs
              .slice()
              .reverse()
              .map((l, i) => (
                <div key={i} className="issue-row" style={{ cursor: 'default' }}>
                  <span className="where">{new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  <span style={{ color: l.kind === 'error' ? 'var(--err)' : l.kind === 'success' ? 'var(--ok)' : 'var(--text-dim)' }}>{l.text}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
