import { create } from 'zustand';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type {
  DocState,
  EditorTab,
  MvuState,
  NormalizedCard,
  NormalizedWorldbook,
  PageKey,
  ProjectMeta,
  RegexPreset,
  ScriptCollection,
  TavernScript,
  ValidationIssue,
  WorldbookEntry,
} from '../core/types';
import { createBlankCard, normalizeCard, serializeCard } from '../core/card';
import { createWorldbook, nextUid, parseWorldbook } from '../core/worldbook';
import { createRegexScript, normalizeRegexScript } from '../core/regex';
import { createScript, normalizeScript } from '../core/scripts';
import { buildMvuState } from '../core/mvu';
import { validateAll } from '../core/validate';
import { extractEmbeddedWorldbook } from '../core/importer';
import { createSampleProject } from '../core/sample';
import { idbGet, idbSet, storageKeys } from '../core/idb';
import { clone, debounce, nowIso, uuid } from '../core/util';
import { checkSyntax } from '../core/scripts';

enablePatches();

/* ------------------------------------------------------------------ 类型 */

export interface HistoryEntry {
  label: string;
  forward: Patch[];
  inverse: Patch[];
  at: number;
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
}

export interface Settings {
  theme: 'dark' | 'light';
  fontSize: number;
  autosave: boolean;
  autosaveMs: number;
  editorFont: string;
  showLineNumbers: boolean;
  wordWrap: boolean;
  confirmDelete: boolean;
  simRecursion: boolean;
  simRollProbability: boolean;
  simSeed: number;
  regexTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 13,
  autosave: true,
  autosaveMs: 1200,
  editorFont: '"JetBrains Mono", "Cascadia Code", Consolas, "Microsoft YaHei", monospace',
  showLineNumbers: true,
  wordWrap: true,
  confirmDelete: true,
  simRecursion: true,
  simRollProbability: true,
  simSeed: 20261126,
  regexTimeoutMs: 300,
};

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface UiState {
  page: PageKey;
  tabs: EditorTab[];
  activeTabId: string;
  selectedWorldbook: string;
  selectedEntryUid: number | null;
  selectedRegexId: string | null;
  selectedScriptId: string | null;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  bottomOpen: boolean;
  bottomTab: 'problems' | 'search' | 'log';
  searchOpen: boolean;
  settingsOpen: boolean;
  toasts: Toast[];
  logs: { at: number; text: string; kind: 'info' | 'error' | 'success' }[];
  busy: string | null;
}

export interface AppState extends UiState {
  doc: DocState;
  settings: Settings;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  history: HistoryEntry[];
  future: HistoryEntry[];

  /* 基础 */
  init: () => Promise<void>;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
  log: (text: string, kind?: 'info' | 'error' | 'success') => void;
  setPage: (page: PageKey, target?: string) => void;
  openTab: (page: PageKey, label: string, target?: string) => void;
  closeTab: (id: string) => void;
  setTab: (id: string) => void;
  select: (patch: Partial<Pick<UiState, 'selectedWorldbook' | 'selectedEntryUid' | 'selectedRegexId' | 'selectedScriptId'>>) => void;
  setUi: (patch: Partial<UiState>) => void;
  setSettings: (patch: Partial<Settings>) => void;

