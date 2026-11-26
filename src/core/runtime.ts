import type { ChainContext, ChainResult, MacroContext, RegexRunResult } from './regex';
import type { RegexScript } from './types';
import type { WorldbookEntry } from './types';

type Pending = { resolve: (v: any) => void; timer: any; worker: Worker };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/regex.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, result, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(error ? { ok: false, error, timeout: false } : { ...(result as object), timeout: false });
  };
  worker.onerror = () => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'Worker 执行异常', timeout: false });
      pending.delete(id);
    }
  };
  return worker;
}

function killWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function run<T>(msg: any, timeoutMs: number): Promise<T & { timeout?: boolean }> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      killWorker();
      resolve({ ok: false, error: `执行超时（>${timeoutMs}ms），已强制终止。该正则可能存在灾难性回溯。`, timeout: true } as any);
    }, timeoutMs);
    pending.set(id, { resolve: resolve as any, timer, worker: w });
    w.postMessage({ ...msg, id });
  });
}

export function testRegexSafe(
  script: RegexScript,
  text: string,
  ctx: MacroContext,
  timeoutMs = 300,
): Promise<RegexRunResult & { timeout?: boolean }> {
  return run({ type: 'test', script, text, ctx }, timeoutMs);
}

export function testChainSafe(
  scripts: RegexScript[],
  text: string,
  ctx: ChainContext,
  timeoutMs = 800,
): Promise<ChainResult & { timeout?: boolean; ok?: boolean; error?: string }> {
  return run({ type: 'chain', scripts, text, ctx }, timeoutMs);
}

/* ------------------------------------------------------------ 搜索客户端 */

interface SearchHit {
  uid: number;
  field: string;
  preview: string;
  score: number;
}

let sw: Worker | null = null;
let sseq = 0;
const searchPending = new Map<number, (v: any) => void>();
let indexVersion = 0;

function getSearchWorker(): Worker {
  if (sw) return sw;
  sw = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' });
  sw.onmessage = (e: MessageEvent) => {
    const d = e.data || {};
    if (d.type === 'result') {
      const cb = searchPending.get(d.id);
      if (cb) {
        searchPending.delete(d.id);
        cb(d);
      }
    }
  };
  return sw;
}

export function sendSearchIndex(entries: WorldbookEntry[], version: number) {
  indexVersion = version;
  const w = getSearchWorker();
  w.postMessage({
    type: 'index',
    entries: entries.map((e) => ({
      uid: e.uid,
      comment: e.comment || '',
      content: e.content || '',
      key: (e.key || []).join(', '),
    })),
  });
}

export function querySearch(
  q: string,
  opts: { limit?: number; regex?: boolean; scope?: 'all' | 'key' | 'content' | 'comment' | 'uid' } = {},
): Promise<{ hits: SearchHit[]; ms: number; total: number; error?: string }> {
  const w = getSearchWorker();
  const id = ++sseq;
  return new Promise((resolve) => {
    searchPending.set(id, resolve);
    w.postMessage({ type: 'query', id, q, limit: opts.limit ?? 200, regex: !!opts.regex, scope: opts.scope ?? 'all' });
    setTimeout(() => {
      if (searchPending.has(id)) {
        searchPending.delete(id);
        resolve({ hits: [], ms: 0, total: 0, error: '搜索超时' });
      }
    }, 5000);
  });
}

export function updateSearchEntries(entries: WorldbookEntry[]) {
  if (!sw || !entries.length) return;
  sw.postMessage({
    type: 'update',
    entries: entries.map((e) => ({ uid: e.uid, comment: e.comment || '', content: e.content || '', key: (e.key || []).join(', ') })),
  });
}

export function currentIndexVersion() {
  return indexVersion;
}
