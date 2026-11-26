import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { useModals, Stat, Empty, useCopy } from '../common';
import { docStats } from '../../core/stats';
import { humanSize, formatJson } from '../../core/util';
import { roundTripCard, roundTripPng, type RoundTripReport } from '../../core/roundtrip';
import { FLAVOR_LABELS } from '../../core/mvu';
import { idbGet, storageKeys } from '../../core/idb';
import type { ProjectMeta } from '../../core/types';
import { summarizeIssues } from '../../core/validate';

export default function HomePage() {
  const { doc, history, setPage, loadSample, createBlankProject, openProject, settings } = useStore();
  const modals = useModals();
  const copy = useCopy();
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  const [rt, setRt] = useState<(RoundTripReport & { title: string; pngOk?: boolean }) | null>(null);
  const [rtBusy, setRtBusy] = useState(false);

  useEffect(() => {
    idbGet<ProjectMeta[]>(storageKeys.projectIndex).then((list) => setRecent(list || []));
  }, [doc.meta.id]);

  const stats = docStats(doc, history.length);
  const issues = useMemo(() => summarizeIssues(doc.issues), [doc.issues]);

  const runJson = (v: 'v2' | 'v3' | 'v1') => {
    if (!doc.card) return;
    setRtBusy(true);
    try {
      const r = roundTripCard(doc.card, v);
      setRt({ ...r, title: `JSON 往返 · ${v.toUpperCase()}` });
    } catch (e: any) {
      setRt({ target: v, ok: false, steps: [`失败：${e?.message || e}`], diffs: [], warnings: [], jsonBytes: 0, elapsedMs: 0, title: 'JSON 往返' });
    } finally {
      setRtBusy(false);
    }
  };

  const runPng = async (v: 'v2' | 'v3') => {
    if (!doc.card) return;
    setRtBusy(true);
    try {
      const r = await roundTripPng(doc.card, v);
      setRt({ ...r, title: `PNG 往返 · ${v.toUpperCase()}` });
    } catch (e: any) {
      setRt({ target: v, ok: false, steps: [`失败：${e?.message || e}`], diffs: [], warnings: [], jsonBytes: 0, elapsedMs: 0, title: 'PNG 往返' });
    } finally {
      setRtBusy(false);
    }
  };

  if (!doc.card) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>项目首页</h1>
          <span className="sub">当前项目还没有人物卡</span>
        </div>
        <div className="pane-body pad">
          <Empty
            icon="◇"
            title="从一张人物卡开始"
            desc="导入 SillyTavern 人物卡（JSON / PNG），或加载内置示例项目，体验完整的世界书、正则、脚本与 MVU 编辑流程。"
          >
            <div className="row">
              <button className="btn primary" onClick={() => modals.set({ importOpen: true })}>导入人物卡</button>
              <button className="btn" onClick={() => loadSample()}>加载示例项目</button>
              <button className="btn" onClick={() => createBlankProject()}>新建空白卡</button>
            </div>
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>项目首页</h1>
        <span className="badge info">{(doc.card.version || '').toUpperCase()}</span>
        <span className="sub ellipsis" style={{ maxWidth: 360 }}>{doc.meta.name}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => modals.set({ importOpen: true })}>导入</button>
        <button className="btn sm primary" onClick={() => modals.set({ exportOpen: true })}>导出</button>
      </div>

      <div className="scroll" style={{ flex: 1 }}>
        <div className="hero">
          <div>
            <h2>
              <span className="grad">CardForge</span> · 把人物卡当成工程来编辑
            </h2>
            <p>
              完整解析 Character Card V1/V2/V3 与 PNG 元数据，世界书、正则、酒馆助手脚本、MVU 变量在同一处管理。
              所有编辑都在本地完成，未知字段一律保留，导出前会告诉你哪些转换会丢信息。
            </p>
            <div className="stat-grid">
              <Stat k="世界书条目" v={stats.entryCount.toLocaleString()} unit="条" />
              <Stat k="世界书正文" v={humanSize(stats.entryChars)} />
              <Stat k="正则规则" v={stats.regexCount} unit="条" />
              <Stat k="脚本" v={stats.scriptCount} unit="个" />
              <Stat k="MVU" v={doc.mvu ? FLAVOR_LABELS[doc.mvu.flavor] : '未检测'} />
              <Stat k="校验" v={`${issues.error}/${issues.warning}`} unit="错误/警告" />
            </div>

            <div className="mt16">
              <div className="section-title">快速进入</div>
              <div className="feature-grid">
                <div className="feature" onClick={() => setPage('character')}>
                  <div className="ft">▤ 人物卡编辑 <span className="badge outline">{(doc.card.data.name || '').slice(0, 8)}</span></div>
                  <div className="fd">基础字段、替代开场白、扩展字段与未知字段 JSON 编辑，字段级写入。</div>
                </div>
                <div className="feature" onClick={() => setPage('worldbook')}>
                  <div className="ft">▦ 世界书 <span className="badge outline">{doc.worldbooks.length} 本</span></div>
                  <div className="fd">虚拟列表浏览数万条目，批量编辑、包含组、触发模拟与关键词索引。</div>
                </div>
                <div className="feature" onClick={() => setPage('regex')}>
                  <div className="ft">⌗ 正则规则</div>
                  <div className="fd">Worker 隔离测试、捕获组、替换预览、灾难性回溯风险提示。</div>
                </div>
                <div className="feature" onClick={() => setPage('scripts')}>
                  <div className="ft">⧉ 酒馆助手脚本</div>
                  <div className="fd">JavaScript 编辑、语法检查、按钮配置、静态依赖分析（不执行）。</div>
                </div>
                <div className="feature" onClick={() => setPage('mvu')}>
                  <div className="ft">◈ MVU 变量</div>
                  <div className="fd">树/表/JSON/差异/历史视图，Zod 静态推断，JSON Patch 模拟。</div>
                </div>
                <div className="feature" onClick={() => setPage('preview')}>
                  <div className="ft">▷ 前端预览</div>
                  <div className="fd">桌面 / 移动端预览，正则渲染、MVU 状态栏、沙箱 iframe。</div>
                </div>
              </div>
            </div>
          </div>

          <div className="col" style={{ gap: 10 }}>
            <div className="card">
              <div className="card-head">项目概览 <span className="spacer" /><span className="faint" style={{ fontSize: 11 }}>{doc.meta.id.slice(0, 8)}</span></div>
              <div className="card-body">
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  {doc.card.image ? (
                    <img src={doc.card.image.dataUrl} alt="card" style={{ width: 84, height: 118, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ width: 84, height: 118, borderRadius: 8, border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 10 }}>
                      无图片
                    </div>
                  )}
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{doc.card.data.name}</div>
                    <div className="faint" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      {doc.card.data.creator || '未署名'} · v{doc.card.data.character_version || '—'}
                    </div>
                    <div className="row wrap" style={{ gap: 3 }}>
                      {(doc.card.data.tags || []).slice(0, 8).map((t: string) => (
                        <span className="badge outline" key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="faint mt6" style={{ fontSize: 11 }}>
                      正文 {stats.cardChars.toLocaleString()} 字符 ≈ {stats.cardTokens.toLocaleString()} tok
                    </div>
                  </div>
                </div>

                <div className="divider" />
                <div className="col" style={{ gap: 5 }}>
                  <div className="row" style={{ fontSize: 11.5 }}>
                    <span className="faint" style={{ width: 92 }}>来源文件</span>
                    <span className="ellipsis grow">{doc.meta.sourceFileName || '（新建）'}</span>
                  </div>
                  <div className="row" style={{ fontSize: 11.5 }}>
                    <span className="faint" style={{ width: 92 }}>内嵌世界书</span>
                    <span className="grow">
                      {doc.card.data.character_book?.entries?.length ? `${doc.card.data.character_book.entries.length} 条 · ${doc.card.data.character_book.name || '未命名'}` : '无'}
                    </span>
                  </div>
                  <div className="row" style={{ fontSize: 11.5 }}>
                    <span className="faint" style={{ width: 92 }}>世界书同步</span>
                    <span className="grow">
                      {doc.worldbooks.some((w) => w.embeddedInCard) ? (
                        <span className="badge warn">存在内嵌副本，改动后需点「同步到人物卡」</span>
                      ) : (
                        <span className="badge ok">无内嵌副本冲突</span>
                      )}
                    </span>
                  </div>
                  <div className="row" style={{ fontSize: 11.5 }}>
                    <span className="faint" style={{ width: 92 }}>保存状态</span>
                    <span className="grow">{settings.autosave ? `自动保存（${settings.autosaveMs}ms 防抖）` : '仅手动保存'}</span>
                  </div>
                </div>

                <div className="row wrap mt10" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setPage('worldbook')}>世界书</button>
                  <button className="btn sm" onClick={() => setPage('validation')}>校验报告</button>
                  <button className="btn sm" onClick={() => setPage('history')}>历史（{history.length}）</button>
                  <button className="btn sm ghost" onClick={() => copy(formatJson(doc.card!.root), '完整人物卡 JSON')}>复制卡片 JSON</button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">无损往返测试</div>
              <div className="card-body">
                <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                  执行「序列化 → 重新解析 → 结构比较」，验证规范字段、未知字段、扩展字段是否全部保留。
                </div>
                <div className="row wrap mt10" style={{ gap: 6 }}>
                  <button className="btn sm" disabled={rtBusy} onClick={() => runJson('v3')}>JSON V3</button>
                  <button className="btn sm" disabled={rtBusy} onClick={() => runJson('v2')}>JSON V2</button>
                  <button className="btn sm" disabled={rtBusy} onClick={() => runJson('v1')}>JSON V1</button>
                  <button className="btn sm" disabled={rtBusy} onClick={() => runPng('v3')}>PNG V3</button>
                  <button className="btn sm" disabled={rtBusy} onClick={() => runPng('v2')}>PNG V2</button>
                </div>

                {rt ? (
                  <div className="mt10">
                    <div className="row">
                      <span className={`badge ${rt.ok ? 'ok' : 'err'}`}>{rt.ok ? '无损通过' : '存在差异'}</span>
                      <span style={{ fontWeight: 600 }}>{rt.title}</span>
                      <span className="spacer" />
                      <span className="faint" style={{ fontSize: 11 }}>{rt.elapsedMs.toFixed(1)}ms</span>
                    </div>
                    {rt.steps.map((s, i) => (
                      <div key={i} className="faint" style={{ fontSize: 11, paddingLeft: 4 }}>· {s}</div>
                    ))}
                    {rt.diffs.length ? (
                      <div className="mt6">
                        {rt.diffs.slice(0, 6).map((d, i) => (
                          <div key={i} style={{ fontSize: 11 }}>
                            <span className="badge warn">{d.kind}</span> <span className="mono">{d.path}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {rt.warnings.length ? (
                      <div className="mt6 faint" style={{ fontSize: 11 }}>
                        {rt.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-head">最近项目 <span className="spacer" /><span className="faint" style={{ fontSize: 11 }}>IndexedDB</span></div>
              <div className="card-body" style={{ padding: 6 }}>
                {recent.length === 0 ? (
                  <div className="faint pad10" style={{ fontSize: 11.5 }}>暂无历史项目。保存一次后会出现。</div>
                ) : (
                  recent.slice(0, 6).map((m) => (
                    <div key={m.id} className={`list-row ${m.id === doc.meta.id ? 'active' : ''}`} onClick={() => openProject(m.id)}>
                      <span className="ellipsis grow">{m.name}</span>
                      <span className="meta">{new Date(m.updatedAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">能力与边界（先看这里）</div>
              <div className="card-body faint" style={{ fontSize: 11.5, lineHeight: 1.8 }}>
                · <b>已实现</b>：V1/V2/V3 读写、PNG tEXt/zTXt/iTXt 元数据读写、世界书完整字段与触发模拟、正则隔离测试、脚本静态检查、MVU 变量多视图与 JSON Patch。
                <br />· <b>近似实现</b>：包含组竞争权重、递归轮次、token 预算截断、概率随机源（可设种子复现）。
                <br />· <b>不实现</b>：向量化语义召回、MVU 运行时真实执行、CHARX ZIP 解包、任意脚本执行。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