  /* 文档变更 */
  mutate: (label: string, recipe: (d: DocState) => void, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /* 项目 */
  newProject: (name?: string) => void;
  loadSample: () => void;
  createBlankProject: () => void;
  openProject: (id: string) => Promise<void>;
  openCard: (card: NormalizedCard, fileName?: string) => void;
  addWorldbook: (wb: NormalizedWorldbook) => void;
  addRegexPreset: (p: RegexPreset) => void;
  addScriptCollection: (c: ScriptCollection) => void;
  removeWorldbook: (name: string) => void;
  syncCardBook: () => void;
  refreshMvu: (opts?: { keepStat?: boolean }) => void;
  importFloors: (floors: { index: number; statData: any; label?: string }[]) => void;
  setStatData: (data: any) => void;
  runValidation: () => ValidationIssue[];
  snapshotBaseline: (label: string) => void;

  /* 世界书 */
  addEntry: (wbName: string, init?: Partial<WorldbookEntry>) => number;
  updateEntry: (wbName: string, uid: number, patch: Partial<WorldbookEntry>, coalesce?: string) => void;
  deleteEntries: (wbName: string, uids: number[]) => void;
  duplicateEntry: (wbName: string, uid: number) => void;
  bulkUpdate: (wbName: string, uids: number[], patch: Partial<WorldbookEntry>) => void;
  reorderEntries: (wbName: string, uids: number[]) => void;
  fixUids: (wbName: string) => void;

  /* 正则 */
  addRegex: (presetName: string, init?: Partial<import('../core/types').RegexScript>) => string;
  updateRegex: (presetName: string, id: string, patch: Partial<import('../core/types').RegexScript>, coalesce?: string) => void;
  deleteRegex: (presetName: string, id: string) => void;
  moveRegex: (presetName: string, id: string, dir: -1 | 1) => void;

  /* 脚本 */
  addScript: (index: number) => string;
  updateScript: (index: number, id: string, patch: Partial<TavernScript>, coalesce?: string) => void;
  deleteScript: (index: number, id: string) => void;
  moveScript: (index: number, id: string, dir: -1 | 1) => void;

  /* 持久化 */
  saveNow: () => Promise<void>;
}

/* ------------------------------------------------------------- 序列化 */

export function emptyDoc(name = '未命名项目'): DocState {
  return {
    meta: { id: uuid(), name, createdAt: Date.now(), updatedAt: Date.now() },
    card: null,
    worldbooks: [],
    regexes: [],
    scripts: [],
    mvu: null,
    mvuFloors: [],
    baselines: [],
    issues: [],
  };
}

/** 持久化时避免 card.data 与 card.root.data 重复存储 */
export function serializeDoc(doc: DocState): string {
  const card = doc.card;
  const payload = {
    ...doc,
    card: card
      ? {
          version: card.version,
          specVersion: card.specVersion,
          root: card.root,
          rootExtra: card.rootExtra,
          image: card.image,
        }
      : null,
    worldbooks: doc.worldbooks.map((w) => {
      if (w.embeddedInCard) return { ...w, root: {} };
      // 独立世界书的 root 往往包含完整的 entries 原对象，持久化时去掉以避免体积翻倍；
      // 导出时 exportWorldbookFile 会从归一化条目重建 entries。
      const root: Record<string, any> = {};
      for (const [k, v] of Object.entries(w.root || {})) {
        if (k === 'entries') continue;
        root[k] = v;
      }
      return { ...w, root };
    }),
  };
  return JSON.stringify(payload);
}

export function deserializeDoc(text: string): DocState {
  const raw = JSON.parse(text);
  let card: NormalizedCard | null = null;
  if (raw.card) {
    card = normalizeCard(raw.card.root, raw.card.image);
    card.version = raw.card.version ?? card.version;
    card.rootExtra = raw.card.rootExtra ?? card.rootExtra;
  }
  const worldbooks: NormalizedWorldbook[] = (raw.worldbooks || []).map((w: any) => ({
    ...w,
    root: w.embeddedInCard && card ? card.data.character_book ?? {} : w.root ?? {},
  }));
  return {
    ...emptyDoc(),
    ...raw,
    card,
    worldbooks,
    issues: raw.issues || [],
  };
}

/* ------------------------------------------------------------- 保存调度 */

let hugeSaveTimer: any = null;

/** 大项目（条目多）降频自动保存，避免每次输入都序列化数十 MB */
function scheduleSave(get: () => AppState, set: (p: Partial<AppState>) => void) {
  const state = get();
  const entryCount = state.doc.worldbooks.reduce((n, w) => n + w.entries.length, 0);
  if (entryCount > 15000) {
    if (hugeSaveTimer) return;
    hugeSaveTimer = setTimeout(() => {
      hugeSaveTimer = null;
      save(get, set);
    }, 5000);
    return;
  }
  save(get, set);
}

const save = debounce(async (get: () => AppState, set: (p: Partial<AppState>) => void) => {
  const state = get();
  if (!state.doc) return;
  set({ saveStatus: 'saving' });
  try {
    const text = serializeDoc(state.doc);
    await idbSet(storageKeys.project(state.doc.meta.id), { id: state.doc.meta.id, updatedAt: Date.now(), json: text });
    const idx = (await idbGet<ProjectMeta[]>(storageKeys.projectIndex)) || [];
    const meta = { ...state.doc.meta, updatedAt: Date.now() };
    const next = [meta, ...idx.filter((m) => m.id !== meta.id)].slice(0, 30);
    await idbSet(storageKeys.projectIndex, next);
    await idbSet(storageKeys.lastProject, state.doc.meta.id);
    set({ saveStatus: 'saved', lastSavedAt: Date.now() });
  } catch (e: any) {
    set({ saveStatus: 'error' });
    get().log(`自动保存失败：${e?.message || e}`, 'error');
  }
}, 900);

/* ------------------------------------------------------------------ Store */

const SAMPLE = createSampleProject();

export const useStore = create<AppState>((set, get) => ({
  /* ---------------- UI 初始值 ---------------- */
  page: 'home',
  tabs: [{ id: 'home', label: '项目首页', page: 'home' }],
  activeTabId: 'home',
  selectedWorldbook: '',
  selectedEntryUid: null,
  selectedRegexId: null,
  selectedScriptId: null,
  sidebarOpen: true,
  inspectorOpen: true,
  bottomOpen: true,
  bottomTab: 'problems',
  searchOpen: false,
  settingsOpen: false,
  toasts: [],
  logs: [{ at: Date.now(), text: 'CardForge 已启动（本地模式，无任何网络请求）', kind: 'info' }],
  busy: null,

  doc: emptyDoc('新项目'),
  settings: DEFAULT_SETTINGS,
  saveStatus: 'idle',
  lastSavedAt: null,
  history: [],
  future: [],

  /* ---------------- 基础 ---------------- */
  init: async () => {
    const settings = (await idbGet<Settings>(storageKeys.settings)) || DEFAULT_SETTINGS;
    set({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    document.documentElement.dataset.theme = (settings.theme || 'dark') === 'light' ? 'light' : 'dark';

    const lastId = await idbGet<string>(storageKeys.lastProject);
    if (lastId) {
      const saved = await idbGet<{ json: string }>(storageKeys.project(lastId));
      if (saved?.json) {
        try {
          const doc = deserializeDoc(saved.json);
          const wbName = doc.worldbooks[0]?.name || '';
          set({
            doc,
            saveStatus: 'saved',
            lastSavedAt: Date.now(),
            selectedWorldbook: wbName,
            selectedEntryUid: doc.worldbooks[0]?.entries[0]?.uid ?? null,
            selectedRegexId: doc.regexes[0]?.scripts[0]?.id ?? null,
            selectedScriptId: doc.scripts[0]?.scripts[0]?.id ?? null,
            history: [],
            future: [],
          });
          get().log(`已恢复上次项目「${doc.meta.name}」`);
          return;
        } catch (e: any) {
          get().log(`上次项目恢复失败：${e?.message || e}`, 'error');
        }
      }
    }
    get().loadSample();
    get().log('首次启动：已载入内置示例项目');
  },

  toast: (kind, text) => {
    const t = { id: uuid(), kind, text };
    set({ toasts: [...get().toasts, t] });
    setTimeout(() => get().dismissToast(t.id), kind === 'error' ? 7000 : 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  log: (text, kind = 'info') => set({ logs: [...get().logs.slice(-199), { at: Date.now(), text, kind }] }),

  setPage: (page, target) => {
    const existing = get().tabs.find((t) => t.page === page);
    if (existing) {
      set({ page, activeTabId: existing.id });
      return;
    }
    const labels: Record<PageKey, string> = {
      home: '项目首页',
      character: '人物卡编辑',
      worldbook: '世界书',
      regex: '正则规则',
      scripts: '酒馆助手脚本',
      mvu: 'MVU 变量',
      preview: '前端预览',
      validation: '数据校验',
      history: '历史记录',
      settings: '项目设置',
    };
    get().openTab(page, labels[page], target);
  },

  openTab: (page, label, target) => {
    const id = `${page}`;
    const tabs = get().tabs;
    if (tabs.find((t) => t.id === id)) {
      set({ page, activeTabId: id });
      return;
    }
    const tab: EditorTab = { id, label, page, target };
    set({ tabs: [...tabs, tab], page, activeTabId: id });
  },

  closeTab: (id) => {
    if (id === 'home') return;
    const tabs = get().tabs.filter((t) => t.id !== id);
    const active = get().activeTabId === id ? tabs[tabs.length - 1] : tabs.find((t) => t.id === get().activeTabId)!;
    set({ tabs, activeTabId: active?.id || 'home', page: active?.page || 'home' });
  },

  setTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab) set({ activeTabId: id, page: tab.page });
  },

  select: (patch) => set(patch),
  setUi: (patch) => set(patch),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (patch.theme) document.documentElement.dataset.theme = patch.theme;
    idbSet(storageKeys.settings, settings).catch(() => undefined);
  },

  /* ---------------- 变更 & 历史 ---------------- */
  mutate: (label, recipe, opts) => {
    let next: DocState;
    let patches: Patch[];
    let inverse: Patch[];
    try {
      [next, patches, inverse] = produceWithPatches(get().doc, recipe as any);
    } catch (e: any) {
      get().log(`修改失败（${label}）：${e?.message || e}`, 'error');
      return;
    }
    if (!patches.length) return;
    // immer 产物是冻结对象，不能就地赋值；这里生成新的 doc 包装层
    const updated: DocState = { ...next, meta: { ...next.meta, updatedAt: Date.now() } };
    const hist = get().history;
    const last = hist[hist.length - 1];
    const coalesce = opts?.coalesce && last && last.label === label && Date.now() - last.at < 700;
    const history = coalesce
      ? [...hist.slice(0, -1), { ...last, inverse, forward: [...last.forward, ...patches], at: Date.now() }]
      : [...hist.slice(-149), { label, forward: patches, inverse, at: Date.now() }];
    set({ doc: updated, history, future: [], saveStatus: 'dirty' });
    if (get().settings.autosave) scheduleSave(get, set as any);
  },

  undo: () => {
    const hist = get().history;
    if (!hist.length) return;
    const entry = hist[hist.length - 1];
    const doc = applyPatches(get().doc, entry.inverse);
    set({ doc, history: hist.slice(0, -1), future: [...get().future, entry], saveStatus: 'dirty' });
    if (get().settings.autosave) scheduleSave(get, set as any);
  },

  redo: () => {
    const fut = get().future;
    if (!fut.length) return;
    const entry = fut[fut.length - 1];
    const doc = applyPatches(get().doc, entry.forward);
    set({ doc, history: [...get().history, entry], future: fut.slice(0, -1), saveStatus: 'dirty' });
    if (get().settings.autosave) scheduleSave(get, set as any);
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  /* ---------------- 项目 ---------------- */
  newProject: (name = '新项目') => {
    set({
      doc: emptyDoc(name),
      history: [],
      future: [],
      tabs: [{ id: 'home', label: '项目首页', page: 'home' }],
      activeTabId: 'home',
      page: 'home',
      selectedWorldbook: '',
      selectedEntryUid: null,
      selectedRegexId: null,
      selectedScriptId: null,
      saveStatus: 'idle',
    });
  },

  loadSample: () => {
    const card = SAMPLE.card;
    const doc: DocState = {
      meta: {
        id: uuid(),
        name: '示例项目：星见澪',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceFileName: 'sample-card.json',
        cardVersion: card.version,
      },
      card,
      worldbooks: [SAMPLE.worldbook],
      regexes: [SAMPLE.regex],
      scripts: [SAMPLE.scripts],
      mvu: SAMPLE.mvu,
      mvuFloors: SAMPLE.floors,
      baselines: [{ key: 'sample', label: '内置示例数据', json: JSON.stringify(card.root), at: Date.now() }],
      issues: [],
    };
    set({
      doc,
      history: [],
      future: [],
      selectedWorldbook: SAMPLE.worldbook.name,
      selectedEntryUid: SAMPLE.worldbook.entries[0]?.uid ?? null,
      selectedRegexId: SAMPLE.regex.scripts[0]?.id ?? null,
      selectedScriptId: SAMPLE.scripts.scripts[0]?.id ?? null,
      saveStatus: 'dirty',
    });
    if (get().settings.autosave) save(get, set as any);
  },

  createBlankProject: () => {
    const card = createBlankCard('未命名角色');
    const doc: DocState = {
      meta: { id: uuid(), name: '空白人物卡项目', createdAt: Date.now(), updatedAt: Date.now(), cardVersion: 'v3' },
      card,
      worldbooks: [],
      regexes: [],
      scripts: [],
      mvu: null,
      mvuFloors: [],
      baselines: [{ key: 'blank', label: '初始空卡', json: JSON.stringify(card.root), at: Date.now() }],
      issues: [],
    };
    set({ doc, history: [], future: [], selectedWorldbook: '', saveStatus: 'dirty' });
    if (get().settings.autosave) save(get, set as any);
  },

  openProject: async (id) => {
    try {
      const saved = await idbGet<{ json: string }>(storageKeys.project(id));
      if (!saved?.json) {
        get().toast('error', '找不到该项目（可能已被清理）');
        return;
      }
      const doc = deserializeDoc(saved.json);
      set({
        doc,
        history: [],
        future: [],
        saveStatus: 'saved',
        lastSavedAt: Date.now(),
        selectedWorldbook: doc.worldbooks[0]?.name || '',
        selectedEntryUid: doc.worldbooks[0]?.entries[0]?.uid ?? null,
        selectedRegexId: doc.regexes[0]?.scripts[0]?.id ?? null,
        selectedScriptId: doc.scripts[0]?.scripts[0]?.id ?? null,
      });
      get().toast('success', `已打开「${doc.meta.name}」`);
      get().log(`打开项目：${doc.meta.name}`);
    } catch (e: any) {
      get().toast('error', `打开失败：${e?.message || e}`);
    }
  },

  openCard: (card, fileName) => {
    const wb = extractEmbeddedWorldbook(card);
    const scripts: ScriptCollection[] = [];
    const th = card.data?.extensions?.tavern_helper;
    if (th && Array.isArray(th.scripts) && th.scripts.length) {
      scripts.push({
        scripts: th.scripts.map((s: any, i: number) => normalizeScript(s, i)),
        root: th.scripts,
        shape: 'array',
        origin: 'character',
      });
    }
    const regexPreset = card.data?.extensions?.regex;
    const regexes: RegexPreset[] = [];
    if (Array.isArray(regexPreset) && regexPreset.length) {
      regexes.push({
        name: '卡片内正则（extensions.regex）',
        scripts: regexPreset.map((s: any, i: number) => normalizeRegexScript(s, i)),
        root: regexPreset,
        shape: 'array',
        origin: 'character',
      });
    }
    const doc: DocState = {
      meta: {
        id: uuid(),
        name: card.data.name || fileName || '导入项目',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceFileName: fileName,
        cardVersion: card.version,
      },
      card,
      worldbooks: wb ? [wb] : [],
      regexes,
      scripts,
      mvu: null,
      mvuFloors: [],
      baselines: [{ key: 'import', label: `导入快照（${fileName || 'JSON'}）`, json: JSON.stringify(card.root), at: Date.now() }],
      issues: [],
    };
    set({
      doc,
      history: [],
      future: [],
      selectedWorldbook: wb?.name || '',
      selectedEntryUid: wb?.entries[0]?.uid ?? null,
      selectedRegexId: regexes[0]?.scripts[0]?.id ?? null,
      selectedScriptId: scripts[0]?.scripts[0]?.id ?? null,
      saveStatus: 'dirty',
    });
    // 异步构建 MVU 分析（避免阻塞导入）
    setTimeout(() => get().refreshMvu({ keepStat: false }), 30);
    get().log(`已导入人物卡：${card.data.name || fileName}（${card.version.toUpperCase()}）`);
    if (get().settings.autosave) save(get, set as any);
  },

  addWorldbook: (wb) => {
    if (wb.entries.length > 15000) {
      get().toast('warn', `已导入 ${wb.entries.length} 条：大项目自动保存降频为 5 秒，编辑时可用 Ctrl+S 立即保存。`);
    }
    get().mutate(`导入世界书「${wb.name}」`, (d) => {
      let name = wb.name;
      let i = 2;
      while (d.worldbooks.some((w) => w.name === name)) name = `${wb.name} (${i++})`;
      wb.name = name;
      d.worldbooks.push(wb);
    });
    const st = get();
    st.select({ selectedWorldbook: st.doc.worldbooks[st.doc.worldbooks.length - 1].name });
  },

  addRegexPreset: (p) => {
    get().mutate(`导入正则集「${p.name}」`, (d) => {
      d.regexes.push(p);
    });
  },

  addScriptCollection: (c) => {
    get().mutate('导入脚本集', (d) => {
      d.scripts.push(c);
    });
  },

  removeWorldbook: (name) => {
    get().mutate(`删除世界书「${name}」`, (d) => {
      d.worldbooks = d.worldbooks.filter((w) => w.name !== name);
    });
    if (get().selectedWorldbook === name) {
      set({ selectedWorldbook: get().doc.worldbooks[0]?.name || '', selectedEntryUid: null });
    }
  },

  syncCardBook: () => {
    const { doc } = get();
    const embedded = doc.worldbooks.find((w) => w.embeddedInCard);
    if (!doc.card || !embedded) {
      get().toast('warn', '当前项目没有内嵌世界书可同步');
      return;
    }
    get().mutate('同步世界书到人物卡', (d) => {
      const book = d.card!.data.character_book;
      const target = d.worldbooks.find((w) => w.name === embedded.name);
      if (book && target) {
        book.entries = target.entries.map((e) => {
          const c = clone(e);
          delete (c as any).displayIndex;
          return c;
        });
        book.name = target.name;
      }
    });
    get().toast('success', '已将世界书条目写回 data.character_book');
  },

  refreshMvu: (opts) => {
    const { doc } = get();
    const prev = doc.mvu;
    const mvu = buildMvuState({
      card: doc.card,
      worldbooks: doc.worldbooks,
      scripts: doc.scripts,
      importedStat: opts?.keepStat && prev && prev.statSource === 'imported' ? prev.statData : doc.mvuFloors.length ? doc.mvuFloors[doc.mvuFloors.length - 1].statData : null,
      floors: doc.mvuFloors,
    });
    get().mutate('重建 MVU 分析', (d) => {
      d.mvu = mvu;
    });
  },

  importFloors: (floors) => {
    get().mutate('导入变量楼层快照', (d) => {
      d.mvuFloors = floors;
    });
    get().refreshMvu();
  },

  setStatData: (data) => {
    get().mutate('修改变量数据', (d) => {
      if (d.mvu) {
        d.mvu.statData = data;
        d.mvu.statSource = 'imported';
        d.mvu.statSourceDetail = '在编辑器中直接编辑';
      }
    }, { coalesce: 'stat' });
  },

  runValidation: () => {
    const { doc } = get();
    const issues = validateAll({
      card: doc.card,
      worldbooks: doc.worldbooks,
      regexes: doc.regexes,
      scripts: doc.scripts,
      mvu: doc.mvu,
    });
    set({ doc: { ...doc, issues } });
    return issues;
  },

  snapshotBaseline: (label) => {
    const { doc } = get();
    if (!doc.card) return;
    const json = JSON.stringify(serializeCard(doc.card, doc.card.version).json);
    get().mutate(`记录快照：${label}`, (d) => {
      d.baselines = [...d.baselines, { key: uuid(), label, json, at: Date.now() }].slice(-20);
    });
    get().toast('success', `已记录快照「${label}」`);
  },

  /* ---------------- 世界书 ---------------- */
  addEntry: (wbName, init) => {
    const wb = get().doc.worldbooks.find((w) => w.name === wbName);
    const uid = wb ? nextUid(wb.entries) : 0;
    const displayIndex = wb ? wb.entries.length : 0;
    get().mutate(`新建条目 #${uid}`, (d) => {
      const target = d.worldbooks.find((w) => w.name === wbName);
      if (!target) return;
      target.entries.push({
        uid,
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
        displayIndex,
        ...(init || {}),
      });
    });
    set({ selectedEntryUid: uid });
    return uid;
  },

  updateEntry: (wbName, uid, patch, coalesce) => {
    get().mutate(
      `编辑条目 #${uid}`,
      (d) => {
        const wb = d.worldbooks.find((w) => w.name === wbName);
        const entry = wb?.entries.find((e) => e.uid === uid);
        if (!entry) return;
        Object.assign(entry, patch);
      },
      coalesce ? { coalesce } : undefined,
    );
  },

  deleteEntries: (wbName, uids) => {
    const setUids = new Set(uids);
    get().mutate(`删除 ${uids.length} 个条目`, (d) => {
      const wb = d.worldbooks.find((w) => w.name === wbName);
      if (!wb) return;
      wb.entries = wb.entries.filter((e) => !setUids.has(e.uid));
      wb.entries.forEach((e, i) => (e.displayIndex = i));
    });
    if (get().selectedEntryUid != null && setUids.has(get().selectedEntryUid!)) {
      const wb = get().doc.worldbooks.find((w) => w.name === wbName);
      set({ selectedEntryUid: wb?.entries[0]?.uid ?? null });
    }
  },

  duplicateEntry: (wbName, uid) => {
    const wb = get().doc.worldbooks.find((w) => w.name === wbName);
    if (!wb) return;
    const src = wb.entries.find((e) => e.uid === uid);
    if (!src) return;
    const newUid = nextUid(wb.entries);
    get().mutate(`复制条目 #${uid}`, (d) => {
      const target = d.worldbooks.find((w) => w.name === wbName);
      if (!target) return;
      const copy = clone(src);
      copy.uid = newUid;
      copy.displayIndex = target.entries.length;
      copy.comment = `${copy.comment || '条目'} 副本`;
      target.entries.push(copy);
    });
    set({ selectedEntryUid: newUid });
  },

  bulkUpdate: (wbName, uids, patch) => {
    const setUids = new Set(uids);
    get().mutate(`批量修改 ${uids.length} 个条目`, (d) => {
      const wb = d.worldbooks.find((w) => w.name === wbName);
      if (!wb) return;
      for (const e of wb.entries) if (setUids.has(e.uid)) Object.assign(e, patch);
    });
    get().toast('success', `已修改 ${uids.length} 个条目`);
  },

  reorderEntries: (wbName, uids) => {
    get().mutate('调整条目顺序', (d) => {
      const wb = d.worldbooks.find((w) => w.name === wbName);
      if (!wb) return;
      const map = new Map(wb.entries.map((e) => [e.uid, e]));
      const ordered = uids.map((u) => map.get(u)).filter(Boolean) as WorldbookEntry[];
      const rest = wb.entries.filter((e) => !uids.includes(e.uid));
      wb.entries = [...ordered, ...rest];
      wb.entries.forEach((e, i) => (e.displayIndex = i));
    });
  },

  fixUids: (wbName) => {
    get().mutate('修复重复 UID', (d) => {
      const wb = d.worldbooks.find((w) => w.name === wbName);
      if (!wb) return;
      const used = new Set<number>();
      let cursor = 0;
      for (const e of wb.entries) {
        if (used.has(e.uid) || typeof e.uid !== 'number' || e.uid < 0) {
          while (used.has(cursor)) cursor++;
          e.uid = cursor;
        }
        used.add(e.uid);
        cursor = Math.max(cursor, e.uid + 1);
      }
    });
    get().toast('success', '已重排重复 UID');
  },

  /* ---------------- 正则 ---------------- */
  addRegex: (presetName, init) => {
    const script = createRegexScript(init);
    get().mutate('新建正则规则', (d) => {
      const p = d.regexes.find((x) => x.name === presetName) || d.regexes[0];
      if (!p) return;
      p.scripts.push(script);
    });
    set({ selectedRegexId: script.id });
    return script.id;
  },

  updateRegex: (presetName, id, patch, coalesce) => {
    get().mutate(
      '编辑正则规则',
      (d) => {
        const p = d.regexes.find((x) => x.name === presetName);
        const s = p?.scripts.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      },
      coalesce ? { coalesce } : undefined,
    );
  },

  deleteRegex: (presetName, id) => {
    get().mutate('删除正则规则', (d) => {
      const p = d.regexes.find((x) => x.name === presetName);
      if (p) p.scripts = p.scripts.filter((s) => s.id !== id);
    });
    const p = get().doc.regexes.find((x) => x.name === presetName);
    set({ selectedRegexId: p?.scripts[0]?.id ?? null });
  },

  moveRegex: (presetName, id, dir) => {
    get().mutate('调整正则顺序', (d) => {
      const p = d.regexes.find((x) => x.name === presetName);
      if (!p) return;
      const i = p.scripts.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.scripts.length) return;
      [p.scripts[i], p.scripts[j]] = [p.scripts[j], p.scripts[i]];
    });
  },

  /* ---------------- 脚本 ---------------- */
  addScript: (index) => {
    const s = createScript();
    get().mutate('新建脚本', (d) => {
      const col = d.scripts[index];
      if (!col) return;
      col.scripts.push(s);
    });
    set({ selectedScriptId: s.id });
    return s.id;
  },

  updateScript: (index, id, patch, coalesce) => {
    get().mutate(
      '编辑脚本',
      (d) => {
        const s = d.scripts[index]?.scripts.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      },
      coalesce ? { coalesce } : undefined,
    );
  },

  deleteScript: (index, id) => {
    get().mutate('删除脚本', (d) => {
      const col = d.scripts[index];
      if (col) col.scripts = col.scripts.filter((s) => s.id !== id);
    });
    const col = get().doc.scripts[index];
    set({ selectedScriptId: col?.scripts[0]?.id ?? null });
  },

  moveScript: (index, id, dir) => {
    get().mutate('调整脚本顺序', (d) => {
      const col = d.scripts[index];
      if (!col) return;
      const i = col.scripts.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= col.scripts.length) return;
      [col.scripts[i], col.scripts[j]] = [col.scripts[j], col.scripts[i]];
    });
  },

  /* ---------------- 持久化 ---------------- */
  saveNow: async () => {
    save.cancel();
    const state = get();
    set({ saveStatus: 'saving' });
    try {
      const text = serializeDoc(state.doc);
      await idbSet(storageKeys.project(state.doc.meta.id), { id: state.doc.meta.id, updatedAt: Date.now(), json: text });
      const idx = (await idbGet<ProjectMeta[]>(storageKeys.projectIndex)) || [];
      const meta = { ...state.doc.meta, updatedAt: Date.now() };
      await idbSet(storageKeys.projectIndex, [meta, ...idx.filter((m) => m.id !== meta.id)].slice(0, 30));
      await idbSet(storageKeys.lastProject, state.doc.meta.id);
      set({ saveStatus: 'saved', lastSavedAt: Date.now() });
      get().log(`已保存（${nowIso()}，${(text.length / 1024).toFixed(0)} KB）`, 'success');
    } catch (e: any) {
      set({ saveStatus: 'error' });
      get().toast('error', `保存失败：${e?.message || e}`);
    }
  },
}));

/* -------------------------------------------------------------- 选择器 */

export const useDoc = () => useStore((s) => s.doc);
export const useCard = () => useStore((s) => s.doc.card);
export const useWorldbook = () => {
  const doc = useStore((s) => s.doc);
  const name = useStore((s) => s.selectedWorldbook);
  return doc.worldbooks.find((w) => w.name === name) || doc.worldbooks[0] || null;
};

export function currentRegexPreset(state: AppState): RegexPreset | null {
  return state.doc.regexes[0] || null;
}

export function scriptSyntax(s: TavernScript) {
  return checkSyntax(s.content || '');
}
