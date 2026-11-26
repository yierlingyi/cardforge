import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, Labeled, Segmented, TextInput, Toggle, useCopy, useModals } from '../common';
import JsonTree from '../components/JsonTree';
import CodeArea from '../components/CodeArea';
import Modal from '../components/Modal';
import { JsonDiff } from '../components/DiffView';
import { FLAVOR_LABELS, checkDataAgainstSchema, inferFieldsFromData, parseZodSchema } from '../../core/mvu';
import { applyPatch, generatePatch, parseUpdateCommands } from '../../core/patch';
import { buildMvuJson } from '../../core/exporter';
import { downloadBlob, formatJson, isPlainObject, jsonType, bytesBlob } from '../../core/util';
import type { MvuSchemaField, MvuState } from '../../core/types';

type Tab = 'tree' | 'table' | 'json' | 'diff' | 'history' | 'schema' | 'patch';

/* ------------------------------- 路径工具 ------------------------------- */

export function parseDataPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  let cur = '';
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === '.') {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    if (c === '[') {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      const end = path.indexOf(']', i);
      const idx = path.slice(i + 1, end);
      out.push(/^\d+$/.test(idx) ? Number(idx) : idx);
      i = end;
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function getAt(data: any, path: string): any {
  let cur = data;
  for (const p of parseDataPath(path)) {
    if (cur == null) return undefined;
    cur = cur[p as any];
  }
  return cur;
}

function setAt(data: any, path: string, value: any): any {
  const parts = parseDataPath(path);
  const clone = JSON.parse(JSON.stringify(data ?? {}));
  if (!parts.length) return value;
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = typeof parts[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

function deleteAt(data: any, path: string): any {
  const parts = parseDataPath(path);
  const clone = JSON.parse(JSON.stringify(data ?? {}));
  if (!parts.length) return {};
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null) return clone;
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else delete cur[last as any];
  return clone;
}

function toPointer(path: string): string {
  const parts = parseDataPath(path);
  return '/' + parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function flatten(data: any, base = ''): { path: string; value: any; type: string }[] {
  const out: { path: string; value: any; type: string }[] = [];
  if (Array.isArray(data)) {
    if (!data.length) out.push({ path: base, value: data, type: 'array' });
    data.forEach((v, i) => out.push(...flatten(v, `${base}[${i}]`)));
    return out;
  }
  if (isPlainObject(data)) {
    const keys = Object.keys(data);
    if (!keys.length && base) out.push({ path: base, value: data, type: 'object' });
    for (const k of keys) out.push(...flatten(data[k], base ? `${base}.${k}` : k));
    return out;
  }
  out.push({ path: base, value: data, type: jsonType(data) });
  return out;
}

/* ------------------------------- 页面 ------------------------------- */

export default function MvuPage() {
  const { doc, mutate, toast, refreshMvu, select, setPage, runValidation } = useStore();
  const mvu = doc.mvu;
  const [tab, setTab] = useState<Tab>('tree');
  const [filter, setFilter] = useState('');
  const [selPath, setSelPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [draftType, setDraftType] = useState<string>('string');
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [addType, setAddType] = useState('string');
  const [addValue, setAddValue] = useState('');
  const [floorA, setFloorA] = useState<number | null>(null);
  const [floorB, setFloorB] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [patchText, setPatchText] = useState('[{"op":"replace","path":"/角色/好感度","value":30}]');
  const [patchResult, setPatchResult] = useState<{ ops: number; ok: boolean; errors: string[]; warnings: string[]; before: any; after: any } | null>(null);
  const copy = useCopy();
  const modals = useModals();

  const stat = mvu?.statData || {};

  useEffect(() => {
    if (mvu && doc.mvuFloors.length) {
      setFloorA(doc.mvuFloors[doc.mvuFloors.length - 2]?.index ?? doc.mvuFloors[0].index);
      setFloorB(doc.mvuFloors[doc.mvuFloors.length - 1].index);
    }
  }, [mvu?.flavor, doc.mvuFloors.length]);

  const schemaMap = useMemo(() => {
    const m = new Map<string, MvuSchemaField>();
    for (const f of mvu?.schemaFields || []) m.set(f.path.replace('[]', ''), f);
    return m;
  }, [mvu?.schemaFields]);

  const schemaIssues = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    if (!mvu) return m;
    for (const i of checkDataAgainstSchema(stat, mvu.schemaFields)) {
      m.set(i.path, i.level === 'error' ? 'error' : 'warning');
    }
    return m;
  }, [mvu?.schemaFields, stat]);

  const selectedValue = selPath ? getAt(stat, selPath) : undefined;

  useEffect(() => {
    if (!selPath) return;
    const v = getAt(stat, selPath);
    setDraftType(jsonType(v));
    setDraft(typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v ?? ''));
  }, [selPath, stat]);

  if (!mvu) {
    return (
      <div className="page">
        <div className="page-head"><h1>MVU 变量</h1></div>
        <Empty icon="◈" title="尚未进行 MVU 分析" desc="载入带 MVU 支持的人物卡后，编辑器会自动识别 mvu / mvubeta / mvuzod，并从世界书初始化条目与脚本中重建变量结构。">
          <button className="btn primary" onClick={() => { refreshMvu(); toast('info', '已重新分析'); }}>立即分析</button>
        </Empty>
      </div>
    );
  }

  const applyValue = () => {
    if (!selPath) return;
    let v: any;
    try {
      switch (draftType) {
        case 'number':
          v = draft.trim() === '' ? 0 : Number(draft);
          if (Number.isNaN(v)) throw new Error('不是合法数字');
          break;
        case 'boolean':
          v = draft === 'true';
          break;
        case 'null':
          v = null;
          break;
        case 'object':
        case 'array':
        case 'json':
          v = JSON.parse(draft);
          break;
        default:
          v = draft;
      }
    } catch (e: any) {
      toast('error', `值无效：${e.message}`);
      return;
    }
    const next = setAt(stat, selPath, v);
    useStore.getState().setStatData(next);
    toast('success', `已更新 ${selPath}`);
  };

  const removeNode = () => {
    if (!selPath) return;
    if (!confirm(`删除变量 ${selPath}？`)) return;
    useStore.getState().setStatData(deleteAt(stat, selPath));
    setSelPath(null);
  };

  const addChild = () => {
    if (!selPath) return;
    let v: any = addValue;
    if (addType === 'number') v = Number(addValue);
    else if (addType === 'boolean') v = addValue === 'true';
    else if (addType === 'null') v = null;
    else if (addType === 'object') v = {};
    else if (addType === 'array') v = [];
    else if (addType === 'json') {
      try {
        v = JSON.parse(addValue || 'null');
      } catch (e: any) {
        toast('error', `JSON 无效：${e.message}`);
        return;
      }
    }
    const parent = getAt(stat, selPath);
    const path = Array.isArray(parent) ? `${selPath}[${parent.length}]` : `${selPath}.${addKey}`;
    useStore.getState().setStatData(setAt(stat, path, v));
    setAddOpen(false);
    setAddKey('');
    setAddValue('');
    setSelPath(path);
  };

  const runPatch = () => {
    const parsed = parseUpdateCommands(patchText);
    const before = JSON.parse(JSON.stringify(stat));
    const r = applyPatch(before, parsed.ops);
    const after = r.result;
    setPatchResult({
      ops: parsed.ops.length,
      ok: r.ok && parsed.errors.length === 0,
      errors: [...parsed.errors, ...(r.ok ? [] : [`第 ${(r.failedAt ?? 0) + 1} 个操作失败：${r.error}`])],
      warnings: parsed.warnings,
      before,
      after,
    });
  };

  const stats = {
    leaves: flatten(stat).length,
    topKeys: Object.keys(stat).length,
    schemaFields: mvu.schemaFields.length,
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>MVU 变量</h1>
        <span className={`badge ${mvu.flavor === 'unknown' ? '' : 'info'}`}>{FLAVOR_LABELS[mvu.flavor]}</span>
        <span className={`badge ${mvu.confidence === 'high' ? 'ok' : mvu.confidence === 'medium' ? 'warn' : ''}`} title="识别置信度">置信度 {mvu.confidence}</span>
        <span className="sub ellipsis" style={{ maxWidth: 320 }}>{mvu.statSourceDetail || '变量来源未确定'}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { refreshMvu({ keepStat: true }); toast('info', '已重新分析（保留当前变量）'); }}>重新分析</button>
        <button className="btn sm" onClick={() => setImportOpen(true)}>导入变量</button>
        <button className="btn sm" onClick={() => { const art = buildMvuJson(mvu); downloadBlob(bytesBlob(art.bytes, art.mime), art.filename); toast('success', '已导出快照'); }}>导出快照</button>
        <button className="btn sm" onClick={() => { const n = runValidation(); toast('info', `校验完成：${n.length} 条`); }}>校验变量</button>
      </div>

      <div className="pane-head">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'tree', label: '树形视图' },
            { value: 'table', label: '表格视图' },
            { value: 'json', label: 'JSON' },
            { value: 'diff', label: '差异' },
            { value: 'history', label: '历史楼层' },
            { value: 'schema', label: 'Schema' },
            { value: 'patch', label: 'Patch 测试' },
          ]}
        />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 10.5 }}>{stats.leaves} 个叶子节点 · {stats.topKeys} 个顶层字段 · {stats.schemaFields} 个 Schema 字段</span>
      </div>

      <div className="split inspector-right">
        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>变量数据</span>
            <span className="badge outline">{mvu.statSource === 'worldbook' ? '来自世界书初始化' : mvu.statSource === 'imported' ? '已导入 / 手动编辑' : '空'}</span>
            <span className="spacer" />
            {tab === 'tree' || tab === 'table' ? (
              <input className="input sm" style={{ width: 150, height: 22 }} placeholder="过滤变量…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            ) : null}
          </div>
          <div className="pane-body pad">
            {tab === 'tree' ? (
              Object.keys(stat).length ? (
                <JsonTree
                  data={stat}
                  selectedPath={selPath}
                  onSelect={(p) => setSelPath(p)}
                  schemaMap={schemaMap}
                  issues={schemaIssues}
                  filter={filter}
                  onCopy={(t, l) => copy(t, l)}
                />
              ) : (
                <Empty icon="◈" title="变量为空" desc="可以从世界书初始化条目解析，或导入一份变量 JSON 快照。">
                  <button className="btn" onClick={() => setImportOpen(true)}>导入变量</button>
                </Empty>
              )
            ) : null}

            {tab === 'table' ? <TableView data={stat} filter={filter} onPick={setSelPath} /> : null}

            {tab === 'json' ? (
              <JsonEditor data={stat} onChange={(v) => useStore.getState().setStatData(v)} />
            ) : null}

            {tab === 'diff' ? (
              <div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="faint" style={{ fontSize: 11.5 }}>基准：</span>
                  <select
                    className="select"
                    style={{ width: 180 }}
                    value={floorA ?? ''}
                    onChange={(e) => setFloorA(doc.mvuFloors.find((f) => String(f.index) === e.target.value)?.index ?? null)}
                  >
                    <option value="">选择楼层…</option>
                    {doc.mvuFloors.map((f) => <option key={f.index} value={f.index}>第 {f.index} 楼 {f.label || ''}</option>)}
                    <option value="__baseline">手动基准</option>
                  </select>
                  <button className="btn sm" onClick={() => setBaseline(JSON.parse(JSON.stringify(stat)))}>把当前设为基准</button>
                  <span className="faint" style={{ fontSize: 11 }}>对比对象：当前变量</span>
                </div>
                <div className="mt10">
                  {(() => {
                    const base = floorA === null ? baseline : floorA === ('__baseline' as any) ? baseline : doc.mvuFloors.find((f) => f.index === floorA)?.statData;
                    if (!base) return <div className="faint">请选择基准楼层，或点击「把当前设为基准」后再修改变量查看差异。</div>;
                    return <JsonDiff before={base} after={stat} />;
                  })()}
                </div>
              </div>
            ) : null}

            {tab === 'history' ? (
              <HistoryView
                floors={doc.mvuFloors}
                current={stat}
                floorA={floorA}
                floorB={floorB}
                setFloorA={setFloorA}
                setFloorB={setFloorB}
              />
            ) : null}

            {tab === 'schema' ? <SchemaView mvu={mvu} stat={stat} /> : null}

            {tab === 'patch' ? (
              <div>
                <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                  支持标准 JSON Patch（RFC 6902）与常见的 <span className="code-inline">_.set('路径', 值)</span> 调用。只做本地计算，不会触碰运行时。
                </div>
                <div className="row mt6" style={{ gap: 4 }}>
                  <button className="btn sm ghost" onClick={() => setPatchText('[{"op":"replace","path":"/角色/好感度","value":30}]')}>示例：替换</button>
                  <button className="btn sm ghost" onClick={() => setPatchText('[{"op":"add","path":"/角色/背包/-","value":{"名称":"咖啡","数量":1}}]')}>示例：数组追加</button>
                  <button className="btn sm ghost" onClick={() => setPatchText("_.set('角色.生命', 72); _.set('世界.天气', '极光过载');")}>示例：_.set</button>
                </div>
                <CodeArea value={patchText} onChange={setPatchText} language="json" minHeight={110} />
                <div className="row mt6">
                  <button className="btn primary" onClick={runPatch}>执行补丁</button>
                  <span className="faint" style={{ fontSize: 11 }}>变更只显示在下方，不会写入变量；确认无误后点「应用到变量」</span>
                </div>

                {patchResult ? (
                  <div className="mt10">
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className={`badge ${patchResult.ok ? 'ok' : 'err'}`}>{patchResult.ok ? '执行成功' : '存在错误'}</span>
                      <span className="badge">{patchResult.ops} 个操作</span>
                      {patchResult.warnings.length ? <span className="badge warn">{patchResult.warnings.length} 条说明</span> : null}
                      <span className="spacer" />
                      <button className="btn sm" disabled={!patchResult.ok} onClick={() => { useStore.getState().setStatData(patchResult.after); toast('success', '已应用到变量'); }}>应用到变量</button>
                    </div>
                    {patchResult.errors.map((e, i) => <div key={i} style={{ color: 'var(--err)', fontSize: 11.5 }}>· {e}</div>)}
                    {patchResult.warnings.map((e, i) => <div key={i} className="faint" style={{ fontSize: 11.5 }}>· {e}</div>)}
                    <div className="label mt10">变更</div>
                    <JsonDiff before={patchResult.before} after={patchResult.after} />
                    {mvu.schemaFields.length ? (
                      <>
                        <div className="label mt10">Schema 校验结果</div>
                        {checkDataAgainstSchema(patchResult.after, mvu.schemaFields).length === 0 ? (
                          <div className="badge ok">未发现 Schema 冲突（静态推断级别）</div>
                        ) : (
                          checkDataAgainstSchema(patchResult.after, mvu.schemaFields).map((i, idx) => (
                            <div key={idx} style={{ fontSize: 11.5, color: i.level === 'error' ? 'var(--err)' : 'var(--warn)' }}>· {i.path}：{i.message}</div>
                          ))
                        )}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* 检查器 */}
        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{selPath ? '变量编辑' : '识别信息'}</span>
            <span className="spacer" />
            {selPath ? <button className="btn ghost sm icon" onClick={() => setSelPath(null)} title="关闭">×</button> : null}
          </div>
          <div className="pane-body pad">
            {selPath ? (
              <>
                <div className="row">
                  <span className="mono" style={{ color: 'var(--accent)', fontSize: 12, wordBreak: 'break-all' }}>{selPath}</span>
                  <span className="spacer" />
                  <button className="btn ghost sm" onClick={() => copy(toPointer(selPath), 'JSON Pointer')}>¶</button>
                </div>
                <div className="faint" style={{ fontSize: 10.5, marginBottom: 8 }}>{toPointer(selPath)}</div>

                <Labeled label="类型">
                  <select
                    className="select"
                    value={draftType}
                    onChange={(e) => {
                      const t = e.target.value;
                      setDraftType(t);
                      const v = selectedValue;
                      if (t === 'object') setDraft(JSON.stringify(isPlainObject(v) ? v : {}, null, 2));
                      else if (t === 'array') setDraft(JSON.stringify(Array.isArray(v) ? v : [], null, 2));
                      else if (t === 'boolean') setDraft(String(!!v));
                      else if (t === 'null') setDraft('null');
                      else if (t === 'json') setDraft(JSON.stringify(v, null, 2));
                      else setDraft(String(v ?? ''));
                    }}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="null">null</option>
                    <option value="object">object</option>
                    <option value="array">array</option>
                    <option value="json">JSON（任意）</option>
                  </select>
                </Labeled>

                <Labeled label="值">
                  {draftType === 'boolean' ? (
                    <Toggle checked={draft === 'true'} onChange={(v) => setDraft(String(v))} label={draft === 'true' ? 'true' : 'false'} />
                  ) : draftType === 'null' ? (
                    <div className="faint">null</div>
                  ) : draftType === 'object' || draftType === 'array' || draftType === 'json' ? (
                    <CodeArea value={draft} onChange={setDraft} language="json" minHeight={140} />
                  ) : (
                    <textarea className={`textarea ${draftType === 'number' ? 'mono' : ''}`} rows={draftType === 'string' && draft.length > 60 ? 5 : 2} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  )}
                </Labeled>

                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" onClick={applyValue}>应用</button>
                  <button className="btn sm" onClick={() => setSelPath(null)}>取消</button>
                  <span className="spacer" />
                  <button className="btn sm danger" onClick={removeNode}>删除</button>
                </div>

                <div className="divider" />
                <button className="btn sm w100" onClick={() => setAddOpen(true)}>
                  + 在此节点下添加
                </button>

                {schemaMap.get(selPath) ? (
                  <div className="panel mt10">
                    <div className="card-body">
                      <div className="label">Schema 约束</div>
                      <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                        <span className="badge info">{schemaMap.get(selPath)!.type}</span>
                        <span className="badge">{schemaMap.get(selPath)!.required ? '必填' : '可选'}</span>
                        {schemaMap.get(selPath)!.defaultValue !== undefined ? <span className="badge outline">默认 {String(schemaMap.get(selPath)!.defaultValue)}</span> : null}
                      </div>
                      {schemaMap.get(selPath)!.constraints.map((c, i) => <div key={i} className="faint" style={{ fontSize: 11 }}>· {c}</div>)}
                    </div>
                  </div>
                ) : (
                  <div className="faint mt10" style={{ fontSize: 11 }}>该路径不在静态推断的 Schema 中。</div>
                )}

                <div className="divider" />
                <div className="label">当前值 JSON</div>
                <div className="code-pre mt6" style={{ maxHeight: 160 }}>{formatJson(selectedValue)}</div>
              </>
            ) : (
              <>
                <KeyValue k="识别版本">{FLAVOR_LABELS[mvu.flavor]}</KeyValue>
                <KeyValue k="置信度">{mvu.confidence}</KeyValue>
                <KeyValue k="变量来源">{mvu.statSource}</KeyValue>
                <KeyValue k="来源说明">{mvu.statSourceDetail || '—'}</KeyValue>
                <KeyValue k="Schema">{mvu.schemaFields.length ? `${mvu.schemaFields.length} 个字段（静态推断）` : '未检测到'}</KeyValue>

                <div className="divider" />
                <div className="section-title">识别证据</div>
                {mvu.evidence.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>没有发现 MVU 特征信号。</div> : null}
                {mvu.evidence.slice(0, 12).map((e, i) => (
                  <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="row">
                      <span className="badge info">{FLAVOR_LABELS[e.flavor]}</span>
                      <span className="faint" style={{ fontSize: 10.5 }}>权重 {e.score}</span>
                    </div>
                    {e.signals.map((s, j) => (
                      <div key={j} className="faint" style={{ fontSize: 11 }}>
                        {s.where}：{s.detail}
                      </div>
                    ))}
                  </div>
                ))}

                <div className="divider" />
                <div className="section-title">相关世界书条目</div>
                {mvu.relatedEntries.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>无</div> : null}
                {mvu.relatedEntries.slice(0, 12).map((e) => (
                  <button
                    key={e.uid}
                    className="list-row w100"
                    style={{ padding: '3px 4px' }}
                    onClick={() => {
                      select({ selectedEntryUid: e.uid });
                      setPage('worldbook');
                    }}
                  >
                    <span className="mono faint" style={{ fontSize: 10 }}>#{e.uid}</span>
                    <span className="ellipsis grow" style={{ fontSize: 11.5 }}>{e.comment}</span>
                    <span className="badge outline" style={{ fontSize: 9 }}>{e.kind}</span>
                  </button>
                ))}

                <div className="section-title">相关脚本</div>
                {mvu.relatedScripts.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>无</div> : null}
                {mvu.relatedScripts.map((s) => (
                  <button
                    key={s.id}
                    className="list-row w100"
                    style={{ padding: '3px 4px' }}
                    onClick={() => {
                      select({ selectedScriptId: s.id });
                      setPage('scripts');
                    }}
                  >
                    <span className="ellipsis grow" style={{ fontSize: 11.5 }}>{s.name}</span>
                    <span className="badge outline" style={{ fontSize: 9 }}>{s.kind}</span>
                  </button>
                ))}

                <div className="divider" />
                <div className="faint" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
                  MVU 的运行时行为由脚本实际执行决定。本页的变量树与 Schema 来自<b>静态解析</b>，用于编辑和分析，不代表运行时一定如此。
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 添加节点 */}
      <Modal open={addOpen} title={`在 ${selPath} 下添加`} onClose={() => setAddOpen(false)} width="narrow" footer={<><button className="btn ghost" onClick={() => setAddOpen(false)}>取消</button><button className="btn primary" onClick={addChild} disabled={!addKey && !Array.isArray(selectedValue)}>添加</button></>}>
        {Array.isArray(selectedValue) ? (
          <div className="faint" style={{ fontSize: 11.5 }}>将追加到数组末尾（索引 {selectedValue.length}）。</div>
        ) : (
          <Labeled label="键名">
            <TextInput value={addKey} onChange={setAddKey} placeholder="例如：好感度" />
          </Labeled>
        )}
        <Labeled label="类型 / 值">
          <div className="row" style={{ gap: 6 }}>
            <select className="select" style={{ width: 120 }} value={addType} onChange={(e) => { setAddType(e.target.value); setAddValue(''); }}>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="null">null</option>
              <option value="object">object</option>
              <option value="array">array</option>
              <option value="json">JSON</option>
            </select>
            {['string', 'number'].includes(addType) ? <input className="input" value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="值" /> : null}
            {addType === 'boolean' ? (
              <select className="select" value={addValue} onChange={(e) => setAddValue(e.target.value)}>
                <option value="">false</option>
                <option value="true">true</option>
              </select>
            ) : null}
            {addType === 'json' ? <input className="input mono" value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder='{"a":1}' /> : null}
          </div>
        </Labeled>
      </Modal>

      {/* 导入变量 */}
      <Modal
        open={importOpen}
        title="导入变量快照"
        width="wide"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setImportOpen(false)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                try {
                  const parsed = JSON.parse(importText);
                  const floors = Array.isArray(parsed)
                    ? parsed.map((p: any, i: number) => ({ index: typeof p?.index === 'number' ? p.index : i, statData: p?.stat_data ?? p?.statData ?? p, label: p?.label }))
                    : (parsed.floors || []).map((p: any, i: number) => ({ index: p.index ?? i, statData: p.stat_data ?? p.statData ?? p, label: p.label }));
                  if (!floors.length) throw new Error('没有找到楼层数据');
                  useStore.getState().importFloors(floors);
                  setImportOpen(false);
                  toast('success', `已导入 ${floors.length} 个楼层的变量`);
                } catch (e: any) {
                  toast('error', `导入失败：${e.message}`);
                }
              }}
            >
              导入
            </button>
          </>
        }
      >
        <div className="faint mb6" style={{ fontSize: 11.5, lineHeight: 1.75 }}>
          支持三种结构：单个变量对象、<span className="code-inline">{'[{"stat_data":{...}}, ...]'}</span>、<span className="code-inline">{'{"floors":[...]}'}</span>。
          每个楼层的变量会作为「历史楼层」保存，可用于变量历史视图与差异对比。
        </div>
        <CodeArea value={importText} onChange={setImportText} language="json" minHeight={260} />
      </Modal>
    </div>
  );
}

/* ------------------------------- 子视图 ------------------------------- */

function TableView({ data, filter, onPick }: { data: any; filter: string; onPick: (p: string) => void }) {
  const [sortKey, setSortKey] = useState<'path' | 'value'>('path');
  const rows = useMemo(() => {
    let list = flatten(data);
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((r) => r.path.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q));
    }
    if (sortKey === 'value') list.sort((a, b) => String(a.value).localeCompare(String(b.value)));
    else list.sort((a, b) => a.path.localeCompare(b.path));
    return list;
  }, [data, filter, sortKey]);

  return (
    <div>
      <div className="row mb6" style={{ gap: 6 }}>
        <span className="faint" style={{ fontSize: 11 }}>{rows.length} 行</span>
        <span className="spacer" />
        <button className={`btn sm ${sortKey === 'path' ? 'active' : ''}`} onClick={() => setSortKey('path')}>按路径</button>
        <button className={`btn sm ${sortKey === 'value' ? 'active' : ''}`} onClick={() => setSortKey('value')}>按值</button>
      </div>
      <table className="table">
        <thead>
          <tr><th>路径</th><th style={{ width: 70 }}>类型</th><th>值</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 1500).map((r) => (
            <tr key={r.path} onClick={() => onPick(r.path)} style={{ cursor: 'pointer' }}>
              <td className="mono" style={{ fontSize: 11 }}>{r.path}</td>
              <td><span className="badge outline">{r.type}</span></td>
              <td className="mono ellipsis" style={{ fontSize: 11, maxWidth: 340 }}>{typeof r.value === 'object' ? formatJson(r.value, 0).slice(0, 80) : String(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="faint pad10">没有匹配项。</div> : null}
      {rows.length > 1500 ? <div className="faint pad10" style={{ fontSize: 11 }}>仅显示前 1500 行（共 {rows.length}），请用过滤缩小范围。</div> : null}
    </div>
  );
}

function JsonEditor({ data, onChange }: { data: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(formatJson(data));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(formatJson(data));
  }, [data, dirty]);
  return (
    <div>
      <div className="row mb6">
        <span className="faint" style={{ fontSize: 11 }}>直接编辑完整变量 JSON</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { setText(formatJson(data)); setDirty(false); setError(null); }}>重置</button>
        <button
          className="btn sm primary"
          onClick={() => {
            try {
              onChange(JSON.parse(text));
              setDirty(false);
              setError(null);
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          应用
        </button>
      </div>
      <CodeArea value={text} onChange={(v) => { setText(v); setDirty(true); try { JSON.parse(v); setError(null); } catch (e: any) { setError(e.message); } }} language="json" minHeight={360} />
      {error ? <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 4 }}>JSON 无效：{error}</div> : null}
    </div>
  );
}

function HistoryView({
  floors,
  current,
  floorA,
  floorB,
  setFloorA,
  setFloorB,
}: {
  floors: { index: number; statData: any; label?: string }[];
  current: any;
  floorA: number | null;
  floorB: number | null;
  setFloorA: (v: number | null) => void;
  setFloorB: (v: number | null) => void;
}) {
  const a = floors.find((f) => f.index === floorA)?.statData;
  const b = floors.find((f) => f.index === floorB)?.statData;
  if (!floors.length) {
    return (
      <Empty
        icon="↺"
        title="没有楼层变量"
        desc="在 MVU 页面点击「导入变量」粘贴多楼层的 stat_data，即可查看变量随对话的变化。"
      />
    );
  }
  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="field" style={{ width: 200 }}>
          <label>楼层 A</label>
          <select className="select" value={floorA ?? ''} onChange={(e) => setFloorA(Number(e.target.value))}>
            {floors.map((f) => <option key={f.index} value={f.index}>第 {f.index} 楼 {f.label || ''}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>楼层 B</label>
          <select className="select" value={floorB ?? ''} onChange={(e) => setFloorB(Number(e.target.value))}>
            {floors.map((f) => <option key={f.index} value={f.index}>第 {f.index} 楼 {f.label || ''}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>当前变量</label>
          <div className="faint" style={{ paddingTop: 6, fontSize: 11 }}>始终作为对照</div>
        </div>
      </div>
      <div className="mt10">
        <div className="label">楼层 A → B 的变量变化</div>
        {a && b ? <JsonDiff before={a} after={b} /> : <div className="faint">请选择两个楼层。</div>}
      </div>
      <div className="divider" />
      <div className="label">全部楼层</div>
      <table className="table">
        <thead><tr><th style={{ width: 70 }}>楼层</th><th>标签</th><th>顶层字段</th><th>叶子数</th><th>与当前差异</th></tr></thead>
        <tbody>
          {floors.map((f) => (
            <tr key={f.index}>
              <td className="num">{f.index}</td>
              <td>{f.label || <span className="faint">—</span>}</td>
              <td className="mono" style={{ fontSize: 11 }}>{Object.keys(f.statData || {}).join(', ')}</td>
              <td className="num">{flatten(f.statData).length}</td>
              <td className="num">{generatePatch(f.statData, current).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchemaView({ mvu, stat }: { mvu: MvuState; stat: any }) {
  const [q, setQ] = useState('');

  const fields = mvu.schemaFields.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()) || f.type.includes(q));
  const issues = checkDataAgainstSchema(stat, mvu.schemaFields);
  const inferred = inferFieldsFromData(stat);

  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="badge info">{mvu.schemaFields.length} 个 Schema 字段</span>
        <span className="badge">{issues.filter((i) => i.level === 'error').length} 个类型/范围问题</span>
        <span className="spacer" />
        <input className="input sm" style={{ width: 180 }} placeholder="过滤字段路径…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="faint mt6" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        {mvu.schemaNote || '未检测到 Zod Schema。'}
        <br />
        Schema 由脚本中的 <span className="code-inline">z.object(...)</span> 静态推断得出；<span className="code-inline">.transform / .refine / z.record</span> 等运行时逻辑无法静态判定，会被显式标记，不会假装已完整理解。
      </div>

      {mvu.schemaFields.length === 0 ? (
        <div className="panel mt10">
          <div className="card-body">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>无 Schema，使用数据推断结构</div>
            <table className="table">
              <thead><tr><th>路径</th><th style={{ width: 90 }}>推断类型</th></tr></thead>
              <tbody>
                {inferred.slice(0, 80).map((f) => (
                  <tr key={f.path}><td className="mono" style={{ fontSize: 11 }}>{f.path}</td><td><span className="badge outline">{f.type}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <table className="table mt10">
            <thead>
              <tr>
                <th>路径</th>
                <th style={{ width: 90 }}>类型</th>
                <th style={{ width: 60 }}>必填</th>
                <th style={{ width: 100 }}>默认值</th>
                <th>约束</th>
                <th style={{ width: 80 }}>数据状态</th>
              </tr>
            </thead>
            <tbody>
              {fields.slice(0, 600).map((f) => {
                const issue = issues.find((i) => i.path === f.path);
                return (
                  <tr key={f.path}>
                    <td className="mono" style={{ fontSize: 11 }}>{f.path}</td>
                    <td><span className="badge outline">{f.type}</span></td>
                    <td>{f.required ? <span className="badge info">是</span> : <span className="faint">否</span>}</td>
                    <td className="mono faint" style={{ fontSize: 10.5 }}>{f.defaultValue === undefined ? '—' : String(f.defaultValue)}</td>
                    <td className="faint" style={{ fontSize: 10.5 }}>{f.constraints.join('；') || '—'}</td>
                    <td>{issue ? <span className={`badge ${issue.level === 'error' ? 'err' : 'warn'}`}>{issue.level === 'error' ? '不符' : '注意'}</span> : <span className="badge ok">正常</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {fields.length > 600 ? <div className="faint" style={{ fontSize: 11 }}>仅显示前 600 个字段。</div> : null}
        </>
      )}

      <div className="divider" />
      <div className="section-title">变量结构与 Schema 的关联分析</div>
      {(() => {
        const schemaPaths = new Set(mvu.schemaFields.map((f) => f.path.replace('[]', '')));
        const dataPaths = inferred.map((f) => f.path.replace('[]', ''));
        const onlyData = dataPaths.filter((p) => p && !schemaPaths.has(p) && !Array.from(schemaPaths).some((s) => p.startsWith(s + '.')));
        const onlySchema = Array.from(schemaPaths).filter((p) => p && !dataPaths.includes(p) && !dataPaths.some((d) => d.startsWith(p + '.')));
        return (
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div className="grow">
              <div className="label">仅存在于数据中（Schema 未声明）</div>
              <div className="panel mt6" style={{ maxHeight: 120, overflow: 'auto' }}>
                <div style={{ padding: 6 }}>
                  {onlyData.length === 0 ? <span className="faint" style={{ fontSize: 11 }}>无</span> : onlyData.slice(0, 40).map((p) => <div key={p} className="mono" style={{ fontSize: 10.5 }}>{p}</div>)}
                </div>
              </div>
            </div>
            <div className="grow">
              <div className="label">仅存在于 Schema 中（数据缺失）</div>
              <div className="panel mt6" style={{ maxHeight: 120, overflow: 'auto' }}>
                <div style={{ padding: 6 }}>
                  {onlySchema.length === 0 ? <span className="faint" style={{ fontSize: 11 }}>无</span> : onlySchema.slice(0, 40).map((p) => <div key={p} className="mono" style={{ fontSize: 10.5 }}>{p}</div>)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
