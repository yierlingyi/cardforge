/**
 * CardForge 统一数据模型
 * ---------------------------------------------------------------------------
 * 设计原则：
 * 1. 原始数据（raw）是唯一事实来源，所有编辑都在 raw 上做「就地字段修改」，
 *    不重建对象，因此未知字段与第三方扩展天然保留。
 * 2. 归一化结构（Normalized*）只是 raw 的「视图 + 索引」，导出时不作为唯一依据。
 * 3. 任何不确定的字段都保留原样，不臆造、不删除。
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };
export type AnyRecord = Record<string, any>;

/* ------------------------------------------------------------------ 人物卡 */

export type CardVersion = 'v1' | 'v2' | 'v3';

/** Character Card V2 `data` 字段（V3 为其超集）。允许任意未知键。 */
export interface CardData {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  character_book?: CharacterBook | null;
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: AnyRecord;

  /* V3 追加字段（规范内） */
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string | string[];
  group_only_greetings?: string[];
  creation_date?: number;
  modification_date?: number;
  assets?: CardAsset[];

  /* 其余扩展字段（tavern_helper / world / depth_prompt / fav / talkativeness …） */
  [k: string]: any;
}

export interface CardAsset {
  type: string;
  uri: string;
  name: string;
  ext: string;
  [k: string]: any;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number | null;
  token_budget?: number | null;
  recursive_scanning?: boolean;
  extensions?: AnyRecord;
  entries?: WorldbookEntry[];
  [k: string]: any;
}

export interface NormalizedCard {
  version: CardVersion;
  /** 卡片根对象（V2/V3 含 spec/spec_version/data；V1 即原始对象） */
  root: AnyRecord;
  /** 卡片正文字段所在的 data 对象（V1 时与 root 同体） */
  data: CardData;
  /** 根级未知字段（不含 spec / spec_version / data） */
  rootExtra: Record<string, any>;
  /** 导入时识别到的原始版本号字符串 */
  specVersion?: string;
  /** 若来自 PNG：图片与元数据信息 */
  image?: CardImageInfo;
}

export interface CardImageInfo {
  dataUrl: string;
  mime: string;
  fileName?: string;
  width?: number;
  height?: number;
  /** 元数据块的原始内容（base64 解码后的 JSON 文本），用于「原始元数据检查」 */
  metaChunks: { keyword: string; json: string; spec?: string; specVersion?: string }[];
  /** 图片中除人物卡元数据外的其他文本块 */
  otherChunks?: { keyword: string; text: string }[];
}

/* ---------------------------------------------------------------- 世界书 */

/** 插入位置（SillyTavern world_info_position） */
export const WI_POSITION_LABELS: Record<number, string> = {
  0: '角色定义之前',
  1: '角色定义之后',
  2: '作者注释之前',
  3: '作者注释之后',
  4: '按深度插入 (@D)',
  5: '示例消息之前',
  6: '示例消息之后',
};

/** 插入角色（world_info_role） */
export const WI_ROLE_LABELS: Record<number, string> = {
  0: 'System',
  1: 'User',
  2: 'Assistant',
};

/** 选择性逻辑（selectiveLogic） */
export const WI_SELECTIVE_LOGIC: Record<number, string> = {
  0: 'AND ANY（任一主键 + 任一辅键）',
  1: 'NOT ALL（主键命中且辅键未全部命中）',
  2: 'NOT ANY（主键命中且辅键全不命中）',
  3: 'AND ALL（主键与辅键都需命中）',
};

export interface WorldbookEntry {
  uid: number;
  key: string[];
  keysecondary?: string[];
  comment?: string;
  content?: string;
  constant?: boolean;
  vectorized?: boolean;
  selective?: boolean;
  selectiveLogic?: number;
  addMemo?: boolean;
  order?: number;
  position?: number;
  disable?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: boolean;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  scanDepth?: number | null;
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  useGroupScoring?: boolean | null;
  automationId?: string;
  role?: number;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  displayIndex?: number;
  [k: string]: any;
}

/**
 * 世界书文件可以是两种形状：
 * - record：`{ entries: { "0": {...}, "1": {...} } }`（SillyTavern 导出的世界书）
 * - array ：`{ entries: [ {...} ] }`（V2/V3 character_book 内嵌）
 * - bare  ：`{ "0": {...} }`（部分旧版工具/手写文件）
 */
export type WorldbookShape = 'record' | 'array' | 'bare';

