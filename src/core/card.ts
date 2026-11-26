import type { AnyRecord, CardData, CardVersion, CharacterBook, NormalizedCard } from './types';
import { clone, hasOwn, isPlainObject } from './util';

/* ------------------------------------------------------------- 版本识别 */

export interface VersionDetection {
  version: CardVersion;
  specVersion?: string;
  reason: string;
}

export function detectCardVersion(json: any): VersionDetection {
  if (!isPlainObject(json)) {
    throw new Error('人物卡根节点必须是 JSON 对象');
  }
  const spec = typeof json.spec === 'string' ? json.spec : undefined;
  if (spec === 'chara_card_v3') {
    return { version: 'v3', specVersion: String(json.spec_version ?? '3.0'), reason: 'spec = chara_card_v3' };
  }
  if (spec === 'chara_card_v2') {
    return { version: 'v2', specVersion: String(json.spec_version ?? '2.0'), reason: 'spec = chara_card_v2' };
  }
  if (spec && /v3/i.test(spec)) {
    return { version: 'v3', specVersion: String(json.spec_version ?? ''), reason: `spec = ${spec}（按 v3 处理）` };
  }
  if (spec && /v2/i.test(spec)) {
    return { version: 'v2', specVersion: String(json.spec_version ?? ''), reason: `spec = ${spec}（按 v2 处理）` };
  }
  if (isPlainObject(json.data) && !hasOwn(json, 'name')) {
    return {
      version: 'v2',
      specVersion: typeof json.spec_version === 'string' ? json.spec_version : undefined,
      reason: '无 spec，但存在 data 对象且根级无 name（按 V2 结构容错读取）',
    };
  }
  return { version: 'v1', specVersion: undefined, reason: '无 spec 字段，按 V1 平面结构读取' };
}

/* --------------------------------------------------------------- 归一化 */

export function normalizeCard(json: any, image?: NormalizedCard['image']): NormalizedCard {
  const det = detectCardVersion(json);
  const root: AnyRecord = json;
  let data: CardData;

  if (det.version === 'v1') {
    data = root as CardData;
  } else {
    if (!isPlainObject(root.data)) {
      throw new Error('人物卡缺少 data 对象，无法按 V2/V3 解析');
    }
    data = root.data as CardData;
  }

  const rootExtra: Record<string, any> = {};
  if (det.version !== 'v1') {
    for (const k of Object.keys(root)) {
      if (k === 'spec' || k === 'spec_version' || k === 'data') continue;
      rootExtra[k] = root[k];
    }
  }

  return { version: det.version, root, data, rootExtra, specVersion: det.specVersion, image };
}

export function createBlankCard(name = '未命名角色'): NormalizedCard {
  const data: CardData = {
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
  };
  const root: AnyRecord = { spec: 'chara_card_v3', spec_version: '3.0', data };
  return { version: 'v3', root, data, rootExtra: {}, specVersion: '3.0' };
}

/* ----------------------------------------------------------------- 导出 */

export interface SerializeResult {
  json: AnyRecord;
  warnings: string[];
}

/**
 * 序列化为指定版本。
 * - 目标 v2/v3：保留 rootExtra 全部未知根字段，只重写 spec/spec_version。
 * - 目标 v1：把 data 摊平；若存在 character_book / extensions 等 V1 不识别字段，给出警告（仍写回，避免数据丢失）。
 */
export function serializeCard(card: NormalizedCard, target: CardVersion): SerializeResult {
  const warnings: string[] = [];
  const data = clone(card.data);

  if (target === 'v1') {
    if (data.character_book && (data.character_book.entries?.length ?? 0) > 0) {
      warnings.push('目标为 V1：内嵌世界书不是 V1 规范字段，SillyTavern 读取 V1 时会忽略它（原始数据仍保留在 JSON 中）。');
    }
    if (data.assets && data.assets.length) {
      warnings.push('目标为 V1：assets 资源清单不是 V1 规范字段，导入 SillyTavern 后可能不被识别。');
    }
    if (card.rootExtra && Object.keys(card.rootExtra).length) {
      warnings.push(`目标为 V1：根级扩展字段 ${Object.keys(card.rootExtra).join(', ')} 将被丢弃（V1 无根级扩展概念）。`);
    }
    const flat: AnyRecord = { ...data };
    return { json: flat, warnings };
  }

  const spec = target === 'v3' ? 'chara_card_v3' : 'chara_card_v2';
  const specVersion = target === 'v3' ? '3.0' : '2.0';
  const out: AnyRecord = { spec, spec_version: specVersion, data };
  for (const [k, v] of Object.entries(card.rootExtra || {})) {
    if (k === 'spec' || k === 'spec_version' || k === 'data') continue;
    out[k] = clone(v);
  }

  if (target === 'v2') {
    const v3Only = ['nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'creation_date', 'modification_date', 'assets'].filter(
      (k) => hasOwn(data, k) && data[k] !== undefined && data[k] !== null && !(Array.isArray(data[k]) && !data[k].length),
    );
    if (v3Only.length) {
      warnings.push(`目标为 V2：字段 ${v3Only.join(', ')} 属于 V3 追加字段，V2 读取器通常会忽略，但仍会写入 data（不丢数据）。`);
    }
  }
  return { json: out, warnings };
}

