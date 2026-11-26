import type { CardVersion, NormalizedCard } from './types';
import { normalizeCard, serializeCard } from './card';
import { buildCardPng } from './exporter';
import { readPngCard } from './png';
import { generatePatch } from './patch';
import { deepEqual } from './util';

export interface StructuralDiff {
  path: string;
  kind: 'add' | 'remove' | 'replace';
  before?: any;
  after?: any;
}

export interface RoundTripReport {
  target: CardVersion;
  ok: boolean;
  steps: string[];
  diffs: StructuralDiff[];
  warnings: string[];
  jsonBytes: number;
  pngBytes?: number;
  elapsedMs: number;
}

function diffCard(a: any, b: any): StructuralDiff[] {
  return generatePatch(a, b).map((op) => ({ path: op.path, kind: op.op === 'add' ? 'add' : op.op === 'remove' ? 'remove' : 'replace', before: undefined, after: op.value }));
}

/** JSON 往返：序列化 → 反序列化 → 归一化 → 结构比较 */
export function roundTripCard(card: NormalizedCard, target: CardVersion): RoundTripReport {
  const t0 = performance.now();
  const steps: string[] = [];
  const { json, warnings } = serializeCard(card, target);
  steps.push(`序列化为 ${target.toUpperCase()}（${JSON.stringify(json).length} 字节）`);
  const text = JSON.stringify(json);
  const reparsed = JSON.parse(text);
  steps.push('JSON 文本重新解析');
  const again = normalizeCard(reparsed);
  steps.push(`重新归一化为 ${again.version.toUpperCase()}`);

  const diffs = diffCard(card.data, again.data);
  const ok = diffs.length === 0;
  steps.push(ok ? '规范字段与扩展字段完全一致（无损）' : `检测到 ${diffs.length} 处结构差异`);

  return {
    target,
    ok,
    steps,
    diffs,
    warnings,
    jsonBytes: new TextEncoder().encode(text).length,
    elapsedMs: performance.now() - t0,
  };
}

/** PNG 往返：写入元数据 → 重新读取 → 比较 */
export async function roundTripPng(card: NormalizedCard, target: CardVersion): Promise<RoundTripReport & { pngOk?: boolean }> {
  const t0 = performance.now();
  const steps: string[] = [];
  let warnings: string[] = [];
  let jsonBytes = 0;
  let pngBytes: number | undefined;
  let pngOk: boolean | undefined;

  const art = await buildCardPng(card, target);
  warnings = art.warnings;
  pngBytes = art.bytes.length;
  jsonBytes = new TextEncoder().encode(JSON.stringify(card.data)).length;
  steps.push(`生成 PNG（${(art.bytes.length / 1024).toFixed(0)} KB）`);

  try {
    const { info } = await readPngCard(art.bytes, art.filename);
    steps.push(`读回 PNG 元数据块：${info.cardChunks.map((c) => c.keyword).join(', ') || '(无)'}`);
    const chosen = info.cardChunks.find((c) => c.spec === 'chara_card_v3') || info.cardChunks[0];
    if (!chosen?.json) throw new Error('回读时未找到人物卡元数据');
    const again = normalizeCard(JSON.parse(chosen.json));
    const diffs = diffCard(card.data, again.data);
    pngOk = diffs.length === 0;
    steps.push(pngOk ? 'PNG 元数据回读一致（无损）' : `PNG 元数据回读存在 ${diffs.length} 处差异`);
    return {
      target,
      ok: pngOk,
      pngOk,
      steps,
      diffs,
      warnings,
      jsonBytes,
      pngBytes,
      elapsedMs: performance.now() - t0,
    };
  } catch (e: any) {
    steps.push(`PNG 回读失败：${e?.message || e}`);
    return { target, ok: false, steps, diffs: [], warnings, jsonBytes, pngBytes, elapsedMs: performance.now() - t0, pngOk: false };
  }
}

/** 变更摘要：用于导出前告知可能的信息损失 */
export function summarizeLoss(card: NormalizedCard, target: CardVersion): string[] {
  const { warnings } = serializeCard(card, target);
  return warnings;
}

export function cardEquals(a: NormalizedCard, b: NormalizedCard): boolean {
  return deepEqual(a.data, b.data);
}
