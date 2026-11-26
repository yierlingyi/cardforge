/**
 * MVU 适配层
 * ---------------------------------------------------------------------------
 * 已确认的事实（写入 docs/MVU版本适配.md，并标注证据等级）：
 * - MVU 变量以 `stat_data` 为核心，展示层常用 `display_data`，增量常用 `delta_data`；
 * - MVU 通过酒馆助手脚本 + 世界书条目分发运行时代码与更新规则；
 * - Zod 版本通过 `registerVariableSchema` 注册 Schema（脚本内调用）。
 *
 * 不确定项（本模块按「可容忍 + 显式标注」处理，不臆造）：
 * - mvu / mvubeta / mvuzod 的精确版本号与全部字段差异；
 * - 初始化条目的固定命名（不同卡作者命名不统一，故用启发式识别）；
 * - display_data / delta_data 的确切生命周期。
 */

import type {
  MvuEvidence,
  MvuFlavor,
  MvuSchemaField,
  MvuState,
  NormalizedCard,
  NormalizedWorldbook,
  ScriptCollection,
  TavernScript,
  WorldbookEntry,
} from './types';
import { isPlainObject } from './util';
import { parseYamlSubset, unwrapInitVar } from './yaml';
import { scriptsFromCard } from './scripts';

/* --------------------------------------------------------------- 版本识别 */

export const FLAVOR_LABELS: Record<MvuFlavor, string> = {
  mvu: 'MVU（基础版）',
  mvubeta: 'MVU Beta',
  mvuzod: 'MVU Zod',
  unknown: '未识别',
};

interface SignalDef {
  flavor: MvuFlavor;
  weight: number;
  test: (hay: string, name: string, comment: string) => boolean;
  detail: string;
  where: string;
}

