import type { RegexScript } from './types';
import { uuid } from './util';

/* --------------------------------------------------------------- 结构解析 */

export interface ParsedRegex {
  pattern: string;
  flags: string;
  ok: boolean;
  error?: string;
  /** 是否自动补了 g 标志（SillyTavern 默认全局替换） */
  addedGlobal?: boolean;
}

/**
 * 解析 SillyTavern 的 findRegex 字符串。
 * 真实存储形式是 `/pattern/flags`，例如 `/\\bfoo\\b/gi`。
 * 若缺少定界符，则把整串当作 pattern 处理（并提示）。
 */
export function parseFindRegex(findRegex: string): ParsedRegex {
  const s = findRegex ?? '';
  if (!s) return { pattern: '', flags: '', ok: false, error: 'findRegex 为空' };
  if (s.startsWith('/')) {
    // 找最后一个未转义的 /
    let end = -1;
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i] === '/') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) bs++;
        if (bs % 2 === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > 0) {
      const pattern = s.slice(1, end);
      let flags = s.slice(end + 1);
      if (!/^[dgimsuvy]*$/.test(flags)) {
        return { pattern: s.slice(1), flags: '', ok: false, error: `无法识别的正则标志：${flags}` };
      }
      return { pattern, flags, ok: true };
    }
    return { pattern: s.slice(1), flags: '', ok: false, error: '缺少结束定界符 /，已按裸 pattern 处理' };
  }
  return { pattern: s, flags: '', ok: false, error: 'findRegex 缺少 /.../ 定界符，已按裸 pattern 处理' };
}

export function buildRegExp(parsed: ParsedRegex, forceGlobal = true): RegExp {
  let flags = parsed.flags;
  if (forceGlobal && !flags.includes('g')) flags += 'g';
  const re = new RegExp(parsed.pattern, flags);
  re.lastIndex = 0;
  return re;
}

/* ------------------------------------------------------------- 宏替换 */

export interface MacroContext {
  char?: string;
  user?: string;
  [k: string]: string | number | null | undefined;
}

/** substituteRegex: 0 = 不替换，1 = 原文替换，2 = 正则转义后替换 */
export function substituteMacros(text: string, ctx: MacroContext, mode: number): string {
  if (!mode) return text;
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, name: string) => {
    const raw = ctx[name.toLowerCase()];
    if (raw === undefined || raw === null || typeof raw === 'number') return m;
    return mode === 2 ? escapeRegExp(raw) : raw;
  });
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* --------------------------------------------------------------- 风险检测 */

export interface RegexRisk {
  level: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * 灾难性回溯的启发式检测。
 * 说明：这是静态启发式，无法证明安全；真正的保护是执行超时。
 */
export function detectRegexRisk(pattern: string): RegexRisk {
  if (!pattern) return { level: 'low', reason: '' };
  if (pattern.length > 5000) return { level: 'medium', reason: '表达式过长（>5000 字符），编译与匹配开销可能较高' };

  const risks: RegexRisk[] = [];
  // 嵌套量词：(a+)+ / (a*)* / (\w+)*
  if (/\((?:\?:)?[^()]*[+*][^()]*\)[+*]/.test(pattern)) {
    risks.push({ level: 'high', reason: '检测到嵌套量词（如 (a+)+），在长文本上可能产生灾难性回溯' });
  }
  // (.*)* 与 (.+)+
  if (/\((?:\.\*|\.\+)\)[+*]/.test(pattern)) {
    risks.push({ level: 'high', reason: '检测到 (.*)+ / (.+)* 形式，极易指数级回溯' });
  }
  // 多个宽泛通配符串联
  const wildcards = (pattern.match(/\.\*/g) || []).length;
  if (wildcards >= 4) risks.push({ level: 'medium', reason: `包含 ${wildcards} 个 .* 通配符，长文本匹配可能变慢` });
  // 交替分支重叠 (a|a|a)* 形式
  if (/\(([^()|]+)\|(?:\1)(?:\|[^()]*)?\)[+*]/.test(pattern)) {
    risks.push({ level: 'high', reason: '存在重叠的交替分支并带量词，可能产生指数级回溯' });
  }
  // 无界量词 + 后向断言组合
  if (/\.\*.*\(\?<[=!]/.test(pattern)) risks.push({ level: 'medium', reason: '通配符后接后向断言，可能触发大量回溯' });

  if (!risks.length) return { level: 'low', reason: '' };
  const level = risks.some((r) => r.level === 'high') ? 'high' : 'medium';
  return { level, reason: risks.map((r) => r.reason).join('；') };
}

/* ---------------------------------------------------------------- 执行 */

export interface MatchInfo {
  index: number;
  end: number;
  value: string;
  groups: string[];
  named: Record<string, string | undefined>;
}

export interface RegexRunResult {
  ok: boolean;
  error?: string;
  errorIndex?: number;
  matches: MatchInfo[];
  output: string;
  truncated?: boolean;
  elapsedMs: number;
  groupNames: string[];
}

export function countCaptureGroups(pattern: string): number {
  // 粗略统计捕获组（跳过 (?: (?= (?! (?<= (?<! 以及字符类中的括号）
  let count = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      if (pattern[i + 1] !== '?') count++;
      else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') count++;
    }
  }
  return count;
}

