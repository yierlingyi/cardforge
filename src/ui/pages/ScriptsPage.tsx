import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, Labeled, PaneHeader, Segmented, TextInput, Toggle, useCopy, useModals } from '../common';
import CodeArea from '../components/CodeArea';
import Modal from '../components/Modal';
import { analyzeScript, checkSyntax, exportScriptCollection } from '../../core/scripts';
import { buildScriptsJson } from '../../core/exporter';
import { formatJsBasic } from '../../core/format';
import { downloadBlob, formatJson, humanSize, bytesBlob } from '../../core/util';
import type { TavernScript } from '../../core/types';

type Tab = 'edit' | 'analysis' | 'buttons' | 'data' | 'json';

export default function ScriptsPage() {
  const { doc, selectedScriptId, select, mutate, addScript, updateScript, deleteScript, moveScript, toast } = useStore();
  const col = doc.scripts[0] || null;
  const scripts = col?.scripts || [];
  const script = scripts.find((s) => s.id === selectedScriptId) || scripts[0] || null;
  const [tab, setTab] = useState<Tab>('edit');
  const [readonly, setReadonly] = useState(false);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const copy = useCopy();
  const modals = useModals();

  const meta = useMemo(() => (script ? analyzeScript(script) : null), [script?.content, script?.button]);
  const syntax = useMemo(() => (script ? checkSyntax(script.content) : { ok: true }), [script?.content]);

  if (!col || !script) {
    return (
      <div className="page">
        <div className="page-head"><h1>酒馆助手脚本</h1></div>
        <Empty icon="⧉" title="没有脚本" desc="酒馆助手（Tavern Helper / JS-Slash-Runner）的脚本通常存放在人物卡 data.extensions.tavern_helper.scripts 中。导入带脚本的卡片即可在这里管理。">
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                mutate('新建脚本集', (d) => {
                  d.scripts.push({ scripts: [], root: [], shape: 'array', origin: 'new' });
                });
                setTimeout(() => addScript(0), 0);
              }}
            >
              新建脚本
            </button>
            <button className="btn" onClick={() => modals.set({ importOpen: true })}>导入脚本 JSON</button>
          </div>
        </Empty>
      </div>
    );
  }

  const set = (patch: Partial<TavernScript>, coalesce?: string) => updateScript(0, script.id, patch, coalesce);
  const filtered = scripts.filter((s) => !search || `${s.name}\n${s.content}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page">
      <div className="page-head">
        <h1>酒馆助手脚本</h1>
        <span className="badge outline">{scripts.length} 个</span>
        <span className="sub">{col.origin === 'character' ? '来自卡片 extensions.tavern_helper' : col.origin === 'file' ? '来自导入文件' : '本地新建'}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => addScript(0)}>+ 新建脚本</button>
        <button
          className="btn sm"
          onClick={() => {
            const art = buildScriptsJson(col);
            downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
            toast('success', `已导出 ${art.filename}`);
          }}
        >
          导出全部
        </button>
        <button className="btn sm" onClick={() => setImportOpen(true)}>导入</button>
        <button
          className="btn sm"
          onClick={() => {
            if (!doc.card) return;
            mutate('把脚本写回卡片 extensions.tavern_helper', (d) => {
              const ext = d.card!.data.extensions || (d.card!.data.extensions = {});
              if (!ext.tavern_helper) ext.tavern_helper = {};
              ext.tavern_helper.scripts = col.scripts.map((s) => JSON.parse(JSON.stringify(s)));
            });
            toast('success', '已写回 data.extensions.tavern_helper.scripts');
          }}
        >
          写回卡片
        </button>
      </div>

      <div className="split">
        {/* 列表 */}
        <div className="pane">
          <PaneHeader title="脚本" sub={`${scripts.filter((s) => s.enabled !== false).length} 启用`} />
          <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <input className="input sm" placeholder="搜索脚本名 / 代码…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="pane-body">
            {filtered.map((s, i) => {
              const m = analyzeScript(s);
              return (
                <div key={s.id} className={`list-row ${s.id === script.id ? 'active' : ''}`} onClick={() => select({ selectedScriptId: s.id })}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 4 }}>
                      <span className="title ellipsis" style={{ opacity: s.enabled === false ? 0.55 : 1 }}>{s.name}</span>
                      {s.enabled === false ? <span className="badge" style={{ height: 14, fontSize: 9 }}>禁用</span> : null}
                      {!m.syntax.ok ? <span className="badge err" style={{ height: 14, fontSize: 9 }}>语法错误</span> : null}
                    </div>
                    <div className="row" style={{ gap: 6, fontSize: 10 }}>
                      <span className="faint">{m.lines} 行</span>
                      <span className="faint">{humanSize(m.chars)}</span>
                      {m.buttonCount ? <span className="faint">按钮 {m.buttonCount}</span> : null}
                      {m.imports.length ? <span className="faint">import {m.imports.length}</span> : null}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 0 }}>
                    <button className="btn ghost sm icon" style={{ width: 16, height: 14, fontSize: 9 }} disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveScript(0, s.id, -1); }}>▲</button>
                    <button className="btn ghost sm icon" style={{ width: 16, height: 14, fontSize: 9 }} disabled={i === filtered.length - 1} onClick={(e) => { e.stopPropagation(); moveScript(0, s.id, 1); }}>▼</button>
                  </div>
                </div>
              );
            })}
            {!filtered.length ? <div className="faint pad10" style={{ fontSize: 11.5 }}>没有匹配的脚本。</div> : null}
          </div>
        </div>

        {/* 主区 */}
        <div className="pane">
          <div className="pane-head">
            <div className="grow" style={{ minWidth: 0, maxWidth: 320 }}>
              <TextInput value={script.name} onChange={(v) => set({ name: v }, `s:${script.id}:name`)} placeholder="脚本名称" />
            </div>
            {syntax.ok ? <span className="badge ok">语法通过</span> : <span className="badge err">语法错误</span>}
            <span className="spacer" />
            <Toggle checked={script.enabled !== false} onChange={(v) => set({ enabled: v })} label={script.enabled === false ? '已禁用' : '启用'} />
            <button className="btn sm ghost" onClick={() => { const s = { ...script, id: crypto.randomUUID(), name: `${script.name} 副本` }; mutate('复制脚本', (d) => { d.scripts[0]?.scripts.push(s); }); select({ selectedScriptId: s.id }); }}>复制</button>
            <button className="btn sm ghost danger" onClick={() => { if (confirm(`删除脚本「${script.name}」？`)) deleteScript(0, script.id); }}>删除</button>
          </div>
          <div className="pane-head" style={{ minHeight: 30 }}>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'edit', label: '代码' },
                { value: 'analysis', label: '分析' },
                { value: 'buttons', label: '按钮' },
                { value: 'data', label: '数据' },
                { value: 'json', label: 'JSON' },
              ]}
            />
            <span className="spacer" />
            <label className="check"><input type="checkbox" checked={readonly} onChange={(e) => setReadonly(e.target.checked)} /> 只读模式</label>
          </div>

          <div style={{ padding: '6px 10px', background: 'var(--warn-soft)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)' }}>
            安全说明：编辑器<b>不会执行</b>脚本。语法检查使用 <span className="code-inline">new Function</span> 仅编译不运行；也未提供任何运行时沙箱执行入口。
          </div>

          {tab === 'edit' ? (
            <div className="pane-body" style={{ padding: 8, display: 'flex', flexDirection: 'column' }}>
              <div className="row mb6" style={{ gap: 6 }}>
                <button className="btn sm" disabled={readonly} onClick={() => { set({ content: formatJsBasic(script.content) }); toast('info', '已按括号层级重新缩进（基础格式化，非 Prettier）'); }}>格式化</button>
                <button className="btn sm ghost" onClick={() => copy(script.content, '脚本代码')}>复制代码</button>
                <button className="btn sm ghost" onClick={() => { const r = checkSyntax(script.content); toast(r.ok ? 'success' : 'error', r.ok ? '语法检查通过' : `语法错误：${r.error}`); }}>语法检查</button>
                <span className="spacer" />
                <span className="faint" style={{ fontSize: 10.5 }}>{meta?.lines} 行 · {script.content.length} 字符</span>
              </div>
              <div style={{ flex: 1, minHeight: 320, display: 'flex' }}>
                <CodeArea value={script.content} onChange={(v) => set({ content: v }, `s:${script.id}:content`)} language="js" readOnly={readonly} minHeight={320} wrap={false} />
              </div>
              {!syntax.ok ? <div style={{ color: 'var(--err)', fontSize: 11, marginTop: 4 }}>语法错误：{syntax.error}</div> : null}
            </div>
          ) : null}

          {tab === 'analysis' && meta ? (
            <div className="pane-body pad">
              <div className="row wrap" style={{ gap: 8 }}>
                <div className="stat" style={{ minWidth: 100 }}><div className="k">行数</div><div className="v">{meta.lines}</div></div>
                <div className="stat" style={{ minWidth: 100 }}><div className="k">字符</div><div className="v">{meta.chars.toLocaleString()}</div></div>
                <div className="stat" style={{ minWidth: 100 }}><div className="k">按钮</div><div className="v">{meta.buttonCount}</div></div>
                <div className="stat" style={{ minWidth: 130 }}><div className="k">语法</div><div className="v" style={{ fontSize: 13, color: meta.syntax.ok ? 'var(--ok)' : 'var(--err)' }}>{meta.syntax.ok ? '通过' : '错误'}</div></div>
              </div>

              {!meta.syntax.ok ? <div className="panel mt10" style={{ borderColor: 'var(--err)' }}><div className="card-body" style={{ color: 'var(--err)', fontSize: 12 }}>{meta.syntax.error}</div></div> : null}
              {meta.syntax.ok && meta.syntax.note ? (
                <div className="panel mt10" style={{ borderColor: 'var(--warn)' }}>
                  <div className="card-body" style={{ fontSize: 11.5 }}>
                    <span className="badge warn" style={{ marginRight: 6 }}>检查说明</span>
                    {meta.syntax.note}
                  </div>
                </div>
              ) : null}

              <div className="mt10">
                <Labeled label="脚本信息 info">
                  <TextInput value={script.info || ''} onChange={(v) => set({ info: v }, `s:${script.id}:info`)} placeholder="给使用者看的说明" />
                </Labeled>
              </div>

              <div className="divider" />
              <div className="section-title">静态依赖与 API 使用</div>
              <KeyValue k="import 模块">{meta.imports.length ? meta.imports.join('，') : <span className="faint">无（未检测到 ES import）</span>}</KeyValue>
              <KeyValue k="importScripts">{meta.importScripts.length ? meta.importScripts.join('，') : <span className="faint">无</span>}</KeyValue>
              <KeyValue k="助手 API">
                {meta.apiCalls.length ? (
                  <span className="row wrap" style={{ gap: 3 }}>{meta.apiCalls.map((a) => <span className="chip on" key={a}>{a}</span>)}</span>
                ) : (
                  <span className="faint">未检测到已知助手 API 调用</span>
                )}
              </KeyValue>
              <KeyValue k="事件订阅">{meta.events.length ? meta.events.map((e) => <span className="chip" key={e} style={{ marginRight: 4 }}>{e}</span>) : <span className="faint">无</span>}</KeyValue>
              <KeyValue k="网络请求">{meta.hasFetch ? <span className="badge warn">含 fetch</span> : <span className="faint">无</span>}</KeyValue>
              <KeyValue k="动态执行">{/\beval\s*\(|new\s+Function\s*\(/.test(script.content) ? <span className="badge err">含 eval / new Function</span> : <span className="faint">无</span>}</KeyValue>
              <KeyValue k="本地存储">{meta.hasStorage ? <span className="badge warn">使用 localStorage / indexedDB</span> : <span className="faint">无</span>}</KeyValue>
              <KeyValue k="iframe 注入">{meta.hasIframe ? <span className="badge warn">包含 iframe</span> : <span className="faint">无</span>}</KeyValue>

              <div className="divider" />
              <div className="section-title">与其他脚本的关系（基于文本引用推断）</div>
              {scripts.filter((s) => s.id !== script.id && script.content.includes(s.name)).length === 0 ? (
                <div className="faint" style={{ fontSize: 11.5 }}>未发现对本卡片其他脚本名称的引用。脚本间的真实依赖只能在运行时确定，此处仅为启发式提示。</div>
              ) : (
                scripts
                  .filter((s) => s.id !== script.id && script.content.includes(s.name))
                  .map((s) => (
                    <div key={s.id} className="row" style={{ fontSize: 11.5 }}>
                      <span className="badge info">引用</span>
                      <span>{s.name}</span>
                    </div>
                  ))
              )}
            </div>
          ) : null}

          {tab === 'buttons' ? (
            <div className="pane-body pad">
              <Toggle
                checked={!!script.button?.enabled}
                onChange={(v) => set({ button: { ...(script.button || { buttons: [] }), enabled: v } })}
                label="启用快捷按钮 button.enabled"
              />
              <div className="divider" />
              <div className="section-title">按钮列表</div>
              {(script.button?.buttons || []).map((b, i) => (
                <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <input
                    className="input"
                    value={b.name}
                    placeholder="按钮名称"
                    onChange={(e) => {
                      const buttons = [...(script.button?.buttons || [])];
                      buttons[i] = { ...buttons[i], name: e.target.value };
                      set({ button: { ...(script.button || {}), buttons } }, `s:${script.id}:btn${i}`);
                    }}
                  />
                  <Toggle
                    checked={b.visible !== false}
                    onChange={(v) => {
                      const buttons = [...(script.button?.buttons || [])];
                      buttons[i] = { ...buttons[i], visible: v };
                      set({ button: { ...(script.button || {}), buttons } });
                    }}
                    label="可见"
                  />
                  <button
                    className="btn ghost sm icon"
                    onClick={() => {
                      const buttons = (script.button?.buttons || []).filter((_, j) => j !== i);
                      set({ button: { ...(script.button || {}), buttons } });
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="btn sm"
                onClick={() => set({ button: { ...(script.button || { enabled: true }), buttons: [...(script.button?.buttons || []), { name: '新按钮', visible: true }] } })}
              >
                + 添加按钮
              </button>
              <div className="faint mt10" style={{ fontSize: 11, lineHeight: 1.7 }}>
                按钮的实际行为由脚本内 <span className="code-inline">eventOn('mag_button_clicked', ...)</span> 之类的回调决定，编辑器只修改配置，不执行回调。
              </div>
            </div>
          ) : null}

          {tab === 'data' ? (
            <div className="pane-body pad">
              <div className="faint mb6" style={{ fontSize: 11.5 }}>script.data 与 script.export_with 是非标准扩展数据，结构因卡而异，因此以通用 JSON 编辑器提供。</div>
              <Labeled label="data（脚本附加数据）">
                <CodeArea value={formatJson(script.data ?? {})} onChange={(v) => { try { set({ data: JSON.parse(v) }, `s:${script.id}:data`); } catch { /* 无效 JSON 时不写入 */ } }} language="json" minHeight={140} />
              </Labeled>
              <Labeled label="export_with（导出附加数据）" hint="含义随实现而异，编辑器仅原样保留与展示">
                <CodeArea value={formatJson(script.export_with ?? {})} onChange={(v) => { try { set({ export_with: JSON.parse(v) }, `s:${script.id}:exp`); } catch { /* ignore */ } }} language="json" minHeight={120} />
              </Labeled>
            </div>
          ) : null}

          {tab === 'json' ? (
            <div className="pane-body pad">
              <div className="row mb6">
                <span className="faint" style={{ fontSize: 11 }}>脚本对象完整 JSON</span>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => copy(formatJson(script), '脚本 JSON')}>复制</button>
              </div>
              <CodeArea value={formatJson(script)} readOnly language="json" minHeight={420} wrap={false} />
            </div>
          ) : null}
        </div>
      </div>

      <Modal open={importOpen} title="导入脚本" onClose={() => setImportOpen(false)} width="narrow" footer={<button className="btn" onClick={() => setImportOpen(false)}>关闭</button>}>
        <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
          请使用顶部「导入」按钮选择脚本 JSON 文件（数组或 {'{scripts:[...]}'}）。导入的脚本会作为新的脚本集加入项目，不会覆盖当前脚本。
        </div>
        <button className="btn primary mt10" onClick={() => { setImportOpen(false); modals.set({ importOpen: true }); }}>打开导入面板</button>
      </Modal>
    </div>
  );
}
