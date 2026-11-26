import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './components/Modal';
import { useModals, useCopy, Empty } from './common';
import { useStore } from '../store/store';
import { importFile, importJsonText, type ImportResult } from '../core/importer';
import { buildCardJson, buildCardPng, buildMvuJson, buildRegexJson, buildScriptsJson, buildWorldbookJson, checkBeforeExport } from '../core/exporter';
import { downloadBlob, humanSize, safeFileName, bytesBlob } from '../core/util';
import type { CardVersion } from '../core/types';

/* ------------------------------------------------------------------ 导入 */

export function ImportModal() {
  const { importOpen, set } = useModals();
  const store = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText('');
    setError(null);
    setReport(null);
    setBusy(false);
  };

  const apply = (r: ImportResult) => {
    if (r.kind === 'card-json' || r.kind === 'card-png') {
      if (!r.card) throw new Error('导入结果缺少人物卡数据');
      store.openCard(r.card, r.fileName);
      store.toast('success', `已导入人物卡「${r.card.data.name || r.fileName}」`);
    } else if (r.kind === 'worldbook' && r.worldbook) {
      store.addWorldbook(r.worldbook);
      store.toast('success', `已导入世界书「${r.worldbook.name}」（${r.worldbook.entries.length} 条）`);
      store.setPage('worldbook');
    } else if (r.kind === 'regex' && r.regex) {
      store.addRegexPreset({ name: r.fileName.replace(/\.json$/i, ''), scripts: r.regex.scripts, root: r.regex.root, shape: r.regex.shape, origin: 'file' });
      store.toast('success', `已导入 ${r.regex.scripts.length} 条正则规则`);
      store.setPage('regex');
    } else if (r.kind === 'scripts' && r.scripts) {
      store.addScriptCollection({ scripts: r.scripts.scripts, root: r.scripts.root, shape: r.scripts.shape, origin: 'file' });
      store.toast('success', `已导入 ${r.scripts.scripts.length} 个脚本`);
      store.setPage('scripts');
    }
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const r = await importFile(file);
      if (r.error) {
        setError(r.error);
        setReport(r);
        return;
      }
      setReport(r);
      apply(r);
      set({ importOpen: false });
      reset();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleText = () => {
    setError(null);
    try {
      const r = importJsonText(text, 'pasted.json');
      setReport(r);
      apply(r);
      set({ importOpen: false });
      reset();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  return (
    <Modal
      open={importOpen}
      title="导入文件"
      onClose={() => {
        set({ importOpen: false });
        reset();
      }}
      footer={
        <>
          <button className="btn ghost" onClick={() => { set({ importOpen: false }); reset(); }}>取消</button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={handleText}>从文本导入</button>
        </>
      }
    >
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 6 }}>⤒</div>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{busy ? '正在解析…' : '拖入文件，或点击选择'}</div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
          支持：人物卡 JSON / PNG、世界书 JSON、正则 JSON、酒馆助手脚本 JSON。自动识别类型。
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".json,.png,.charx,application/json,image/png"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = '';
          }}
        />
      </div>

      <div className="row mt16" style={{ gap: 8 }}>
        <div className="hdivider grow" style={{ height: 1, background: 'var(--border)' }} />
        <span className="faint" style={{ fontSize: 11 }}>或粘贴 JSON</span>
        <div className="grow" style={{ height: 1, background: 'var(--border)' }} />
      </div>

      <textarea
        className="textarea mono mt10"
        rows={7}
        placeholder='{"spec":"chara_card_v2", "data": { ... }}  /  {"entries": { ... }}  /  [{"findRegex": ...}]'
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />

      {error ? (
        <div className="panel mt10" style={{ borderColor: 'var(--err)', background: 'var(--err-soft)' }}>
          <div className="card-body" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text)' }}>{error}</div>
        </div>
      ) : null}

      {report?.warnings?.length ? (
        <div className="panel mt10">
          <div className="card-body">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>导入说明</div>
            {report.warnings.map((w, i) => (
              <div key={i} className="faint" style={{ fontSize: 11.5 }}>· {w}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="faint mt10" style={{ fontSize: 11 }}>
        导入不会上传任何内容；所有解析在本地完成。PNG 会读取 tEXt/zTXt/iTXt 中的 chara / ccv3 元数据块，不是识别图片内容。
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 导出 */

type ExportKind = 'card-json' | 'card-png' | 'worldbook' | 'regex' | 'scripts' | 'mvu';

export function ExportModal() {
  const { exportOpen, set } = useModals();
  const { doc, toast, settings } = useStore();
  const [kind, setKind] = useState<ExportKind>('card-json');
  const [version, setVersion] = useState<CardVersion>(doc.card?.version || 'v3');
  const [wbName, setWbName] = useState(doc.worldbooks[0]?.name || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (exportOpen) {
      setVersion(doc.card?.version || 'v3');
      setWbName(doc.worldbooks[0]?.name || '');
    }
  }, [exportOpen, doc.card, doc.worldbooks]);

  const check = useMemo(() => {
    if (kind === 'card-json' || kind === 'card-png') return checkBeforeExport(doc.card, version, doc.issues);
    return null;
  }, [kind, version, doc.card, doc.issues]);

  const doExport = async () => {
    setBusy(true);
    try {
      if (kind === 'card-json') {
        if (!doc.card) throw new Error('当前项目没有人物卡');
        const art = buildCardJson(doc.card, version);
        downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        toast('success', `已导出 ${art.filename}（${humanSize(art.bytes.length)}）`);
      } else if (kind === 'card-png') {
        if (!doc.card) throw new Error('当前项目没有人物卡');
        const art = await buildCardPng(doc.card, version);
        downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        toast('success', `已导出 ${art.filename}（${humanSize(art.bytes.length)}）`);
      } else if (kind === 'worldbook') {
        const wb = doc.worldbooks.find((w) => w.name === wbName);
        if (!wb) throw new Error('请选择要导出的世界书');
        const art = buildWorldbookJson(wb);
        downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        toast('success', `已导出 ${art.filename}`);
      } else if (kind === 'regex') {
        for (const p of doc.regexes) {
          const art = buildRegexJson(p);
          downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        }
        toast('success', `已导出 ${doc.regexes.length} 个正则集`);
      } else if (kind === 'scripts') {
        for (const c of doc.scripts) {
          const art = buildScriptsJson(c);
          downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        }
        toast('success', `已导出 ${doc.scripts.length} 个脚本集`);
      } else if (kind === 'mvu') {
        if (!doc.mvu) throw new Error('尚未构建 MVU 分析');
        const art = buildMvuJson(doc.mvu);
        downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
        toast('success', `已导出 ${art.filename}`);
      }
    } catch (e: any) {
      toast('error', `导出失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const kinds: { value: ExportKind; label: string; desc: string }[] = [
    { value: 'card-json', label: '人物卡 JSON', desc: '按所选版本输出 spec 结构，保留未知字段' },
    { value: 'card-png', label: '人物卡 PNG', desc: '写入 chara / ccv3 元数据块，保留原图其他块' },
    { value: 'worldbook', label: '世界书 JSON', desc: '输出 SillyTavern 可直接导入的 entries 对象' },
    { value: 'regex', label: '正则规则', desc: '导出全部正则集' },
    { value: 'scripts', label: '酒馆助手脚本', desc: '导出全部脚本与按钮配置' },
    { value: 'mvu', label: 'MVU 快照', desc: '变量 / Schema / 楼层，供分析用' },
  ];

  return (
    <Modal
      open={exportOpen}
      title="导出"
      width="wide"
      onClose={() => set({ exportOpen: false })}
      footer={
        <>
          <button className="btn ghost" onClick={() => set({ exportOpen: false })}>取消</button>
          <button className="btn primary" onClick={doExport} disabled={busy}>
            {busy ? '正在生成…' : '导出并下载'}
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'stretch', gap: 14 }}>
        <div style={{ width: 250, flexShrink: 0 }}>
          {kinds.map((k) => (
            <div
              key={k.value}
              className={`list-row ${kind === k.value ? 'active' : ''}`}
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '7px 10px' }}
              onClick={() => setKind(k.value)}
            >
              <span className="title">{k.label}</span>
              <span className="meta" style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>{k.desc}</span>
            </div>
          ))}
        </div>

        <div className="grow">
          {kind === 'card-json' || kind === 'card-png' ? (
            <>
              <div className="row wrap" style={{ gap: 12 }}>
                <div className="field" style={{ width: 180 }}>
                  <label>目标版本</label>
                  <select className="select" value={version} onChange={(e) => setVersion(e.target.value as CardVersion)}>
                    <option value="v1">V1（平面结构）</option>
                    <option value="v2">V2（chara_card_v2）</option>
                    <option value="v3">V3（chara_card_v3）</option>
                  </select>
                </div>
                <div className="grow">
                  <div className="label">导出文件名</div>
                  <div className="mono" style={{ paddingTop: 4 }}>{safeFileName(doc.card?.data.name || 'character')}.{kind === 'card-png' ? 'png' : 'json'}</div>
                </div>
              </div>

              {check ? (
                <div className="mt10">
                  {check.blocking.length ? (
                    <div className="panel" style={{ borderColor: 'var(--err)' }}>
                      <div className="card-body">
                        <div style={{ color: 'var(--err)', fontWeight: 600, marginBottom: 4 }}>阻断性问题（{check.blocking.length}）</div>
                        {check.blocking.slice(0, 8).map((b, i) => (
                          <div key={i} style={{ fontSize: 11.5, marginBottom: 2 }}>· {b}</div>
                        ))}
                        {check.blocking.length > 8 ? <div className="faint" style={{ fontSize: 11 }}>…还有 {check.blocking.length - 8} 条</div> : null}
                        <div className="faint mt6" style={{ fontSize: 11 }}>仍然可以导出，但请确认这不是误操作。</div>
                      </div>
                    </div>
                  ) : (
                    <div className="panel" style={{ borderColor: 'var(--ok)' }}>
                      <div className="card-body" style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--ok)', fontWeight: 600 }}>未发现阻断性问题</span>
                        <span className="faint">（校验结果 {doc.issues.length} 条，其中错误 0 条）</span>
                      </div>
                    </div>
                  )}

                  {check.warnings.length ? (
                    <div className="panel mt10">
                      <div className="card-body">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>需要知晓的变化（{check.warnings.length}）</div>
                        {check.warnings.slice(0, 10).map((w, i) => (
                          <div key={i} className="faint" style={{ fontSize: 11.5, marginBottom: 2 }}>· {w}</div>
                        ))}
                        {check.warnings.length > 10 ? <div className="faint" style={{ fontSize: 11 }}>…还有 {check.warnings.length - 10} 条</div> : null}
                      </div>
                    </div>
                  ) : null}

                  {check.infos.length ? (
                    <div className="mt6">
                      {check.infos.map((t, i) => (
                        <div key={i} className="faint" style={{ fontSize: 11 }}>· {t}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {kind === 'worldbook' ? (
            <>
              <div className="field">
                <label>选择世界书</label>
                <select className="select" value={wbName} onChange={(e) => setWbName(e.target.value)}>
                  {doc.worldbooks.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}（{w.entries.length} 条{w.embeddedInCard ? ' · 内嵌' : ''}）
                    </option>
                  ))}
                </select>
              </div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                导出格式与 SillyTavern 世界书文件一致：<span className="code-inline">{'{"entries":{"0":{...}}}'}</span>，可直接在酒馆「世界书 → 导入」中使用。
                编辑期的 displayIndex 不会写入文件。
              </div>
            </>
          ) : null}

          {kind === 'regex' ? (
            <div className="faint" style={{ fontSize: 11.5 }}>
              共 {doc.regexes.length} 个正则集、{doc.regexes.reduce((n, p) => n + p.scripts.length, 0)} 条规则。导出为数组（SillyTavern 正则扩展可导入的格式）。
              若卡片中的规则来自 <span className="code-inline">extensions.regex</span>，导出后也可粘贴回该字段。
            </div>
          ) : null}

          {kind === 'scripts' ? (
            <div className="faint" style={{ fontSize: 11.5 }}>
              共 {doc.scripts.length} 个脚本集、{doc.scripts.reduce((n, c) => n + c.scripts.length, 0)} 个脚本。
              导出仅包含脚本文本与 button/data 配置；脚本依赖的远端模块需目标环境可访问。
            </div>
          ) : null}

          {kind === 'mvu' ? (
            <div className="faint" style={{ fontSize: 11.5 }}>
              包含变量树、静态推断的 Schema 字段、楼层快照与识别证据。此文件是分析快照，不是 MVU 运行格式。
            </div>
          ) : null}

          <div className="divider" />
          <div className="faint" style={{ fontSize: 11 }}>
            导出在本地生成文件，不会发起任何上传。PNG 导出会保留原图中除 chara / ccv3 之外的所有块（字节级复制）。
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 搜索 */

interface Hit {
  group: string;
  title: string;
  sub?: string;
  page: string;
  action?: () => void;
}

export function SearchModal() {
  const searchOpen = useStore((st) => st.searchOpen);
  const setUi = useStore((st) => st.setUi);
  const { doc, setPage, select, toast } = useStore();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const copy = useCopy();

  useEffect(() => {
    if (searchOpen) {
      setQ('');
      setCursor(0);
    }
  }, [searchOpen]);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: Hit[] = [];
    const pushIf = (text: string, hit: Hit) => {
      if (text && text.toLowerCase().includes(query)) out.push(hit);
    };

    if (doc.card) {
      const d = doc.card.data;
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'string') {
          pushIf(k, { group: '人物卡字段', title: k, sub: `${v.slice(0, 90)}`, page: 'character' });
          pushIf(v.slice(0, 4000), { group: '人物卡内容', title: `字段 ${k}`, sub: v.slice(Math.max(0, v.toLowerCase().indexOf(query) - 20), v.toLowerCase().indexOf(query) + 80), page: 'character' });
        }
      }
      if (out.length > 40) return out.slice(0, 40);
    }

    for (const wb of doc.worldbooks) {
      for (const e of wb.entries) {
        if (out.length > 120) break;
        const keys = (e.key || []).join(', ');
        const hay = `${e.comment}\n${keys}\n${e.content ?? ''}`.toLowerCase();
        if (hay.includes(query)) {
          const idx = (e.content || '').toLowerCase().indexOf(query);
          out.push({
            group: `世界书 · ${wb.name}`,
            title: `#${e.uid} ${e.comment || '(无备注)'}`,
            sub: idx >= 0 ? (e.content ?? '').slice(Math.max(0, idx - 25), idx + 70).replace(/\n/g, ' ') : keys,
            page: 'worldbook',
            action: () => select({ selectedWorldbook: wb.name, selectedEntryUid: e.uid }),
          });
        }
      }
    }

    for (const p of doc.regexes) {
      for (const s of p.scripts) {
        if (out.length > 160) break;
        if (`${s.scriptName}\n${s.findRegex}\n${s.replaceString}`.toLowerCase().includes(query)) {
          out.push({
            group: '正则规则',
            title: s.scriptName,
            sub: s.findRegex,
            page: 'regex',
            action: () => select({ selectedRegexId: s.id }),
          });
        }
      }
    }

    for (const c of doc.scripts) {
      for (const s of c.scripts) {
        if (out.length > 200) break;
        if (`${s.name}\n${s.content}`.toLowerCase().includes(query)) {
          out.push({
            group: '酒馆助手脚本',
            title: s.name,
            sub: `${s.content.length} 字符`,
            page: 'scripts',
            action: () => select({ selectedScriptId: s.id }),
          });
        }
      }
    }

    if (doc.mvu) {
      const walk = (v: any, path: string) => {
        if (out.length > 240) return;
        if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
        } else if (String(v).toLowerCase().includes(query) || path.toLowerCase().includes(query)) {
          out.push({ group: 'MVU 变量', title: path, sub: String(v), page: 'mvu' });
        }
      };
      walk(doc.mvu.statData, '');
    }

    return out.slice(0, 240);
  }, [q, doc, select]);

  const go = (h: Hit) => {
    h.action?.();
    setPage(h.page as any);
    setUi({ searchOpen: false });
  };

  return (
    <Modal open={searchOpen} title={<div className="row"><span>全局搜索</span><span className="kbd">Esc 关闭</span></div>} onClose={() => setUi({ searchOpen: false })} width="wide">
      <input
        autoFocus
        className="input"
        placeholder="搜索人物卡字段、世界书条目（备注/关键词/正文）、正则、脚本、MVU 变量…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(hits.length - 1, c + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === 'Enter' && hits[cursor]) {
            go(hits[cursor]);
          }
        }}
      />
      <div className="mt10" style={{ maxHeight: '52vh', overflow: 'auto' }}>
        {!q.trim() ? (
          <div className="faint pad10" style={{ fontSize: 11.5 }}>
            提示：世界书搜索在「世界书」页面使用 Worker 索引，可对 5 万条目即时检索；此处为全项目快捷跳转。
          </div>
        ) : hits.length === 0 ? (
          <div className="faint pad10">没有匹配结果。</div>
        ) : (
          hits.map((h, i) => (
            <div key={i} className={`list-row ${i === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => go(h)}>
              <span className="badge outline" style={{ flexShrink: 0 }}>{h.group}</span>
              <span className="title ellipsis" style={{ maxWidth: 260 }}>{h.title}</span>
              <span className="meta ellipsis grow">{h.sub}</span>
            </div>
          ))
        )}
      </div>
      <div className="row mt10 faint" style={{ fontSize: 11 }}>
        <span>共 {hits.length} 条</span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => copy(q, '搜索词')}>复制搜索词</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Toast */

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)} style={{ cursor: 'pointer' }}>
          <span style={{ flexShrink: 0 }}>{t.kind === 'success' ? '✓' : t.kind === 'error' ? '✕' : t.kind === 'warn' ? '!' : 'ⓘ'}</span>
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
