import type { CardImageInfo, NormalizedCard, NormalizedWorldbook } from './types';
import { normalizeCard } from './card';
import { parseWorldbook } from './worldbook';
import { parseRegexCollection } from './regex';
import { parseScriptCollection } from './scripts';
import { isPng, readPngCard } from './png';
import { isPlainObject, safeJsonParse } from './util';

export type ImportKind = 'card-json' | 'card-png' | 'worldbook' | 'regex' | 'scripts' | 'charx' | 'unknown';

export interface ImportResult {
  kind: ImportKind;
  fileName: string;
  warnings: string[];
  card?: NormalizedCard;
  worldbook?: NormalizedWorldbook;
  regex?: ReturnType<typeof parseRegexCollection>;
  scripts?: ReturnType<typeof parseScriptCollection>;
  image?: CardImageInfo;
  /** 无法导入时的详细说明 */
  error?: string;
}

const CARD_HINTS = ['first_mes', 'description', 'personality', 'scenario', 'mes_example', 'alternate_greetings'];

function looksLikeCard(json: any): boolean {
  if (!isPlainObject(json)) return false;
  if (typeof json.spec === 'string' && /chara_card/i.test(json.spec)) return true;
  if (isPlainObject(json.data) && (typeof json.data.name === 'string' || 'first_mes' in json.data)) return true;
  const hits = CARD_HINTS.filter((k) => k in json).length;
  return hits >= 2 || (typeof json.name === 'string' && ('description' in json || 'first_mes' in json));
}

export function sniffJson(json: any): ImportKind {
  if (Array.isArray(json)) {
    const first = json[0];
    if (isPlainObject(first) && 'findRegex' in first) return 'regex';
    if (isPlainObject(first) && 'content' in first && ('name' in first || 'id' in first)) return 'scripts';
    return 'unknown';
  }
  if (!isPlainObject(json)) return 'unknown';
  if (looksLikeCard(json)) return 'card-json';
  if (json.entries !== undefined) {
    if (Array.isArray(json.entries)) {
      const f = json.entries[0];
      if (isPlainObject(f) && 'findRegex' in f) return 'regex';
      if (isPlainObject(f) && 'content' in f && 'key' in f) return 'worldbook';
      return 'worldbook';
    }
    if (isPlainObject(json.entries)) {
      const vals = Object.values(json.entries);
      const f: any = vals[0];
      if (isPlainObject(f) && 'findRegex' in f) return 'regex';
      return 'worldbook';
    }
  }
  // 裸 record 形式 {"0": {key, content}}
  const keys = Object.keys(json);
  if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
    const f: any = json[keys[0]];
    if (isPlainObject(f) && ('key' in f || 'content' in f)) return 'worldbook';
  }
  if (Array.isArray(json.scripts)) {
    const f = json.scripts[0];
    if (isPlainObject(f)) return 'findRegex' in f ? 'regex' : 'scripts';
  }
  if (Array.isArray(json.script)) return 'scripts';
  if (isPlainObject(json.data) && json.data.entries) return 'worldbook';
  return 'unknown';
}

export async function importFile(file: File): Promise<ImportResult> {
  const fileName = file.name;
  const warnings: string[] = [];
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.charx')) {
    return {
      kind: 'charx',
      fileName,
      warnings,
      error:
        'CHARX 是包含 card.json 与资源文件的 ZIP 容器。当前版本未内置 ZIP 解包（避免引入不可控依赖），因此不会伪装成「已支持」。' +
        '请用解压工具取出 card.json 后按 JSON 导入；资源将保留在 card.json 的 assets 字段中。',
    };
  }

  if (lower.endsWith('.png') || file.type === 'image/png') {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (!isPng(buf)) throw new Error('文件扩展名为 .png 但内容不是有效 PNG');
    const { info, image } = await readPngCard(buf, fileName);
    // 选择元数据：优先 ccv3（版本更高），否则 chara
    const ccv3 = info.cardChunks.find((c) => c.spec === 'chara_card_v3');
    const chara = info.cardChunks.find((c) => c.keyword.toLowerCase() === 'chara');
    const chosen = ccv3 || chara || info.cardChunks[0];
    if (!chosen || !chosen.json) throw new Error('PNG 人物卡元数据块无法解码为 JSON');
    const parsed = safeJsonParse(chosen.json);
    if (!parsed.ok) throw new Error(`PNG 元数据 JSON 解析失败：${parsed.error}`);
    if (info.cardChunks.length > 1) {
      warnings.push(`PNG 包含 ${info.cardChunks.length} 个人物卡元数据块（${info.cardChunks.map((c) => c.keyword).join(', ')}），已选用 ${chosen.keyword}。`);
    }
    const card = normalizeCard(parsed.value, image);
    return { kind: 'card-png', fileName, warnings, card, image };
  }

  const text = await file.text();
  return importJsonText(text, fileName);
}

export function importJsonText(text: string, fileName = 'pasted.json'): ImportResult {
  const warnings: string[] = [];
  const parsed = safeJsonParse(text);
  if (!parsed.ok) {
    throw new Error(`JSON 解析失败：${parsed.error}\n提示：请确认文件为 UTF-8 编码，且不是被截断的大文件。`);
  }
  const json = parsed.value;
  const kind = sniffJson(json);

  switch (kind) {
    case 'card-json': {
      const card = normalizeCard(json);
      if (card.version === 'v1') warnings.push('识别为 V1 平面结构人物卡。');
      return { kind, fileName, warnings, card };
    }
    case 'worldbook': {
      const name = fileName.replace(/\.json$/i, '');
      const wb = parseWorldbook(json, { name, origin: 'file' });
      return { kind, fileName, warnings, worldbook: wb };
    }
    case 'regex': {
      const col = parseRegexCollection(json);
      return { kind, fileName, warnings, regex: col };
    }
    case 'scripts': {
      const col = parseScriptCollection(json);
      return { kind, fileName, warnings, scripts: col };
    }
    default:
      throw new Error(
        '无法识别该 JSON 的类型。已尝试按人物卡 / 世界书 / 正则规则 / 酒馆助手脚本四种结构探测，均不匹配。\n' +
          '人物卡应含 spec+data 或 name+first_mes；世界书应含 entries；正则应含 findRegex；脚本应含 content。',
      );
  }
}

/** 从卡片中提取内嵌世界书（返回 null 表示没有） */
export function extractEmbeddedWorldbook(card: NormalizedCard): NormalizedWorldbook | null {
  const book = card.data.character_book;
  if (!isPlainObject(book)) return null;
  if (!Array.isArray(book.entries) || !book.entries.length) return null;
  const wb = parseWorldbook({ ...book, entries: book.entries }, {
    name: book.name || card.data.name || '内嵌世界书',
    origin: 'card',
    embeddedInCard: true,
  });
  wb.root = book;
  return wb;
}
