/**
 * 世界书触发模拟器
 * ---------------------------------------------------------------------------
 * 实现依据（SillyTavern 世界书公开行为）：
 *  - 扫描深度：取最近 N 条消息拼接为扫描文本（条目 scanDepth 覆盖全局）
 *  - 关键词：子串匹配（默认不区分大小写）；支持整词匹配与正则键（版本相关）
 *  - 常驻条目 constant 无条件激活
 *  - 选择性逻辑 selectiveLogic 0/1/2/3
 *  - 触发概率 probability（useProbability）
 *  - 包含组 group：同组竞争，groupOverride 强制优先，groupWeight 加权
 *  - 递归扫描：excludeRecursion / preventRecursion / delayUntilRecursion
 *  - 插入位置 position / depth / role，排序 order
 *
 * 明确标注为「近似」的部分：包含组竞争的具体随机策略、递归轮次上限、
 * group scoring 的权重算法、token_budget 截断顺序。UI 中会同步展示这些说明。
 */

import type { WorldbookEntry } from './types';
import { deepEqual } from './util';

export interface SimMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SimOptions {
  messages: SimMessage[];
  /** 全局扫描深度（世界书设置里的 Scan Depth） */
  globalScanDepth: number;
  /** 全局是否区分大小写 / 整词匹配（作为条目 null 时的继承值） */
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  /** 是否执行概率判定 */
  rollProbability?: boolean;
  /** 随机种子，保证结果可复现 */
  seed?: number;
  /** 递归扫描开关与轮次上限 */
  recursion?: boolean;
  maxRecursionDepth?: number;
  /** token 预算（0 表示不限制）；用于标注哪些条目会被预算截断 */
  tokenBudget?: number;
  /** 是否支持正则键（版本相关，默认开启并标注） */
  regexKeys?: boolean;
}

export type SimStatus =
  | 'matched'
  | 'constant'
  | 'disabled'
  | 'no-key'
  | 'key-miss'
  | 'secondary-miss'
  | 'prob-fail'
  | 'group-blocked'
  | 'budget-cut';

export const SIM_STATUS_LABELS: Record<SimStatus, string> = {
  matched: '命中',
  constant: '常驻激活',
  disabled: '已禁用',
  'no-key': '无关键词',
  'key-miss': '关键词未命中',
  'secondary-miss': '次关键词条件不满足',
  'prob-fail': '概率未通过',
  'group-blocked': '同组竞争落选',
  'budget-cut': '超出 token 预算',
};

export interface KeywordHit {
  key: string;
  field: 'key' | 'keysecondary';
  snippet: string;
  viaRegex?: boolean;
}

export interface SimEntryResult {
  uid: number;
  comment: string;
  status: SimStatus;
  hits: KeywordHit[];
  reasons: string[];
  group?: string;
  orderValue: number;
  position: number;
  depth: number;
  role: number;
  contentTokens: number;
  round: number;
  /** 被预算截断时仍保留排序信息 */
  included: boolean;
}

export interface SimReport {
  scannedText: string;
  scanDepthUsed: number;
  messageCount: number;
  results: SimEntryResult[];
  injection: SimEntryResult[];
  totalTokens: number;
  budgetCut: number;
  groupDecisions: { group: string; candidates: number[]; winner: number | null; rule: string }[];
  recursionRounds: number;
  warnings: string[];
  rulesUsed: { rule: string; level: 'exact' | 'approx' | 'ignored'; note: string }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x2e80 && c <= 0x9fff) cjk++;
  }
  return Math.round(cjk + (text.length - cjk) / 4);
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface KeyMatch {
  matched: boolean;
  hits: KeywordHit[];
  regexError?: string;
}

function matchOneKey(
  key: string,
  text: string,
  opts: { caseSensitive: boolean; wholeWords: boolean; regexKeys: boolean },
): KeyMatch {
  const hits: KeywordHit[] = [];
  const raw = String(key ?? '').trim();
  if (!raw) return { matched: false, hits };

  // 正则键：/pattern/flags
  if (opts.regexKeys && raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const end = raw.lastIndexOf('/');
    const pattern = raw.slice(1, end);
    const flags = raw.slice(end + 1);
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard++ < 20) {
        const idx = m.index;
        hits.push({
          key: raw,
          field: 'key',
          snippet: snippetAround(text, idx, m[0].length),
          viaRegex: true,
        });
        if (m[0] === '') re.lastIndex++;
        if (hits.length >= 3) break;
      }
      return { matched: hits.length > 0, hits };
    } catch (e: any) {
      return { matched: false, hits, regexError: `正则键无效：${e.message}` };
    }
  }

  const needle = opts.wholeWords ? null : opts.caseSensitive ? raw : raw.toLowerCase();
  const hay = opts.caseSensitive ? text : text.toLowerCase();

  if (needle !== null) {
    let from = 0;
    while (hits.length < 3) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      hits.push({ key: raw, field: 'key', snippet: snippetAround(text, idx, raw.length) });
      from = idx + Math.max(1, needle.length);
    }
    return { matched: hits.length > 0, hits };
  }

  // 整词匹配
  try {
    const re = new RegExp(`\\b${escapeReg(raw)}\\b`, opts.caseSensitive ? 'g' : 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ key: raw, field: 'key', snippet: snippetAround(text, m.index, m[0].length) });
      if (hits.length >= 3) break;
      if (m[0] === '') re.lastIndex++;
    }
  } catch {
    /* 忽略 */
  }
  return { matched: hits.length > 0, hits };
}

