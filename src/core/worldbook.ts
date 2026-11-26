import type { AnyRecord, NormalizedWorldbook, WorldbookEntry, WorldbookShape } from './types';
import { clone, isPlainObject } from './util';

/** SillyTavern 世界书条目的默认值（依据世界书编辑器的建条默认） */
export const ENTRY_DEFAULTS: Partial<WorldbookEntry> = {
  key: [],
  keysecondary: [],
  comment: '',
  content: '',
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  order: 100,
  position: 0,
  disable: false,
  excludeRecursion: false,
  preventRecursion: false,
  delayUntilRecursion: false,
  probability: 100,
  useProbability: true,
  depth: 4,
  group: '',
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  role: 0,
  sticky: 0,
  cooldown: 0,
  delay: 0,
  displayIndex: 0,
};

export function createEntry(uid: number, init?: Partial<WorldbookEntry>): WorldbookEntry {
  return { ...clone(ENTRY_DEFAULTS), uid, ...(init || {}) } as WorldbookEntry;
}

/* ------------------------------------------------------------ 解析 / 归一化 */

export interface ParseWorldbookOptions {
  name?: string;
  origin?: NormalizedWorldbook['origin'];
  embeddedInCard?: boolean;
}

export function parseWorldbook(json: any, opts: ParseWorldbookOptions = {}): NormalizedWorldbook {
  let shape: WorldbookShape = 'record';
  let rawEntries: any[] = [];
  let root: AnyRecord = {};

  if (Array.isArray(json)) {
    // 裸条目数组
    shape = 'array';
    rawEntries = json;
    root = { entries: json };
  } else if (isPlainObject(json)) {
    if (Array.isArray(json.entries)) {
      shape = 'array';
      rawEntries = json.entries;
      root = json;
    } else if (isPlainObject(json.entries)) {
      shape = 'record';
      root = json;
      rawEntries = Object.keys(json.entries)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({ uid: Number(k), ...json.entries[k] }));
    } else {
      // 尝试裸 record：{"0": {...}}
      const keys = Object.keys(json);
      const looksBare = keys.length > 0 && keys.every((k) => /^\d+$/.test(k) && isPlainObject(json[k]));
      if (looksBare) {
        shape = 'bare';
        root = { entries: json };
        rawEntries = keys
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => ({ uid: Number(k), ...json[k] }));
      } else {
        throw new Error('无法识别世界书结构：缺少 entries 字段（应为对象或数组）');
      }
    }
  } else {
    throw new Error('世界书根节点必须是 JSON 对象或条目数组');
  }

  const entries: WorldbookEntry[] = rawEntries.map((e, i) => normalizeEntry(e, i));
  // displayIndex 仅用于编辑期排序，缺失时按读入顺序补
  entries.forEach((e, i) => {
    if (typeof e.displayIndex !== 'number') e.displayIndex = i;
  });

  return {
    name: opts.name || root.name || root.title || '未命名世界书',
    root,
    shape,
    entries,
    origin: opts.origin || 'file',
    embeddedInCard: opts.embeddedInCard,
  };
}

export function normalizeEntry(raw: any, fallbackUid = 0): WorldbookEntry {
  const src = isPlainObject(raw) ? raw : {};
  const e: WorldbookEntry = { ...clone(src) } as WorldbookEntry;
  if (typeof e.uid !== 'number' || !Number.isFinite(e.uid)) e.uid = fallbackUid;
  if (!Array.isArray(e.key)) e.key = typeof e.key === 'string' && e.key ? [e.key] : [];
  if (!Array.isArray(e.keysecondary)) e.keysecondary = typeof e.keysecondary === 'string' && e.keysecondary ? [e.keysecondary] : [];
  if (typeof e.content !== 'string') e.content = e.content == null ? '' : String(e.content);
  if (typeof e.comment !== 'string') e.comment = e.comment == null ? '' : String(e.comment);
  // 只补「缺失」的编辑辅助字段，不覆盖已有值（包括 null，null 表示继承全局）
  for (const [k, v] of Object.entries(ENTRY_DEFAULTS)) {
    if (!(k in e)) (e as any)[k] = clone(v);
  }
  return e;
}

/* ------------------------------------------------------------------- 导出 */

