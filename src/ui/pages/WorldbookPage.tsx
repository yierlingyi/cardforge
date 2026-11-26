import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, PaneHeader, Section, Segmented, Stat, useCopy, useModals, Labeled, TextInput, NumberInput, Toggle, TagInput, useContextMenu } from '../common';
import Modal from '../components/Modal';
import CodeArea from '../components/CodeArea';
import VirtualList from '../components/VirtualList';
import WorldbookSim from './WorldbookSim';
import { ENTRY_DEFAULTS, createWorldbook, deadEntries, exportWorldbookFile, keyConflicts, mergeWorldbooks, parseWorldbook, uidConflicts, worldbookStats } from '../../core/worldbook';
import { WI_POSITION_LABELS, WI_ROLE_LABELS, WI_SELECTIVE_LOGIC, type NormalizedWorldbook, type WorldbookEntry } from '../../core/types';
import { buildWorldbookJson } from '../../core/exporter';
import { querySearch, sendSearchIndex, updateSearchEntries } from '../../core/runtime';
import { bytesBlob, downloadBlob, formatJson, humanSize } from '../../core/util';
import { estimateTokens } from '../../core/card';

const KNOWN_ENTRY_KEYS = new Set([...Object.keys(ENTRY_DEFAULTS), 'uid', 'displayIndex']);

type ViewMode = 'list' | 'cards' | 'keywords' | 'relations' | 'json';
type FilterMode = 'all' | 'enabled' | 'disabled' | 'constant' | 'dead' | 'dupkeys' | 'group' | 'empty' | 'long';
type SortMode = 'index' | 'uid' | 'order' | 'length' | 'keys' | 'comment';

