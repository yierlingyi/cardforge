import { useMemo } from 'react';
import { diffLines, diffWords } from 'diff';
import { generatePatch } from '../../core/patch';
import { formatJson } from '../../core/util';

export function DiffView({ before, after, mode = 'line', maxLines = 400 }: { before: string; after: string; mode?: 'line' | 'word'; maxLines?: number }) {
  const rows = useMemo<{ kind: 'add' | 'del' | 'eq'; text: string; ln?: string }[]>(() => {
    if (mode === 'word') {
      const parts = diffWords(before || '', after || '');
      return parts.map((p) => ({ kind: p.added ? 'add' : p.removed ? 'del' : 'eq', text: p.value }));
    }
    const parts = diffLines(before || '', after || '');
    const out: { kind: 'add' | 'del' | 'eq'; text: string; ln: string }[] = [];
    let ln = 0;
    for (const p of parts) {
      const lines = p.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        if (!p.added && !p.removed) ln++;
        out.push({ kind: p.added ? 'add' : p.removed ? 'del' : 'eq', text: line, ln: p.removed ? '' : String(ln) });
        if (out.length >= maxLines) return out;
      }
    }
    return out;
  }, [before, after, mode, maxLines]);

  const same = before === after;
  if (same) return <div className="empty" style={{ padding: 20 }}><p>两边内容一致，没有差异。</p></div>;

  return (
    <div className="diff">
      {rows.map((r, i) => (
        <div key={i} className={`line ${r.kind}`}>
          <span className="ln">{r.ln ?? ''}</span>
          <span className="sign" style={{ width: 10, flexShrink: 0 }}>{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}</span>
          <span className="eq" style={{ flex: 1 }}>{r.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

export function JsonDiff({ before, after }: { before: any; after: any }) {
  const ops = useMemo(() => {
    try {
      return generatePatch(before, after);
    } catch {
      return [];
    }
  }, [before, after]);

  if (!ops.length) return <div className="empty" style={{ padding: 20 }}><p>结构完全一致。</p></div>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 70 }}>操作</th>
          <th style={{ width: 240 }}>路径</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        {ops.map((op, i) => (
          <tr key={i}>
            <td>
              <span className={`badge ${op.op === 'add' ? 'ok' : op.op === 'remove' ? 'err' : 'info'}`}>{op.op}</span>
            </td>
            <td className="mono" style={{ fontSize: 11 }}>{op.path || '/'}</td>
            <td className="mono" style={{ fontSize: 11, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {op.op === 'remove' ? <span className="faint">—</span> : formatJson(op.value, 0).slice(0, 300)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
