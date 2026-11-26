/// <reference lib="webworker" />
/**
 * 世界书全文搜索 Worker
 * 主线程只发送一次索引，之后的查询都在 Worker 内完成，避免长文本阻塞 UI。
 */

interface IndexEntry {
  uid: number;
  comment: string;
  key: string;
  content: string;
  fieldText: string;
}

const ctx = self as any;

let index: IndexEntry[] = [];
let byUid = new Map<number, number>();

function makeEntry(it: { uid: number; comment: string; content: string; key: string }): IndexEntry {
  return {
    uid: it.uid,
    comment: it.comment || '',
    key: it.key || '',
    content: it.content || '',
    fieldText: `${it.uid}\n${it.comment || ''}\n${it.key || ''}\n${it.content || ''}`.toLowerCase(),
  };
}

type InMsg =
  | { type: 'index'; entries: { uid: number; comment: string; content: string; key: string }[] }
  | { type: 'update'; entries: { uid: number; comment: string; content: string; key: string }[] }
  | { type: 'query'; id: number; q: string; limit: number; regex: boolean; scope: 'all' | 'key' | 'content' | 'comment' | 'uid' }
  | { type: 'stats' }
  | { type: 'clear' };

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'index') {
    const t0 = performance.now();
    index = msg.entries.map(makeEntry);
    byUid = new Map(index.map((e, i) => [e.uid, i]));
    ctx.postMessage({ type: 'indexed', count: index.length, ms: performance.now() - t0 });
    return;
  }

  if (msg.type === 'update') {
    for (const it of msg.entries) {
      const idx = byUid.get(it.uid);
      const built = makeEntry(it);
      if (idx === undefined) {
        byUid.set(it.uid, index.length);
        index.push(built);
      } else {
        index[idx] = built;
      }
    }
    ctx.postMessage({ type: 'updated', count: msg.entries.length });
    return;
  }

  if (msg.type === 'clear') {
    index = [];
    byUid = new Map();
    (self as any).postMessage({ type: 'cleared' });
    return;
  }

  if (msg.type === 'stats') {
    let chars = 0;
    for (const it of index) chars += it.content.length;
    (self as any).postMessage({ type: 'stats', count: index.length, chars });
    return;
  }

  if (msg.type === 'query') {
    const t0 = performance.now();
    const { id, q, limit, regex, scope } = msg;
    const hits: { uid: number; field: string; preview: string; score: number }[] = [];
    if (!q.trim()) {
      (self as any).postMessage({ type: 'result', id, hits: [], ms: 0, total: 0 });
      return;
    }

    let re: RegExp | null = null;
    if (regex) {
      try {
        re = new RegExp(q, 'gi');
      } catch (err: any) {
        (self as any).postMessage({ type: 'result', id, hits: [], error: `正则无效：${err.message}`, ms: performance.now() - t0 });
        return;
      }
    }
    const needle = q.toLowerCase();

    const fieldsOf = (it: IndexEntry): [string, string][] => {
      switch (scope) {
        case 'key':
          return [['key', it.key]];
        case 'content':
          return [['content', it.content]];
        case 'comment':
          return [['comment', it.comment]];
        case 'uid':
          return [['uid', String(it.uid)]];
        default:
          return [
            ['comment', it.comment],
            ['key', it.key],
            ['content', it.content],
          ];
      }
    };

    let total = 0;
    for (const it of index) {
      if (re) {
        re.lastIndex = 0;
      } else if (scope === 'all' && !it.fieldText.includes(needle)) {
        continue;
      }
      let best: { field: string; preview: string; score: number } | null = null;
      for (const [field, text] of fieldsOf(it)) {
        let idx = -1;
        let len = q.length;
        if (re) {
          re.lastIndex = 0;
          const m = re.exec(text);
          if (m) {
            idx = m.index;
            len = m[0].length;
          }
        } else {
          idx = text.toLowerCase().indexOf(needle);
        }
        if (idx < 0) continue;
        const start = Math.max(0, idx - 28);
        const preview = (start ? '…' : '') + text.slice(start, idx + len + 46).replace(/\n/g, ' ⏎ ');
        let score = 1;
        if (field === 'comment') score = 3;
        if (field === 'key') score = 4;
        if (field === 'uid') score = 5;
        if (!best || score > best.score) best = { field, preview, score };
      }
      if (best) {
        total++;
        if (hits.length < limit) hits.push({ uid: it.uid, ...best });
      }
    }
    (self as any).postMessage({ type: 'result', id, hits, ms: performance.now() - t0, total });
  }
};

export {};
