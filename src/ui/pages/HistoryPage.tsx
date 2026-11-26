import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, useCopy } from '../common';
import { JsonDiff } from '../components/DiffView';
import { formatJson } from '../../core/util';

export default function HistoryPage() {
  const { doc, history, future, undo, redo, snapshotBaseline, loadSample } = useStore();
  const [baselineIdx, setBaselineIdx] = useState<number | null>(null);
  const copy = useCopy();

  const jumpTo = (idx: number) => {
    // 从当前状态回退到 idx（idx 为 history 下标，-1 表示回到最初）
    const steps = history.length - 1 - idx;
    for (let i = 0; i < steps; i++) undo();
  };

  const baseline = baselineIdx != null ? doc.baselines[baselineIdx] : null;
  const baselineData = useMemo(() => {
    if (!baseline) return null;
    try {
      const p = JSON.parse(baseline.json);
      return p.data ?? p;
    } catch {
      return null;
    }
  }, [baseline]);

  const currentData = useMemo(() => {
    if (!doc.card) return null;
    return JSON.parse(JSON.stringify(doc.card.data));
  }, [doc.card?.data]);

  const totalChars = history.reduce((n, h) => n + JSON.stringify(h).length, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>历史记录</h1>
        <span className="sub">基于 immer 补丁的撤销 / 重做，内存级、不写盘</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => useStore.getState().snapshotBaseline(`手动快照 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)}>记录快照</button>
      </div>

      <div className="split">
        <div className="pane" style={{ maxWidth: 380 }}>
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>操作栈</span>
            <span className="badge outline">{history.length}</span>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={undo} disabled={!history.length}>撤销</button>
            <button className="btn ghost sm" onClick={redo} disabled={!future.length}>重做</button>
          </div>
          <div className="pane-body">
            {doc.baselines.length ? (
              <>
                <div className="nav-group">导入 / 手动快照</div>
                {doc.baselines.map((b, i) => (
                  <div key={b.key + i} className={`list-row ${baselineIdx === i ? 'active' : ''}`} onClick={() => setBaselineIdx(i)}>
                    <span className="grow ellipsis">{b.label}</span>
                    <span className="meta">{new Date(b.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  </div>
                ))}
              </>
            ) : null}

            <div className="nav-group">编辑历史（最新在上）</div>
            {history.length === 0 ? <div className="faint pad10" style={{ fontSize: 11.5 }}>还没有编辑记录。修改任意字段后会出现在这里。</div> : null}
            {history
              .slice()
              .reverse()
              .map((h, i) => {
                const idx = history.length - 1 - i;
                return (
                  <div key={idx} className="list-row" onClick={() => jumpTo(idx)} title="点击回退到这一步之前">
                    <span className="faint mono" style={{ fontSize: 10, width: 22 }}>{idx + 1}</span>
                    <span className="grow ellipsis">{h.label}</span>
                    <span className="meta">{new Date(h.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  </div>
                );
              })}
          </div>
          <div className="pane-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
            <span className="faint" style={{ fontSize: 10.5 }}>内存占用 ≈ {(totalChars / 1024).toFixed(0)} KB · 最多保留 150 步</span>
          </div>
        </div>

        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{baseline ? `与快照对比：${baseline.label}` : '当前状态'}</span>
            <span className="spacer" />
            {currentData ? <button className="btn ghost sm" onClick={() => copy(formatJson(currentData), '当前 data JSON')}>复制当前 JSON</button> : null}
          </div>
          <div className="pane-body pad">
            {!baseline || !baselineData || !currentData ? (
              <Empty icon="↺" title="选择一个快照查看差异" desc="导入时的原始数据会自动记录为快照；你也可以随时记录当前状态，用于对比改动。" />
            ) : (
              <>
                <div className="row wrap" style={{ gap: 8 }}>
                  <KeyValue k="快照时间">{new Date(baseline.at).toLocaleString('zh-CN')}</KeyValue>
                  <KeyValue k="快照条目数">{Object.keys(baselineData).length}</KeyValue>
                  <KeyValue k="当前条目数">{Object.keys(currentData).length}</KeyValue>
                </div>
                <div className="divider" />
                <JsonDiff before={baselineData} after={currentData} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