export function listNamedGroups(pattern: string): string[] {
  const out: string[] = [];
  const re = /\(\?<([A-Za-z_$][\w$]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern))) out.push(m[1]);
  return out;
}

export function applyTrimStrings(text: string, trims: string[] | undefined): string {
  if (!trims?.length) return text;
  let out = text;
  for (const t of trims) if (t) out = out.split(t).join('');
  return out;
}

/** 在给定文本上执行一条正则规则（含替换），最多返回 maxMatches 个匹配 */
export function runRegexOnText(
  script: RegexScript,
  text: string,
  opts: { maxMatches?: number; macroCtx?: MacroContext; forceGlobal?: boolean } = {},
): RegexRunResult {
  const started = performance.now();
  const maxMatches = opts.maxMatches ?? 500;
  const parsed = parseFindRegex(script.findRegex);
  const result: RegexRunResult = {
    ok: false,
    matches: [],
    output: text,
    elapsedMs: 0,
    groupNames: [],
  };
  if (!parsed.pattern) {
    result.error = '正则表达式为空';
    result.elapsedMs = performance.now() - started;
    return result;
  }
  let pattern = parsed.pattern;
  if (script.substituteRegex) pattern = substituteMacros(pattern, opts.macroCtx || {}, script.substituteRegex);
  let replace = script.replaceString ?? '';
  if (script.substituteRegex) replace = substituteMacros(replace, opts.macroCtx || {}, script.substituteRegex);

  let re: RegExp;
  try {
    re = buildRegExp({ ...parsed, pattern }, opts.forceGlobal !== false);
  } catch (e: any) {
    result.error = `正则编译失败：${e?.message || e}`;
    result.errorIndex = 0;
    result.elapsedMs = performance.now() - started;
    return result;
  }

  result.groupNames = listNamedGroups(pattern);
  const matches: MatchInfo[] = [];
  try {
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      const named: Record<string, string | undefined> = {};
      if (m.groups) for (const k of Object.keys(m.groups)) named[k] = m.groups[k];
      matches.push({
        index: m.index,
        end: m.index + m[0].length,
        value: m[0],
        groups: m.slice(1),
        named,
      });
      if (m[0] === '') re.lastIndex++; // 防止零宽匹配死循环
      if (matches.length >= maxMatches + 1) {
        result.truncated = true;
        break;
      }
      if (++guard > maxMatches + 2) break;
    }
    result.ok = true;
  } catch (e: any) {
    result.error = `匹配过程异常：${e?.message || e}`;
    result.elapsedMs = performance.now() - started;
    return result;
  }

  if (matches.length > maxMatches) matches.length = maxMatches;

  // 替换：对 trimStrings 先裁剪，再做全量替换（与 SillyTavern 的 trim 语义一致）
  try {
    let target = applyTrimStrings(text, script.trimStrings);
    // 若发生裁剪，索引会变化，matches 仍按原文展示，替换按裁剪后文本执行
    result.output = target.replace(re, replace);
    if (replace === '' && matches.length === 0) result.output = target;
    // 未指定全局时，仅替换第一处
    if (parsed.flags && !parsed.flags.includes('g')) {
      const re1 = new RegExp(pattern, parsed.flags);
      result.output = target.replace(re1, replace);
    }
  } catch (e: any) {
    result.error = `替换失败：${e?.message || e}`;
  }

  result.matches = matches;
  result.elapsedMs = performance.now() - started;
  return result;
}

/** 多条规则按顺序执行，记录每一步 */
export interface ChainStep {
  scriptId: string;
  scriptName: string;
  before: string;
  after: string;
  matchCount: number;
  error?: string;
  elapsedMs: number;
  skipped?: string;
}

export interface ChainResult {
  steps: ChainStep[];
  final: string;
}

export interface ChainContext extends MacroContext {
  /** 当前消息楼层深度，用于 minDepth/maxDepth 过滤；null 表示不判断 */
  messageDepth?: number | null;
  /** 目标位置，用于 placement 过滤 */
  placement?: number | null;
}