/** 导出为 SillyTavern 世界书文件（entries 为以 uid 为键的对象） */
export function exportWorldbookFile(wb: NormalizedWorldbook, opts: { keepExtraRoot?: boolean } = {}): AnyRecord {
  const entries: Record<string, any> = {};
  const sorted = [...wb.entries].sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0));
  for (const e of sorted) {
    const copy = clone(e);
    delete copy.displayIndex; // 编辑期字段，不写入文件
    entries[String(e.uid)] = copy;
  }
  const base: AnyRecord = { ...(opts.keepExtraRoot === false ? {} : pickRootExtras(wb.root)) };
  base.entries = entries;
  if (!base.name && wb.name && wb.origin !== 'card') base.name = wb.name;
  return base;
}

/** 导出为 V2/V3 character_book.entries 数组 */
export function exportWorldbookArray(wb: NormalizedWorldbook): WorldbookEntry[] {
  return [...wb.entries]
    .sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0))
    .map((e) => {
      const copy = clone(e);
      delete copy.displayIndex;
      return copy;
    });
}

/** 写回卡片 character_book */
export function syncWorldbookToCard(wb: NormalizedWorldbook, book: AnyRecord): void {
  book.entries = exportWorldbookArray(wb);
  if (book.name === undefined && wb.name) book.name = wb.name;
}

function pickRootExtras(root: AnyRecord): AnyRecord {
  const out: AnyRecord = {};
  for (const k of Object.keys(root || {})) {
    if (k === 'entries') continue;
    out[k] = clone(root[k]);
  }
  return out;
}

/* ------------------------------------------------------------------- 工具 */

export function nextUid(entries: WorldbookEntry[]): number {
  let max = -1;
  for (const e of entries) if (typeof e.uid === 'number' && e.uid > max) max = e.uid;
  return max + 1;
}

export function uidConflicts(entries: WorldbookEntry[]): Map<number, WorldbookEntry[]> {
  const map = new Map<number, WorldbookEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.uid) || [];
    arr.push(e);
    map.set(e.uid, arr);
  }
  for (const [k, v] of map) if (v.length < 2) map.delete(k);
  return map;
}

export function emptyEntries(entries: WorldbookEntry[]): WorldbookEntry[] {
  return entries.filter((e) => !e.content?.trim() && !e.key?.length && !e.comment?.trim());
}

/** 重复关键词：同一条目内重复 + 跨条目重复 */
export interface KeyConflict {
  key: string;
  entries: number[];
  kind: 'within' | 'across';
}

export function keyConflicts(entries: WorldbookEntry[]): KeyConflict[] {
  const out: KeyConflict[] = [];
  // 按「条目身份」而非 uid 去重：同一关键词在两条 UID 相同的条目上也应被发现
  const index = new Map<string, Map<number, number>>();
  entries.forEach((e, ei) => {
    const seen = new Set<string>();
    for (const k of e.key || []) {
      const key = String(k).trim();
      if (!key) continue;
      const norm = key.toLowerCase();
      if (seen.has(norm)) out.push({ key, entries: [e.uid], kind: 'within' });
      seen.add(norm);
      let m = index.get(norm);
      if (!m) {
        m = new Map();
        index.set(norm, m);
      }
      if (!m.has(ei)) m.set(ei, e.uid);
    }
  });
  for (const [key, m] of index) {
    if (m.size > 1) out.push({ key, entries: Array.from(m.values()), kind: 'across' });
  }
  return out;
}

/** 无关键词且非常驻 → 永远不会触发 */
export function deadEntries(entries: WorldbookEntry[]): WorldbookEntry[] {
  return entries.filter((e) => !e.disable && !e.constant && (!e.key || !e.key.filter((k) => String(k).trim()).length));
}

export interface WorldbookStats {
  count: number;
  enabled: number;
  disabled: number;
  constant: number;
  selective: number;
  totalChars: number;
  avgChars: number;
  maxChars: number;
  emptyContent: number;
  withSecondary: number;
  groups: number;
  duplicateKeys: number;
  dead: number;
}

