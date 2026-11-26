import type { ScriptCollection, TavernScript } from './types';
import { isPlainObject, uuid } from './util';

/* ---------------------------------------------------------------- 归一化 */

export function normalizeScript(raw: any, i = 0): TavernScript {
  let src: any = isPlainObject(raw) ? { ...raw } : {};
  // 全局脚本容器形如 { type: 'script', value: {...}, enabled: true }
  let enabledFromWrapper: boolean | undefined;
  if (isPlainObject(src.value) && (src.type === 'script' || src.enabled !== undefined) && !('content' in src)) {
    enabledFromWrapper = src.enabled;
    src = { ...src.value };
  }
  const s: TavernScript = src as TavernScript;
  s.id = typeof s.id === 'string' && s.id ? s.id : uuid();
  s.name = typeof s.name === 'string' ? s.name : `脚本 ${i + 1}`;
  s.content = typeof s.content === 'string' ? s.content : '';
  if (s.enabled === undefined) s.enabled = enabledFromWrapper ?? true;
  if (!isPlainObject(s.button)) s.button = { enabled: false, buttons: [] };
  if (!Array.isArray(s.button.buttons)) s.button.buttons = [];
  if (!isPlainObject(s.data)) s.data = {};
  return s;
}

export function parseScriptCollection(json: any): { scripts: TavernScript[]; root: any; shape: 'array' | 'object' } {
  if (Array.isArray(json)) {
    return { scripts: json.map((s, i) => normalizeScript(s, i)), root: json, shape: 'array' };
  }
  if (isPlainObject(json)) {
    if (Array.isArray(json.scripts)) {
      return { scripts: json.scripts.map((s: any, i: number) => normalizeScript(s, i)), root: json, shape: 'object' };
    }
    if (Array.isArray(json.script)) {
      return { scripts: json.script.map((s: any, i: number) => normalizeScript(s, i)), root: json, shape: 'object' };
    }
    const vals = Object.values(json);
    if (vals.length && vals.every((v: any) => isPlainObject(v) && ('content' in v || isPlainObject((v as any).value)))) {
      return { scripts: (vals as any[]).map((s, i) => normalizeScript(s, i)), root: json, shape: 'object' };
    }
  }
  throw new Error('无法识别酒馆助手脚本数据：应为数组、{scripts:[...]} 或脚本对象映射');
}

/** 从人物卡中提取酒馆助手脚本集合（data.extensions.tavern_helper.scripts 为首要位置） */
export function scriptsFromCard(cardData: any): { collection: ScriptCollection | null; path: string } {
  const ext = cardData?.extensions;
  if (isPlainObject(ext)) {
    const th = ext.tavern_helper ?? ext.tavernHelper;
    if (isPlainObject(th)) {
      const arr = th.scripts;
      if (Array.isArray(arr)) {
        return {
          collection: { scripts: arr.map((s, i) => normalizeScript(s, i)), root: arr, shape: 'array', origin: 'character' },
          path: 'data.extensions.tavern_helper.scripts',
        };
      }
    }
    // 少数卡把脚本放在 extensions.tavern_helper_scripts
    if (Array.isArray(ext.tavern_helper_scripts)) {
      return {
        collection: {
          scripts: ext.tavern_helper_scripts.map((s: any, i: number) => normalizeScript(s, i)),
          root: ext.tavern_helper_scripts,
          shape: 'array',
          origin: 'character',
        },
        path: 'data.extensions.tavern_helper_scripts',
      };
    }
  }
  return { collection: null, path: '' };
}

export function createScript(init?: Partial<TavernScript>): TavernScript {
  return {
    id: uuid(),
    name: '新建脚本',
    content: "// 在此编写酒馆助手脚本\nconsole.log('hello');\n",
    info: '',
    enabled: true,
    button: { enabled: false, buttons: [] },
    data: {},
    ...(init || {}),
  };
}

/* ---------------------------------------------------------------- 静态分析 */

export interface ScriptMeta {
  lines: number;
  chars: number;
  imports: string[];
  importScripts: string[];
  apiCalls: string[];
  events: string[];
  hasIframe: boolean;
  hasFetch: boolean;
  hasStorage: boolean;
  buttonCount: number;
  syntax: { ok: boolean; error?: string; note?: string };
}

