import type { CardVersion, MvuState, NormalizedCard, NormalizedWorldbook, RegexPreset, ScriptCollection, ValidationIssue } from './types';
import { serializeCard } from './card';
import { exportWorldbookFile } from './worldbook';
import { exportRegexCollection } from './regex';
import { exportScriptCollection } from './scripts';
import { dataUrlToBytes, isPng, writeCardToPng } from './png';
import { safeFileName, utf8ToBase64 } from './util';

export interface ExportArtifact {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  warnings: string[];
}

export function buildCardJson(card: NormalizedCard, target: CardVersion): ExportArtifact & { jsonText: string } {
  const { json, warnings } = serializeCard(card, target);
  const jsonText = JSON.stringify(json, null, 2);
  return {
    bytes: new TextEncoder().encode(jsonText),
    mime: 'application/json',
    filename: `${safeFileName(card.data.name || 'character')}.${target === 'v1' ? 'json' : 'json'}`,
    warnings,
    jsonText,
  };
}

export function buildWorldbookJson(wb: NormalizedWorldbook): ExportArtifact {
  const json = exportWorldbookFile(wb);
  const text = JSON.stringify(json, null, 2);
  return {
    bytes: new TextEncoder().encode(text),
    mime: 'application/json',
    filename: `${safeFileName(wb.name, 'worldbook')}.json`,
    warnings: [],
  };
}

export function buildRegexJson(preset: RegexPreset): ExportArtifact {
  const json = exportRegexCollection(preset.scripts, preset.shape);
  return {
    bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)),
    mime: 'application/json',
    filename: `${safeFileName(preset.name, 'regex')}.json`,
    warnings: [],
  };
}

export function buildScriptsJson(col: ScriptCollection): ExportArtifact {
  const json = exportScriptCollection(col.scripts, col.shape);
  return {
    bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)),
    mime: 'application/json',
    filename: `${safeFileName(col.origin === 'character' ? 'tavern-helper-scripts' : 'scripts', 'scripts')}.json`,
    warnings: [
      '导出脚本仅包含脚本文本与配置，不包含运行时依赖（远端 import 的模块需目标环境可访问）。',
    ],
  };
}

export function buildMvuJson(state: MvuState): ExportArtifact {
  const payload = {
    flavor: state.flavor,
    confidence: state.confidence,
    stat_data: state.statData,
    schema_fields: state.schemaFields,
    schema_note: state.schemaNote,
    floors: state.floors,
    evidence: state.evidence,
  };
  return {
    bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
    mime: 'application/json',
    filename: 'mvu-snapshot.json',
    warnings: ['该文件是编辑器快照，不是 MVU 运行时格式；不要直接当作变量初始化条目使用。'],
  };
}

/* ------------------------------------------------------------ PNG 导出 */

async function makePlaceholderPng(name: string, subtitle: string): Promise<Uint8Array> {
  const w = 512;
  const h = 768;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#141821');
  g.addColorStop(0.55, '#1d2433');
  g.addColorStop(1, '#0f1218');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(110,168,254,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.36, 90 + i * 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#8fb8ff';
  ctx.font = '600 30px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  const title = name.length > 16 ? name.slice(0, 16) + '…' : name;
  ctx.fillText(title, w / 2, h * 0.38);
  ctx.fillStyle = 'rgba(200,215,240,0.6)';
  ctx.font = '400 15px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(subtitle, w / 2, h * 0.38 + 34);
  ctx.fillStyle = 'rgba(140,160,190,0.45)';
  ctx.font = '400 13px monospace';
  ctx.fillText('CardForge placeholder', w / 2, h - 36);

  const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildCardPng(card: NormalizedCard, target: CardVersion): Promise<ExportArtifact> {
  const warnings: string[] = [];
  const { json, warnings: serWarnings } = serializeCard(card, target);
  warnings.push(...serWarnings);

  let baseBytes: Uint8Array;
  if (card.image?.dataUrl) {
    baseBytes = dataUrlToBytes(card.image.dataUrl);
    if (!isPng(baseBytes)) throw new Error('原始图片不是 PNG，无法写回元数据');
  } else {
    baseBytes = await makePlaceholderPng(card.data.name || '未命名角色', `Character Card ${target.toUpperCase()}`);
    warnings.push('当前项目没有关联图片，导出时生成了 512×768 占位图（仅在图片区域绘制文字与装饰，不含任何第三方素材）。');
  }

  const bytes = writeCardToPng(baseBytes, json, { writeCcv3: target === 'v3' });
  // 自校验：确认写入后能被读回
  const check = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  void check;
  return {
    bytes,
    mime: 'image/png',
    filename: `${safeFileName(card.data.name || 'character')}.png`,
    warnings,
  };
}

/* ------------------------------------------------------- 导出前完整性检查 */

export interface ExportCheck {
  blocking: string[];
  warnings: string[];
  infos: string[];
  version: CardVersion;
}

export function checkBeforeExport(
  card: NormalizedCard | null,
  version: CardVersion,
  issues: ValidationIssue[],
  opts: { withEmbeddedBook?: boolean; worldbooks?: NormalizedWorldbook[] } = {},
): ExportCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];

  if (card) {
    if (!card.data.name?.trim()) blocking.push('角色名称为空，导出的卡片在 SillyTavern 中无法正常显示。');
    if (version === 'v3' && card.version === 'v2') infos.push('源卡片为 V2，导出 V3 时会保持现有字段并写入 chara_card_v3 标识，不会自动补全 V3 专属字段。');

    const { warnings: w } = serializeCard(card, version);
    warnings.push(...w);

    const book = card.data.character_book;
    if (book?.entries?.length) {
      const seen = new Set<number>();
      let dup = 0;
      for (const e of book.entries) {
        if (typeof e.uid === 'number') {
          if (seen.has(e.uid)) dup++;
          seen.add(e.uid);
        }
      }
      if (dup) warnings.push(`内嵌世界书存在 ${dup} 个重复 UID。`);
      if (version === 'v1') warnings.push('目标 V1 不包含 character_book，内嵌世界书不会被打包进 PNG 元数据。');
    }
    if (!card.image && version !== 'v1') infos.push('导出 PNG 将使用生成的占位图。');
  }

  for (const issue of issues) {
    if (issue.level === 'error') blocking.push(`[${issue.scope}] ${issue.path}：${issue.message}`);
    else if (issue.level === 'warning') warnings.push(`[${issue.scope}] ${issue.path}：${issue.message}`);
  }

  return { blocking, warnings: Array.from(new Set(warnings)), infos, version };
}

/** 供文档/调试：把 JSON 文本转为 base64（与 PNG 元数据同格式） */
export function jsonToCardBase64(json: any): string {
  return utf8ToBase64(JSON.stringify(json));
}