export function runRegexChain(scripts: RegexScript[], text: string, ctx: ChainContext = {}): ChainResult {
  const steps: ChainStep[] = [];
  let cur = text;
  for (const s of scripts) {
    if (s.disabled) {
      steps.push({ scriptId: s.id, scriptName: s.scriptName, before: cur, after: cur, matchCount: 0, elapsedMs: 0, skipped: '已禁用' });
      continue;
    }
    if (ctx.placement != null && Array.isArray(s.placement) && s.placement.length && !s.placement.includes(ctx.placement)) {
      steps.push({
        scriptId: s.id,
        scriptName: s.scriptName,
        before: cur,
        after: cur,
        matchCount: 0,
        elapsedMs: 0,
        skipped: 'placement 不匹配',
      });
      continue;
    }
    if (ctx.messageDepth != null) {
      if (typeof s.minDepth === 'number' && ctx.messageDepth < s.minDepth) {
        steps.push({ scriptId: s.id, scriptName: s.scriptName, before: cur, after: cur, matchCount: 0, elapsedMs: 0, skipped: `深度 ${ctx.messageDepth} < minDepth ${s.minDepth}` });
        continue;
      }
      if (typeof s.maxDepth === 'number' && s.maxDepth >= 0 && ctx.messageDepth > s.maxDepth) {
        steps.push({ scriptId: s.id, scriptName: s.scriptName, before: cur, after: cur, matchCount: 0, elapsedMs: 0, skipped: `深度 ${ctx.messageDepth} > maxDepth ${s.maxDepth}` });
        continue;
      }
    }
    const r = runRegexOnText(s, cur, { maxMatches: 200, macroCtx: ctx });
    steps.push({
      scriptId: s.id,
      scriptName: s.scriptName,
      before: cur,
      after: r.ok ? r.output : cur,
      matchCount: r.matches.length,
      error: r.error,
      elapsedMs: r.elapsedMs,
    });
    if (r.ok) cur = r.output;
  }
  return { steps, final: cur };
}

/* --------------------------------------------------------------- 新建/导入 */

export function createRegexScript(init?: Partial<RegexScript>): RegexScript {
  return {
    id: uuid(),
    scriptName: '新建规则',
    findRegex: '/(pattern)/gi',
    replaceString: '',
    trimStrings: [],
    placement: [3],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...(init || {}),
  };
}

export function normalizeRegexScript(raw: any, i = 0): RegexScript {
  const s: RegexScript = { ...(raw || {}) };
  s.id = typeof s.id === 'string' && s.id ? s.id : uuid();
  s.scriptName = typeof s.scriptName === 'string' ? s.scriptName : `规则 ${i + 1}`;
  s.findRegex = typeof s.findRegex === 'string' ? s.findRegex : '';
  s.replaceString = typeof s.replaceString === 'string' ? s.replaceString : '';
  if (!Array.isArray(s.trimStrings)) s.trimStrings = [];
  if (!Array.isArray(s.placement)) s.placement = typeof s.placement === 'number' ? [s.placement] : [];
  s.disabled = !!s.disabled;
  s.markdownOnly = !!s.markdownOnly;
  s.promptOnly = !!s.promptOnly;
  s.runOnEdit = !!s.runOnEdit;
  if (typeof s.substituteRegex !== 'number') s.substituteRegex = 0;
  if (s.minDepth === undefined) s.minDepth = null;
  if (s.maxDepth === undefined) s.maxDepth = null;
  return s;
}

export function parseRegexCollection(json: any): { scripts: RegexScript[]; root: any; shape: 'array' | 'object' } {
  if (Array.isArray(json)) {
    return { scripts: json.map((s, i) => normalizeRegexScript(s, i)), root: json, shape: 'array' };
  }
  if (json && Array.isArray(json.scripts)) {
    return { scripts: json.scripts.map((s: any, i: number) => normalizeRegexScript(s, i)), root: json, shape: 'object' };
  }
  if (json && typeof json === 'object') {
    // 以 id 为键的对象形式（部分导出）
    const vals = Object.values(json);
    if (vals.length && vals.every((v: any) => v && typeof v === 'object' && 'findRegex' in v)) {
      return { scripts: (vals as any[]).map((s, i) => normalizeRegexScript(s, i)), root: json, shape: 'object' };
    }
  }
  throw new Error('无法识别的正则规则文件：应为数组、{scripts:[...]} 或以 id 为键的对象');
}

export function exportRegexCollection(scripts: RegexScript[], shape: 'array' | 'object' = 'array'): any {
  const clean = scripts.map((s) => {
    const c: any = { ...s };
    return c;
  });
  return shape === 'object' ? { scripts: clean } : clean;
}
