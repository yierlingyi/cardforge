import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { CARD_FIELDS, estimateTokens, unknownCardFields, type FieldDef } from '../../core/card';
import { Labeled, TextInput, NumberInput, TextArea, Toggle, TagInput, JsonTextArea, Segmented, KeyValue, Section, Empty, useCopy, useModals } from '../common';
import Modal from '../components/Modal';
import CodeArea from '../components/CodeArea';
import { JsonDiff } from '../components/DiffView';
import { markdownToHtml } from '../../core/format';
import { formatJson, isPlainObject } from '../../core/util';
import { characterBookStats } from '../../core/stats';

const GROUPS = [
  { key: '基础信息', label: '基础信息' },
  { key: '正文内容', label: '正文内容' },
  { key: '提示词', label: '提示词' },
  { key: '酒馆运行设置', label: '运行设置' },
  { key: '结构化数据', label: '结构化数据' },
  { key: '未知字段', label: '未知字段' },
];

export default function CharacterPage() {
  const { doc, mutate, toast } = useStore();
  const card = doc.card;
  const [group, setGroup] = useState('正文内容');
  const [fieldQuery, setFieldQuery] = useState('');
  const [preview, setPreview] = useState<{ key: string; text: string } | null>(null);
  const [fullscreen, setFullscreen] = useState<{ key: string; text: string } | null>(null);
  const [rawView, setRawView] = useState<'data' | 'root'>('data');
  const [unknownEdit, setUnknownEdit] = useState<{ key: string; value: string } | null>(null);
  const copy = useCopy();

  if (!card) {
    return (
      <Empty
        icon="▤"
        title="尚未载入人物卡"
        desc="从「导入」载入 JSON / PNG 人物卡，或加载内置示例项目开始。"
      >
        <div className="row">
          <button className="btn primary" onClick={() => useStore.getState().loadSample()}>加载示例项目</button>
          <button className="btn" onClick={() => useStore.getState().createBlankProject()}>新建空白卡</button>
        </div>
      </Empty>
    );
  }

  const data = card.data;
  const unknown = unknownCardFields(data);
  const baseline = doc.baselines[doc.baselines.length - 1];
  const baselineData = useMemo(() => {
    if (!baseline) return null;
    try {
      const parsed = JSON.parse(baseline.json);
      return parsed.data ?? parsed;
    } catch {
      return null;
    }
  }, [baseline]);

  const setField = (key: string, value: any) => {
    mutate(
      `编辑字段 ${key}`,
      (d) => {
        if (!d.card) return;
        if (value === undefined) delete (d.card.data as any)[key];
        else (d.card.data as any)[key] = value;
      },
      { coalesce: `card:${key}` },
    );
  };

  const fields = CARD_FIELDS.filter((f) => f.group === group && (!f.version || f.version.includes(card.version)));

  const chars = estimateTokens(JSON.stringify(data));
  const completeness = useMemo(() => {
    const checks = [
      { label: '名称 name', ok: !!data.name?.trim(), hint: '必填' },
      { label: '描述 description', ok: !!data.description?.trim(), hint: '建议填写' },
      { label: '开场白 first_mes', ok: !!data.first_mes?.trim(), hint: '建议填写' },
      { label: '性格 personality', ok: !!data.personality?.trim(), hint: '可选' },
      { label: '场景 scenario', ok: !!data.scenario?.trim(), hint: '可选' },
      { label: '示例对话 mes_example', ok: !!data.mes_example?.trim(), hint: '可选' },
      { label: '标签 tags', ok: Array.isArray(data.tags) && data.tags.length > 0, hint: '便于检索' },
      { label: '替代开场白', ok: Array.isArray(data.alternate_greetings) && data.alternate_greetings.length > 0, hint: '提升可玩性' },
      { label: '内嵌世界书', ok: !!data.character_book?.entries?.length, hint: '资料量大时使用' },
      { label: '系统提示词', ok: !!data.system_prompt?.trim(), hint: '高级用法' },
    ];
    return checks;
  }, [data]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>人物卡编辑</h1>
        <span className="badge info">{card.version.toUpperCase()}</span>
        <span className="sub ellipsis" style={{ maxWidth: 320 }}>{data.name || '(未命名)'}</span>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 11 }}>{chars.toLocaleString()} tok（估算）</span>
        <button className="btn sm" onClick={() => useStore.getState().snapshotBaseline(`手动快照 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)}>
          记录快照
        </button>
        <button className="btn sm" onClick={() => useModals.getState().set({ exportOpen: true })}>导出此卡</button>
      </div>

      <div className="split3">
        {/* 左：字段分组 + 完整性 */}
        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>字段分组</span>
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 10 }}>{CARD_FIELDS.length} 项</span>
          </div>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input
              className="input sm"
              placeholder="搜索字段名 / key…"
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
            />
          </div>
          <div className="pane-body">
            {fieldQuery.trim() ? (
              <div>
                {CARD_FIELDS.filter(
                  (f) =>
                    f.label.toLowerCase().includes(fieldQuery.toLowerCase()) ||
                    f.key.toLowerCase().includes(fieldQuery.toLowerCase()),
                ).map((f) => (
                  <button
                    key={f.key}
                    className={`nav-item ${group === f.group ? 'active' : ''}`}
                    onClick={() => setGroup(f.group)}
                    title={`${f.label}（${f.group}）`}
                  >
                    <span className="ni">·</span>
                    <span className="ellipsis">{f.key}</span>
                    <span className="count ellipsis" style={{ maxWidth: 70 }}>{f.group}</span>
                  </button>
                ))}
                {unknown.filter((k) => k.toLowerCase().includes(fieldQuery.toLowerCase())).map((k) => (
                  <button key={k} className="nav-item" onClick={() => setGroup('未知字段')}>
                    <span className="ni">?</span>
                    <span className="ellipsis">{k}</span>
                    <span className="count">未知</span>
                  </button>
                ))}
                {CARD_FIELDS.filter((f) => f.label.toLowerCase().includes(fieldQuery.toLowerCase()) || f.key.toLowerCase().includes(fieldQuery.toLowerCase())).length === 0 &&
                unknown.filter((k) => k.toLowerCase().includes(fieldQuery.toLowerCase())).length === 0 ? (
                  <div className="faint pad10" style={{ fontSize: 11 }}>没有匹配的字段。</div>
                ) : null}
              </div>
            ) : (
              GROUPS.map((g) => {
              const count =
                g.key === '未知字段'
                  ? unknown.length
                  : CARD_FIELDS.filter((f) => f.group === g.key && data[f.key] !== undefined && data[f.key] !== '' && !(Array.isArray(data[f.key]) && !data[f.key].length)).length;
              return (
                <button key={g.key} className={`nav-item ${group === g.key ? 'active' : ''}`} onClick={() => setGroup(g.key)} style={{ borderLeft: '2px solid transparent' }}>
                  <span className="ni">{group === g.key ? '▸' : '·'}</span>
                  <span>{g.label}</span>
                  <span className="count">{count}</span>
                </button>
              );
            })
            )}

            <div className="divider" />
            <div className="pad10">
              <div className="section-title" style={{ padding: 0, marginBottom: 6 }}>完整性检查</div>
              {completeness.map((c) => (
                <div key={c.label} className="row" style={{ fontSize: 11.5, padding: '2px 0' }}>
                  <span style={{ color: c.ok ? 'var(--ok)' : 'var(--text-faint)', width: 12 }}>{c.ok ? '✓' : '○'}</span>
                  <span className={c.ok ? '' : 'faint'}>{c.label}</span>
                  <span className="spacer" />
                  {!c.ok ? <span className="faint" style={{ fontSize: 10 }}>{c.hint}</span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 中：表单 */}
        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{GROUPS.find((g) => g.key === group)?.label}</span>
            <span className="faint">{group === '未知字段' ? `${unknown.length} 个未识别字段（默认全部保留）` : `${fields.length} 个字段`}</span>
            <span className="spacer" />
            <span className="badge outline">字段级写入</span>
          </div>
          <div className="pane-body pad">
            {group === '未知字段' ? (
              unknown.length === 0 ? (
                <div className="faint pad10">没有未知字段。规范字段之外的字段会显示在这里，并保证导出时不丢失。</div>
              ) : (
                <>
                  <div className="faint mb6" style={{ fontSize: 11.5 }}>
                    以下字段不在 Character Card V2/V3 规范内，但会被完整保留。你可以查看或编辑它们的 JSON。
                  </div>
                  {unknown.map((k) => (
                    <div className="panel mb6" key={k}>
                      <div className="row" style={{ padding: '6px 10px' }}>
                        <span className="mono" style={{ color: 'var(--accent)' }}>{k}</span>
                        <span className="badge outline">{Array.isArray(data[k]) ? 'array' : typeof data[k]}</span>
                        <span className="spacer" />
                        <button className="btn ghost sm" onClick={() => copy(JSON.stringify(data[k], null, 2), `字段 ${k}`)}>复制</button>
                        <button className="btn ghost sm" onClick={() => setUnknownEdit({ key: k, value: formatJson(data[k]) })}>编辑</button>
                        <button
                          className="btn ghost sm danger"
                          onClick={() => {
                            if (confirm(`确定删除未知字段「${k}」？此操作可撤销。`)) setField(k, undefined);
                          }}
                        >
                          删除
                        </button>
                      </div>
                      <div className="code-pre" style={{ margin: 0, border: 'none', borderRadius: 0, maxHeight: 140 }}>
                        {formatJson(data[k]).slice(0, 600)}
                      </div>
                    </div>
                  ))}
                </>
              )
            ) : (
              fields.map((f) => (
                <FieldEditor
                  key={f.key}
                  def={f}
                  value={data[f.key]}
                  onChange={(v) => setField(f.key, v)}
                  onPreview={(text) => setPreview({ key: f.label, text })}
                  onFullscreen={(text) => setFullscreen({ key: f.key, text })}
                  onCopy={() => copy(String(data[f.key] ?? ''), f.label)}
                  onClear={() => setField(f.key, f.kind === 'stringList' || f.kind === 'tags' ? [] : '')}
                />
              ))
            )}
          </div>
        </div>

        {/* 右：检查器 */}
        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>检查器</span>
            <span className="spacer" />
            <Segmented value={rawView} onChange={setRawView} options={[{ value: 'data', label: 'data' }, { value: 'root', label: 'root' }]} />
          </div>
          <div className="pane-body pad">
            <Section title="结构信息">
              <KeyValue k="识别版本">{card.version.toUpperCase()}（spec_version: {card.specVersion || '—'}）</KeyValue>
              <KeyValue k="根级扩展">{Object.keys(card.rootExtra || {}).length ? Object.keys(card.rootExtra).join(', ') : '无'}</KeyValue>
              <KeyValue k="data 字段数">{Object.keys(data).length}</KeyValue>
              <KeyValue k="未知字段">{unknown.length}</KeyValue>
              <KeyValue k="来源文件">{doc.meta.sourceFileName || '（本地新建）'}</KeyValue>
              {card.image ? <KeyValue k="图片">{card.image.width}×{card.image.height} · {card.image.metaChunks.map((c) => c.keyword).join('/')}</KeyValue> : null}
            </Section>

            <Section title="内容统计">
              <KeyValue k="描述">{data.description?.length || 0} 字符 ≈ {estimateTokens(String(data.description || ''))} tok</KeyValue>
              <KeyValue k="开场白">{data.first_mes?.length || 0} 字符 ≈ {estimateTokens(String(data.first_mes || ''))} tok</KeyValue>
              <KeyValue k="示例对话">{data.mes_example?.length || 0} 字符</KeyValue>
              <KeyValue k="替代开场白">{Array.isArray(data.alternate_greetings) ? data.alternate_greetings.length : 0} 条</KeyValue>
              <KeyValue k="内嵌世界书">{(() => {
                const s = characterBookStats(data.character_book);
                return s ? `${s.count} 条 · ${s.totalChars} 字符` : '无';
              })()}</KeyValue>
            </Section>

            {baselineData ? (
              <Section title={`与快照的差异（${baseline.label}）`} defaultOpen={false}>
                <JsonDiff before={baselineData} after={data} />
              </Section>
            ) : null}

            <Section title="原始 JSON" defaultOpen={false}>
              <CodeArea value={formatJson(rawView === 'data' ? data : card.root)} readOnly language="json" minHeight={240} wrap={false} />
              <div className="row mt6">
                <button className="btn ghost sm" onClick={() => copy(formatJson(rawView === 'data' ? data : card.root), 'JSON')}>复制 JSON</button>
                <span className="faint" style={{ fontSize: 10.5 }}>只读视图，编辑请在表单中进行</span>
              </div>
            </Section>

            <div className="faint mt10" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
              所有修改都通过「字段级写入」实现，不会重建整个 data 对象，因此未知字段与第三方扩展不会丢失。
            </div>
          </div>
        </div>
      </div>

      <Modal open={!!preview} title={`Markdown 预览 · ${preview?.key || ''}`} onClose={() => setPreview(null)} width="wide">
        <div className="bubble" style={{ maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: markdownToHtml(preview?.text || '') }} />
      </Modal>

      <Modal
        open={!!fullscreen}
        title={`全屏编辑 · ${fullscreen?.key || ''}`}
        width="wide"
        onClose={() => setFullscreen(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setFullscreen(null)}>关闭</button>
            <button
              className="btn primary"
              onClick={() => {
                if (fullscreen) setField(fullscreen.key, fullscreen.text);
                setFullscreen(null);
                toast('success', '已应用修改');
              }}
            >
              应用
            </button>
          </>
        }
      >
        {fullscreen ? (
          <CodeArea value={fullscreen.text} onChange={(v) => setFullscreen({ ...fullscreen, text: v })} language="text" minHeight={420} />
        ) : null}
      </Modal>

      <Modal
        open={!!unknownEdit}
        title={`编辑未知字段 · ${unknownEdit?.key || ''}`}
        onClose={() => setUnknownEdit(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setUnknownEdit(null)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                if (!unknownEdit) return;
                try {
                  const v = JSON.parse(unknownEdit.value);
                  setField(unknownEdit.key, v);
                  setUnknownEdit(null);
                  toast('success', '已保存');
                } catch (e: any) {
                  toast('error', `JSON 无效：${e.message}`);
                }
              }}
            >
              保存
            </button>
          </>
        }
      >
        {unknownEdit ? (
          <CodeArea value={unknownEdit.value} onChange={(v) => setUnknownEdit({ ...unknownEdit, value: v })} language="json" minHeight={260} />
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------ 字段编辑器 */

function FieldEditor({
  def,
  value,
  onChange,
  onPreview,
  onFullscreen,
  onCopy,
  onClear,
}: {
  def: FieldDef;
  value: any;
  onChange: (v: any) => void;
  onPreview: (text: string) => void;
  onFullscreen: (text: string) => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  const tools = (
    <span className="row" style={{ gap: 2 }}>
      {def.kind === 'longtext' ? (
        <>
          <button className="btn ghost sm" onClick={() => onPreview(String(value || ''))}>预览</button>
          <button className="btn ghost sm" onClick={() => onFullscreen(String(value || ''))}>全屏</button>
        </>
      ) : null}
      <button className="btn ghost sm" onClick={onCopy}>复制</button>
      <button className="btn ghost sm" onClick={onClear}>清空</button>
    </span>
  );

  const count = typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : 0;

  switch (def.kind) {
    case 'text':
      return (
        <Labeled label={def.label} hint={def.hint} right={tools}>
          <TextInput value={String(value ?? '')} onChange={onChange} placeholder={def.hint} />
        </Labeled>
      );
    case 'number':
      return (
        <Labeled label={def.label} hint={def.hint}>
          <NumberInput value={typeof value === 'number' ? value : null} onChange={(v) => onChange(v)} nullable />
        </Labeled>
      );
    case 'boolean':
      return (
        <Labeled label={def.label} hint={def.hint}>
          <Toggle checked={!!value} onChange={onChange} label={value ? '是' : '否'} />
        </Labeled>
      );
    case 'tags':
      return (
        <Labeled label={def.label} hint={def.hint} right={tools}>
          <TagInput values={Array.isArray(value) ? value : []} onChange={onChange} />
        </Labeled>
      );
    case 'stringList':
      return (
        <Labeled label={def.label} hint={def.hint} right={<span className="row" style={{ gap: 2 }}>{tools}</span>}>
          <StringListEditor values={Array.isArray(value) ? value : []} onChange={onChange} />
        </Labeled>
      );
    case 'json':
      return (
        <Labeled label={def.label} hint={def.hint}>
          <JsonTextArea value={value ?? null} onChange={onChange} rows={def.key === 'character_book' || def.key === 'extensions' ? 10 : 5} />
        </Labeled>
      );
    default:
      return (
        <Labeled label={def.label} hint={def.hint} right={<span className="row" style={{ gap: 6 }}><span className="faint" style={{ fontSize: 10.5 }}>{count} 字符</span>{tools}</span>}>
          <TextArea value={String(value ?? '')} onChange={onChange} rows={def.rows || 6} />
        </Labeled>
      );
  }
}

function StringListEditor({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      {values.map((v, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
          <span className="badge outline" style={{ marginTop: 6 }}>#{i + 1}</span>
          <textarea
            className="textarea mono grow"
            rows={2}
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <div className="col" style={{ gap: 2 }}>
            <button className="btn ghost sm icon" disabled={i === 0} onClick={() => { const n = [...values]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</button>
            <button className="btn ghost sm icon" disabled={i === values.length - 1} onClick={() => { const n = [...values]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }}>↓</button>
            <button className="btn ghost sm icon danger" onClick={() => onChange(values.filter((_, j) => j !== i))}>×</button>
          </div>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...values, ''])}>+ 添加一项</button>
    </div>
  );
}
