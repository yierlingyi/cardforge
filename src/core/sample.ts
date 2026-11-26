import type { MvuState, NormalizedCard, NormalizedWorldbook, RegexPreset, ScriptCollection } from './types';
import { normalizeCard } from './card';
import { parseWorldbook } from './worldbook';
import { normalizeRegexScript } from './regex';
import { normalizeScript } from './scripts';
import { buildMvuState } from './mvu';

const INIT_YAML = `角色:
  姓名: 星见澪
  等级: 3
  生命: 88
  好感度: 24
  状态: 正常
  背包:
    - 名称: 观测记录仪
      数量: 1
    - 名称: 压缩口粮
      数量: 4
世界:
  时间: 星历 2187 年 4 月 3 日
  地点: 北境观测站
  天气: 极光`;

const SCHEMA_SCRIPT = `// MVU Zod 变量结构定义（示例）
// 说明：本脚本不会被编辑器执行，仅用于静态解析变量结构。
const StatSchema = z.object({
  角色: z.object({
    姓名: z.string().default('星见澪'),
    等级: z.number().int().min(1).max(99).default(1),
    生命: z.number().min(0).max(100).default(100),
    好感度: z.number().min(0).max(100).default(12),
    状态: z.enum(['正常', '轻伤', '重伤']).default('正常'),
    背包: z.array(
      z.object({
        名称: z.string(),
        数量: z.number().int().min(1),
      }),
    ).default([]),
  }),
  世界: z.object({
    时间: z.string().default('星历 2187 年 4 月 3 日'),
    地点: z.string().default('北境观测站'),
    天气: z.string().optional(),
  }),
});

registerVariableSchema(StatSchema);
`;

const STATUS_SCRIPT = `// 状态栏渲染（示例，未执行）
// 实际运行时通过 MVU 的 display_data 读取变量并渲染 HTML。
const stat = getVariables({ type: 'message', message_id: 'latest' }).stat_data?.角色 ?? {};

const html = \`
<div class="status-bar">
  <div class="row"><span class="k">姓名</span><span class="v">\${stat.姓名 ?? '未知'}</span></div>
  <div class="row"><span class="k">等级</span><span class="v">Lv.\${stat.等级 ?? 1}</span></div>
  <div class="row"><span class="k">生命</span><span class="v">\${stat.生命 ?? 0}/100</span></div>
  <div class="row"><span class="k">好感</span><span class="v">\${stat.好感度 ?? 0}</span></div>
</div>\`;

toastr.info('状态栏已更新（示例脚本，不会真的执行）');
`;

const INIT_SCRIPT = `// 读取世界书中的 [InitVar] 条目并写入 stat_data（示例）
const book = await getWorldbook('北境观测站资料');
const init = book.find((e) => e.comment === '[InitVar]');
if (init) {
  const data = YAML.parse(init.content);
  await insertOrAssignVariables({ stat_data: data }, { type: 'message', message_id: 'latest' });
}
`;

const BUTTON_SCRIPT = `// 带按钮的脚本示例
eventOn('mag_button_clicked', (buttonName) => {
  if (buttonName === '查看天气') {
    toastr.success('极光正在增强，辐射值上升。');
  }
});
`;

const now = Date.now();