function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 18);
  const end = Math.min(text.length, idx + len + 18);
  return (start ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ⏎ ') + (end < text.length ? '…' : '');
}

function scanTextForDepth(messages: SimMessage[], depth: number): { text: string; used: number } {
  if (!messages.length || depth <= 0) return { text: '', used: 0 };
  const slice = messages.slice(Math.max(0, messages.length - depth));
  const text = slice.map((m) => `${m.role}: ${m.content}`).join('\n');
  return { text, used: slice.length };
}

/** 核心模拟 */
export function simulateWorldbook(entries: WorldbookEntry[], opts: SimOptions): SimReport {
  const warnings: string[] = [];
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const results = new Map<number, SimEntryResult>();
  const active = new Set<number>();
  const maxRecursion = opts.maxRecursionDepth ?? 3;

  const base = scanTextForDepth(opts.messages, opts.globalScanDepth || 0);
  let scannedText = base.text;

  const globalCase = opts.caseSensitive ?? false;
  const globalWhole = opts.matchWholeWords ?? false;
  const regexKeys = opts.regexKeys ?? true;

  const entryByUid = new Map<number, WorldbookEntry>();
  for (const e of entries) if (!entryByUid.has(e.uid)) entryByUid.set(e.uid, e);

  const makeResult = (e: WorldbookEntry, round: number): SimEntryResult => ({
    uid: e.uid,
    comment: e.comment || '',
    status: 'key-miss',
    hits: [],
    reasons: [],
    group: e.group ? String(e.group).split(',')[0].trim() : undefined,
    orderValue: typeof e.order === 'number' ? e.order : 100,
    position: typeof e.position === 'number' ? e.position : 0,
    depth: typeof e.depth === 'number' ? e.depth : 4,
    role: typeof e.role === 'number' ? e.role : 0,
    contentTokens: estimateTokens(e.content || ''),
    round,
    included: false,
  });

  /** 对单条目做关键词判定 */
  function evaluate(e: WorldbookEntry, text: string, round: number): SimEntryResult {
    const r = makeResult(e, round);
    if (e.disable) {
      r.status = 'disabled';
      r.reasons.push('条目已禁用');
      return r;
    }
    if (e.constant) {
      r.status = 'constant';
      r.reasons.push('constant = true，无需关键词即注入');
      return r;
    }
    const keys = (e.key || []).map((k) => String(k)).filter((k) => k.trim());
    const secs = (e.keysecondary || []).map((k) => String(k)).filter((k) => k.trim());
    if (!keys.length) {
      r.status = 'no-key';
      r.reasons.push('未配置主关键词，且非常驻条目 → 永不触发');
      return r;
    }
    if (e.preventRecursion && round > 0) {
      r.status = 'key-miss';
      r.reasons.push('preventRecursion = true，不参与递归扫描');
      return r;
    }
    if (e.excludeRecursion && round > 0) {
      r.status = 'key-miss';
      r.reasons.push('excludeRecursion = true，被递归排除');
      return r;
    }
    const cse = e.caseSensitive ?? globalCase;
    const whole = e.matchWholeWords ?? globalWhole;

    let primaryHits: KeywordHit[] = [];
    let keyMatched = false;
    for (const k of keys) {
      const m = matchOneKey(k, text, { caseSensitive: cse, wholeWords: whole, regexKeys });
      if (m.regexError) r.reasons.push(m.regexError);
      if (m.matched) {
        keyMatched = true;
        primaryHits.push(...m.hits.map((h) => ({ ...h, field: 'key' as const })));
      }
    }
    r.hits = primaryHits.slice(0, 12);
    if (!keyMatched) {
      r.status = 'key-miss';
      r.reasons.push(`主关键词未命中（大小写敏感=${cse ? '是' : '否'}，整词=${whole ? '是' : '否'}）`);
      return r;
    }

    const selective = e.selective !== false;
    if (selective && secs.length) {
      let secHitCount = 0;
      for (const k of secs) {
        const m = matchOneKey(k, text, { caseSensitive: cse, wholeWords: whole, regexKeys });
        if (m.matched) {
          secHitCount++;
          r.hits.push(...m.hits.map((h) => ({ ...h, field: 'keysecondary' as const })));
        }
      }
      const logic = typeof e.selectiveLogic === 'number' ? e.selectiveLogic : 0;
      let pass = false;
      let desc = '';
      switch (logic) {
        case 1:
          pass = secHitCount < secs.length;
          desc = 'NOT ALL：次关键词未全部命中';
          break;
        case 2:
          pass = secHitCount === 0;
          desc = 'NOT ANY：次关键词全部未命中';
          break;
        case 3:
          pass = secHitCount === secs.length;
          desc = 'AND ALL：次关键词全部命中';
          break;
        default:
          pass = secHitCount > 0;
          desc = 'AND ANY：至少一个次关键词命中';
      }
      if (!pass) {
        r.status = 'secondary-miss';
        r.reasons.push(`次关键词条件不满足（${desc}；命中 ${secHitCount}/${secs.length}）`);
        return r;
      }
      r.reasons.push(`次关键词条件通过（${desc}；命中 ${secHitCount}/${secs.length}）`);
    } else if (secs.length) {
      r.reasons.push('selective = false，次关键词被忽略');
    }

    if (opts.rollProbability !== false && e.useProbability !== false) {
      const p = typeof e.probability === 'number' ? e.probability : 100;
      if (p < 100) {
        const roll = rng() * 100;
        if (roll >= p) {
          r.status = 'prob-fail';
          r.reasons.push(`概率判定失败：概率 ${p}%，随机数 ${roll.toFixed(1)}`);
          return r;
        }
        r.reasons.push(`概率判定通过：概率 ${p}%，随机数 ${roll.toFixed(1)}`);
      }
    } else if (typeof e.probability === 'number' && e.probability < 100) {
      r.reasons.push('已关闭概率判定（按必定触发处理）');
    }

    r.status = 'matched';
    return r;
  }

  // 第一轮
  for (const e of entries) {
    const r = evaluate(e, scannedText, 0);
    results.set(e.uid, r);
    if (r.status === 'matched' || r.status === 'constant') active.add(e.uid);
  }

  // 递归
  let round = 0;
  if (opts.recursion) {
    let changed = true;
    const insertedText: string[] = [];
    while (changed && round < maxRecursion) {
      changed = false;
      round++;
      insertedText.length = 0;
      for (const uid of active) {
        const e = entryByUid.get(uid);
        if (!e) continue;
        if (e.excludeRecursion) continue;
        insertedText.push(e.content || '');
      }
      const recursiveText = insertedText.join('\n');
      if (!recursiveText.trim()) break;
      for (const e of entries) {
        if (active.has(e.uid)) continue;
        if (e.disable || e.constant) continue;
        if (e.preventRecursion) continue;
        if (e.delayUntilRecursion && round < 1) continue;
        const r = evaluate(e, recursiveText, round);
        if (r.status === 'matched') {
          // 递归命中的条目不再计入「直接命中」的理由混淆
          r.reasons.push(`第 ${round} 轮递归扫描命中`);
          results.set(e.uid, r);
          active.add(e.uid);
          changed = true;
        } else if (r.status === 'prob-fail' || r.status === 'secondary-miss') {
          // 保留更详细的失败原因（不覆盖首轮 key-miss 的简单结果）
          const prev = results.get(e.uid);
          if (!prev || prev.status === 'key-miss') results.set(e.uid, r);
        }
      }
    }
  }

  // 包含组竞争
  const groupDecisions: SimReport['groupDecisions'] = [];
  const byGroup = new Map<string, number[]>();
  for (const uid of active) {
    const e = entryByUid.get(uid);
    if (!e?.group) continue;
    for (const g of String(e.group).split(',').map((s) => s.trim()).filter(Boolean)) {
      const arr = byGroup.get(g) || [];
      arr.push(uid);
      byGroup.set(g, arr);
    }
  }
  for (const [group, uids] of byGroup) {
    if (uids.length < 2) {
      groupDecisions.push({ group, candidates: uids, winner: uids[0] ?? null, rule: '组内唯一候选，直接通过' });
      continue;
    }
    const override = uids.filter((u) => entryByUid.get(u)?.groupOverride);
    let winner: number | null = null;
    let rule = '';
    if (override.length) {
      // 多个 override 时取权重最高
      override.sort((a, b) => (entryByUid.get(b)?.groupWeight ?? 100) - (entryByUid.get(a)?.groupWeight ?? 100));
      winner = override[0];
      rule = `groupOverride 优先（${override.length} 个候选）`;
    } else {
      const weights = uids.map((u) => Math.max(0, entryByUid.get(u)?.groupWeight ?? 100));
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) {
        winner = uids[0];
        rule = '权重全为 0，取第一个';
      } else {
        let roll = rng() * total;
        for (let i = 0; i < uids.length; i++) {
          roll -= weights[i];
          if (roll <= 0) {
            winner = uids[i];
            break;
          }
        }
        winner = winner ?? uids[uids.length - 1];
        rule = `按 groupWeight 加权随机（权重 ${weights.join('/')}）`;
      }
    }
    groupDecisions.push({ group, candidates: uids, winner, rule });
    for (const uid of uids) {
      if (uid === winner) continue;
      const r = results.get(uid);
      if (r && (r.status === 'matched' || r.status === 'constant')) {
        r.status = 'group-blocked';
        r.reasons.push(`同组「${group}」竞争落选（胜出：#${winner}）`);
        active.delete(uid);
      }
    }
  }

  // 排序 & 预算
  const injection = Array.from(active)
    .map((uid) => results.get(uid)!)
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      if (a.position === 4 && a.depth !== b.depth) return a.depth - b.depth;
      return b.orderValue - a.orderValue;
    });

  let totalTokens = 0;
  let budgetCut = 0;
  const budget = opts.tokenBudget ?? 0;
  for (const r of injection) {
    if (budget > 0 && totalTokens + r.contentTokens > budget) {
      r.status = 'budget-cut';
      r.included = false;
      r.reasons.push(`超出 token 预算（已用 ${totalTokens}/${budget}）`);
      budgetCut++;
      continue;
    }
    totalTokens += r.contentTokens;
    r.included = true;
  }

  const rulesUsed: SimReport['rulesUsed'] = [
    { rule: '扫描深度（条目 scanDepth 覆盖全局）', level: 'exact', note: '取最近 N 条消息拼接为扫描文本' },
    { rule: '关键词子串 / 整词匹配', level: 'exact', note: '整词匹配使用 \\b 边界，与 ST 的 matchWholeWords 行为一致' },
    { rule: '正则关键词 /pattern/flags', level: 'approx', note: '较新版本支持；旧版本会当作普通文本，故标注为近似' },
    { rule: '选择性逻辑 selectiveLogic', level: 'exact', note: 'AND ANY / NOT ALL / NOT ANY / AND ALL 四种' },
    { rule: '触发概率 probability', level: 'approx', note: '随机源为本地 PRNG（可设种子复现），与运行时不同' },
    { rule: '包含组 group / groupWeight / groupOverride', level: 'approx', note: '加权随机策略与 group scoring 细节可能随版本变化' },
    { rule: '递归扫描', level: 'approx', note: `轮次上限固定为 ${maxRecursion}，ST 的实际轮次受设置影响` },
    { rule: 'token_budget 截断', level: 'approx', note: '按排序后累加估算 token，实际分词器不同' },
    { rule: '向量化 / 语义召回', level: 'ignored', note: '需要嵌入模型与运行时，编辑器无法模拟' },
    { rule: 'sticky / cooldown / delay（按消息计数的时序状态）', level: 'ignored', note: '需要完整聊天时序状态机，当前仅展示数值' },
  ];

  if (!opts.messages.length) warnings.push('未提供模拟聊天内容，仅常驻条目会被激活。');
  if (opts.recursion) warnings.push(`递归扫描已启用，轮次上限 ${maxRecursion}（近似实现）。`);

  return {
    scannedText,
    scanDepthUsed: base.used,
    messageCount: opts.messages.length,
    results: Array.from(results.values()).sort((a, b) => a.uid - b.uid),
    injection,
    totalTokens,
    budgetCut,
    groupDecisions,
    recursionRounds: round,
    warnings,
    rulesUsed,
  };
}

export function buildScanPreview(messages: SimMessage[], depth: number): string {
  return scanTextForDepth(messages, depth).text;
}

/** 比较两份报告，用于「改动前后触发差异」 */
export function diffReports(a: SimReport, b: SimReport): { added: number[]; removed: number[] } {
  const sa = new Set(a.injection.filter((r) => r.included).map((r) => r.uid));
  const sb = new Set(b.injection.filter((r) => r.included).map((r) => r.uid));
  return {
    added: Array.from(sb).filter((u) => !sa.has(u)),
    removed: Array.from(sa).filter((u) => !sb.has(u)),
  };
}

/** 检查两组条目内容是否一致（用于测试） */
export function sameEntries(a: WorldbookEntry[], b: WorldbookEntry[]): boolean {
  return deepEqual(
    [...a].sort((x, y) => x.uid - y.uid),
    [...b].sort((x, y) => x.uid - y.uid),
  );
}
