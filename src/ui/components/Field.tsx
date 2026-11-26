import { useEffect, useState, type ReactNode } from 'react';

export function Labeled({ label, hint, children, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
      </label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      className={`input ${mono ? 'mono' : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  nullable,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  nullable?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <input
      className="input mono"
      value={text}
      placeholder={placeholder ?? (nullable ? 'null（继承全局）' : '')}
      inputMode="numeric"
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v.trim() === '') {
          onChange(nullable ? null : 0);
          return;
        }
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(n);
      }}
      min={min}
      max={max}
      step={step}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <textarea
      className={`textarea ${mono ? 'mono' : ''}`}
      rows={rows}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <select
      className="select"
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const found = options.find((o) => String(o.value) === raw);
        onChange((found ? found.value : (raw as T)) as T);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TagInput({
  values,
  onChange,
  placeholder = '输入后按 Enter 添加',
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(values) ? values : [];
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!list.includes(v)) onChange([...list, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="row wrap" style={{ gap: 4, marginBottom: 5 }}>
        {list.map((v, i) => (
          <span className="chip on" key={`${v}-${i}`} title={v}>
            {v}
            <button
              className="btn ghost sm icon"
              style={{ width: 14, height: 14, marginLeft: 2 }}
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              title="移除"
            >
              ×
            </button>
          </span>
        ))}
        {!list.length ? <span className="faint" style={{ fontSize: 11 }}>（空）</span> : null}
      </div>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
          if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

export function JsonTextArea({ value, onChange, rows = 6 }: { value: any; onChange: (v: any) => void; rows?: number }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setText(JSON.stringify(value ?? null, null, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <textarea
        className="textarea mono"
        rows={rows}
        value={text}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          try {
            onChange(JSON.parse(text));
            setError(null);
          } catch (e: any) {
            setError(e.message);
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            JSON.parse(e.target.value);
            setError(null);
          } catch (err: any) {
            setError(err.message);
          }
        }}
      />
      {error ? <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 3 }}>JSON 无效：{error}</div> : <div className="hint">失去焦点时保存</div>}
    </div>
  );
}