export function detectMvu(scripts: TavernScript[], entries: WorldbookEntry[]): {
  flavor: MvuFlavor;
  confidence: 'high' | 'medium' | 'low';
  evidence: MvuEvidence[];
} {
  const evidence: MvuEvidence[] = [];
  const scores: Record<MvuFlavor, number> = { mvu: 0, mvubeta: 0, mvuzod: 0, unknown: 0 };

  const push = (flavor: MvuFlavor, score: number, where: string, detail: string) => {
    scores[flavor] += score;
    evidence.push({ flavor, score, signals: [{ where, detail }] });
  };

  for (const s of scripts) {
    const code = s.content || '';
    const name = s.name || '';
    const lower = (name + '\n' + code).toLowerCase();

    if (/registervariableschema\s*\(/i.test(code)) push('mvuzod', 6, `脚本「${name}」`, '调用 registerVariableSchema（Zod Schema 注册）');
    if (/\bz\.object\s*\(/.test(code)) push('mvuzod', 4, `脚本「${name}」`, '包含 z.object()（Zod Schema 定义）');
    if (/\bz\.(string|number|boolean|array|enum|literal|record|union)\s*\(/.test(code)) push('mvuzod', 2, `脚本「${name}」`, '使用 Zod 基础类型构造器');
    if (/from\s+['"]zod['"]|require\(['"]zod['"]\)/.test(code)) push('mvuzod', 2, `脚本「${name}」`, '直接 import zod');
    if (/magvarupdate/i.test(lower)) push('mvu', 3, `脚本「${name}」`, '提及 MagVarUpdate');
    if (/\bmvubeta\b|mvu\s*beta/i.test(lower)) push('mvubeta', 4, `脚本「${name}」`, '出现 MVU Beta 字样');
    if (/\bstat_data\b/.test(code)) {
      const zodish = /z\.object|registervariableschema/i.test(code);
      push(zodish ? 'mvuzod' : 'mvu', zodish ? 3 : 2, `脚本「${name}」`, '引用 stat_data');
    }
    if (/display_data/.test(code)) push('mvu', 1, `脚本「${name}」`, '引用 display_data');
    if (/delta_data/.test(code)) push('mvu', 1, `脚本「${name}」`, '引用 delta_data');
    if (/\bMvu\./.test(code)) push('mvu', 2, `脚本「${name}」`, '调用 window.Mvu 接口');
    if (/_\s*\.\s*(set|add|assign|insert|delete|remove|move)\s*\(/.test(code)) push('mvu', 1, `脚本「${name}」`, '使用 _.xxx() 变量操作符');
    if (/变量更新规则|更新规则|JSON\s*Patch/i.test(code)) push('mvu', 1, `脚本「${name}」`, '包含变量更新规则说明');
  }

  for (const e of entries) {
    const hay = (e.comment || '') + '\n' + (e.content || '');
    if (/\[?\s*init\s*_?var\s*\]?/i.test(e.comment || '') || /初始化变量|变量初始化/.test(e.comment || '')) {
      push('mvu', 3, `世界书条目 #${e.uid}「${e.comment || '(无备注)'}」`, '疑似变量初始化条目');
    }
    if (/\bstat_data\b/.test(hay)) push('mvu', 2, `世界书条目 #${e.uid}`, '正文含 stat_data');
    if (/\$schema\b|\bschema\b/i.test(e.comment || '') && /z\.|Zod/i.test(hay)) push('mvuzod', 2, `世界书条目 #${e.uid}`, '疑似 Schema 说明条目');
    if (/Zod/.test(hay)) push('mvuzod', 1, `世界书条目 #${e.uid}`, '正文提及 Zod');
    if (/MVU\s*Beta/i.test(hay)) push('mvubeta', 2, `世界书条目 #${e.uid}`, '正文提及 MVU Beta');
  }

  const ranked = (Object.keys(scores) as MvuFlavor[])
    .filter((f) => f !== 'unknown')
    .sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0];
  const bestScore = scores[best];
  if (bestScore < 2) {
    return { flavor: 'unknown', confidence: 'low', evidence };
  }
  const second = scores[ranked[1]] ?? 0;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (bestScore >= 8 && bestScore >= second * 1.5) confidence = 'high';
  else if (bestScore >= 4 && bestScore > second) confidence = 'medium';

  // mvuzod 是建立在 MVU 基础机制之上的超集：
  // 当出现 registerVariableSchema 这类「明确 Zod 注册」信号时，
  // 即使基础版信号同样密集，也可以判定为高置信度。
  const explicitZod = evidence.some((e) => e.flavor === 'mvuzod' && e.score >= 6);
  if (best === 'mvuzod' && explicitZod && ranked[1] === 'mvu') confidence = 'high';
  return { flavor: best, confidence, evidence };
}

/* --------------------------------------------------- 初始化变量条目识别 */

const INIT_COMMENT_RE = /^\s*\[?\s*(init\s*_?var|initvar|initial\s*variables?|变量初始化|初始化变量|初始变量)\s*\]?\s*$/i;

export function findInitVarEntry(entries: WorldbookEntry[]): WorldbookEntry | null {
  const exact = entries.find((e) => INIT_COMMENT_RE.test(e.comment || ''));
  if (exact) return exact;
  const loose = entries.find((e) => /初始化变量|init\s*_?var|初始变量/i.test((e.comment || '') + (e.content || '').slice(0, 200)));
  if (loose) return loose;
  // 内容形如 stat_data: / 全为 YAML 结构且被标注为变量
  const byContent = entries.find((e) => /^\s*(stat_data|变量)\s*:/m.test(e.content || '') && /变量|variable/i.test(e.comment || ''));
  return byContent || null;
}

export function parseInitVar(content: string): { ok: boolean; data: any; error?: string; warnings: string[]; unwrapped: boolean } {
  if (!content?.trim()) return { ok: false, data: null, error: '条目内容为空', warnings: [], unwrapped: false };
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const { data, unwrapped } = unwrapInitVar(parsed);
      return { ok: true, data, warnings: ['内容按 JSON 解析'], unwrapped };
    } catch (e: any) {
      return { ok: false, data: null, error: `JSON 解析失败：${e.message}`, warnings: [], unwrapped: false };
    }
  }
  const r = parseYamlSubset(content);
  if (!r.ok) return { ok: false, data: null, error: r.error, warnings: r.warnings, unwrapped: false };
  const { data, unwrapped } = unwrapInitVar(r.value);
  return { ok: true, data, warnings: r.warnings, unwrapped };
}

/* ------------------------------------------------------------ Zod 静态解析 */

export interface ZodParseResult {
  found: boolean;
  fields: MvuSchemaField[];
  notes: string[];
  dynamic: string[];
  sourceScript?: string;
}

function findBalanced(src: string, openIdx: number): { body: string; end: number } | null {
  const open = src[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : '';
  if (!close) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { body: src.slice(openIdx + 1, i), end: i };
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === '\\') {
        cur += body[++i] ?? '';
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if ('{[('.includes(c)) depth++;
    if ('}])'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function literalValue(s: string): any {
  const t = s.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t.replace(/'/g, '"'));
  } catch {
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^['"`].*['"`]$/.test(t)) return t.slice(1, -1);
    return undefined;
  }
}

/** 解析单个 Zod 表达式 → 类型/约束 */
function parseZodExpr(expr: string, path: string, notes: string[], dynamic: string[]): { field: MvuSchemaField; children: MvuSchemaField[] } {
  let s = expr.trim();
  let type = 'unknown';
  let required = true;
  let defaultValue: any = undefined;
  const constraints: string[] = [];
  const children: MvuSchemaField[] = [];

  const chain: string[] = [];
  // 剥离链式调用：z.xxx(...).a(...).b(...)
  const baseMatch = s.match(/^(?:z|zod)\.([A-Za-z]+)\s*\(/);
  if (baseMatch) {
    const start = s.indexOf('(');
    const bal = findBalanced(s, start);
    if (bal) {
      const args = bal.body;
      const fn = baseMatch[1];
      switch (fn) {
        case 'string':
          type = 'string';
          break;
        case 'number':
        case 'bigint':
          type = 'number';
          break;
        case 'boolean':
          type = 'boolean';
          break;
        case 'null':
          type = 'null';
          break;
        case 'any':
        case 'unknown':
          type = 'any';
          break;
        case 'date':
          type = 'date';
          break;
        case 'literal':
          type = literalValue(args) === undefined ? 'literal' : typeof literalValue(args);
          defaultValue = literalValue(args);
          break;
        case 'enum': {
          type = 'enum';
          const m = args.match(/\[([\s\S]*)\]/);
          if (m) constraints.push(`可选值：${splitTopLevel(m[1]).map((x) => x.trim().replace(/^['"`]|['"`]$/g, '')).join(' | ')}`);
          break;
        }
        case 'array': {
          type = 'array';
          const inner = args.trim();
          if (inner.startsWith('z.')) {
            const sub = parseZodExpr(inner, path + '[]', notes, dynamic);
            constraints.push(`元素类型：${sub.field.type}`);
            if (sub.children.length) children.push(...sub.children);
          } else if (/^z\.object/.test(inner)) {
            const sub = parseZodExpr(inner, path + '[]', notes, dynamic);
            children.push(...sub.children);
          } else if (inner) {
            constraints.push('元素类型：动态表达式（未能静态解析）');
            dynamic.push(path);
          }
          break;
        }
        case 'object': {
          type = 'object';
          const objBody = args.trim();
          if (objBody.startsWith('{')) {
            const inner = findBalanced(objBody, 0);
            if (inner) {
              for (const part of splitTopLevel(inner.body)) {
                const p = part.trim();
                if (!p) continue;
                if (p.startsWith('...')) {
                  notes.push(`${path || '(根)'}：使用了展开语法 ...${p.slice(3).trim()}，该部分字段无法静态展开`);
                  dynamic.push(path + '/*');
                  continue;
                }
                const m = p.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*))\s*:\s*([\s\S]+)$/);
                if (!m) {
                  notes.push(`${path || '(根)'}：无法解析的字段定义片段「${p.slice(0, 40)}」`);
                  dynamic.push(path);
                  continue;
                }
                const key = m[1] ?? m[2] ?? m[3];
                const sub = parseZodExpr(m[4], path ? `${path}.${key}` : key, notes, dynamic);
                children.push(sub.field, ...sub.children);
              }
            }
          } else if (objBody) {
            notes.push(`${path || '(根)'}：z.object 的字段来自变量或函数调用，无法静态解析`);
            dynamic.push(path || '(根)');
          }
          break;
        }
        case 'record':
          type = 'object';
          constraints.push('动态键对象（z.record），字段不可枚举');
          dynamic.push(path || '(根)');
          break;
        case 'union': {
          const m = args.match(/\[([\s\S]*)\]/);
          if (m) {
            const opts = splitTopLevel(m[1]).map((x) => x.trim());
            const types = opts.map((o) => {
              const r = parseZodExpr(o, path, notes, dynamic);
              return r.field.type;
            });
            type = Array.from(new Set(types)).join(' | ');
            if (types.includes('object')) {
              for (const o of opts) {
                const r = parseZodExpr(o, path, notes, dynamic);
                children.push(...r.children);
              }
            }
          }
          break;
        }
        case 'tuple': {
          type = 'array';
          constraints.push('定长元组');
          break;
        }
        case 'coerce': {
          const inner = args.trim();
          if (inner.startsWith('z.')) {
            const sub = parseZodExpr(inner, path, notes, dynamic);
            type = sub.field.type;
            constraints.push('强制类型转换（coerce）');
          }
          break;
        }
        case 'preprocess':
        case 'custom':
          type = 'any';
          constraints.push('自定义校验（运行时逻辑，静态不可判定）');
          dynamic.push(path || '(根)');
          break;
        default:
          type = fn;
          constraints.push('未识别的 Zod 构造器');
          break;
      }
      s = s.slice(bal.end + 1);
      // 继续解析链式调用
      const re = /^\s*\.\s*([A-Za-z]+)\s*\(/;
      while (true) {
        const cm = s.match(re);
        if (!cm) break;
        const startIdx = s.indexOf('(', cm.index ?? 0);
        const cb = findBalanced(s, startIdx);
        if (!cb) break;
        const arg = cb.body.trim();
        chain.push(cm[1]);
        switch (cm[1]) {
          case 'optional':
            required = false;
            break;
          case 'nullable':
            type = type === 'null' ? type : `${type} | null`;
            break;
          case 'default':
            defaultValue = literalValue(arg);
            required = false;
            break;
          case 'min':
            constraints.push(`最小值/长度 ≥ ${arg}`);
            break;
          case 'max':
            constraints.push(`最大值/长度 ≤ ${arg}`);
            break;
          case 'length':
            constraints.push(`长度 = ${arg}`);
            break;
          case 'int':
            constraints.push('必须为整数');
            break;
          case 'positive':
            constraints.push('必须 > 0');
            break;
          case 'nonnegative':
            constraints.push('必须 ≥ 0');
            break;
          case 'regex':
            constraints.push(`匹配正则 ${arg}`);
            break;
          case 'describe':
            constraints.push(`说明：${arg.replace(/^['"`]|['"`]$/g, '')}`);
            break;
          case 'refine':
          case 'superRefine':
          case 'transform':
          case 'catch':
            constraints.push(`${cm[1]}（运行时逻辑，静态不可判定）`);
            dynamic.push(path || '(根)');
            break;
          default:
            break;
        }
        s = s.slice(cb.end + 1);
      }
    }
  } else if (/^z\./.test(s)) {
    type = 'any';
    constraints.push('简写/未知 Zod 表达式');
  }

  const field: MvuSchemaField = { path, type, required, defaultValue, constraints };
  return { field, children };
}

export function parseZodSchema(code: string): ZodParseResult {
  const notes: string[] = [];
  const dynamic: string[] = [];
  const fields: MvuSchemaField[] = [];
  if (!code || !/z\.object|registerVariableSchema/.test(code)) {
    return { found: false, fields, notes: ['未找到 Zod Schema 定义'], dynamic };
  }

  // 优先找 z.object({...})（取第一个包含对象字面量的）
  let idx = code.indexOf('z.object(');
  let foundBody: string | null = null;
  while (idx >= 0) {
    const bal = findBalanced(code, idx + 'z.object'.length);
    if (bal) {
      const inner = bal.body.trim();
      if (inner.startsWith('{')) {
        foundBody = inner;
        break;
      }
    }
    idx = code.indexOf('z.object(', idx + 1);
  }
  if (!foundBody) {
    notes.push('检测到 Zod 引用，但未能定位对象字面量定义（可能由函数动态构造）');
    dynamic.push('(根)');
    return { found: true, fields, notes, dynamic };
  }
  const objBal = findBalanced(foundBody, 0);
  if (!objBal) return { found: true, fields, notes: ['Schema 对象括号不匹配'], dynamic };
  for (const part of splitTopLevel(objBal.body)) {
    const p = part.trim();
    if (!p) continue;
    if (p.startsWith('//')) continue;
    if (p.startsWith('...')) {
      notes.push(`Schema 使用展开语法 ...${p.slice(3).trim()}，该部分字段无法静态展开`);
      dynamic.push('/*');
      continue;
    }
    const m = p.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*))\s*:\s*([\s\S]+)$/);
    if (!m) {
      // 可能是注释或方法
      continue;
    }
    const key = m[1] ?? m[2] ?? m[3];
    const r = parseZodExpr(m[4], key, notes, dynamic);
    fields.push(r.field, ...r.children);
  }

  // 检查根上的 .partial() 等（对象后链式）
  const tail = code.slice(idx);
  if (/\.partial\s*\(\s*\)/.test(tail.slice(0, 400))) {
    for (const f of fields) f.required = false;
    notes.push('Schema 根对象使用了 .partial()，所有字段按可选处理');
  }
  if (/\.passthrough\s*\(|\.catchall\s*\(/.test(tail.slice(0, 400))) {
    notes.push('Schema 允许额外字段（passthrough/catchall）');
  }
  return { found: true, fields, notes, dynamic };
}

/* ------------------------------------------------------- 结构推断 / 校验 */

export function inferFieldsFromData(data: any, base = ''): MvuSchemaField[] {
  const out: MvuSchemaField[] = [];
  if (Array.isArray(data)) {
    out.push({ path: base, type: 'array', required: true, constraints: [`长度 ${data.length}`] });
    if (data.length && isPlainObject(data[0])) {
      for (const f of inferFieldsFromData(data[0], base + '[]')) out.push(f);
    }
    return out;
  }
  if (isPlainObject(data)) {
    if (base) out.push({ path: base, type: 'object', required: true, constraints: [`${Object.keys(data).length} 个字段`] });
    for (const [k, v] of Object.entries(data)) {
      const p = base ? `${base}.${k}` : k;
      if (isPlainObject(v)) out.push(...inferFieldsFromData(v, p));
      else if (Array.isArray(v)) out.push(...inferFieldsFromData(v, p));
      else out.push({ path: p, type: v === null ? 'null' : typeof v, required: true, constraints: ['来自变量数据推断'] });
    }
  }
  return out;
}

export interface MvuCheckIssue {
  level: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}

export function checkDataAgainstSchema(data: any, fields: MvuSchemaField[]): MvuCheckIssue[] {
  const issues: MvuCheckIssue[] = [];
  for (const f of fields) {
    if (!f.path || f.path.includes('[]')) continue;
    const parts = f.path.split('.');
    let cur: any = data;
    let exists = true;
    for (const p of parts) {
      if (cur === null || typeof cur !== 'object' || !(p in cur)) {
        exists = false;
        break;
      }
      cur = cur[p];
    }
    if (!exists) {
      if (f.required && f.defaultValue === undefined) {
        issues.push({ level: 'warning', path: f.path, message: `Schema 中为必填，但变量数据中不存在该字段` });
      }
      continue;
    }
    const t = cur === null ? 'null' : Array.isArray(cur) ? 'array' : typeof cur;
    const expected = f.type;
    if (expected === 'any' || expected.includes('|')) continue;
    const map: Record<string, string[]> = {
      string: ['string'],
      number: ['number'],
      boolean: ['boolean'],
      array: ['array'],
      object: ['object'],
      null: ['null'],
      date: ['string', 'number'],
    };
    if (map[expected] && !map[expected].includes(t)) {
      issues.push({ level: 'error', path: f.path, message: `类型不匹配：Schema 要求 ${expected}，实际为 ${t}` });
      continue;
    }
    for (const c of f.constraints) {
      const min = c.match(/最小值\/长度 ≥ (-?\d+)/);
      if (min) {
        const n = Number(min[1]);
        if (typeof cur === 'number' && cur < n) issues.push({ level: 'error', path: f.path, message: `数值 ${cur} 小于最小值 ${n}` });
        if (typeof cur === 'string' && cur.length < n) issues.push({ level: 'error', path: f.path, message: `字符串长度 ${cur.length} 小于最小长度 ${n}` });
        if (Array.isArray(cur) && cur.length < n) issues.push({ level: 'error', path: f.path, message: `数组长度 ${cur.length} 小于最小长度 ${n}` });
      }
      const max = c.match(/最大值\/长度 ≤ (-?\d+)/);
      if (max) {
        const n = Number(max[1]);
        if (typeof cur === 'number' && cur > n) issues.push({ level: 'error', path: f.path, message: `数值 ${cur} 大于最大值 ${n}` });
        if (typeof cur === 'string' && cur.length > n) issues.push({ level: 'error', path: f.path, message: `字符串长度 ${cur.length} 大于最大长度 ${n}` });
      }
      if (c.includes('整数') && typeof cur === 'number' && !Number.isInteger(cur)) {
        issues.push({ level: 'error', path: f.path, message: `要求整数，实际为 ${cur}` });
      }
      if (c.startsWith('可选值：')) {
        const opts = c.replace('可选值：', '').split('|').map((s) => s.trim());
        if (typeof cur === 'string' && !opts.includes(cur)) issues.push({ level: 'warning', path: f.path, message: `值「${cur}」不在枚举范围（${opts.join('/')}）` });
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------- 组装状态 */

export interface BuildMvuOptions {
  card: NormalizedCard | null;
  worldbooks: NormalizedWorldbook[];
  scripts: ScriptCollection[];
  importedStat?: AnyRecordLike | null;
  floors?: { index: number; statData: any; label?: string }[];
}

type AnyRecordLike = Record<string, any>;

export function buildMvuState(opts: BuildMvuOptions): MvuState {
  const allScripts: TavernScript[] = [];
  for (const c of opts.scripts) allScripts.push(...c.scripts);
  if (opts.card) {
    const fromCard = scriptsFromCard(opts.card.data).collection;
    if (fromCard) for (const s of fromCard.scripts) if (!allScripts.some((x) => x.id === s.id)) allScripts.push(s);
  }

  const allEntries: { entry: WorldbookEntry; book: string }[] = [];
  for (const wb of opts.worldbooks) for (const e of wb.entries) allEntries.push({ entry: e, book: wb.name });

  const det = detectMvu(allScripts, allEntries.map((x) => x.entry));

  const initEntry = findInitVarEntry(allEntries.map((x) => x.entry));
  let statData: AnyRecordLike = {};
  let statSource: MvuState['statSource'] = 'empty';
  let statSourceDetail = '';

  if (opts.importedStat && Object.keys(opts.importedStat).length) {
    statData = opts.importedStat;
    statSource = 'imported';
    statSourceDetail = '从外部导入的变量快照';
  } else if (initEntry) {
    const parsed = parseInitVar(initEntry.content || '');
    if (parsed.ok && isPlainObject(parsed.data)) {
      statData = parsed.data;
      statSource = 'worldbook';
      statSourceDetail = `世界书条目 #${initEntry.uid}「${initEntry.comment || '(无备注)'}」${parsed.unwrapped ? '（已剥离 stat_data 外层）' : ''}`;
    } else {
      statSourceDetail = `初始化条目存在但解析失败：${parsed.error || '未知错误'}`;
    }
  }

  // Schema 脚本
  const schemaScript = allScripts.find((s) => /registerVariableSchema|z\.object/.test(s.content || ''));
  let schemaResult: ZodParseResult = { found: false, fields: [], notes: [], dynamic: [] };
  if (schemaScript) schemaResult = parseZodSchema(schemaScript.content);

  const relatedEntries = allEntries
    .filter(({ entry }) =>
      INIT_COMMENT_RE.test(entry.comment || '') ||
      /变量|variable|update|更新|schema|init/i.test(entry.comment || '') ||
      /stat_data|_\.set|JSON\s*Patch|变量更新/i.test((entry.content || '').slice(0, 2000)),
    )
    .slice(0, 200)
    .map(({ entry }) => ({
      uid: entry.uid,
      comment: entry.comment || '(无备注)',
      kind: INIT_COMMENT_RE.test(entry.comment || '') ? '初始化变量' : /schema/i.test(entry.comment || '') ? 'Schema' : '变量规则/相关',
    }));

  const relatedScripts = allScripts
    .filter((s) => /stat_data|Mvu|mvu|registerVariableSchema|_\s*\.\s*(set|add)|变量/.test(s.content || '') || /mvu|变量|schema/i.test(s.name || ''))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: /registerVariableSchema|z\.object/.test(s.content) ? 'Schema' : /变量更新|update/i.test(s.name + s.content.slice(0, 200)) ? '变量更新' : 'MVU 相关',
    }));

  return {
    flavor: det.flavor,
    confidence: det.confidence,
    evidence: det.evidence,
    statData,
    statSource,
    statSourceDetail,
    displayData: undefined,
    deltaData: undefined,
    schemaFields: schemaResult.fields,
    schemaNote: schemaResult.found
      ? schemaResult.notes.join('；') || 'Zod Schema 静态解析完成（仅供结构与约束参考，运行时行为以实际执行为准）'
      : '未检测到 Zod Schema',
    relatedEntries,
    relatedScripts,
    floors: opts.floors || [],
  };
}
