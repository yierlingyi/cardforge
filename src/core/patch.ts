/**
 * JSON Patch (RFC 6902) 子集实现 + 生成器 + MVU 更新指令解析
 * 支持 add / remove / replace / move / copy / test
 */

import { clone, deepEqual, escapePointer, isPlainObject, parsePointer } from './util';

export interface PatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

export interface PatchResult {
  ok: boolean;
  result?: any;
  error?: string;
  failedAt?: number;
  applied: number;
}

function getParent(root: any, path: string): { parent: any; key: string } {
  const parts = parsePointer(path);
  if (!parts.length) return { parent: null, key: '' };
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') throw new Error(`路径不存在：${path}（在 ${parts.slice(0, i + 1).join('/')} 处中断）`);
    cur = cur[parts[i]];
  }
  if (cur === null || typeof cur !== 'object') {
    throw new Error(`路径不存在：${path}（父级 ${parts.slice(0, -1).join('/') || '(根)'} 不是对象或数组）`);
  }
  return { parent: cur, key: parts[parts.length - 1] };
}

export function applyPatch(doc: any, ops: PatchOp[]): PatchResult {
  const root = clone(doc);
  let applied = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (!op || typeof op !== 'object') throw new Error('操作项必须是对象');
      if (typeof op.path !== 'string') throw new Error('缺少 path 字段');
      switch (op.op) {
        case 'add': {
          const { parent, key } = getParent(root, op.path);
          if (Array.isArray(parent)) {
            const idx = key === '-' ? parent.length : Number(key);
            if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new Error(`数组下标非法：${key}`);
            parent.splice(idx, 0, clone(op.value));
          } else if (parent && typeof parent === 'object') {
            parent[key] = clone(op.value);
          } else throw new Error(`无法在 ${op.path} 添加`);
          break;
        }
        case 'remove': {
          const { parent, key } = getParent(root, op.path);
          if (Array.isArray(parent)) {
            const idx = Number(key);
            if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) throw new Error(`数组下标越界：${key}`);
            parent.splice(idx, 1);
          } else if (parent && typeof parent === 'object') {
            if (!(key in parent)) throw new Error(`字段不存在：${op.path}`);
            delete parent[key];
          } else throw new Error(`无法从 ${op.path} 删除`);
          break;
        }
        case 'replace': {
          const { parent, key } = getParent(root, op.path);
          if (Array.isArray(parent)) {
            const idx = Number(key);
            if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) throw new Error(`数组下标越界：${key}`);
            parent[idx] = clone(op.value);
          } else if (parent && typeof parent === 'object') {
            if (!(key in parent)) throw new Error(`replace 目标不存在：${op.path}（如需新增请用 add）`);
            parent[key] = clone(op.value);
          } else throw new Error(`无法替换 ${op.path}`);
          break;
        }
        case 'move':
        case 'copy': {
          if (typeof op.from !== 'string') throw new Error('move/copy 需要 from 字段');
          const { parent: fp, key: fk } = getParent(root, op.from);
          const val = Array.isArray(fp) ? fp[Number(fk)] : fp?.[fk];
          if (val === undefined) throw new Error(`from 路径不存在：${op.from}`);
          const copied = clone(val);
          if (op.op === 'move') {
            if (Array.isArray(fp)) fp.splice(Number(fk), 1);
            else delete fp[fk];
          }
          const { parent, key } = getParent(root, op.path);
          if (Array.isArray(parent)) parent.splice(key === '-' ? parent.length : Number(key), 0, copied);
          else if (parent && typeof parent === 'object') parent[key] = copied;
          else throw new Error(`无法写入 ${op.path}`);
          break;
        }
        case 'test': {
          const { parent, key } = getParent(root, op.path);
          const cur = Array.isArray(parent) ? parent[Number(key)] : parent?.[key];
          if (!deepEqual(cur, op.value)) throw new Error(`test 失败：${op.path} 当前值与期望值不一致`);
          break;
        }
        default:
          throw new Error(`不支持的 op：${(op as any).op}`);
      }
      applied++;
    } catch (e: any) {
      return { ok: false, error: e?.message ? String(e.message) : String(e), failedAt: i, applied, result: root };
    }
  }
  return { ok: true, result: root, applied };
}

/** 生成 a → b 的补丁（深度优先，数组按整段替换） */
export function generatePatch(a: any, b: any, base = ''): PatchOp[] {
  const ops: PatchOp[] = [];
  if (deepEqual(a, b)) return ops;

  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) ops.push({ op: 'remove', path: base + '/' + escapePointer(k) });
    }
    for (const k of Object.keys(b)) {
      const p = base + '/' + escapePointer(k);
      if (!(k in a)) ops.push({ op: 'add', path: p, value: clone(b[k]) });
      else ops.push(...generatePatch(a[k], b[k], p));
    }
    return ops;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) {
      let sameShape = true;
      for (let i = 0; i < a.length; i++) {
        if (isPlainObject(a[i]) !== isPlainObject(b[i]) || Array.isArray(a[i]) !== Array.isArray(b[i])) sameShape = false;
      }
      if (sameShape) {
        for (let i = 0; i < a.length; i++) ops.push(...generatePatch(a[i], b[i], base + '/' + i));
        return ops;
      }
    }
    if (!a.length) return [{ op: 'add', path: base || '/', value: clone(b) }];
    return [{ op: 'replace', path: base, value: clone(b) }];
  }
  ops.push({ op: base ? 'replace' : 'add', path: base || '', value: clone(b) });
  return ops;
}