export interface NormalizedWorldbook {
  /** 世界书名称（文件格式里通常无 name，取文件名或卡片 character_book.name） */
  name: string;
  /** 原始文件根对象（保留 description/scan_depth/token_budget/extensions 等） */
  root: AnyRecord;
  shape: WorldbookShape;
  entries: WorldbookEntry[];
  /** 从卡片内嵌世界书读入时的归属 */
  origin: 'file' | 'card' | 'new';
  /** 该世界书是否绑定在卡片的 data.character_book 上（改动需回写卡片） */
  embeddedInCard?: boolean;
}

/* ---------------------------------------------------------------- 正则 */

export const REGEX_PLACEMENT_LABELS: Record<number, string> = {
  1: 'AI 输出（Markdown 显示）',
  2: '用户输入',
  3: 'AI 输出（发送给模型）',
  4: '斜杠命令',
  5: '世界书内容',
  6: '推理过程',
};

/** SillyTavern Regex 脚本对象（未知字段一律保留） */
export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings?: string[];
  placement?: number[];
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
  /** 部分分支/魔改版本存在，保留但不强行解释 */
  replace_file?: string;
  [k: string]: any;
}

export interface RegexPreset {
  name: string;
  scripts: RegexScript[];
  /** 原始容器（可能是数组，也可能是 {scripts:[...]}） */
  root: any;
  shape: 'array' | 'object';
  origin: 'file' | 'character' | 'new';
}

/* ------------------------------------------------------- 酒馆助手脚本 */

export interface ScriptButton {
  name: string;
  visible?: boolean;
  [k: string]: any;
}

export interface TavernScript {
  id: string;
  name: string;
  content: string;
  info?: string;
  type?: string;
  enabled?: boolean;
  button?: { enabled?: boolean; buttons?: ScriptButton[]; [k: string]: any };
  data?: AnyRecord;
  export_with?: AnyRecord;
  [k: string]: any;
}

export interface ScriptCollection {
  scripts: TavernScript[];
  /** 原始容器：通常是 data.extensions.tavern_helper.scripts */
  root: any;
  shape: 'array' | 'object';
  origin: 'file' | 'character' | 'new';
}

/* ---------------------------------------------------------------- MVU */

export type MvuFlavor = 'mvu' | 'mvubeta' | 'mvuzod' | 'unknown';

export interface MvuEvidence {
  flavor: MvuFlavor;
  score: number;
  signals: { where: string; detail: string }[];
}

export interface MvuSchemaField {
  path: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  constraints: string[];
}

export interface MvuState {
  flavor: MvuFlavor;
  confidence: 'high' | 'medium' | 'low';
  evidence: MvuEvidence[];
  /** 变量树（stat_data 或用户导入的变量快照） */
  statData: AnyRecord;
  /** 初始化变量来源说明 */
  statSource: 'worldbook' | 'script' | 'imported' | 'empty';
  statSourceDetail?: string;
  displayData?: AnyRecord;
  deltaData?: AnyRecord;
  /** 静态推断出的 Schema 字段（非完整解析） */
  schemaFields: MvuSchemaField[];
  schemaNote?: string;
  /** 相关世界书条目 / 脚本索引 */
  relatedEntries: { uid: number; comment: string; kind: string }[];
  relatedScripts: { id: string; name: string; kind: string }[];
  /** 消息楼层变量快照（用户可导入多楼层） */
  floors: { index: number; statData: AnyRecord; label?: string }[];
}

/* ---------------------------------------------------------------- 项目 */

export type PageKey =
  | 'home'
  | 'character'
  | 'worldbook'
  | 'regex'
  | 'scripts'
  | 'mvu'
  | 'preview'
  | 'validation'
  | 'history'
  | 'settings';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceFileName?: string;
  cardVersion?: CardVersion;
}

export interface EditorTab {
  id: string;
  label: string;
  page: PageKey;
  /** 子视图定位，例如 worldbook:uid / regex:id / script:id */
  target?: string;
  dirty?: boolean;
  pinned?: boolean;
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  scope: 'card' | 'worldbook' | 'regex' | 'scripts' | 'mvu' | 'image';
  path: string;
  message: string;
  hint?: string;
}

export interface DocState {
  meta: ProjectMeta;
  /** 人物卡（可能为空：只编辑独立世界书时） */
  card: NormalizedCard | null;
  /** 独立世界书集合 */
  worldbooks: NormalizedWorldbook[];
  regexes: RegexPreset[];
  scripts: ScriptCollection[];
  mvu: MvuState | null;
  /** 用户导入的 MVU 变量快照 / 楼层 */
  mvuFloors: { index: number; statData: AnyRecord; label?: string }[];
  /** 原始导入文件快照（无损比对用） */
  baselines: { key: string; label: string; json: string; at: number }[];
  issues: ValidationIssue[];
}
