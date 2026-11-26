import { create } from 'zustand';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useStore } from '../store/store';
import type { ValidationIssue } from '../core/types';

export { Labeled, TextInput, NumberInput, TextArea, Toggle, Check, Select, TagInput, JsonTextArea } from './components/Field';

/* --------------------------------------------------------- 剪贴板 */

export function useCopy() {
  const toast = useStore((s) => s.toast);
  return async (text: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', `已复制${label}`);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('success', `已复制${label}`);
      } catch {
        toast('error', '复制失败，请手动选择文本');
      }
    }
  };
}

/* --------------------------------------------------------- 面板标签 */

export function PaneHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pane-head">
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      {sub ? <span className="faint" style={{ fontSize: 11 }}>{sub}</span> : null}
      <span className="spacer" />
      {right}
    </div>
  );
}

/* --------------------------------------------------------- 折叠区 */

export function Section({
  title,
  children,
  right,
  defaultOpen = true,
  dense,
}: {
  title: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  defaultOpen?: boolean;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section" style={dense ? { paddingTop: 0, marginTop: 0 } : undefined}>
      <div className="section-title" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        {title}
        <span className="spacer" />
        {right}
      </div>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------- 空状态 */

export function Empty({ icon = '◇', title, desc, children }: { icon?: string; title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h3>{title}</h3>
      {desc ? <p>{desc}</p> : null}
      {children}
    </div>
  );
}

/* --------------------------------------------------------- 徽章 */

export function LevelBadge({ level }: { level: ValidationIssue['level'] }) {
  if (level === 'error') return <span className="badge err">错误</span>;
  if (level === 'warning') return <span className="badge warn">警告</span>;
  return <span className="badge info">提示</span>;
}

export function Stat({ k, v, unit }: { k: ReactNode; v: ReactNode; unit?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {unit ? <span className="u"> {unit}</span> : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 分段控件 */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}) {
  return (
    <div className="btn-group">
      {options.map((o) => (
        <button
          key={o.value}
          className={`btn sm ${value === o.value ? 'active' : ''}`}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- 模态框状态 */

interface ModalState {
  importOpen: boolean;
  exportOpen: boolean;
  simOpen: boolean;
  shortcutsOpen: boolean;
  set: (p: Partial<Omit<ModalState, 'set'>>) => void;
}

export const useModals = create<ModalState>((set) => ({
  importOpen: false,
  exportOpen: false,
  simOpen: false,
  shortcutsOpen: false,
  set: (p) => set(p),
}));

/* --------------------------------------------------------- 右键菜单 */

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  const close = useCallback(() => setMenu(null), []);

  const node = menu ? (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div
        style={{
          position: 'fixed',
          left: Math.min(menu.x, window.innerWidth - 220),
          top: Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 26),
          zIndex: 401,
          minWidth: 180,
          background: 'var(--bg-1)',
          border: '1px solid var(--border-strong)',
          borderRadius: 6,
          boxShadow: 'var(--shadow)',
          padding: 4,
        }}
      >
        {menu.items.map((it, i) =>
          it.divider ? (
            <div key={i} style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
          ) : (
            <button
              key={i}
              className="btn ghost sm w100"
              disabled={it.disabled}
              onClick={() => {
                close();
                it.onClick();
              }}
              style={{ justifyContent: 'flex-start', height: 24, color: it.danger ? 'var(--err)' : undefined }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    </>
  ) : null;

  return { open, close, node, isOpen: !!menu };
}

/* --------------------------------------------------------- 字段行 */

export function KeyValue({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '3px 0' }}>
      <span className="faint" style={{ width: 96, flexShrink: 0, fontSize: 11.5 }}>{k}</span>
      <span className="grow" style={{ minWidth: 0, fontSize: 12 }}>{children}</span>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="hint" style={{ color: 'var(--text-faint)', fontSize: 11, lineHeight: 1.6 }}>{children}</div>;
}
