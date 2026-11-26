import { useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { useStore } from '../../store/store';
import { simulateWorldbook, SIM_STATUS_LABELS, type SimMessage, type SimReport } from '../../core/simulate';
import type { NormalizedWorldbook } from '../../core/types';
import { Segmented } from '../common';
import { useCopy } from '../common';

export default function WorldbookSim({ wb, open, onClose }: { wb: NormalizedWorldbook; open: boolean; onClose: () => void }) {
  const { settings } = useStore();
  const copy = useCopy();
  const [messages, setMessages] = useState<SimMessage[]>([
    { role: 'user', content: '外面的风雪越来越大了，观测站的通讯好像断了。' },
    { role: 'assistant', content: '星见澪把耳机摘下来，看了一眼数据屏："极光在增强，先别出门。"' },
  ]);
  const [draft, setDraft] = useState('');
  const [scanDepth, setScanDepth] = useState(4);
  const [recursion, setRecursion] = useState(settings.simRecursion);
  const [roll, setRoll] = useState(settings.simRollProbability);
  const [seed, setSeed] = useState(settings.simSeed);
  const [budget, setBudget] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [report, setReport] = useState<SimReport | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'hit' | 'fail'>('all');
  const [showRules, setShowRules] = useState(false);

  const run = () => {
    const r = simulateWorldbook(wb.entries, {
      messages,
      globalScanDepth: scanDepth,
      recursion,
      rollProbability: roll,
      seed,
      tokenBudget: budget,
      caseSensitive,
      matchWholeWords: wholeWords,
    });
    setReport(r);
  };

  const addMessage = (role: SimMessage['role']) => {
    if (!draft.trim()) return;
    setMessages([...messages, { role, content: draft }]);
    setDraft('');
  };

  const filtered = useMemo(() => {
    if (!report) return [];
    return report.results.filter((r) => {
      if (statusFilter === 'hit') return r.included;
      if (statusFilter === 'fail') return !r.included;
      return true;
    });
  }, [report, statusFilter]);

  return (
    <Modal open={open} onClose={onClose} width="wide" title="世界书触发模拟" footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 420, flexShrink: 0 }}>
          <div className="label">模拟聊天（按时间顺序）</div>
          <div className="panel mt6" style={{ maxHeight: 260, overflow: 'auto' }}>
            {messages.map((m, i) => (
              <div key={i} className="row" style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                <span className={`badge ${m.role === 'user' ? 'info' : m.role === 'assistant' ? 'purple' : ''}`} style={{ marginTop: 2 }}>{m.role}</span>
                <span className="grow" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{m.content}</span>
                <button className="btn ghost sm icon" onClick={() => setMessages(messages.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {!messages.length ? <div className="faint pad10" style={{ fontSize: 11.5 }}>还没有消息。常驻条目仍会被激活。</div> : null}
          </div>

          <textarea
            className="textarea mt6"
            rows={3}
            placeholder="输入一条消息，选择角色后添加…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row mt6" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => addMessage('user')}>+ 用户消息</button>
            <button className="btn sm" onClick={() => addMessage('assistant')}>+ 角色消息</button>
            <button className="btn sm ghost" onClick={() => setMessages([])}>清空</button>
          </div>

          <div className="divider" />
          <div className="row wrap" style={{ gap: 10 }}>
            <div className="field" style={{ width: 110 }}>
              <label>扫描深度</label>
              <input className="input mono" type="number" value={scanDepth} onChange={(e) => setScanDepth(Number(e.target.value))} />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label>随机种子</label>
              <input className="input mono" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Token 预算</label>
              <input className="input mono" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} placeholder="0 = 不限" />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="check"><input type="checkbox" checked={recursion} onChange={(e) => setRecursion(e.target.checked)} /> 递归扫描</label>
            <label className="check"><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /> 执行概率判定</label>
            <label className="check"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> 区分大小写</label>
            <label className="check"><input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} /> 整词匹配</label>
          </div>

          <button className="btn primary w100 mt10" onClick={run}>运行模拟</button>
          <div className="faint mt6" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
            使用当前世界书的 <b>{wb.entries.length}</b> 个条目。相同种子 + 相同输入 → 结果可复现。
          </div>
        </div>

        <div className="grow" style={{ minWidth: 0 }}>
          {!report ? (
            <div className="empty" style={{ padding: 50 }}>
              <div className="big">▦</div>
              <h3>运行一次模拟</h3>
              <p>模拟器会按 SillyTavern 的世界书规则计算每条条目是否触发，并给出一条条目的最终注入顺序。</p>
            </div>
          ) : (
            <>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="badge ok">注入 {report.injection.filter((r) => r.included).length} 条</span>
                <span className="badge">扫描 {report.scanDepthUsed} 条消息</span>
                <span className="badge">≈ {report.totalTokens} tok</span>
                {report.budgetCut ? <span className="badge err">预算截断 {report.budgetCut}</span> : null}
                {recursion ? <span className="badge warn">递归 {report.recursionRounds} 轮</span> : null}
                <span className="spacer" />
                <Segmented
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'hit', label: '已注入' },
                    { value: 'fail', label: '未触发' },
                  ]}
                />
                <button className="btn sm ghost" onClick={() => setShowRules(!showRules)}>规则说明</button>
                <button className="btn sm ghost" onClick={() => copy(JSON.stringify(report, null, 2), '模拟报告')}>复制报告</button>
              </div>

              {showRules ? (
                <div className="panel mt6">
                  <div className="card-body">
                    {report.rulesUsed.map((r, i) => (
                      <div key={i} className="row" style={{ alignItems: 'flex-start', fontSize: 11.5, padding: '2px 0' }}>
                        <span className={`badge ${r.level === 'exact' ? 'ok' : r.level === 'approx' ? 'warn' : 'outline'}`} style={{ flexShrink: 0 }}>
                          {r.level === 'exact' ? '精确' : r.level === 'approx' ? '近似' : '未实现'}
                        </span>
                        <span style={{ width: 210, flexShrink: 0 }}>{r.rule}</span>
                        <span className="faint grow">{r.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="panel mt6" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 46 }}>UID</th>
                      <th style={{ width: 150 }}>备注</th>
                      <th style={{ width: 76 }}>状态</th>
                      <th>命中关键词 / 原因</th>
                      <th style={{ width: 96 }}>插入</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.uid}>
                        <td className="num">{r.uid}</td>
                        <td className="ellipsis" style={{ maxWidth: 150 }} title={r.comment}>{r.comment || <span className="faint">(无备注)</span>}</td>
                        <td>
                          <span className={`badge ${r.included ? 'ok' : r.status === 'disabled' || r.status === 'prob-fail' ? 'warn' : ''}`}>{SIM_STATUS_LABELS[r.status]}</span>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {r.hits.length ? (
                            <div className="row wrap" style={{ gap: 3, marginBottom: 2 }}>
                              {r.hits.slice(0, 4).map((h, i) => (
                                <span key={i} className={`chip ${h.field === 'keysecondary' ? '' : 'on'}`} title={h.snippet}>
                                  {h.field === 'keysecondary' ? '次:' : ''}{h.key}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <span className="faint" style={{ fontSize: 10.5 }}>{r.reasons.join('；')}</span>
                        </td>
                        <td style={{ fontSize: 10.5 }} className="mono">
                          {r.included ? `pos ${r.position}${r.position === 4 ? ` / d${r.depth}` : ''} / r${r.role}` : '—'}
                          {r.included ? <div className="faint">order {r.orderValue}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row mt10" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className="grow">
                  <div className="label">最终注入顺序</div>
                  <div className="panel mt6" style={{ maxHeight: 150, overflow: 'auto' }}>
                    <div style={{ padding: 8 }}>
                      {report.injection.filter((r) => r.included).length === 0 ? (
                        <span className="faint" style={{ fontSize: 11.5 }}>没有条目被注入。</span>
                      ) : (
                        report.injection
                          .filter((r) => r.included)
                          .map((r, i) => (
                            <div key={r.uid} className="row" style={{ fontSize: 11.5, padding: '2px 0' }}>
                              <span className="faint mono" style={{ width: 26 }}>{i + 1}.</span>
                              <span className="mono" style={{ color: 'var(--accent)', width: 44 }}>#{r.uid}</span>
                              <span className="grow ellipsis">{r.comment || '(无备注)'}</span>
                              <span className="faint mono">{r.contentTokens} tok</span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ width: 260, flexShrink: 0 }}>
                  <div className="label">包含组决策</div>
                  <div className="panel mt6" style={{ maxHeight: 150, overflow: 'auto' }}>
                    <div style={{ padding: 8 }}>
                      {report.groupDecisions.length === 0 ? (
                        <span className="faint" style={{ fontSize: 11.5 }}>无包含组竞争。</span>
                      ) : (
                        report.groupDecisions.map((g, i) => (
                          <div key={i} style={{ fontSize: 11, marginBottom: 4 }}>
                            <span className="badge purple">{g.group}</span>{' '}
                            <span className="faint">候选 {g.candidates.map((u) => `#${u}`).join('/')} → 胜出 #{g.winner ?? '—'}</span>
                            <div className="faint" style={{ fontSize: 10 }}>{g.rule}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <details className="mt10">
                <summary className="faint" style={{ fontSize: 11, cursor: 'pointer' }}>查看扫描文本与警告</summary>
                <div className="code-pre mt6" style={{ maxHeight: 120 }}>{report.scannedText || '(空)'}</div>
                {report.warnings.map((w, i) => (
                  <div key={i} className="faint" style={{ fontSize: 11 }}>· {w}</div>
                ))}
              </details>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