export function worldbookStats(entries: WorldbookEntry[]): WorldbookStats {
  let enabled = 0,
    disabled = 0,
    constant = 0,
    selective = 0,
    totalChars = 0,
    maxChars = 0,
    emptyContent = 0,
    withSecondary = 0;
  const groups = new Set<string>();
  for (const e of entries) {
    if (e.disable) disabled++;
    else enabled++;
    if (e.constant) constant++;
    if (e.selective) selective++;
    const len = (e.content || '').length;
    totalChars += len;
    if (len > maxChars) maxChars = len;
    if (!e.content?.trim()) emptyContent++;
    if ((e.keysecondary || []).length) withSecondary++;
    if (e.group) for (const g of String(e.group).split(',')) if (g.trim()) groups.add(g.trim());
  }
  return {
    count: entries.length,
    enabled,
    disabled,
    constant,
    selective,
    totalChars,
    avgChars: entries.length ? Math.round(totalChars / entries.length) : 0,
    maxChars,
    emptyContent,
    withSecondary,
    groups: groups.size,
    duplicateKeys: keyConflicts(entries).filter((c) => c.kind === 'across').length,
    dead: deadEntries(entries).length,
  };
}

/* ------------------------------------------------------------------- 合并 */

export interface MergeOptions {
  uidStrategy: 'keep' | 'reassign';
  keyStrategy: 'append' | 'skip-if-key-exists';
}

export interface MergeReport {
  added: number;
  skipped: number;
  uidRemapped: number;
  warnings: string[];
}

export function mergeWorldbooks(
  base: NormalizedWorldbook,
  incoming: NormalizedWorldbook,
  opts: MergeOptions = { uidStrategy: 'reassign', keyStrategy: 'append' },
): MergeReport {
  const report: MergeReport = { added: 0, skipped: 0, uidRemapped: 0, warnings: [] };
  const used = new Set(base.entries.map((e) => e.uid));
  const existingKeys = new Set(base.entries.flatMap((e) => (e.key || []).map((k) => String(k).toLowerCase())));
  let cursor = nextUid(base.entries);
  const startIndex = base.entries.length;

  for (const raw of incoming.entries) {
    const e = clone(raw);
    if (opts.keyStrategy === 'skip-if-key-exists') {
      const hit = (e.key || []).some((k) => existingKeys.has(String(k).toLowerCase()));
      if (hit) {
        report.skipped++;
        continue;
      }
    }
    if (opts.uidStrategy === 'reassign' || used.has(e.uid)) {
      if (used.has(e.uid)) report.uidRemapped++;
      e.uid = cursor++;
      used.add(e.uid);
    } else {
      used.add(e.uid);
    }
    e.displayIndex = startIndex + report.added;
    base.entries.push(e);
    for (const k of e.key || []) existingKeys.add(String(k).toLowerCase());
    report.added++;
  }
  if (report.uidRemapped) report.warnings.push(`${report.uidRemapped} 个条目因 UID 冲突被重新分配。`);
  return report;
}

/* --------------------------------------------------------------- 索引/搜索 */

export interface EntrySearchHit {
  uid: number;
  field: string;
  preview: string;
}

export function searchEntriesLocal(entries: WorldbookEntry[], query: string, limit = 50): EntrySearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: EntrySearchHit[] = [];
  for (const e of entries) {
    const fields: [string, string][] = [
      ['comment', e.comment || ''],
      ['content', e.content || ''],
      ['key', (e.key || []).join(', ')],
      ['keysecondary', (e.keysecondary || []).join(', ')],
      ['uid', String(e.uid)],
    ];
    for (const [field, text] of fields) {
      const idx = text.toLowerCase().indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        hits.push({ uid: e.uid, field, preview: (start ? '…' : '') + text.slice(start, idx + q.length + 50).replace(/\n/g, ' ') });
        break;
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

/** 关键词倒排索引：keyword -> uids */
export function buildKeywordIndex(entries: WorldbookEntry[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const e of entries) {
    for (const k of e.key || []) {
      const key = String(k).trim().toLowerCase();
      if (!key) continue;
      const arr = index.get(key) || [];
      arr.push(e.uid);
      index.set(key, arr);
    }
  }
  return index;
}

/** 创建空世界书 */
export function createWorldbook(name = '新建世界书'): NormalizedWorldbook {
  return {
    name,
    root: { entries: {}, name },
    shape: 'record',
    entries: [],
    origin: 'new',
  };
}