/* ------------------------------------------------------- MVU 更新指令解析 */

export interface ParsedUpdate {
  ops: PatchOp[];
  format: 'json-patch' | 'mvu-calls' | 'unknown';
  errors: string[];
  warnings: string[];
  raw: string;
}

/** 点路径 / 中文键路径 → JSON Pointer */
export function dotPathToPointer(path: string): string {
  const p = path.trim().replace(/^\./, '');
  if (p.startsWith('/')) return p;
  const parts = p.split('.').filter((s) => s.length > 0);
  return parts.map((s) => '/' + escapePointer(s)).join('');
}

/** 解析 JS 字面量（宽松）：支持字符串/数字/布尔/null/数组/对象 */
export function parseLooseLiteral(src: string): { ok: boolean; value?: any; error?: string } {
  const t = src.trim();
  if (!t) return { ok: false, error: '空值' };
  try {
    // 用 JSON5 风格转换：单引号 → 双引号，裸键加引号
    let s = t
      .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner) => JSON.stringify(inner.replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    return { ok: true, value: JSON.parse(s) };
  } catch (e: any) {
    if (/^(true|false)$/.test(t)) return { ok: true, value: t === 'true' };
    if (t === 'null' || t === 'undefined') return { ok: true, value: null };
    if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: Number(t) };
    if (/^['"].*['"]$/.test(t)) return { ok: true, value: t.slice(1, -1) };
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

/**
 * 解析 MVU 变量更新块。已确认支持的形态：
 * 1) 标准 JSON Patch 数组：[{ "op": "replace", "path": "/角色/好感", "value": 10 }]
 * 2) MVU 文档中常见的 `_.set('角色.好感', 10)` 调用风格
 * 未识别的形态会明确报错，不做猜测性执行。
 */
export function parseUpdateCommands(text: string): ParsedUpdate {
  const raw = text || '';
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return { ops: [], format: 'unknown', errors: ['内容为空'], warnings, raw };

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const ops: PatchOp[] = [];
      for (const o of arr) {
        if (!o || typeof o !== 'object' || typeof o.op !== 'string') {
          errors.push(`非法操作项：${JSON.stringify(o).slice(0, 60)}`);
          continue;
        }
        if (!['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(o.op)) {
          errors.push(`不支持的 op：${o.op}`);
          continue;
        }
        ops.push({ op: o.op, path: String(o.path ?? ''), value: o.value, from: o.from });
      }
      return { ops, format: 'json-patch', errors, warnings, raw };
    } catch (e: any) {
      errors.push(`JSON 解析失败：${e.message}`);
      return { ops: [], format: 'unknown', errors, warnings, raw };
    }
  }

  // _.set('a.b', 1) 风格
  const ops: PatchOp[] = [];
  const re = /_\.(set|add|replace|remove|delete|insert|move|copy)\s*\(([\s\S]*?)\)\s*;?\s*$/gm;
  let m: RegExpExecArray | null;
  let matchedAny = false;
  while ((m = re.exec(trimmed))) {
    matchedAny = true;
    const fn = m[1];
    const argsRaw = m[2];
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    let quote: string | null = null;
    for (const c of argsRaw) {
      if (quote) {
        cur += c;
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        cur += c;
        continue;
      }
      if ('[{('.includes(c)) depth++;
      if (']})'.includes(c)) depth--;
      if (c === ',' && depth === 0) {
        args.push(cur.trim());
        cur = '';
        continue;
      }
      cur += c;
    }
    if (cur.trim()) args.push(cur.trim());

    const pathLit = parseLooseLiteral(args[0] || '');
    if (!pathLit.ok || typeof pathLit.value !== 'string') {
      errors.push(`无法解析路径参数：${args[0] || '(空)'}`);
      continue;
    }
    const pointer = dotPathToPointer(pathLit.value);
    if (fn === 'set' || fn === 'replace') {
      const v = parseLooseLiteral(args.slice(1).join(','));
      if (!v.ok) {
        errors.push(`无法解析 ${fn} 的值：${args.slice(1).join(',')}`);
        continue;
      }
      ops.push({ op: 'replace', path: pointer, value: v.value });
    } else if (fn === 'add' || fn === 'insert') {
      const v = parseLooseLiteral(args.slice(1).join(','));
      if (!v.ok) {
        errors.push(`无法解析 ${fn} 的值`);
        continue;
      }
      ops.push({ op: 'add', path: pointer, value: v.value });
    } else if (fn === 'remove' || fn === 'delete') {
      ops.push({ op: 'remove', path: pointer });
    } else if ((fn === 'move' || fn === 'copy') && args[1]) {
      const to = parseLooseLiteral(args[1]);
      if (!to.ok || typeof to.value !== 'string') {
        errors.push(`无法解析 ${fn} 的目标路径`);
        continue;
      }
      ops.push({ op: fn, from: pointer, path: dotPathToPointer(to.value) });
    }
  }
  if (matchedAny) {
    warnings.push('检测到 `_.xxx()` 调用风格，已转换为 JSON Patch；MVU 侧的运算类指令（如 _.add 做数值累加）在此按字面值写入，语义可能与运行时不同。');
    return { ops, format: 'mvu-calls', errors, warnings, raw };
  }

  errors.push('无法识别更新格式：支持 JSON Patch 数组，或 `_.set("路径", 值)` 调用');
  return { ops: [], format: 'unknown', errors, warnings, raw };
}

export function formatPatch(ops: PatchOp[]): string {
  return JSON.stringify(ops, null, 2);
}