const CARD_JSON: any = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '星见澪',
    nickname: '澪',
    description:
      '北境观测站的技术员，负责极光与辐射监测。话不多，习惯把情绪写进记录里。\n' +
      '身高 168cm，常穿观测站的深蓝色工装，左耳有一枚旧式通讯耳机。\n' +
      '对陌生人保持礼貌的距离，对熟悉的人会不动声色地照顾。',
    personality: '冷静、克制、观察力强。不擅长表达关心，但会用行动替代语言。对天文数据有近乎固执的认真。',
    scenario: '{{user}} 因暴风雪滞留北境观测站，站内只有你和值班的 {{char}}。极光正在增强，通讯中断。',
    first_mes:
      '观测站的走廊尽头亮着一盏灯。\n\n' +
      '{{char}} 从数据屏前转过身，把耳机摘下一半："外面风大，先进来。"\n' +
      '她侧身让开门，目光在你湿透的外套上停了一瞬，又移开。\n' +
      '"热水在左手边第三个柜子。别碰最上面那层，那是样本。"',
    mes_example:
      '<START>\n{{user}}: 你一直一个人守着这里吗？\n{{char}}: 换班要等三月。她把手套摘下来，指尖压着记录本："习惯就好。"\n' +
      '<START>\n{{user}}: 极光真好看。\n{{char}}: "嗯。"她看了很久，才补一句，"今天的数值不太对。"',
    creator_notes:
      '示例人物卡，用于演示 CardForge 的各项功能：内嵌世界书、正则规则、酒馆助手脚本、MVU Zod 变量与多楼层变量历史。',
    system_prompt: '',
    post_history_instructions: '保持 {{char}} 的克制语气；不要替 {{user}} 决定行动。',
    alternate_greetings: [
      '警报声把你吵醒。{{char}} 站在门口，手里拿着两件防辐射服："穿上。极光过载了。"',
      '你推开观测站的门时，{{char}} 正在给一株温室里的薄荷浇水。她没有回头："门自己关，风会灌进来。"',
    ],
    character_book: {},
    tags: ['科幻', '极地', '慢热', '示例卡'],
    creator: 'CardForge',
    character_version: '1.0.0',
    extensions: {
      talkativeness: 0.4,
      fav: false,
      world: '北境观测站资料',
      depth_prompt: {
        prompt: '{{char}} 说话简短，避免使用感叹号；环境描写以温度、声音、光线为主。',
        depth: 4,
        role: 0,
      },
      tavern_helper: {
        scripts: [
          normalizeScript({
            id: 'sample-schema',
            name: 'MVU Zod Schema',
            content: SCHEMA_SCRIPT,
            info: '定义 stat_data 的结构与约束',
            enabled: true,
            button: { enabled: false, buttons: [] },
            data: {},
          }),
          normalizeScript({
            id: 'sample-status',
            name: '状态栏渲染',
            content: STATUS_SCRIPT,
            info: '读取 display_data 渲染状态栏',
            enabled: true,
            button: { enabled: true, buttons: [{ name: '查看天气', visible: true }] },
            data: {},
            export_with: { stat_data: true },
          }),
          normalizeScript({
            id: 'sample-init',
            name: '变量初始化',
            content: INIT_SCRIPT,
            info: '从 [InitVar] 条目读取初始变量',
            enabled: true,
          }),
          normalizeScript({
            id: 'sample-button',
            name: '按钮交互',
            content: BUTTON_SCRIPT,
            info: '示例按钮回调',
            enabled: false,
            button: { enabled: true, buttons: [{ name: '查看天气', visible: true }] },
          }),
        ],
      },
      regex: [],
    },
    creation_date: Math.floor(now / 1000),
    modification_date: Math.floor(now / 1000),
    assets: [],
    source: ['https://example.invalid/cardforge-sample'],
    creator_notes_multilingual: { 'zh-cn': '示例卡：用于功能演示', en: 'Sample card for CardForge demo' },
    group_only_greetings: [],
  },
};