export default function WorldbookPage() {
  const store = useStore();
  const { doc, selectedWorldbook, selectedEntryUid, select, toast, mutate, addEntry, updateEntry, deleteEntries, bulkUpdate, reorderEntries, fixUids, removeWorldbook, syncCardBook, addWorldbook } = store;
  const wb = doc.worldbooks.find((w) => w.name === selectedWorldbook) || doc.worldbooks[0] || null;

  const [view, setView] = useState<ViewMode>('list');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('index');
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [simOpen, setSimOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSrc, setMergeSrc] = useState('');
  const [mergeUid, setMergeUid] = useState<'reassign' | 'keep'>('reassign');
  const [mergeKey, setMergeKey] = useState<'append' | 'skip-if-key-exists'>('append');
  const [jsonEditing, setJsonEditing] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [matchUids, setMatchUids] = useState<Set<number> | null>(null);
  const [searchMs, setSearchMs] = useState<number | null>(null);
  const [statsTick, setStatsTick] = useState(0);
  const prevEntries = useRef<Map<number, WorldbookEntry> | null>(null);
  const [fullscreenContent, setFullscreenContent] = useState<string | null>(null);
  const [fsOpen, setFsOpen] = useState(false);
  const copy = useCopy();
  const modals = useModals();
  const lastClick = useRef<number | null>(null);
  const [dragUid, setDragUid] = useState<number | null>(null);
  const [overUid, setOverUid] = useState<number | null>(null);
  const ctx = useContextMenu();

  const entries = wb?.entries || [];

  /* 搜索索引：只在必要时全量重建，其余走增量更新 */
  useEffect(() => {
    if (!wb) return;
    if (wb.entries.length < 1200) return;
    const prev = prevEntries.current;
    const list = wb.entries;
    if (!prev || prev.size !== list.length) {
      sendSearchIndex(list, list.length);
      prevEntries.current = new Map(list.map((e) => [e.uid, e]));
      return;
    }
    const changed: WorldbookEntry[] = [];
    for (const e of list) {
      const old = prev.get(e.uid);
      if (old === undefined) {
        // 有新增：直接全量重建更稳妥
        sendSearchIndex(list, list.length);
        prevEntries.current = new Map(list.map((x) => [x.uid, x]));
        return;
      }
      if (old !== e) changed.push(e);
    }
    // 删除条目导致 size 变化已在上方处理
    if (changed.length && changed.length <= 200) {
      const t = setTimeout(() => updateSearchEntries(changed), 350);
      for (const e of changed) prev.set(e.uid, e);
      return () => clearTimeout(t);
    }
    if (changed.length > 200) {
      sendSearchIndex(list, list.length);
      prevEntries.current = new Map(list.map((e2) => [e2.uid, e2]));
    }
  }, [wb?.entries, wb?.name]);

  useEffect(() => {
    if (!wb || !q.trim()) {
      setMatchUids(null);
      setSearchMs(null);
      return;
    }
    if (wb.entries.length < 1200) {
      const needle = q.toLowerCase();
      const set = new Set<number>();
      for (const e of wb.entries) {
        if (`${e.uid}\n${e.comment}\n${(e.key || []).join(',')}\n${(e.keysecondary || []).join(',')}\n${e.content}`.toLowerCase().includes(needle)) set.add(e.uid);
      }
      setMatchUids(set);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await querySearch(q, { limit: 5000 });
      if (!alive) return;
      setMatchUids(new Set(r.hits.map((h) => h.uid)));
      setSearchMs(r.ms);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, wb?.entries, wb?.name]);

  const big = entries.length > 8000;
  const dupUids = useMemo(() => {
    const s = new Set<number>();
    if (!wb || wb.entries.length > 8000) return s;
    for (const c of keyConflicts(wb.entries)) if (c.kind === 'across') c.entries.forEach((u) => s.add(u));
    return s;
  }, [wb?.entries]);

  const visible = useMemo(() => {
    if (!wb) return [];
    let list = wb.entries.slice();
    if (matchUids) list = list.filter((e) => matchUids.has(e.uid));
    switch (filter) {
      case 'enabled':
        list = list.filter((e) => !e.disable);
        break;
      case 'disabled':
        list = list.filter((e) => e.disable);
        break;
      case 'constant':
        list = list.filter((e) => e.constant);
        break;
      case 'dead':
        list = list.filter((e) => deadEntries([e]).length > 0);
        break;
      case 'dupkeys':
        list = list.filter((e) => dupUids.has(e.uid));
        break;
      case 'group':
        list = list.filter((e) => !!e.group);
        break;
      case 'empty':
        list = list.filter((e) => !e.content?.trim());
        break;
      case 'long':
        list = list.filter((e) => (e.content || '').length > 2000);
        break;
      default:
        break;
    }
    switch (sort) {
      case 'uid':
        list.sort((a, b) => a.uid - b.uid);
        break;
      case 'order':
        list.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
        break;
      case 'length':
        list.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0));
        break;
      case 'keys':
        list.sort((a, b) => (b.key?.length || 0) - (a.key?.length || 0));
        break;
      case 'comment':
        list.sort((a, b) => (a.comment || '').localeCompare(b.comment || '', 'zh-CN'));
        break;
      default:
        list.sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0));
    }
    return list;
  }, [wb?.entries, matchUids, filter, sort, dupUids]);

  const wbJson = useMemo(() => (view === 'json' && wb ? formatJson(exportWorldbookFile(wb)) : ''), [view, wb?.entries, wb?.name]);
  const selected = wb?.entries.find((e) => e.uid === selectedEntryUid) || null;
  const stats = useMemo(
    () => (wb ? (!big || statsTick ? worldbookStats(wb.entries) : null) : null),
    [wb?.entries, big, statsTick],
  );

  if (!wb) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>世界书</h1>
          <span className="spacer" />
          <button className="btn sm" onClick={() => modals.set({ importOpen: true })}>导入世界书</button>
          <button className="btn sm primary" onClick={() => createNew()}>新建世界书</button>
        </div>
        <Empty icon="▦" title="还没有世界书" desc="导入 SillyTavern 世界书 JSON，或读取人物卡内嵌的 character_book。也可以从零创建一本。">
          <div className="row">
            <button className="btn" onClick={() => modals.set({ importOpen: true })}>导入世界书 JSON</button>
            <button className="btn primary" onClick={() => createNew()}>新建世界书</button>
          </div>
        </Empty>
      </div>
    );
  }

  function createNew() {
    let name = '新建世界书';
    let i = 2;
    while (doc.worldbooks.some((w) => w.name === name)) name = `新建世界书 ${i++}`;
    addWorldbook(createWorldbook(name));
    select({ selectedWorldbook: name, selectedEntryUid: null });
    toast('success', `已创建「${name}」`);
  }

  const toggleSelect = (uid: number, e: React.MouseEvent) => {
    const next = new Set(selection);
    if (e.shiftKey && lastClick.current != null) {
      const uids = visible.map((x) => x.uid);
      const a = uids.indexOf(lastClick.current);
      const b = uids.indexOf(uid);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(uids[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
    } else {
      next.clear();
      next.add(uid);
    }
    lastClick.current = uid;
    setSelection(next);
    select({ selectedEntryUid: uid });
  };

  const doRename = () => {
    const target = renameText.trim();
    if (!target || !wb) return;
    if (doc.worldbooks.some((w) => w.name === target && w !== wb)) {
      toast('error', '已存在同名世界书');
      return;
    }
    mutate('重命名世界书', (d) => {
      const w = d.worldbooks.find((x) => x.name === wb.name);
      if (!w) return;
      w.name = target;
      if (w.embeddedInCard && d.card?.data.character_book) d.card.data.character_book.name = target;
    });
    select({ selectedWorldbook: target });
    setRenameOpen(false);
    toast('success', '已重命名');
  };

  const doDuplicate = () => {
    if (!wb) return;
    let name = `${wb.name} 副本`;
    let i = 2;
    while (doc.worldbooks.some((w) => w.name === name)) name = `${wb.name} 副本 ${i++}`;
    const cloneWb: NormalizedWorldbook = {
      ...JSON.parse(JSON.stringify(wb)),
      name,
      origin: 'new',
      embeddedInCard: false,
    };
    addWorldbook(cloneWb);
    select({ selectedWorldbook: name });
    toast('success', `已复制为「${name}」（原条目 UID 保留）`);
  };

  const doMerge = () => {
    if (!wb) return;
    const src = doc.worldbooks.find((w) => w.name === mergeSrc);
    if (!src) return;
    const baseCopy = JSON.parse(JSON.stringify(wb)) as NormalizedWorldbook;
    const srcCopy = JSON.parse(JSON.stringify(src)) as NormalizedWorldbook;
    const report = mergeWorldbooks(baseCopy, srcCopy, { uidStrategy: mergeUid, keyStrategy: mergeKey });
    mutate(`合并世界书「${src.name}」`, (d) => {
      const target = d.worldbooks.find((w) => w.name === wb.name);
      if (target) target.entries = baseCopy.entries;
    });
    setMergeOpen(false);
    toast('success', `合并完成：新增 ${report.added} 条，跳过 ${report.skipped} 条${report.uidRemapped ? `，重分配 UID ${report.uidRemapped} 个` : ''}`);
  };

  const exportWb = () => {
    const art = buildWorldbookJson(wb);
    downloadBlob(bytesBlob(art.bytes, art.mime), art.filename);
    toast('success', `已导出 ${art.filename}`);
  };

  const unknownKeys = Object.keys(selected || {}).filter((k) => !KNOWN_ENTRY_KEYS.has(k));

  return (
    <div className="page">
      <div className="page-head">
        <h1>世界书</h1>
        <select className="select" style={{ width: 220 }} value={wb.name} onChange={(e) => select({ selectedWorldbook: e.target.value, selectedEntryUid: doc.worldbooks.find((w) => w.name === e.target.value)?.entries[0]?.uid ?? null })}>
          {doc.worldbooks.map((w) => (
            <option key={w.name} value={w.name}>{w.name}（{w.entries.length}）</option>
          ))}
        </select>
        {wb.embeddedInCard ? <span className="badge warn">内嵌于人物卡</span> : <span className="badge outline">独立文件</span>}
        <span className="sub">{stats ? `${stats.count} 条 · ${humanSize(stats.totalChars)}` : `${entries.length} 条（大世界书）`}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => { setRenameText(wb.name); setRenameOpen(true); }}>重命名</button>
        <button className="btn sm" onClick={doDuplicate}>复制</button>
        <button className="btn sm" onClick={() => { setMergeSrc(doc.worldbooks.find((w) => w.name !== wb.name)?.name || ''); setMergeOpen(true); }} disabled={doc.worldbooks.length < 2}>合并</button>
        <button className="btn sm" onClick={exportWb}>导出</button>
        {wb.embeddedInCard ? <button className="btn sm" onClick={syncCardBook} title="把条目写回 data.character_book">同步到卡片</button> : null}
        <button className="btn sm primary" onClick={() => addEntry(wb.name)}>+ 新建条目</button>
        <button className="btn sm ghost danger" onClick={() => { if (confirm(`删除世界书「${wb.name}」？可通过撤销恢复。`)) removeWorldbook(wb.name); }}>删除</button>
      </div>

      <div className={`split3 wb-split ${view === 'keywords' || view === 'relations' || view === 'json' ? 'view-wide' : ''}`}>
        {/* 列表 */}
        <div className="pane">
          <div className="pane-head">
            <Segmented
              value={view}
              onChange={(v) => setView(v)}
              options={[
                { value: 'list', label: '列表' },
                { value: 'cards', label: '卡片' },
                { value: 'keywords', label: '关键词' },
                { value: 'relations', label: '关系' },
                { value: 'json', label: 'JSON' },
              ]}
            />
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 10.5 }}>{visible.length}/{entries.length}</span>
          </div>

          {view === 'list' || view === 'cards' ? (
          <>
          <div className="row" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', gap: 4 }}>
            <input className="input sm" placeholder="搜索备注 / 关键词 / 正文…" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 24 }} />
            {q ? <button className="btn ghost sm icon" onClick={() => setQ('')}>×</button> : null}
          </div>

          <div className="row wrap" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', gap: 4 }}>
            <select className="select" style={{ width: 92, height: 24, fontSize: 11, padding: '0 18px 0 6px' }} value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
              <option value="all">全部</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
              <option value="constant">常驻</option>
              <option value="dead">失效（永不可触发）</option>
              <option value="dupkeys">重复关键词</option>
              <option value="group">包含组</option>
              <option value="empty">空正文</option>
              <option value="long">超长（&gt;2000）</option>
            </select>
            <select className="select" style={{ width: 92, height: 24, fontSize: 11, padding: '0 18px 0 6px' }} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="index">默认顺序</option>
              <option value="uid">UID</option>
              <option value="order">触发顺序 order</option>
              <option value="length">正文长度</option>
              <option value="keys">关键词数</option>
              <option value="comment">备注名</option>
            </select>
            <button className="btn ghost sm" onClick={() => { setSelection(new Set(visible.map((e) => e.uid))); }} title="选中当前筛选结果">全选</button>
            <button className="btn ghost sm" onClick={() => setSelection(new Set())}>清空</button>
            {searchMs != null ? <span className="faint" style={{ fontSize: 10 }}>Worker {searchMs.toFixed(0)}ms</span> : null}
            <span className="faint" style={{ fontSize: 10 }} title="拖拽条目行可排序（需默认顺序、无搜索）">{sort === 'index' && !q ? '可拖拽排序' : ''}</span>
          </div>

          {selection.size > 0 ? (
            <div className="row wrap" style={{ padding: '4px 8px', gap: 4, background: 'var(--accent-soft)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{selection.size} 项</span>
              <button className="btn sm" onClick={() => bulkUpdate(wb.name, [...selection], { disable: true })}>禁用</button>
              <button className="btn sm" onClick={() => bulkUpdate(wb.name, [...selection], { disable: false })}>启用</button>
              <button className="btn sm" onClick={() => setBulkOpen(true)}>批量设置…</button>
              <button className="btn sm danger" onClick={() => { if (confirm(`删除选中的 ${selection.size} 个条目？`)) { deleteEntries(wb.name, [...selection]); setSelection(new Set()); } }}>删除</button>
            </div>
          ) : null}
          </>
          ) : null}

          {view === 'list' ? (
            <VirtualList
              items={visible}
              rowHeight={40}
              className="grow"
              empty={<Empty icon="▦" title="没有匹配的条目" desc="调整搜索或筛选条件，或新建一个条目。" />}
              render={(e) => {
                const dup = dupUids.has(e.uid);
                const dead = !e.disable && !e.constant && !(e.key || []).some((k) => k.trim());
                return (
                  <div
                    className={`vrow ${selectedEntryUid === e.uid ? 'active' : ''} ${overUid === e.uid ? 'active' : ''}`}
                    onClick={(ev) => toggleSelect(e.uid, ev)}
                    title={`#${e.uid} ${e.comment}`}
                    style={{ height: 40, opacity: dragUid === e.uid ? 0.5 : 1 }}
                    draggable={sort === 'index' && !q}
                    onDragStart={() => setDragUid(e.uid)}
                    onDragEnd={() => { setDragUid(null); setOverUid(null); }}
                    onDragOver={(ev) => { if (dragUid !== null && dragUid !== e.uid) { ev.preventDefault(); setOverUid(e.uid); } }}
                    onDragLeave={() => { if (overUid === e.uid) setOverUid(null); }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      if (dragUid === null || dragUid === e.uid) return;
                      const uids = entries.map((x) => x.uid).filter((u) => u !== dragUid);
                      const at = uids.indexOf(e.uid);
                      uids.splice(at < 0 ? uids.length : at, 0, dragUid);
                      reorderEntries(wb.name, uids);
                      setDragUid(null);
                      setOverUid(null);
                    }}
                    onContextMenu={(ev) =>
                      ctx.open(ev, [
                        { label: '编辑此条目', onClick: () => select({ selectedEntryUid: e.uid }) },
                        { label: e.disable ? '启用' : '禁用', onClick: () => updateEntry(wb.name, e.uid, { disable: !e.disable }) },
                        { label: e.constant ? '取消常驻' : '设为常驻', onClick: () => updateEntry(wb.name, e.uid, { constant: !e.constant }) },
                        { divider: true, label: '', onClick: () => undefined },
                        { label: '复制条目', onClick: () => store.duplicateEntry(wb.name, e.uid) },
                        { label: '复制 JSON', onClick: () => copy(JSON.stringify(e, null, 2), `条目 #${e.uid} JSON`) },
                        { label: '复制正文', onClick: () => copy(e.content || '', '正文') },
                        { divider: true, label: '', onClick: () => undefined },
                        {
                          label: `删除条目 #${e.uid}`,
                          danger: true,
                          onClick: () => {
                            if (confirm(`删除条目 #${e.uid}「${e.comment || '无备注'}」？`)) deleteEntries(wb.name, [e.uid]);
                          },
                        },
                      ])
                    }
                  >
                    <span className="uid">{e.uid}</span>
                    <div className="vmain">
                      <div className="vname" style={{ opacity: e.disable ? 0.6 : 1 }}>
                        {e.constant ? <span className="badge purple" style={{ height: 14, fontSize: 9 }}>常驻</span> : null}
                        {e.disable ? <span className="badge" style={{ height: 14, fontSize: 9 }}>禁用</span> : null}
                        {dup ? <span className="badge warn" style={{ height: 14, fontSize: 9 }} title="关键词与其他条目重复">重</span> : null}
                        {dead ? <span className="badge warn" style={{ height: 14, fontSize: 9 }} title="无关键词且非常驻：永远不会触发">失效</span> : null}
                        <span className="ellipsis">{e.comment || <span className="faint">(无备注)</span>}</span>
                      </div>
                      <div className="vkeys">
                        {(e.key || []).slice(0, 3).map((k, i) => (
                          <span key={i} className="chip">{k}</span>
                        ))}
                        {(e.key?.length || 0) > 3 ? <span className="chip">+{(e.key!.length - 3)}</span> : null}
                        {!(e.key || []).length ? <span className="faint" style={{ fontSize: 9.5 }}>{e.constant ? '无条件注入' : '无关键词'}</span> : null}
                      </div>
                    </div>
                    <span className="vlen">{(e.content?.length || 0).toLocaleString()}</span>
                  </div>
                );
              }}
            />
          ) : null}

          {view === 'cards' ? (
            <div className="pane-body pad">
              {visible.length > 240 ? <div className="faint mb6" style={{ fontSize: 11 }}>卡片视图仅渲染前 240 条（共 {visible.length} 条），其余请在列表视图查看。</div> : null}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {visible.slice(0, 240).map((e) => (
                  <div
                    key={e.uid}
                    className="card"
                    style={{ cursor: 'pointer', borderColor: selectedEntryUid === e.uid ? 'var(--accent)' : undefined }}
                    onClick={() => select({ selectedEntryUid: e.uid })}
                  >
                    <div className="card-body" style={{ padding: 9 }}>
                      <div className="row" style={{ marginBottom: 3 }}>
                        <span className="faint mono" style={{ fontSize: 10 }}>#{e.uid}</span>
                        <span className="spacer" />
                        {e.constant ? <span className="badge purple" style={{ height: 14, fontSize: 9 }}>常驻</span> : null}
                        {e.disable ? <span className="badge" style={{ height: 14, fontSize: 9 }}>禁用</span> : null}
                      </div>
                      <div className="ellipsis" style={{ fontWeight: 600, fontSize: 12 }}>{e.comment || '(无备注)'}</div>
                      <div className="row wrap mt6" style={{ gap: 2 }}>
                        {(e.key || []).slice(0, 4).map((k, i) => <span key={i} className="chip">{k}</span>)}
                      </div>
                      <div className="faint" style={{ fontSize: 11, marginTop: 6, height: 34, overflow: 'hidden' }}>
                        {(e.content || '(空正文)').slice(0, 70)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {view === 'keywords' ? (
            <div className="pane-body">
              <KeywordIndex entries={entries} onPick={(k) => { setQ(k); setView('list'); }} />
            </div>
          ) : null}

          {view === 'relations' ? (
            <div className="pane-body pad">
              <RelationsView entries={entries} onPick={(uid) => { select({ selectedEntryUid: uid }); setView('list'); }} />
            </div>
          ) : null}

          {view === 'json' ? (
            <div className="pane-body pad">
              <div className="row mb6">
                <span className="faint" style={{ fontSize: 11 }}>世界书导出格式（entries 以 uid 为键）</span>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => copy(formatJson(exportWorldbookFile(wb)), '世界书 JSON')}>复制</button>
                <button className="btn sm" onClick={() => { setJsonDraft(formatJson(exportWorldbookFile(wb))); setJsonEditing(true); }}>编辑 JSON</button>
              </div>
              <CodeArea value={wbJson} readOnly language="json" wrap={false} minHeight={300} />
            </div>
          ) : null}
        </div>

        {/* 编辑区 */}
        <div className="pane">
          {!selected ? (
            <Empty icon="▸" title="选择一个条目开始编辑" desc="左侧列表支持搜索、筛选、多选（Ctrl/Shift）与批量操作。">
              <button className="btn primary" onClick={() => addEntry(wb.name)}>新建条目</button>
            </Empty>
          ) : (
            <>
              <div className="pane-head">
                <span className="mono" style={{ color: 'var(--accent)' }}>#{selected.uid}</span>
                <span className="ellipsis" style={{ fontWeight: 600, color: 'var(--text)', maxWidth: 280 }}>{selected.comment || '(无备注)'}</span>
                <span className={`badge ${selected.disable ? '' : selected.constant ? 'purple' : 'ok'}`}>
                  {selected.disable ? '已禁用' : selected.constant ? '常驻' : '条件触发'}
                </span>
                {selected.probability !== undefined && selected.probability < 100 ? <span className="badge warn">{selected.probability}%</span> : null}
                <span className="spacer" />
                <button className="btn ghost sm" onClick={() => store.duplicateEntry(wb.name, selected.uid)}>复制</button>
                <button className="btn ghost sm" onClick={() => copy(JSON.stringify(selected, null, 2), '条目 JSON')}>复制 JSON</button>
                <button
                  className="btn ghost sm danger"
                  onClick={() => {
                    const idx = entries.findIndex((e) => e.uid === selected.uid);
                    deleteEntries(wb.name, [selected.uid]);
                    const next = entries[idx + 1] || entries[idx - 1];
                    select({ selectedEntryUid: next?.uid ?? null });
                  }}
                >
                  删除
                </button>
              </div>

              <div className="pane-body pad">
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div className="grow">
                    <Labeled label="备注 comment">
                      <TextInput
                        value={selected.comment || ''}
                        onChange={(v) => updateEntry(wb.name, selected.uid, { comment: v }, `e:${selected.uid}:comment`)}
                        placeholder="给这个条目起个名字，方便检索（不参与触发）"
                      />
                    </Labeled>
                  </div>
                  <div style={{ width: 96 }}>
                    <Labeled label="UID" hint={entries.filter((x) => x.uid === selected.uid).length > 1 ? '⚠ 与其他条目冲突' : undefined}>
                      <NumberInput value={selected.uid} onChange={(v) => updateEntry(wb.name, selected.uid, { uid: v ?? 0 }, `e:${selected.uid}:uid`)} />
                    </Labeled>
                  </div>
                </div>

                <div className="row wrap" style={{ gap: 14, marginBottom: 10 }}>
                  <Toggle checked={!selected.disable} onChange={(v) => updateEntry(wb.name, selected.uid, { disable: !v })} label={selected.disable ? '已禁用' : '启用'} />
                  <Toggle checked={!!selected.constant} onChange={(v) => updateEntry(wb.name, selected.uid, { constant: v })} label="常驻 constant" />
                  <Toggle checked={selected.selective !== false} onChange={(v) => updateEntry(wb.name, selected.uid, { selective: v })} label="选择性 selective" />
                  <Toggle checked={selected.useProbability !== false} onChange={(v) => updateEntry(wb.name, selected.uid, { useProbability: v })} label="使用概率" />
                </div>

                <Section title="触发条件">
                  <Labeled label="主关键词 key" hint="命中任一关键词即可进入下一步；留空且非常驻 → 永不触发">
                    <TagInput values={selected.key || []} onChange={(v) => updateEntry(wb.name, selected.uid, { key: v }, `e:${selected.uid}:key`)} placeholder="输入关键词后回车" />
                  </Labeled>
                  <Labeled label="次关键词 keysecondary" hint="与 selectiveLogic 配合使用">
                    <TagInput values={selected.keysecondary || []} onChange={(v) => updateEntry(wb.name, selected.uid, { keysecondary: v }, `e:${selected.uid}:keys`)} placeholder="输入次关键词后回车" />
                  </Labeled>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <div className="grow" style={{ minWidth: 180 }}>
                      <Labeled label="选择性逻辑 selectiveLogic">
                        <select className="select" value={String(selected.selectiveLogic ?? 0)} onChange={(e) => updateEntry(wb.name, selected.uid, { selectiveLogic: Number(e.target.value) })}>
                          {Object.entries(WI_SELECTIVE_LOGIC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </Labeled>
                    </div>
                    <div style={{ width: 110 }}>
                      <Labeled label="触发概率 %">
                        <NumberInput value={selected.probability ?? 100} onChange={(v) => updateEntry(wb.name, selected.uid, { probability: v ?? 100 }, `e:${selected.uid}:prob`)} min={0} max={100} />
                      </Labeled>
                    </div>
                    <div style={{ width: 120 }}>
                      <Labeled label="扫描深度" hint="null=继承全局">
                        <NumberInput value={selected.scanDepth ?? null} onChange={(v) => updateEntry(wb.name, selected.uid, { scanDepth: v })} nullable />
                      </Labeled>
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 14 }}>
                    <div style={{ width: 160 }}>
                      <Labeled label="大小写 caseSensitive" hint="null=继承全局">
                        <select
                          className="select"
                          value={selected.caseSensitive === null || selected.caseSensitive === undefined ? '' : String(selected.caseSensitive)}
                          onChange={(e) => updateEntry(wb.name, selected.uid, { caseSensitive: e.target.value === '' ? null : e.target.value === 'true' })}
                        >
                          <option value="">继承</option>
                          <option value="true">区分</option>
                          <option value="false">不区分</option>
                        </select>
                      </Labeled>
                    </div>
                    <div style={{ width: 160 }}>
                      <Labeled label="整词 matchWholeWords" hint="null=继承全局">
                        <select
                          className="select"
                          value={selected.matchWholeWords === null || selected.matchWholeWords === undefined ? '' : String(selected.matchWholeWords)}
                          onChange={(e) => updateEntry(wb.name, selected.uid, { matchWholeWords: e.target.value === '' ? null : e.target.value === 'true' })}
                        >
                          <option value="">继承</option>
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      </Labeled>
                    </div>
                  </div>
                </Section>

                <Section title="插入设置">
                  <div className="row wrap" style={{ gap: 8 }}>
                    <div className="grow" style={{ minWidth: 180 }}>
                      <Labeled label="插入位置 position">
                        <select className="select" value={String(selected.position ?? 0)} onChange={(e) => updateEntry(wb.name, selected.uid, { position: Number(e.target.value) })}>
                          {Object.entries(WI_POSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                        </select>
                      </Labeled>
                    </div>
                    <div style={{ width: 90 }}>
                      <Labeled label="深度 depth">
                        <NumberInput value={selected.depth ?? 4} onChange={(v) => updateEntry(wb.name, selected.uid, { depth: v ?? 4 }, `e:${selected.uid}:depth`)} />
                      </Labeled>
                    </div>
                    <div style={{ width: 110 }}>
                      <Labeled label="角色 role">
                        <select className="select" value={String(selected.role ?? 0)} onChange={(e) => updateEntry(wb.name, selected.uid, { role: Number(e.target.value) })}>
                          {Object.entries(WI_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </Labeled>
                    </div>
                    <div style={{ width: 90 }}>
                      <Labeled label="顺序 order">
                        <NumberInput value={selected.order ?? 100} onChange={(v) => updateEntry(wb.name, selected.uid, { order: v ?? 100 }, `e:${selected.uid}:order`)} />
                      </Labeled>
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <div className="grow" style={{ minWidth: 180 }}>
                      <Labeled label="包含组 group" hint="同组条目在一次生成中只取一个；多组用逗号分隔">
                        <TextInput value={selected.group || ''} onChange={(v) => updateEntry(wb.name, selected.uid, { group: v }, `e:${selected.uid}:group`)} placeholder="例如：天气" />
                      </Labeled>
                    </div>
                    <div style={{ width: 100 }}>
                      <Labeled label="组权重">
                        <NumberInput value={selected.groupWeight ?? 100} onChange={(v) => updateEntry(wb.name, selected.uid, { groupWeight: v ?? 100 })} />
                      </Labeled>
                    </div>
                    <div style={{ paddingTop: 20 }}>
                      <Toggle checked={!!selected.groupOverride} onChange={(v) => updateEntry(wb.name, selected.uid, { groupOverride: v })} label="组覆盖" />
                    </div>
                  </div>
                </Section>

                <Section title="正文内容" right={<span className="faint" style={{ fontSize: 10.5 }}>{(selected.content?.length || 0).toLocaleString()} 字符 ≈ {estimateTokens(selected.content || '')} tok</span>}>
                  <div className="row mb6" style={{ gap: 4 }}>
                    <button className="btn sm" onClick={() => { setFullscreenContent(selected.content || ''); setFsOpen(true); }}>全屏编辑</button>
                    <button className="btn sm ghost" onClick={() => copy(selected.content || '', '正文')}>复制正文</button>
                    <span className="spacer" />
                    {!selected.content?.trim() ? <span className="badge warn">正文为空</span> : null}
                  </div>
                  <textarea
                    className="textarea mono"
                    rows={12}
                    value={selected.content || ''}
                    placeholder="写入会注入到提示词中的正文。支持 {{char}} / {{user}} 等宏。"
                    onChange={(e) => updateEntry(wb.name, selected.uid, { content: e.target.value }, `e:${selected.uid}:content`)}
                    spellCheck={false}
                  />
                </Section>

                <Section title="递归与时序" defaultOpen={false}>
                  <div className="row wrap" style={{ gap: 14 }}>
                    <Toggle checked={!!selected.excludeRecursion} onChange={(v) => updateEntry(wb.name, selected.uid, { excludeRecursion: v })} label="排除递归 excludeRecursion" />
                    <Toggle checked={!!selected.preventRecursion} onChange={(v) => updateEntry(wb.name, selected.uid, { preventRecursion: v })} label="阻止递归触发 preventRecursion" />
                    <Toggle checked={!!selected.delayUntilRecursion} onChange={(v) => updateEntry(wb.name, selected.uid, { delayUntilRecursion: v })} label="延迟到递归 delayUntilRecursion" />
                  </div>
                  <div className="row mt10" style={{ gap: 8 }}>
                    <div style={{ width: 100 }}>
                      <Labeled label="sticky">
                        <NumberInput value={selected.sticky ?? 0} onChange={(v) => updateEntry(wb.name, selected.uid, { sticky: v ?? 0 })} />
                      </Labeled>
                    </div>
                    <div style={{ width: 100 }}>
                      <Labeled label="cooldown">
                        <NumberInput value={selected.cooldown ?? 0} onChange={(v) => updateEntry(wb.name, selected.uid, { cooldown: v ?? 0 })} />
                      </Labeled>
                    </div>
                    <div style={{ width: 100 }}>
                      <Labeled label="delay">
                        <NumberInput value={selected.delay ?? 0} onChange={(v) => updateEntry(wb.name, selected.uid, { delay: v ?? 0 })} />
                      </Labeled>
                    </div>
                    <div className="faint" style={{ fontSize: 10.5, paddingTop: 22 }}>这三个字段依赖聊天时序状态，模拟器只展示数值、不计算状态机。</div>
                  </div>
                </Section>

                <Section title="其他字段" defaultOpen={false}>
                  <div className="row wrap" style={{ gap: 14 }}>
                    <Toggle checked={!!selected.vectorized} onChange={(v) => updateEntry(wb.name, selected.uid, { vectorized: v })} label="向量化 vectorized" />
                    <Toggle checked={!!selected.addMemo} onChange={(v) => updateEntry(wb.name, selected.uid, { addMemo: v })} label="addMemo" />
                    <Toggle checked={!!selected.useGroupScoring} onChange={(v) => updateEntry(wb.name, selected.uid, { useGroupScoring: v })} label="组内评分 useGroupScoring" />
                  </div>
                  <div className="row mt10" style={{ gap: 8 }}>
                    <div className="grow">
                      <Labeled label="automationId">
                        <TextInput value={selected.automationId || ''} onChange={(v) => updateEntry(wb.name, selected.uid, { automationId: v }, `e:${selected.uid}:auto`)} />
                      </Labeled>
                    </div>
                  </div>
                </Section>

                {unknownKeys.length ? (
                  <Section title={`未知字段（${unknownKeys.length}）`} defaultOpen={false}>
                    {unknownKeys.map((k) => (
                      <div key={k} className="row" style={{ padding: '3px 0', alignItems: 'flex-start' }}>
                        <span className="mono" style={{ color: 'var(--accent)', width: 140, flexShrink: 0 }}>{k}</span>
                        <span className="mono faint grow" style={{ fontSize: 11, wordBreak: 'break-all' }}>{formatJson(selected[k]).slice(0, 200)}</span>
                      </div>
                    ))}
                    <div className="faint mt6" style={{ fontSize: 10.5 }}>未知字段会原样保留并随导出写回，不会被删除。</div>
                  </Section>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* 检查器 */}
        <div className="pane">
          <PaneHeader title="检查器" right={<button className="btn sm" onClick={() => setSimOpen(true)}>触发模拟</button>} />
          <div className="pane-body pad">
            {wb ? (
              <>
                {stats ? (
                  <>
                    <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <Stat k="条目" v={stats.count} />
                      <Stat k="启用" v={stats.enabled} />
                      <Stat k="常驻" v={stats.constant} />
                      <Stat k="失效" v={stats.dead} />
                    </div>
                    <div className="mt10">
                      <KeyValue k="总字符">{stats.totalChars.toLocaleString()}（均值 {stats.avgChars}，最长 {stats.maxChars.toLocaleString()}）</KeyValue>
                      <KeyValue k="重复关键词">{stats.duplicateKeys} 组</KeyValue>
                      <KeyValue k="包含组">{stats.groups} 个</KeyValue>
                      <KeyValue k="空正文">{stats.emptyContent} 条</KeyValue>
                      <KeyValue k="导出形状">{wb.shape === 'array' ? '数组（卡片内嵌）' : '对象（独立文件）'}</KeyValue>
                      <KeyValue k="全局设置">{wb.root?.scan_depth !== undefined ? `scan_depth=${wb.root.scan_depth}，token_budget=${wb.root.token_budget ?? '—'}，recursive=${String(wb.root.recursive_scanning ?? '—')}` : '未设置'}</KeyValue>
                    </div>
                  </>
                ) : (
                  <div className="panel">
                    <div className="card-body">
                      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                        这是大世界书（{entries.length.toLocaleString()} 条）。为避免每次输入都全量统计，统计信息改为按需计算。
                      </div>
                      <button className="btn sm mt6" onClick={() => setStatsTick((n) => n + 1)}>计算统计</button>
                    </div>
                  </div>
                )}

                {selected ? (
                  <>
                    <div className="divider" />
                    <Section title="当前条目" dense>
                      <KeyValue k="插入位置">{WI_POSITION_LABELS[selected.position ?? 0]}</KeyValue>
                      <KeyValue k="深度 / 角色">{selected.position === 4 ? `${selected.depth} / ${WI_ROLE_LABELS[selected.role ?? 0]}` : '—'}</KeyValue>
                      <KeyValue k="触发">{selected.disable ? '已禁用' : selected.constant ? '常驻（无条件）' : (selected.key || []).length ? `关键词 ${selected.key.join(' / ')}` : '⚠ 无关键词且非常驻 → 永不触发'}</KeyValue>
                      <KeyValue k="顺序 order">{selected.order ?? 100}（越大越靠前）</KeyValue>
                      {selected.group ? <KeyValue k="包含组">{selected.group}（权重 {selected.groupWeight ?? 100}{selected.groupOverride ? '，组覆盖' : ''}）</KeyValue> : null}
                    </Section>

                    <Section title="关键词信息" dense defaultOpen={false}>
                      {(selected.key || []).length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>无</div> : null}
                      {(selected.key || []).map((k, i) => {
                        const others = entries.filter((e) => e.uid !== selected.uid && (e.key || []).some((x) => x.toLowerCase() === k.toLowerCase()));
                        return (
                          <div key={i} className="row" style={{ fontSize: 11.5, padding: '2px 0' }}>
                            <span className="chip on">{k}</span>
                            <span className="spacer" />
                            {others.length ? <span className="badge warn" title={others.map((o) => `#${o.uid} ${o.comment}`).join('\n')}>另 {others.length} 条共用</span> : <span className="faint" style={{ fontSize: 10 }}>唯一</span>}
                          </div>
                        );
                      })}
                    </Section>

                    <Section title="原始条目 JSON" dense defaultOpen={false}>
                      <CodeArea value={formatJson(selected)} readOnly language="json" wrap={false} minHeight={200} />
                    </Section>
                  </>
                ) : null}

                <div className="divider" />
                <button
                  className="btn sm w100"
                  onClick={() => {
                    const s = simOpen;
                    setSimOpen(true);
                    void s;
                  }}
                >
                  打开触发模拟面板
                </button>
                <div className="faint mt6" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
                  世界书改动会即时反映到人物卡的 character_book（需点击「同步到卡片」），或仅保存在项目的独立副本中。
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* 重命名 */}
      <Modal
        open={renameOpen}
        title="重命名世界书"
        onClose={() => setRenameOpen(false)}
        width="narrow"
        footer={<><button className="btn ghost" onClick={() => setRenameOpen(false)}>取消</button><button className="btn primary" onClick={doRename}>保存</button></>}
      >
        <Labeled label="名称" hint="内嵌世界书会同时更新 character_book.name">
          <TextInput value={renameText} onChange={setRenameText} onEnter={doRename} />
        </Labeled>
      </Modal>

      {/* 合并 */}
      <Modal
        open={mergeOpen}
        title="合并世界书"
        onClose={() => setMergeOpen(false)}
        footer={<><button className="btn ghost" onClick={() => setMergeOpen(false)}>取消</button><button className="btn primary" onClick={doMerge} disabled={!mergeSrc}>合并</button></>}
      >
        <Labeled label="来源世界书" hint="来源的条目会被追加到当前世界书">
          <select className="select" value={mergeSrc} onChange={(e) => setMergeSrc(e.target.value)}>
            <option value="">请选择…</option>
            {doc.worldbooks.filter((w) => w.name !== wb.name).map((w) => (
              <option key={w.name} value={w.name}>{w.name}（{w.entries.length} 条）</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="UID 冲突处理">
          <select className="select" value={mergeUid} onChange={(e) => setMergeUid(e.target.value as any)}>
            <option value="reassign">冲突时重新分配 UID（推荐）</option>
            <option value="keep">保留原 UID（可能产生重复）</option>
          </select>
        </Labeled>
        <Labeled label="关键词去重">
          <select className="select" value={mergeKey} onChange={(e) => setMergeKey(e.target.value as any)}>
            <option value="append">全部追加</option>
            <option value="skip-if-key-exists">已有相同关键词时跳过</option>
          </select>
        </Labeled>
      </Modal>

      {/* 批量设置 */}
      <Modal open={bulkOpen} title={`批量设置 ${selection.size} 个条目`} onClose={() => setBulkOpen(false)} footer={<button className="btn" onClick={() => setBulkOpen(false)}>关闭</button>}>
        <div className="faint mb6" style={{ fontSize: 11.5 }}>选择要应用的字段（留空表示不修改）：</div>
        <div className="row" style={{ gap: 8 }}>
          <div className="grow">
            <Labeled label="插入位置">
              <select className="select" defaultValue="" onChange={(e) => { if (e.target.value !== '') bulkUpdate(wb.name, [...selection], { position: Number(e.target.value) }); }}>
                <option value="">不修改</option>
                {Object.entries(WI_POSITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Labeled>
          </div>
          <div style={{ width: 100 }}>
            <Labeled label="深度">
              <NumberInput value={null} onChange={(v) => { if (v != null) bulkUpdate(wb.name, [...selection], { depth: v }); }} nullable placeholder="不改" />
            </Labeled>
          </div>
          <div style={{ width: 110 }}>
            <Labeled label="顺序 order">
              <NumberInput value={null} onChange={(v) => { if (v != null) bulkUpdate(wb.name, [...selection], { order: v }); }} nullable placeholder="不改" />
            </Labeled>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="grow">
            <Labeled label="包含组">
              <TextInput value="" onChange={(v) => { if (v) bulkUpdate(wb.name, [...selection], { group: v }); }} placeholder="输入后立即应用" />
            </Labeled>
          </div>
          <div style={{ width: 110 }}>
            <Labeled label="扫描深度">
              <NumberInput value={null} onChange={(v) => { if (v != null) bulkUpdate(wb.name, [...selection], { scanDepth: v }); }} nullable placeholder="不改" />
            </Labeled>
          </div>
        </div>
        <div className="row wrap mt10" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => bulkUpdate(wb.name, [...selection], { constant: true })}>设为常驻</button>
          <button className="btn sm" onClick={() => bulkUpdate(wb.name, [...selection], { constant: false })}>取消常驻</button>
          <button className="btn sm" onClick={() => bulkUpdate(wb.name, [...selection], { useProbability: true, probability: 100 })}>概率设为 100%</button>
          <button className="btn sm" onClick={() => fixUids(wb.name)}>修复重复 UID</button>
        </div>
      </Modal>

      {/* JSON 编辑 */}
      <Modal
        open={jsonEditing}
        title={`编辑世界书 JSON · ${wb.name}`}
        width="wide"
        onClose={() => setJsonEditing(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setJsonEditing(false)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonDraft);
                  const next = parseWorldbook(parsed, { name: wb.name, origin: wb.origin, embeddedInCard: wb.embeddedInCard });
                  mutate('整体替换世界书 JSON', (d) => {
                    const target = d.worldbooks.find((w) => w.name === wb.name);
                    if (!target) return;
                    target.entries = next.entries;
                    target.root = next.root;
                    target.shape = next.shape;
                  });
                  setJsonEditing(false);
                  toast('success', `已替换为 ${next.entries.length} 个条目`);
                } catch (e: any) {
                  toast('error', `解析失败：${e.message}`);
                }
              }}
            >
              解析并替换
            </button>
          </>
        }
      >
        <div className="faint mb6" style={{ fontSize: 11.5 }}>格式：<span className="code-inline">{'{"entries":{"0":{"key":[],"content":""}}}'}</span>。替换会覆盖当前世界书全部条目（可撤销）。</div>
        <CodeArea value={jsonDraft} onChange={setJsonDraft} language="json" minHeight={420} />
      </Modal>

      {/* 全屏正文 */}
      <Modal
        open={fsOpen}
        title={`全屏编辑正文 · #${selected?.uid ?? ''}`}
        width="wide"
        onClose={() => setFsOpen(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setFsOpen(false)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                if (selected && fullscreenContent != null) updateEntry(wb.name, selected.uid, { content: fullscreenContent });
                setFsOpen(false);
              }}
            >
              应用
            </button>
          </>
        }
      >
        {fullscreenContent != null ? <CodeArea value={fullscreenContent} onChange={setFullscreenContent} language="text" minHeight={440} /> : null}
      </Modal>

      {simOpen ? <WorldbookSim wb={wb} open={simOpen} onClose={() => setSimOpen(false)} /> : null}
      {ctx.node}
    </div>
  );
}

/* ------------------------------------------------------------ 关键词索引 */

function KeywordIndex({ entries, onPick }: { entries: WorldbookEntry[]; onPick: (k: string) => void }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const e of entries) {
      for (const k of e.key || []) {
        const key = (k || '').trim();
        if (!key) continue;
        const arr = map.get(key) || [];
        if (!arr.includes(e.uid)) arr.push(e.uid);
        map.set(key, arr);
      }
    }
    let list = Array.from(map.entries()).map(([key, uids]) => ({ key, uids }));
    if (q.trim()) list = list.filter((x) => x.key.toLowerCase().includes(q.toLowerCase()));
    list.sort((a, b) => b.uids.length - a.uids.length || a.key.localeCompare(b.key, 'zh-CN'));
    return list;
  }, [entries, q]);

  return (
    <div>
      <div style={{ padding: 8 }}>
        <input className="input sm" placeholder="筛选关键词…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="table">
        <thead>
          <tr><th>关键词</th><th style={{ width: 80 }}>条目数</th><th>关联 UID</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 2000).map((r) => (
            <tr key={r.key}>
              <td>
                <button className="btn ghost sm" onClick={() => onPick(r.key)} title="用该关键词搜索">
                  <span className="mono" style={{ color: r.uids.length > 1 ? 'var(--warn)' : 'var(--text)' }}>{r.key}</span>
                </button>
              </td>
              <td className="num">{r.uids.length}</td>
              <td className="mono faint" style={{ fontSize: 10.5 }}>{r.uids.slice(0, 12).join(', ')}{r.uids.length > 12 ? ' …' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="faint pad10">没有关键词。</div> : null}
      {rows.length > 2000 ? <div className="faint pad10" style={{ fontSize: 11 }}>仅显示前 2000 个关键词（共 {rows.length}）。</div> : null}
    </div>
  );
}


/* ------------------------------------------------------------ 关系视图 */

function RelationsView({ entries, onPick }: { entries: WorldbookEntry[]; onPick: (uid: number) => void }) {
  const data = useMemo(() => {
    const groups = new Map<string, WorldbookEntry[]>();
    const keyword = new Map<string, WorldbookEntry[]>();
    for (const e of entries) {
      for (const g of String(e.group || '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const arr = groups.get(g) || [];
        arr.push(e);
        groups.set(g, arr);
      }
      for (const k of e.key || []) {
        const key = String(k).trim().toLowerCase();
        if (!key) continue;
        const arr = keyword.get(key) || [];
        arr.push(e);
        keyword.set(key, arr);
      }
    }
    return {
      groups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length),
      shared: [...keyword.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length),
    };
  }, [entries]);

  if (!entries.length) return <Empty icon="◈" title="没有条目" />;

  return (
    <div>
      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        关系视图展示两类结构：<b>包含组</b>（同组条目在一次生成中竞争）与<b>共用关键词</b>（会被同一段文本同时触发）。
        这是静态关系，不等于运行时一定同时注入。
      </div>

      <div className="section-title mt16">包含组（{data.groups.length}）</div>
      {data.groups.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>没有条目配置包含组。</div> : null}
      {data.groups.map(([g, list]) => (
        <div className="panel mb6" key={g}>
          <div className="card-body" style={{ padding: 9 }}>
            <div className="row">
              <span className="badge purple">{g}</span>
              <span className="faint" style={{ fontSize: 11 }}>{list.length} 个条目</span>
              <span className="spacer" />
              <span className="faint" style={{ fontSize: 10.5 }}>总权重 {list.reduce((n, e) => n + (e.groupWeight ?? 100), 0)}</span>
            </div>
            <div className="row wrap mt6" style={{ gap: 4 }}>
              {list.map((e) => (
                <button key={e.uid} className="chip on" title={`#${e.uid} 权重 ${e.groupWeight ?? 100}`} onClick={() => onPick(e.uid)}>
                  #{e.uid} {e.comment || '无备注'} · {e.groupWeight ?? 100}{e.groupOverride ? ' · 覆盖' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}

      <div className="section-title mt16">共用关键词（{data.shared.length}）</div>
      {data.shared.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>没有跨条目共用的关键词。</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
        {data.shared.slice(0, 200).map(([k, list]) => (
          <div className="panel" key={k}>
            <div className="card-body" style={{ padding: 8 }}>
              <div className="row">
                <span className="mono" style={{ color: 'var(--warn)', fontSize: 11.5 }}>{k}</span>
                <span className="spacer" />
                <span className="faint" style={{ fontSize: 10 }}>{list.length} 条</span>
              </div>
              <div className="row wrap mt6" style={{ gap: 3 }}>
                {list.map((e) => (
                  <button key={e.uid} className="chip" onClick={() => onPick(e.uid)}>#{e.uid} {e.comment || ''}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {data.shared.length > 200 ? <div className="faint mt6" style={{ fontSize: 11 }}>仅显示前 200 组共用关键词。</div> : null}
    </div>
  );
}
