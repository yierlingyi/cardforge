import type { DocState, NormalizedWorldbook } from './types';
import { estimateTokens } from './card';
import { worldbookStats } from './worldbook';

export function characterBookStats(book: any): { count: number; totalChars: number; disabled: number; constant: number } | null {
  if (!book || !Array.isArray(book.entries)) return null;
  let totalChars = 0;
  let disabled = 0;
  let constant = 0;
  for (const e of book.entries) {
    totalChars += (e?.content || '').length;
    if (e?.disable) disabled++;
    if (e?.constant) constant++;
  }
  return { count: book.entries.length, totalChars, disabled, constant };
}

export interface DocStats {
  cardChars: number;
  cardTokens: number;
  worldbookCount: number;
  entryCount: number;
  entryChars: number;
  regexCount: number;
  scriptCount: number;
  scriptChars: number;
  unknownFields: number;
  approvals?: never;
  sizeBytes: number;
  mvuFields: number;
  historySteps: number;
}

export function docStats(doc: DocState, historySteps = 0): DocStats {
  let cardChars = 0;
  let cardTokens = 0;
  if (doc.card) {
    const d = doc.card.data;
    const texts = [d.description, d.personality, d.scenario, d.first_mes, d.mes_example, d.system_prompt, d.post_history_instructions];
    cardChars = texts.reduce((n, t) => n + (typeof t === 'string' ? t.length : 0), 0);
    cardTokens = estimateTokens(texts.filter((t) => typeof t === 'string').join('\n'));
  }
  let entryChars = 0;
  for (const wb of doc.worldbooks) entryChars += worldbookStats(wb.entries).totalChars;
  const scriptChars = doc.scripts.reduce((n, c) => n + c.scripts.reduce((m, s) => m + (s.content?.length || 0), 0), 0);
  let sizeBytes = 0;
  try {
    sizeBytes = new TextEncoder().encode(JSON.stringify(doc.card?.root ?? {})).length;
  } catch {
    sizeBytes = 0;
  }
  return {
    cardChars,
    cardTokens,
    worldbookCount: doc.worldbooks.length,
    entryCount: doc.worldbooks.reduce((n, w) => n + w.entries.length, 0),
    entryChars,
    regexCount: doc.regexes.reduce((n, p) => n + p.scripts.length, 0),
    scriptCount: doc.scripts.reduce((n, c) => n + c.scripts.length, 0),
    scriptChars,
    unknownFields: doc.card ? Object.keys(doc.card.data).length : 0,
    sizeBytes,
    mvuFields: doc.mvu?.schemaFields.length ?? 0,
    historySteps,
  };
}

export function worldbookSummary(wb: NormalizedWorldbook) {
  const s = worldbookStats(wb.entries);
  return `${s.count} 条 · 启用 ${s.enabled} · 常驻 ${s.constant} · ${s.totalChars.toLocaleString()} 字符`;
}
