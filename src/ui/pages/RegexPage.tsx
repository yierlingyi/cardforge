import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, Labeled, PaneHeader, Segmented, TextInput, NumberInput, Toggle, TagInput, useCopy, useModals } from '../common';
import CodeArea from '../components/CodeArea';
import { buildRegexJson } from '../../core/exporter';
import { detectRegexRisk, parseFindRegex, type RegexRunResult } from '../../core/regex';
import { testChainSafe, testRegexSafe } from '../../core/runtime';
import { downloadBlob, formatJson, bytesBlob } from '../../core/util';
import { REGEX_PLACEMENT_LABELS, type RegexScript } from '../../core/types';

type Tab = 'edit' | 'test' | 'chain' | 'json';

const PLACEMENTS = Object.entries(REGEX_PLACEMENT_LABELS).map(([k, v]) => ({ value: Number(k), label: `${k} · ${v}` }));

function describeGroups(pattern: string) {
  const out: { index: number; name?: string; snippet: string; at: number }[] = [];
  let idx = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
          const end = pattern.indexOf('>', i + 3);
          const name = pattern.slice(i + 3, end > 0 ? end : undefined);
          idx++;
          out.push({ index: idx, name, snippet: pattern.slice(i, Math.min(pattern.length, i + 18)), at: i });
        }
        // 非捕获组 / 断言不计数
        continue;
      }
      idx++;
      out.push({ index: idx, snippet: pattern.slice(i, Math.min(pattern.length, i + 18)), at: i });
    }
  }
  return out;
}

