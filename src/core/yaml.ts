/**
 * 极简 YAML 子集解析器（专供 MVU 初始化变量条目使用）
 * 支持：嵌套映射、序列、序列内映射、行内 [a,b] / {a:1}、引号、数字/bool/null、
 *      块标量 | 与 >、注释、文档分隔符 ---。
 * 不支持（会明确报错或告警）：锚点 &/*、复杂标签、多文档合并、流式多行。
 * 若内容以 { 或 [ 开头则优先按 JSON 解析。
 */

export interface YamlParseResult {
  ok: boolean;
  value: any;
  error?: string;
  warnings: string[];
}

interface Line {
  indent: number;
  text: string;
  raw: string;
  no: number;
}

function preprocess(src: string): { lines: Line[]; warnings: string[] } {
  const warnings: string[] = [];
  const rawLines = src.replace(/\r\n?/g, '\n').split('\n');
  const lines: Line[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') {
      i++;
      continue;
    }
    if (/^[&*]/.test(trimmed)) warnings.push(`第 ${i + 1} 行使用 YAML 锚点/别名，暂不支持：${trimmed}`);
    let indent = 0;
    while (indent < raw.length && (raw[indent] === ' ' || raw[indent] === '\t')) indent += raw[indent] === '\t' ? 2 : 1;
    lines.push({ indent, text: trimmed, raw, no: i + 1 });
    i++;
  }
  return { lines, warnings };
}

function stripComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

function parseScalar(raw: string, warnings: string[], lineNo: number): any {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('&') || s.startsWith('*')) {
    warnings.push(`第 ${lineNo} 行：锚点/别名不被支持，已按字符串处理`);
    return s;
  }
  if (s.startsWith('!!')) s = s.replace(/^!!\w+\s*/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    if (s[0] === '"') {
      return inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return inner.replace(/''/g, "'");
  }
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      // 先按 JSON 尝试（引号齐全时）
      return JSON.parse(s.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1'));
    } catch {
      if (s.startsWith('[') && s.endsWith(']')) {
        const body = s.slice(1, -1).trim();
        if (!body) return [];
        return splitFlow(body).map((p) => parseScalar(p, warnings, lineNo));
      }
      if (s.startsWith('{') && s.endsWith('}')) {
        const body = s.slice(1, -1).trim();
        const obj: any = {};
        if (!body) return obj;
        for (const part of splitFlow(body)) {
          const idx = part.indexOf(':');
          if (idx < 0) continue;
          obj[unquote(part.slice(0, idx).trim())] = parseScalar(part.slice(idx + 1), warnings, lineNo);
        }
        return obj;
      }
      warnings.push(`第 ${lineNo} 行：无法解析行内集合，按字符串处理`);
      return s;
    }
  }
  if (/^(true|True|TRUE|yes|Yes|on|On)$/.test(s)) return true;
  if (/^(false|False|FALSE|no|No|off|Off)$/.test(s)) return false;
  if (/^(null|Null|NULL|~)$/.test(s)) return null;
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  if (s === '{}') return {};
  if (s === '[]') return [];
  return s;
}

function splitFlow(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const c of body) {
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
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function findColon(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ':' && depth === 0 && (i + 1 >= text.length || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

export function parseYamlSubset(src: string): YamlParseResult {
  const text = (src || '').trim();
  const warnings: string[] = [];
  if (!text) return { ok: true, value: {}, warnings };
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return { ok: true, value: JSON.parse(text), warnings: ['内容按 JSON 解析'] };
    } catch {
      /* 继续按 YAML 解析 */
    }
  }

  const { lines, warnings: w0 } = preprocess(text);
  warnings.push(...w0);
  if (!lines.length) return { ok: true, value: {}, warnings };

  let pos = 0;

  function parseBlock(minIndent: number): any {
    const first = lines[pos];
    if (!first) return null;
    if (first.text.startsWith('- ') || first.text === '-') return parseSequence(first.indent);

    const obj: any = {};
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent < minIndent) break;
      if (line.text.startsWith('- ')) break;
      const colon = findColon(line.text);
      if (colon < 0) {
        warnings.push(`第 ${line.no} 行缺少冒号，已跳过：${line.text.slice(0, 40)}`);
        pos++;
        continue;
      }
      const key = unquote(line.text.slice(0, colon).trim());
      let rest = stripComment(line.text.slice(colon + 1).trim());
      pos++;

      // 块标量
      if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
        const blockLines: string[] = [];
        const baseIndent = line.indent;
        while (pos < lines.length && lines[pos].indent > baseIndent) {
          blockLines.push(lines[pos].raw.slice(Math.min(lines[pos].indent, baseIndent + 2)));
          pos++;
        }
        obj[key] = rest.startsWith('|') ? blockLines.join('\n') : blockLines.join(' ');
        continue;
      }

      if (!rest) {
        // 嵌套块
        const next = lines[pos];
        if (next && (next.indent > line.indent || (next.indent === line.indent && next.text.startsWith('- ')))) {
          obj[key] = next.text.startsWith('- ') && next.indent === line.indent ? parseSequence(next.indent) : parseBlock(next.indent);
        } else if (next && next.indent >= line.indent && next.text.startsWith('- ')) {
          obj[key] = parseSequence(next.indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest, warnings, line.no);
      }
    }
    return obj;
  }

  function parseSequence(indent: number): any[] {
    const arr: any[] = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.indent !== indent || !(line.text.startsWith('- ') || line.text === '-')) break;
      const rest = stripComment(line.text.slice(1).trim());
      pos++;
      if (!rest) {
        const next = lines[pos];
        if (next && next.indent > indent) arr.push(parseBlock(next.indent));
        else arr.push(null);
        continue;
      }
      const colon = findColon(rest);
      if (colon > 0) {
        // - key: value （行内映射起点）
        const obj: any = {};
        const k = unquote(rest.slice(0, colon).trim());
        const v = rest.slice(colon + 1).trim();
        if (v) obj[k] = parseScalar(v, warnings, line.no);
        else {
          const next = lines[pos];
          obj[k] = next && next.indent > indent ? parseBlock(next.indent) : null;
        }
        // 同条目后续键（缩进大于 - 的列）
        while (pos < lines.length && lines[pos].indent > indent && !lines[pos].text.startsWith('- ')) {
          const sub = lines[pos];
          const c2 = findColon(sub.text);
          if (c2 < 0) {
            pos++;
            continue;
          }
          const k2 = unquote(sub.text.slice(0, c2).trim());
          const v2 = stripComment(sub.text.slice(c2 + 1).trim());
          pos++;
          if (v2) obj[k2] = parseScalar(v2, warnings, sub.no);
          else {
            const nx = lines[pos];
            obj[k2] = nx && nx.indent > sub.indent ? parseBlock(nx.indent) : null;
          }
        }
        arr.push(obj);
      } else {
        arr.push(parseScalar(rest, warnings, line.no));
        // 支持 "- 文本" 后续同缩进的续行映射（少见，忽略）
      }
    }
    return arr;
  }

  try {
    const value = parseBlock(lines[0].indent);
    return { ok: true, value, warnings };
  } catch (e: any) {
    return { ok: false, value: null, error: e?.message ? String(e.message) : String(e), warnings };
  }
}

/** 变量初始化条目常见前缀（stat_data: / 变量: / initvar:）剥离 */
export function unwrapInitVar(parsed: any): { data: any; unwrapped: boolean } {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && /^(stat_data|variables?|initvar|初始化变量|变量)$/i.test(keys[0])) {
      return { data: parsed[keys[0]], unwrapped: true };
    }
  }
  return { data: parsed, unwrapped: false };
}
