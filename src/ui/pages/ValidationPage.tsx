import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, LevelBadge, Stat, useCopy } from '../common';
import { summarizeIssues } from '../../core/validate';
import { checkBeforeExport } from '../../core/exporter';
import { roundTripCard, roundTripPng, type RoundTripReport } from '../../core/roundtrip';
import { downloadBlob, formatJson, nowIso } from '../../core/util';
import type { CardVersion, ValidationIssue } from '../../core/types';

export default function ValidationPage() {
  const { doc, runValidation, setPage, select, toast } = useStore();
  const [level, setLevel] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [scope, setScope] = useState<'all' | ValidationIssue['scope']>('all');
  const [rt, setRt] = useState<(RoundTripReport & { title: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkVersion, setCheckVersion] = useState<CardVersion>(doc.card?.version || 'v3');
  const copy = useCopy();

  const counts = summarizeIssues(doc.issues);
  const filtered = useMemo(
    () =>
      doc.issues.filter((i) => (level === 'all' || i.level === level) && (scope === 'all' || i.scope === scope)),
    [doc.issues, level, scope],
  );
  const check = useMemo(() => checkBeforeExport(doc.card, checkVersion, doc.issues), [doc.card, checkVersion, doc.issues]);

  const jump = (i: ValidationIssue) => {
    if (i.scope === 'card') setPage('character');
    else if (i.scope === 'worldbook' || i.scope === 'image') {
      const m = String(i.path).match(/^(.*) #(\d+)$/);
      if (m) select({ selectedWorldbook: m[1], selectedEntryUid: Number(m[2]) });
      setPage('worldbook');
    } else if (i.scope === 'regex') setPage('regex');
    else if (i.scope === 'scripts') setPage('scripts');
    else setPage('mvu');
  };

  const runRt = async (kind: 'json' | 'png', v: CardVersion) => {
    if (!doc.card) return;
    setBusy(true);
    try {
      const r = kind === 'json' ? roundTripCard(doc.card, v) : await roundTripPng(doc.card, v);
      setRt({ ...r, title: `${kind === 'json' ? 'JSON' : 'PNG'} 往返 · ${v.toUpperCase()}` });
    } catch (e: any) {
      toast('error', `测试失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const exportReport = () => {
    const report = {
      generatedAt: nowIso(),
      project: doc.meta,
      cardVersion: doc.card?.version,
      summary: counts,
      issues: doc.issues,
      exportCheck: check,
      roundTrip: rt,
      stats: {
        worldbooks: doc.worldbooks.map((w) => ({ name: w.name, entries: w.entries.length, embedded: !!w.embeddedInCard })),
        regex: doc.regexes.reduce((n, p) => n + p.scripts.length, 0),
        scripts: doc.scripts.reduce((n, c) => n + c.scripts.length, 0),
        mvuFlavor: doc.mvu?.flavor,
      },
    };
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'cardforge-validation-report.json');
    toast('success', '已导出校验报告');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>数据校验</h1>
        <span className="sub">规范字段、UID、引用、正则、脚本语法、MVU Schema</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { const n = runValidation(); toast('info', `校验完成：${n.length} 条结果`); }}>重新校验</button>
        <button className="btn sm" onClick={exportReport}>导出报告</button>
      </div>

      <div className="scroll" style={{ flex: 1 }}>
        <div className="pane-body pad">
          <div className="stat-grid">
            <Stat k="错误" v={counts.error} />
            <Stat k="警告" v={counts.warning} />
            <Stat k="提示" v={counts.info} />
            <Stat k="检查项" v={doc.issues.length} />
          </div>

          <div className="row wrap mt10" style={{ gap: 6 }}>
            {(['all', 'error', 'warning', 'info'] as const).map((l) => (
              <button key={l} className={`btn sm ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
                {l === 'all' ? '全部级别' : l === 'error' ? '错误' : l === 'warning' ? '警告' : '提示'}
              </button>
            ))}
            <span className="vdivider" />
            {(['all', 'card', 'worldbook', 'regex', 'scripts', 'mvu', 'image'] as const).map((s) => (
              <button key={s} className={`btn sm ${scope === s ? 'active' : ''}`} onClick={() => setScope(s)}>
                {s === 'all' ? '全部范围' : s === 'card' ? '人物卡' : s === 'worldbook' ? '世界书' : s === 'regex' ? '正则' : s === 'scripts' ? '脚本' : s === 'mvu' ? 'MVU' : '图片'}
              </button>
            ))}
          </div>

          <div className="panel mt10">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>级别</th>
                  <th style={{ width: 80 }}>范围</th>
                  <th>说明</th>
                  <th style={{ width: 280 }}>位置</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i, idx) => (
                  <tr key={idx}>
                    <td><LevelBadge level={i.level} /></td>
                    <td className="faint">{i.scope}</td>
                    <td>
                      <div>{i.message}</div>
                      {i.hint ? <div className="faint" style={{ fontSize: 10.5 }}>{i.hint}</div> : null}
                    </td>
                    <td className="mono faint" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{i.path || '—'}</td>
                    <td><button className="btn ghost sm" onClick={() => jump(i)}>定位</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <div className="faint pad10">没有符合筛选条件的检查结果。</div> : null}
          </div>

          <div className="row mt16" style={{ alignItems: 'flex-start', gap: 14 }}>
            <div className="card grow">
              <div className="card-head">导出前检查</div>
              <div className="card-body">
                <div className="row" style={{ gap: 6 }}>
                  <select className="select" style={{ width: 130 }} value={checkVersion} onChange={(e) => setCheckVersion(e.target.value as CardVersion)}>
                    <option value="v1">V1</option>
                    <option value="v2">V2</option>
                    <option value="v3">V3</option>
                  </select>
                  <span className={`badge ${check.blocking.length ? 'err' : 'ok'}`}>{check.blocking.length ? `${check.blocking.length} 个阻断问题` : '可导出'}</span>
                  <span className="badge warn">{check.warnings.length} 个警告</span>
                </div>
                <div className="mt10" style={{ maxHeight: 200, overflow: 'auto' }}>
                  {check.blocking.map((b, i) => <div key={i} style={{ color: 'var(--err)', fontSize: 11.5 }}>✕ {b}</div>)}
                  {check.warnings.map((b, i) => <div key={i} className="faint" style={{ fontSize: 11.5 }}>△ {b}</div>)}
                  {check.infos.map((b, i) => <div key={i} className="faint" style={{ fontSize: 11 }}>ⓘ {b}</div>)}
                  {!check.blocking.length && !check.warnings.length && !check.infos.length ? <div className="faint" style={{ fontSize: 11.5 }}>没有需要提示的转换风险。</div> : null}
                </div>
              </div>
            </div>

            <div className="card grow">
              <div className="card-head">无损往返测试</div>
              <div className="card-body">
                <div className="row wrap" style={{ gap: 6 }}>
                  <button className="btn sm" disabled={busy} onClick={() => runRt('json', 'v3')}>JSON V3</button>
                  <button className="btn sm" disabled={busy} onClick={() => runRt('json', 'v2')}>JSON V2</button>
                  <button className="btn sm" disabled={busy} onClick={() => runRt('json', 'v1')}>JSON V1</button>
                  <button className="btn sm" disabled={busy} onClick={() => runRt('png', 'v3')}>PNG V3</button>
                  <button className="btn sm" disabled={busy} onClick={() => runRt('png', 'v2')}>PNG V2</button>
                </div>
                {rt ? (
                  <div className="mt10">
                    <div className="row">
                      <span className={`badge ${rt.ok ? 'ok' : 'err'}`}>{rt.ok ? '无损' : '有差异'}</span>
                      <span style={{ fontWeight: 600 }}>{rt.title}</span>
                      <span className="spacer" />
                      <span className="faint" style={{ fontSize: 11 }}>{rt.elapsedMs.toFixed(1)}ms</span>
                    </div>
                    {rt.steps.map((s, i) => <div key={i} className="faint" style={{ fontSize: 11 }}>· {s}</div>)}
                    {rt.diffs.length ? (
                      <div className="mt6">
                        <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>{rt.diffs.length} 处差异（前 8 条）：</div>
                        {rt.diffs.slice(0, 8).map((d, i) => (
                          <div key={i} className="mono" style={{ fontSize: 10.5 }}>{d.kind} {d.path}</div>
                        ))}
                      </div>
                    ) : null}
                    {rt.warnings.map((w, i) => <div key={i} className="faint" style={{ fontSize: 10.5 }}>· {w}</div>)}
                    <button className="btn ghost sm mt6" onClick={() => copy(formatJson(rt), '测试报告')}>复制报告</button>
                  </div>
                ) : (
                  <div className="faint mt10" style={{ fontSize: 11.5 }}>运行一次往返测试，确认未知字段、扩展字段与图片元数据在导出后不丢失。</div>
                )}
              </div>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">数据完整性快照</div>
            <div className="card-body">
              <div className="row wrap" style={{ gap: 10 }}>
                <div className="badge outline">规范字段 {doc.card ? Object.keys(doc.card.data).length : 0} 个</div>
                <div className="badge outline">未知字段保留 {doc.card ? Object.keys(doc.card.data).filter((k) => !['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings', 'character_book', 'tags', 'creator', 'character_version', 'extensions', 'nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date', 'assets'].includes(k)).length : 0} 个</div>
                <div className="badge outline">世界书 {doc.worldbooks.length} 本 / {doc.worldbooks.reduce((n, w) => n + w.entries.length, 0)} 条</div>
                <div className="badge outline">正则 {doc.regexes.reduce((n, p) => n + p.scripts.length, 0)} 条</div>
                <div className="badge outline">脚本 {doc.scripts.reduce((n, c) => n + c.scripts.length, 0)} 个</div>
                <div className="badge outline">快照 {doc.baselines.length} 份</div>
              </div>
              {doc.card?.image ? (
                <div className="mt10 faint" style={{ fontSize: 11 }}>
                  图片：{doc.card.image.width}×{doc.card.image.height}，元数据块 {doc.card.image.metaChunks.map((c) => `${c.keyword}${c.spec ? `(${c.spec})` : ''}`).join(' / ')}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