const ENTRIES: any[] = [
  {
    uid: 0,
    key: [],
    keysecondary: [],
    comment: '[InitVar] 变量初始化',
    content: INIT_YAML,
    constant: false,
    selective: true,
    selectiveLogic: 0,
    order: 100,
    position: 0,
    disable: true,
    excludeRecursion: true,
    preventRecursion: true,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    role: 0,
    vectorized: false,
    addMemo: true,
    displayIndex: 0,
  },
  {
    uid: 1,
    key: ['更新变量', '变量更新'],
    keysecondary: [],
    comment: '变量更新规则',
    content:
      '每次回复结束时，仅输出 JSON Patch 形式的变量更新，不要输出解释文字。\n' +
      '可用路径：/角色/生命、/角色/好感度、/角色/状态、/角色/背包、/世界/时间、/世界/地点。\n' +
      '规则：\n' +
      '1. 好感度每次变化不超过 ±5；\n' +
      '2. 生命值范围 0-100；\n' +
      '3. 状态仅可取「正常 / 轻伤 / 重伤」；\n' +
      '4. 时间推进需符合场景内的时间流速。',
    constant: true,
    order: 90,
    position: 4,
    depth: 0,
    role: 0,
    disable: false,
    displayIndex: 1,
  },
  {
    uid: 2,
    key: [],
    keysecondary: [],
    comment: '状态栏',
    content:
      '<div class="cf-status">\n' +
      '  <div>生命 {{getvar::stat_data.角色.生命}} / 100</div>\n' +
      '  <div>好感 {{getvar::stat_data.角色.好感度}}</div>\n' +
      '</div>',
    constant: true,
    order: 120,
    position: 4,
    depth: 0,
    role: 0,
    disable: false,
    displayIndex: 2,
  },
  {
    uid: 3,
    key: ['观测站', '北境'],
    keysecondary: [],
    comment: '地点：北境观测站',
    content:
      '北境观测站建在永久冻土带上，主体是三层环形结构。\n' +
      '- 一层：玄关、储物间、热水间；\n' +
      '- 二层：数据大厅、温室、值班室；\n' +
      '- 三层：天线阵列与样本冷库（需权限）。\n' +
      '冬季平均气温 -38℃，暴风雪时通讯会中断数小时。',
    constant: false,
    order: 80,
    position: 0,
    disable: false,
    displayIndex: 3,
  },
  {
    uid: 4,
    key: ['星见', '澪', '技术员'],
    keysecondary: ['观测', '数据'],
    comment: '人物：星见澪',
    content:
      '星见澪，27 岁，观测站技术员，驻站第 4 年。\n' +
      '擅长极光粒子数据分析，不擅长应付访客。\n' +
      '习惯：记录本随身；紧张时会转动耳机线。\n' +
      '在意的人面前会刻意保持工作状态。',
    constant: false,
    selective: true,
    selectiveLogic: 0,
    order: 85,
    position: 0,
    disable: false,
    displayIndex: 4,
  },
  {
    uid: 5,
    key: ['老陈', '补给'],
    keysecondary: [],
    comment: '人物：老陈',
    content: '老陈，补给车司机，每两周上山一次。爱讲冷笑话，会偷偷多留两罐咖啡。',
    constant: false,
    order: 70,
    position: 0,
    disable: false,
    displayIndex: 5,
  },
  {
    uid: 6,
    key: ['极光', 'aurora'],
    keysecondary: ['辐射', '过载'],
    comment: '事件：极光过载',
    content:
      '极光过载时，天空会出现紫色与青色交叠的带状光，仪器读数飙升。\n' +
      '过载持续 20-40 分钟，期间室外辐射达到安全阈值的 6 倍，必须留在站内。',
    constant: false,
    selective: true,
    selectiveLogic: 3,
    order: 75,
    position: 4,
    depth: 2,
    role: 1,
    disable: false,
    displayIndex: 6,
  },
  {
    uid: 7,
    key: ['暴风雪', '风雪'],
    keysecondary: [],
    comment: '天气：暴雪',
    content: '暴风雪封住了山路，能见度不足五米。风声像有人在门外拖着重物。',
    constant: false,
    group: '天气',
    groupWeight: 80,
    order: 60,
    position: 4,
    depth: 1,
    role: 1,
    disable: false,
    displayIndex: 7,
  },
  {
    uid: 8,
    key: ['晴天', '放晴'],
    keysecondary: [],
    comment: '天气：放晴',
    content: '风雪停了。阳光落在雪面上，反光刺得人睁不开眼。',
    constant: false,
    group: '天气',
    groupWeight: 40,
    order: 60,
    position: 4,
    depth: 1,
    role: 1,
    disable: false,
    displayIndex: 8,
  },
  {
    uid: 9,
    key: [],
    keysecondary: [],
    comment: '写作风格：冷峻',
    content: '叙述保持克制：少用形容词，多用可观测的细节（温度、声音、光线、动作）。不写心理独白式的解释。',
    constant: true,
    order: 150,
    position: 0,
    disable: false,
    displayIndex: 9,
  },
  {
    uid: 10,
    key: ['样本', '冷库'],
    keysecondary: [],
    comment: '设定：样本冷库',
    content: '三层冷库保存着历次极光期间采集的冰芯样本，编号从 A-001 开始。取样需要双人授权。',
    constant: false,
    order: 65,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    displayIndex: 10,
  },
  {
    uid: 11,
    key: ['温室', '薄荷'],
    keysecondary: [],
    comment: '细节：温室',
    content: '二层温室种着薄荷和几株耐寒番茄，是全站唯一有绿色植物的地方。星见澪每天浇水两次。',
    constant: false,
    order: 55,
    position: 2,
    disable: false,
    displayIndex: 11,
  },
  {
    uid: 12,
    key: ['记录本'],
    keysecondary: [],
    comment: '细节：记录本（失效条目示例）',
    content: '',
    constant: false,
    order: 50,
    position: 0,
    disable: false,
    displayIndex: 12,
  },
  {
    uid: 13,
    key: ['观测站'],
    keysecondary: [],
    comment: '重复关键词示例',
    content: '观测站的墙上有历年的值班表，最早的一张已经泛黄。',
    constant: false,
    order: 40,
    position: 0,
    disable: true,
    displayIndex: 13,
  },
];