/* ------------------------------------------------------- 字段元数据（UI） */

export type FieldKind = 'text' | 'textarea' | 'longtext' | 'stringList' | 'json' | 'number' | 'boolean' | 'tags';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
  hint?: string;
  rows?: number;
  version?: CardVersion[];
}

export const CARD_FIELDS: FieldDef[] = [
  { key: 'name', label: '角色名称 name', kind: 'text', group: '基础信息', hint: '会作为 {{char}} 宏的值' },
  { key: 'nickname', label: '昵称 nickname', kind: 'text', group: '基础信息', version: ['v3'], hint: 'V3 字段，部分客户端用于显示短名' },
  { key: 'creator', label: '创作者 creator', kind: 'text', group: '基础信息' },
  { key: 'character_version', label: '角色版本 character_version', kind: 'text', group: '基础信息' },
  { key: 'tags', label: '标签 tags', kind: 'tags', group: '基础信息' },
  { key: 'source', label: '来源 source', kind: 'json', group: '基础信息', version: ['v3'], hint: 'V3 允许字符串或字符串数组' },

  { key: 'description', label: '角色描述 description', kind: 'longtext', group: '正文内容', rows: 10 },
  { key: 'personality', label: '性格 personality', kind: 'longtext', group: '正文内容', rows: 5 },
  { key: 'scenario', label: '场景 scenario', kind: 'longtext', group: '正文内容', rows: 5 },
  { key: 'first_mes', label: '开场白 first_mes', kind: 'longtext', group: '正文内容', rows: 8 },
  { key: 'alternate_greetings', label: '替代开场白 alternate_greetings', kind: 'stringList', group: '正文内容' },
  { key: 'group_only_greetings', label: '群聊专用开场白 group_only_greetings', kind: 'stringList', group: '正文内容', version: ['v3'] },
  { key: 'mes_example', label: '示例对话 mes_example', kind: 'longtext', group: '正文内容', rows: 8, hint: '通常使用 <START> 分隔对话样本' },
  { key: 'creator_notes', label: '创作者备注 creator_notes', kind: 'longtext', group: '正文内容', rows: 4 },
  { key: 'creator_notes_multilingual', label: '多语言备注 creator_notes_multilingual', kind: 'json', group: '正文内容', version: ['v3'] },

  { key: 'system_prompt', label: '系统提示词 system_prompt', kind: 'longtext', group: '提示词', rows: 6, hint: '留空则使用全局主提示词' },
  { key: 'post_history_instructions', label: '历史后指令 post_history_instructions', kind: 'longtext', group: '提示词', rows: 6 },
  { key: 'depth_prompt', label: '深度提示 depth_prompt', kind: 'json', group: '提示词', hint: '形如 { prompt, depth, role }' },

  { key: 'talkativeness', label: '话痨度 talkativeness', kind: 'number', group: '酒馆运行设置' },
  { key: 'fav', label: '收藏 fav', kind: 'boolean', group: '酒馆运行设置' },
  { key: 'world', label: '绑定世界书 world', kind: 'text', group: '酒馆运行设置', hint: '世界书名称；角色卡本身不存储该世界书内容' },

  { key: 'character_book', label: '内嵌世界书 character_book', kind: 'json', group: '结构化数据', hint: '在「世界书」页面以可视化方式编辑' },
  { key: 'assets', label: '资源清单 assets', kind: 'json', group: '结构化数据', version: ['v3'] },
  { key: 'extensions', label: '扩展 extensions', kind: 'json', group: '结构化数据', hint: '第三方扩展（含酒馆助手脚本）都存放在这里' },
  { key: 'creation_date', label: '创建时间 creation_date', kind: 'number', group: '结构化数据', version: ['v3'] },
  { key: 'modification_date', label: '修改时间 modification_date', kind: 'number', group: '结构化数据', version: ['v3'] },
];

/** 规范字段集合（用于「未知字段」识别） */
export const KNOWN_CARD_FIELDS = new Set(CARD_FIELDS.map((f) => f.key));

export function unknownCardFields(data: any): string[] {
  return Object.keys(data || {}).filter((k) => !KNOWN_CARD_FIELDS.has(k));
}

/* ---------------------------------------------------- character_book 访问 */

export function getCharacterBook(card: NormalizedCard | null): CharacterBook | null {
  if (!card) return null;
  const book = card.data.character_book;
  return isPlainObject(book) ? (book as CharacterBook) : null;
}

export function ensureCharacterBook(card: NormalizedCard, name: string): CharacterBook {
  if (!isPlainObject(card.data.character_book)) {
    card.data.character_book = {
      name: name || card.data.name || '内嵌世界书',
      description: '',
      scan_depth: null,
      token_budget: null,
      recursive_scanning: false,
      extensions: {},
      entries: [],
    };
  }
  const book = card.data.character_book as CharacterBook;
  if (!Array.isArray(book.entries)) book.entries = [];
  return book;
}

/** 简易 token 估算：CJK 按 1 字 ≈ 1 token，其它按 4 字符 ≈ 1 token（粗估，仅供显示） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x2e80 && c <= 0x9fff) cjk++;
  }
  const rest = text.length - cjk;
  return Math.round(cjk + rest / 4);
}