const API_PATTERNS: [RegExp, string][] = [
  [/\bgetVariables\s*\(/g, 'getVariables'],
  [/\breplaceVariables\s*\(/g, 'replaceVariables'],
  [/\bupdateVariablesWith\s*\(/g, 'updateVariablesWith'],
  [/\binsertOrAssignVariables\s*\(/g, 'insertOrAssignVariables'],
  [/\bgetChatMessages\s*\(/g, 'getChatMessages'],
  [/\bsetChatMessages\s*\(/g, 'setChatMessages'],
  [/\bgetWorldbook\s*\(/g, 'getWorldbook'],
  [/\bupdateWorldbookWith\s*\(/g, 'updateWorldbookWith'],
  [/\breplaceWorldbook\s*\(/g, 'replaceWorldbook'],
  [/\bcreateWorldbookEntries\s*\(/g, 'createWorldbookEntries'],
  [/\bdeleteWorldbookEntries\s*\(/g, 'deleteWorldbookEntries'],
  [/\bgenerate(?:Raw)?\s*\(/g, 'generate'],
  [/\binjectPrompts\s*\(/g, 'injectPrompts'],
  [/\beventOn\s*\(/g, 'eventOn'],
  [/\beventOnce\s*\(/g, 'eventOnce'],
  [/\bregisterVariableSchema\s*\(/g, 'registerVariableSchema'],
  [/\bMvu\b/g, 'Mvu'],
  [/\$\.(?:set|get)\s*\(/g, 'MVU $.set/get'],
  [/\b_\.(?:set|get|add|assign|insert|delete|remove|move)\s*\(/g, 'MVU _.ops'],
];

export function analyzeScript(script: TavernScript): ScriptMeta {
  const code = script.content || '';
  const imports: string[] = [];
  const importScripts: string[] = [];
  const reImport = /(?:import[\s\S]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = reImport.exec(code))) imports.push(m[1]);
  const reImportScripts = /importScripts\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = reImportScripts.exec(code))) importScripts.push(m[1]);

  const apiCalls: string[] = [];
  for (const [re, name] of API_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(code)) apiCalls.push(name);
  }
  const events = new Set<string>();
  const reEvent = /eventOn\s*\(\s*([^,)]+)/g;
  while ((m = reEvent.exec(code))) events.add(m[1].trim().slice(0, 60));

  return {
    lines: code ? code.split('\n').length : 0,
    chars: code.length,
    imports: Array.from(new Set(imports)),
    importScripts: Array.from(new Set(importScripts)),
    apiCalls,
    events: Array.from(events),
    hasIframe: /<iframe|iframe/i.test(code),
    hasFetch: /\bfetch\s*\(/.test(code),
    hasStorage: /localStorage|indexedDB|GM_/.test(code),
    buttonCount: script.button?.buttons?.length ?? 0,
    syntax: checkSyntax(code),
  };
}

/**
 * 语法检查：new Function 只做编译（解析）不执行函数体，
 * 因此不会运行导入的恶意代码，可安全用于静态检查。
 */
export function checkSyntax(code: string): { ok: boolean; error?: string; note?: string } {
  if (!code.trim()) return { ok: true };
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    // 酒馆助手脚本常以模块/异步上下文运行：顶层 await 与 import 在 new Function 中会报错，
    // 但这不代表脚本有语法错误。这里做一次「按异步上下文重试」并显式标注。
    if (/await is only valid/i.test(msg)) {
      try {
        new Function(`return (async () => {\n${code}\n})`);
        return { ok: true, note: '包含顶层 await：需在模块或异步上下文中运行' };
      } catch (e2: any) {
        return { ok: false, error: `${e2?.message || e2}（已按异步上下文重试）` };
      }
    }
    if (/Cannot use import statement|import statement outside a module/i.test(msg) || /Unexpected token 'export'/i.test(msg)) {
      return { ok: true, note: '包含 ES module 语法（import/export），需在模块环境中运行；已跳过语法检查' };
    }
    return { ok: false, error: msg };
  }
}

/* ---------------------------------------------------------------- 导出 */

export function exportScriptCollection(scripts: TavernScript[], shape: 'array' | 'object' = 'array'): any {
  return shape === 'object' ? { scripts } : scripts;
}