const REGEX_SCRIPTS = [
  normalizeRegexScript({
    id: 'regex-status',
    scriptName: '状态栏 <status> 转 HTML',
    findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
    replaceString: '<div class="status-bar">$1</div>',
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    minDepth: null,
    maxDepth: null,
    runOnEdit: false,
    substituteRegex: 0,
    trimStrings: [],
  }),
  normalizeRegexScript({
    id: 'regex-blank',
    scriptName: '压缩多余空行',
    findRegex: '/\\n{3,}/g',
    replaceString: '\n\n',
    placement: [1, 3],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    minDepth: null,
    maxDepth: null,
    trimStrings: [],
  }),
  normalizeRegexScript({
    id: 'regex-depth',
    scriptName: '仅在最近 2-4 层附加提示',
    findRegex: '/(你是{{char}})/g',
    replaceString: '$1（保持角色语气）',
    placement: [3],
    disabled: false,
    minDepth: 2,
    maxDepth: 4,
    substituteRegex: 1,
    trimStrings: ['\u200b'],
  }),
  normalizeRegexScript({
    id: 'regex-narr',
    scriptName: '旁白括号转斜体（示例）',
    findRegex: '/（([^）]+)）/g',
    replaceString: '*$1*',
    placement: [1],
    disabled: true,
    markdownOnly: true,
  }),
];

export function createSampleProject(): {
  card: NormalizedCard;
  worldbook: NormalizedWorldbook;
  regex: RegexPreset;
  scripts: ScriptCollection;
  mvu: MvuState;
  floors: { index: number; statData: any; label?: string }[];
} {
  const cardJson = JSON.parse(JSON.stringify(CARD_JSON));
  cardJson.data.character_book = {
    name: '北境观测站资料',
    description: '示例内嵌世界书：包含初始化变量、变量更新规则、地点/人物/事件条目与包含组演示。',
    scan_depth: 4,
    token_budget: 2048,
    recursive_scanning: true,
    extensions: {},
    entries: ENTRIES,
  };
  const card = normalizeCard(cardJson);

  const worldbook = parseWorldbook(
    { ...cardJson.data.character_book, entries: cardJson.data.character_book.entries },
    { name: '北境观测站资料', origin: 'card', embeddedInCard: true },
  );
  worldbook.root = cardJson.data.character_book;

  const regex: RegexPreset = {
    name: '示例正则集',
    scripts: REGEX_SCRIPTS,
    root: REGEX_SCRIPTS,
    shape: 'array',
    origin: 'character',
  };

  const scripts: ScriptCollection = {
    scripts: cardJson.data.extensions.tavern_helper.scripts.map((s: any) => s as any),
    root: cardJson.data.extensions.tavern_helper.scripts,
    shape: 'array',
    origin: 'character',
  };

  const floors = [
    { index: 0, statData: JSON.parse(JSON.stringify({ 角色: { 姓名: '星见澪', 等级: 3, 生命: 100, 好感度: 12, 状态: '正常', 背包: [{ 名称: '压缩口粮', 数量: 4 }] }, 世界: { 时间: '星历 2187 年 4 月 3 日', 地点: '北境观测站' } })), label: '开场' },
    { index: 4, statData: JSON.parse(JSON.stringify({ 角色: { 姓名: '星见澪', 等级: 3, 生命: 88, 好感度: 24, 状态: '正常', 背包: [{ 名称: '观测记录仪', 数量: 1 }, { 名称: '压缩口粮', 数量: 4 }] }, 世界: { 时间: '星历 2187 年 4 月 3 日', 地点: '北境观测站', 天气: '极光' } })), label: '第 4 楼' },
    { index: 9, statData: JSON.parse(JSON.stringify({ 角色: { 姓名: '星见澪', 等级: 4, 生命: 62, 好感度: 31, 状态: '轻伤', 背包: [{ 名称: '观测记录仪', 数量: 1 }] }, 世界: { 时间: '星历 2187 年 4 月 4 日', 地点: '三层冷库', 天气: '暴雪' } })), label: '第 9 楼' },
  ];

  const mvu = buildMvuState({
    card,
    worldbooks: [worldbook],
    scripts: [scripts],
    floors,
  });

  return { card, worldbook, regex, scripts, mvu, floors };
}
