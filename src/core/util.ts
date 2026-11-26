/** 通用工具：无依赖、可被 Worker 复用 */

export const hasOwn = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o ?? {}, k);

export function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v);
    } catch {
      /* 含不可克隆对象时退回 JSON */
    }
  }
  return JSON.parse(JSON.stringify(v));
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    if (Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!hasOwn(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** JSON Pointer 转义（RFC 6901） */
export const escapePointer = (s: string) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
export const unescapePointer = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');

export function parsePointer(pointer: string): string[] {
  if (!pointer) return [];
  const p = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return p.split('/').map(unescapePointer);
}

export function toPointer(parts: (string | number)[]): string {
  return parts.map((p) => '/' + escapePointer(String(p))).join('');
}

export function getByPointer(root: any, pointer: string): any {
  let cur = root;
  for (const part of parsePointer(pointer)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setByPointer(root: any, pointer: string, value: any): void {
  const parts = parsePointer(pointer);
  if (!parts.length) throw new Error('不能整体替换根对象');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === null || typeof cur[k] !== 'object') {
      cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

export function deleteByPointer(root: any, pointer: string): void {
  const parts = parsePointer(pointer);
  if (!parts.length) return;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return;
    cur = cur[parts[i]];
  }
  if (cur === null || typeof cur !== 'object') return;
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else delete cur[last];
}

export function jsonType(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function humanSize(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export type Debounced<F extends (...a: any[]) => any> = F & {
  cancel: () => void;
  flush: (...args: Parameters<F>) => void;
};

export function debounce<F extends (...a: any[]) => any>(fn: F, ms: number): Debounced<F> {
  let t: any = null;
  const wrapped = (...args: Parameters<F>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  return Object.assign(wrapped, {
    cancel: () => {
      if (t) clearTimeout(t);
      t = null;
    },
    flush: (...args: Parameters<F>) => {
      if (t) clearTimeout(t);
      t = null;
      fn(...args);
    },
  }) as Debounced<F>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder('utf-8').decode(base64ToBytes(b64));
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function safeJsonParse<T = any>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : String(e) };
  }
}

export function formatJson(v: any, indent = 2): string {
  try {
    return JSON.stringify(v, null, indent);
  } catch {
    return String(v);
  }
}

export function bytesBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mime });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(name: string, fallback = 'untitled'): string {
  const s = (name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return s || fallback;
}

/** 简单的高亮匹配片段切分（用于搜索结果展示） */
export function splitHighlight(text: string, needle: string, limit = 2): { text: string; hit: boolean }[] {
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  let hits = 0;
  while (i < text.length && hits < limit) {
    const idx = lower.indexOf(n, i);
    if (idx < 0) break;
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + needle.length), hit: true });
    i = idx + needle.length;
    hits++;
  }
  if (i < text.length) parts.push({ text: text.slice(i), hit: false });
  return parts;
}

export function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