export default function RegexPage() {
  const { doc, selectedRegexId, select, mutate, addRegex, updateRegex, deleteRegex, moveRegex, toast } = useStore();
  const preset = doc.regexes[0] || null;
  const scripts = preset?.scripts || [];
  const script = scripts.find((s) => s.id === selectedRegexId) || scripts[0] || null;
  const [tab, setTab] = useState<Tab>('edit');
  const [testText, setTestText] = useState(
    '星见澪把耳机摘下来，看了一眼数据屏。\n<status>生命 88/100 好感 24</status>\n外面的风雪更大了。\n\n\n\n（她压低声音）"先别出门。"',
  );
  const [result, setResult] = useState<(RegexRunResult & { timeout?: boolean }) | null>(null);
  const [running, setRunning] = useState(false);
  const [chainResult, setChainResult] = useState<any>(null);
  const [chainText, setChainText] = useState(testText);
  const [chainPlacement, setChainPlacement] = useState(3);
  const [chainDepth, setChainDepth] = useState<number | null>(null);
  const [regexDraft, setRegexDraft] = useState('');
  const copy = useCopy();

  useEffect(() => {
    if (script) setRegexDraft(script.findRegex);
  }, [script?.id]);

  const parsed = useMemo(() => (script ? parseFindRegex(script.findRegex) : null), [script?.findRegex]);
  const risk = useMemo(() => (parsed ? detectRegexRisk(parsed.pattern) : { level: 'low' as const, reason: '' }), [parsed?.pattern]);
  const groups = useMemo(() => (parsed ? describeGroups(parsed.pattern) : []), [parsed?.pattern]);

  if (!preset || !script) {
    return (
      <div className="page">
        <div className="page-head"><h1>正则规则</h1></div>
        <Empty icon="⌗" title="还没有正则规则" desc="SillyTavern 的正则扩展可以改写显示文本、用户输入与发送给模型的提示词。这里可以创建规则并安全测试。">
          <button
            className="btn primary"
            onClick={() => {
              if (!doc.regexes.length) {
                mutate('新建正则集', (d) => {
                  d.regexes.push({ name: '默认正则集', scripts: [], root: [], shape: 'array', origin: 'new' });
                });
              }
              setTimeout(() => addRegex(doc.regexes[0]?.name || '默认正则集'), 0);
            }}
          >
            新建规则
          </button>
        </Empty>
      </div>
    );
  }

  const set = (patch: Partial<RegexScript>, coalesce?: string) => updateRegex(preset.name, script.id, patch, coalesce);

  const runTest = async () => {
    if (!script) return;
    setRunning(true);
    setResult(null);
    const r = await testRegexSafe(script, testText, { char: doc.card?.data.name || 'char', user: 'user' }, 400);
    setResult(r);
    setRunning(false);
    if (r.timeout) toast('error', r.error || '执行超时');
  };

  const runChain = async () => {
    setRunning(true);
    setChainResult(null);
    const r = await testChainSafe(scripts, chainText, { char: doc.card?.data.name || 'char', user: 'user', placement: chainPlacement, messageDepth: chainDepth }, 1500);
    setChainResult(r);
    setRunning(false);
  };

  const exportPreset = () => {
    const art = buildRegexJson(preset);
    downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
    toast('success', `已导出 ${art.filename}`);
  };

  const syncToCard = () => {
    if (!doc.card) return;
    mutate('把正则写回卡片 extensions.regex', (d) => {
      const ext = d.card!.data.extensions || (d.card!.data.extensions = {});
      ext.regex = preset.scripts.map((s) => ({ ...s }));
    });
    toast('success', '已写入 data.extensions.regex');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>正则规则</h1>
        <span className="badge outline">{preset.name}</span>
        <span className="sub">{scripts.length} 条规则</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => addRegex(preset.name)}>+ 新建规则</button>
        <button className="btn sm" onClick={exportPreset}>导出</button>
        <button className="btn sm" onClick={syncToCard} title="写入人物卡 data.extensions.regex">写回卡片</button>
        <button className="btn sm" onClick={() => useModals.getState().set({ importOpen: true })}>导入</button>
      </div>

      <div className="split">
        {/* 规则列表 */}
        <div className="pane">
          <PaneHeader
            title="规则"
            sub={`${scripts.filter((s) => !s.disabled).length} 启用`}
            right={<button className="btn ghost sm icon" onClick={() => addRegex(preset.name)} title="新建">+</button>}
          />
          <div className="pane-body">
            {scripts.map((s, i) => (
              <div key={s.id} className={`list-row ${s.id === script.id ? 'active' : ''}`} onClick={() => select({ selectedRegexId: s.id })}>
                <span className="faint mono" style={{ fontSize: 10, width: 16, textAlign: 'right' }}>{i + 1}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 4 }}>
                    <span className="title ellipsis" style={{ opacity: s.disabled ? 0.55 : 1 }}>{s.scriptName}</span>
                    {s.disabled ? <span className="badge" style={{ height: 14, fontSize: 9 }}>禁用</span> : null}
                    {s.markdownOnly ? <span className="badge info" style={{ height: 14, fontSize: 9 }}>MD</span> : null}
                    {s.promptOnly ? <span className="badge purple" style={{ height: 14, fontSize: 9 }}>PT</span> : null}
                  </div>
                  <div className="mono faint ellipsis" style={{ fontSize: 10.5 }}>{s.findRegex}</div>
                </div>
                <div className="col" style={{ gap: 0 }}>
                  <button className="btn ghost sm icon" style={{ width: 16, height: 14, fontSize: 9 }} disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveRegex(preset.name, s.id, -1); }}>▲</button>
                  <button className="btn ghost sm icon" style={{ width: 16, height: 14, fontSize: 9 }} disabled={i === scripts.length - 1} onClick={(e) => { e.stopPropagation(); moveRegex(preset.name, s.id, 1); }}>▼</button>
                </div>
              </div>
            ))}
            {!scripts.length ? <div className="faint pad10" style={{ fontSize: 11.5 }}>还没有规则。</div> : null}
          </div>
        </div>

        {/* 主区 */}
        <div className="pane">
          <div className="pane-head">
            <div className="grow" style={{ minWidth: 0, maxWidth: 320 }}>
              <TextInput value={script.scriptName} onChange={(v) => set({ scriptName: v }, `r:${script.id}:name`)} placeholder="规则名称" />
            </div>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => { const s = { ...script, id: crypto.randomUUID(), scriptName: `${script.scriptName} 副本` }; mutate('复制正则规则', (d) => { d.regexes.find((p) => p.name === preset.name)?.scripts.push(s); }); select({ selectedRegexId: s.id }); }}>复制</button>
            <button className="btn sm ghost danger" onClick={() => { if (confirm(`删除规则「${script.scriptName}」？`)) deleteRegex(preset.name, script.id); }}>删除</button>
          </div>
          <div className="pane-head" style={{ minHeight: 30 }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'edit', label: '规则编辑' },
                { value: 'test', label: '正则测试' },
                { value: 'chain', label: '执行链模拟' },
                { value: 'json', label: 'JSON' },
              ]}
            />
            <span className="spacer" />
            <Toggle checked={!script.disabled} onChange={(v) => set({ disabled: !v })} label={script.disabled ? '已禁用' : '启用'} />
          </div>

          {tab === 'edit' ? (
            <div className="pane-body pad">
              <Labeled
                label="findRegex 匹配表达式"
                hint="SillyTavern 使用 /pattern/flags 形式；修改即时生效。未加斜杠也能运行，但会给出提示。"
                right={
                  <span className="row" style={{ gap: 4 }}>
                    <span className={`badge ${parsed?.ok ? 'ok' : 'warn'}`}>{parsed?.ok ? '格式正常' : '格式提醒'}</span>

                  </span>
                }
              >
                <textarea
                  className="textarea mono"
                  rows={3}
                  value={regexDraft}
                  onChange={(e) => {
                    setRegexDraft(e.target.value);
                    set({ findRegex: e.target.value }, `r:${script.id}:find`);
                  }}
                  spellCheck={false}
                  placeholder="/pattern/gi"
                />
              </Labeled>

              <div className="row wrap" style={{ gap: 8, marginTop: -4 }}>
                <span className="badge outline">pattern: {parsed?.pattern.length ?? 0} 字符</span>
                <span className="badge outline">flags: {parsed?.flags || '(无)'}</span>
                <span className="badge outline">捕获组: {groups.length}</span>
                {risk.level !== 'low' ? <span className={`badge ${risk.level === 'high' ? 'err' : 'warn'}`}>风险：{risk.level === 'high' ? '高' : '中'}</span> : <span className="badge ok">未发现明显回溯风险</span>}
              </div>

              {risk.reason ? (
                <div className="panel mt6" style={{ borderColor: risk.level === 'high' ? 'var(--err)' : 'var(--warn)' }}>
                  <div className="card-body" style={{ fontSize: 11.5 }}>{risk.reason}</div>
                </div>
              ) : null}

              <Labeled
                label="replaceString 替换为"
                hint="支持 $1 / $& / $<name> 等 JS 替换语法；当前 substituteRegex 为「宏替换」时会先替换 {{char}} 等宏。"
                right={
                  <span className="row" style={{ gap: 2 }}>
                    {groups.slice(0, 6).map((g) => (
                      <button key={g.index} className="btn ghost sm" title={`插入 $${g.index}`} onClick={() => set({ replaceString: (script.replaceString || '') + `$${g.index}` }, `r:${script.id}:rep`)}>${g.index}</button>
                    ))}
                  </span>
                }
              >
                <textarea className="textarea mono" rows={6} value={script.replaceString || ''} onChange={(e) => set({ replaceString: e.target.value }, `r:${script.id}:rep`)} spellCheck={false} placeholder="替换结果，可以是纯文本，也可以是 HTML" />
              </Labeled>

              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <div className="grow">
                  <Labeled label="生效位置 placement" hint="至少选择一个，否则规则不会在任何位置运行">
                    <div className="row wrap" style={{ gap: 10 }}>
                      {PLACEMENTS.map((p) => {
                        const on = (script.placement || []).includes(p.value);
                        return (
                          <label className="check" key={p.value}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                const cur = new Set(script.placement || []);
                                if (e.target.checked) cur.add(p.value);
                                else cur.delete(p.value);
                                set({ placement: [...cur].sort((a, b) => a - b) });
                              }}
                            />
                            <span>{p.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </Labeled>
                </div>
              </div>

              <div className="row wrap" style={{ gap: 14 }}>
                <Toggle checked={!!script.markdownOnly} onChange={(v) => set({ markdownOnly: v })} label="仅影响显示 markdownOnly" />
                <Toggle checked={!!script.promptOnly} onChange={(v) => set({ promptOnly: v })} label="仅影响提示词 promptOnly" />
                <Toggle checked={!!script.runOnEdit} onChange={(v) => set({ runOnEdit: v })} label="编辑时也运行 runOnEdit" />
              </div>
              {script.markdownOnly && script.promptOnly ? <div className="badge err mt6">markdownOnly 与 promptOnly 同时开启会被 SillyTavern 视为无效组合</div> : null}

              <div className="row mt10" style={{ gap: 8 }}>
                <div style={{ width: 170 }}>
                  <Labeled label="宏替换 substituteRegex">
                    <select className="select" value={String(script.substituteRegex ?? 0)} onChange={(e) => set({ substituteRegex: Number(e.target.value) })}>
                      <option value="0">0 · 不替换宏</option>
                      <option value="1">1 · 原文替换宏</option>
                      <option value="2">2 · 正则转义后替换</option>
                    </select>
                  </Labeled>
                </div>
                <div style={{ width: 110 }}>
                  <Labeled label="minDepth" hint="null = 不限">
                    <NumberInput value={script.minDepth ?? null} onChange={(v) => set({ minDepth: v })} nullable />
                  </Labeled>
                </div>
                <div style={{ width: 110 }}>
                  <Labeled label="maxDepth" hint="-1 = 不限">
                    <NumberInput value={script.maxDepth ?? null} onChange={(v) => set({ maxDepth: v })} nullable />
                  </Labeled>
                </div>
              </div>

              <Labeled label="trimStrings 预处理删除的字符串" hint="匹配前先从文本中删除这些片段">
                <TagInput values={script.trimStrings || []} onChange={(v) => set({ trimStrings: v })} />
              </Labeled>

              <div className="row" style={{ gap: 8 }}>
                <div className="grow">
                  <Labeled label="replace_file（非标准字段，存在则保留）">
                    <TextInput value={script.replace_file || ''} onChange={(v) => set({ replace_file: v }, `r:${script.id}:file`)} placeholder="部分分支/魔改版本使用" />
                  </Labeled>
                </div>
                <div style={{ width: 240 }}>
                  <Labeled label="规则 ID">
                    <div className="row">
                      <span className="mono faint ellipsis grow" style={{ fontSize: 10.5 }}>{script.id}</span>
                      <button className="btn ghost sm" onClick={() => copy(script.id, '规则 ID')}>复制</button>
                    </div>
                  </Labeled>
                </div>
              </div>

              {groups.length ? (
                <>
                  <div className="divider" />
                  <div className="section-title">捕获组说明</div>
                  <table className="table">
                    <thead><tr><th style={{ width: 60 }}>序号</th><th style={{ width: 140 }}>名称</th><th>起始片段</th></tr></thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.index}>
                          <td className="num">${g.index}</td>
                          <td className="mono">{g.name || <span className="faint">—</span>}</td>
                          <td className="mono faint" style={{ fontSize: 11 }}>{g.snippet}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === 'test' ? (
            <div className="pane-body pad">
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className="grow">
                  <div className="label">测试文本</div>
                  <textarea className="textarea mono mt6" rows={7} value={testText} onChange={(e) => setTestText(e.target.value)} spellCheck={false} />
                  <div className="row mt6" style={{ gap: 6 }}>
                    <button className="btn primary" onClick={runTest} disabled={running}>{running ? '执行中…' : '运行测试'}</button>
                    <button className="btn" onClick={() => setTestText('')}>清空</button>
                    <span className="faint" style={{ fontSize: 11 }}>超时阈值 400ms，超时会终止 Worker</span>
                  </div>
                </div>
                <div style={{ width: 220, flexShrink: 0 }}>
                  <div className="label">表达式</div>
                  <div className="code-pre mt6" style={{ fontSize: 11, maxHeight: 120 }}>{script.findRegex || '(空)'}</div>
                  <div className="label mt10">编译信息</div>
                  <KeyValue k="pattern">{parsed?.pattern.length ?? 0} 字符</KeyValue>
                  <KeyValue k="flags">{parsed?.flags || '（无，测试时自动加 g）'}</KeyValue>
                  <KeyValue k="捕获组">{groups.length}</KeyValue>
                  <KeyValue k="风险">
                    <span className={`badge ${risk.level === 'high' ? 'err' : risk.level === 'medium' ? 'warn' : 'ok'}`}>{risk.level === 'high' ? '高' : risk.level === 'medium' ? '中' : '低'}</span>
                  </KeyValue>
                  {result ? <KeyValue k="耗时">{result.elapsedMs?.toFixed(2)} ms</KeyValue> : null}
                </div>
              </div>

              {result ? (
                <div className="mt10">
                  {!result.ok ? (
                    <div className="panel" style={{ borderColor: 'var(--err)' }}>
                      <div className="card-body" style={{ color: 'var(--err)', fontSize: 12 }}>{result.error}</div>
                    </div>
                  ) : (
                    <>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <span className="badge info">{result.matches.length} 处匹配</span>
                        {result.truncated ? <span className="badge warn">结果已截断</span> : null}
                        {result.matches.length === 0 ? <span className="badge">未命中，替换结果与原文相同</span> : null}
                      </div>

                      <div className="row mt10" style={{ alignItems: 'flex-start', gap: 12 }}>
                        <div className="grow">
                          <div className="label">匹配明细</div>
                          <div className="panel mt6" style={{ maxHeight: 200, overflow: 'auto' }}>
                            {result.matches.length === 0 ? <div className="faint pad10" style={{ fontSize: 11.5 }}>无匹配</div> : (
                              result.matches.map((m, i) => (
                                <div key={i} style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)' }}>
                                  <div className="row">
                                    <span className="badge info">#{i + 1}</span>
                                    <span className="mono" style={{ fontSize: 11 }}>位置 {m.index}–{m.end}</span>
                                    <span className="spacer" />
                                    <button className="btn ghost sm" onClick={() => copy(m.value, '匹配文本')}>复制</button>
                                  </div>
                                  <div className="code-pre mt6" style={{ fontSize: 11, padding: 5 }}>{m.value || '(零宽匹配)'}</div>
                                  {m.groups.length ? (
                                    <div className="row wrap mt6" style={{ gap: 4 }}>
                                      {m.groups.map((g, gi) => (
                                        <span key={gi} className="chip" title={`$${gi + 1}`}>{`$${gi + 1}`} = {g === undefined ? 'undefined' : g || '""'}</span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="grow">
                          <div className="label">替换结果</div>
                          <div className="code-pre mt6" style={{ maxHeight: 200, minHeight: 80 }}>{result.output}</div>
                        </div>
                      </div>

                      <div className="divider" />
                      <div className="label">原文 → 替换（并排）</div>
                      <div className="row mt6" style={{ alignItems: 'flex-start', gap: 10 }}>
                        <div className="code-pre grow" style={{ maxHeight: 160 }}>{testText}</div>
                        <div style={{ alignSelf: 'center', color: 'var(--text-faint)' }}>→</div>
                        <div className="code-pre grow" style={{ maxHeight: 160, borderColor: 'var(--ok)' }}>{result.output}</div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'chain' ? (
            <div className="pane-body pad">
              <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                按列表顺序执行全部启用的规则，展示每一步的输入输出。placement / minDepth / maxDepth 会参与过滤（结果中标注「跳过」）。
              </div>
              <div className="row mt10" style={{ alignItems: 'flex-start', gap: 10 }}>
                <div className="grow">
                  <textarea className="textarea mono" rows={6} value={chainText} onChange={(e) => setChainText(e.target.value)} spellCheck={false} />
                </div>
                <div style={{ width: 190 }}>
                  <Labeled label="模拟位置">
                    <select className="select" value={chainPlacement} onChange={(e) => setChainPlacement(Number(e.target.value))}>
                      {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </Labeled>
                  <Labeled label="楼深（min/maxDepth）">
                    <NumberInput value={chainDepth} onChange={setChainDepth} nullable placeholder="不判断" />
                  </Labeled>
                  <button className="btn primary w100" onClick={runChain} disabled={running}>运行执行链</button>
                </div>
              </div>

              {chainResult?.steps ? (
                <div className="mt10">
                  <div className="row">
                    <span className="badge ok">{chainResult.steps.filter((s: any) => s.matchCount > 0).length} 条规则产生了替换</span>
                    <span className="spacer" />
                    <button className="btn sm ghost" onClick={() => copy(chainResult.final, '最终结果')}>复制最终结果</button>
                  </div>
                  <div className="panel mt6" style={{ maxHeight: 260, overflow: 'auto' }}>
                    {chainResult.steps.map((s: any, i: number) => (
                      <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                        <div className="row">
                          <span className="faint mono" style={{ width: 20 }}>{i + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: 11.5 }}>{s.scriptName}</span>
                          {s.skipped ? <span className="badge warn">跳过：{s.skipped}</span> : <span className={`badge ${s.error ? 'err' : s.matchCount ? 'ok' : ''}`}>{s.error ? '错误' : `${s.matchCount} 处`}</span>}
                          <span className="spacer" />
                          <span className="faint mono" style={{ fontSize: 10 }}>{s.elapsedMs?.toFixed(2)}ms</span>
                        </div>
                        {s.error ? <div style={{ color: 'var(--err)', fontSize: 11 }}>{s.error}</div> : null}
                        {s.before !== s.after ? (
                          <div className="row mt6" style={{ alignItems: 'flex-start', gap: 6 }}>
                            <div className="code-pre grow" style={{ fontSize: 10.5, padding: 4, maxHeight: 70 }}>{s.before}</div>
                            <div style={{ color: 'var(--text-faint)', alignSelf: 'center' }}>→</div>
                            <div className="code-pre grow" style={{ fontSize: 10.5, padding: 4, maxHeight: 70, borderColor: 'var(--ok)' }}>{s.after}</div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="label mt10">最终输出</div>
                  <div className="code-pre mt6" style={{ maxHeight: 180 }}>{chainResult.final}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'json' ? (
            <div className="pane-body pad">
              <div className="row mb6">
                <span className="faint" style={{ fontSize: 11 }}>单条规则的原始 JSON（与 SillyTavern 正则扩展字段一致）</span>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => copy(formatJson(script), '规则 JSON')}>复制</button>
              </div>
              <CodeArea value={formatJson(script)} readOnly language="json" minHeight={400} wrap={false} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
