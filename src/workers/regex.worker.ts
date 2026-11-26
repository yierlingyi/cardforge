/// <reference lib="webworker" />
/**
 * 正则测试 Worker：把可能产生灾难性回溯的匹配放到独立线程，
 * 主线程用超时 + terminate 兜底，保证编辑器不会被恶意正则卡死。
 */
import { runRegexChain, runRegexOnText, type ChainContext, type MacroContext } from '../core/regex';
import type { RegexScript } from '../core/types';

type InMsg =
  | { type: 'test'; id: number; script: RegexScript; text: string; ctx: MacroContext }
  | { type: 'chain'; id: number; scripts: RegexScript[]; text: string; ctx: ChainContext };

const ctx = self as any;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'test') {
      const r = runRegexOnText(msg.script, msg.text, { maxMatches: 300, macroCtx: msg.ctx });
      ctx.postMessage({ type: 'result', id: msg.id, result: r });
    } else if (msg.type === 'chain') {
      const r = runRegexChain(msg.scripts, msg.text, msg.ctx);
      ctx.postMessage({ type: 'result', id: msg.id, result: r });
    }
  } catch (err: any) {
    ctx.postMessage({ type: 'result', id: (msg as any).id, error: err?.message || String(err) });
  }
};

export {};
