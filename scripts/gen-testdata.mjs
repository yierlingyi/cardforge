/**
 * 生成测试数据：docs / testdata 目录
 * 运行：npm run gen:testdata
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'testdata');
fs.mkdirSync(OUT, { recursive: true });

const WORDS = ['观测站', '极光', '暴雪', '通讯', '样本', '温室', '记录本', '补给', '冷库', '天线', '辐射', '值班'];
const HEAD = ['地点', '人物', '事件', '设定', '细节', '规则', '物品', '组织'];

function entry(i) {
  const head = HEAD[i % HEAD.length];
  const w1 = WORDS[i % WORDS.length];
  const w2 = WORDS[(i * 3 + 1) % WORDS.length];
  const long = i % 97 === 0;
  const body = `这是第 ${i} 条世界书条目，标签为「${head}」。\n` + `与「${w1}」和「${w2}」相关。` + (long ? `\n补充说明：`.padEnd(80, '内容') + `极光过载时仪器读数会短时飙升，需要在 20 分钟内完成采样记录。`.repeat(40) : '');
  return {
    uid: i,
    key: [`${w1}${i % 7}`, `${w2}_${i}`],
    keysecondary: i % 13 === 0 ? [`次键_${i}`] : [],
    comment: `${head}：${w1} ${i}`,
    content: body,
    constant: i % 211 === 0,
    vectorized: false,
    selective: true,
    selectiveLogic: i % 4,
    addMemo: true,
    order: 100 + (i % 20),
    position: i % 5,
    disable: i % 53 === 0,
    excludeRecursion: i % 101 === 0,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: i % 17 === 0 ? 40 : 100,
    useProbability: true,
    depth: 4,
    group: i % 31 === 0 ? `组${i % 4}` : '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    displayIndex: i,
  };
}

function worldbook(n) {
  const entries = {};
  for (let i = 0; i < n; i++) entries[String(i)] = entry(i);
  return { name: `压力测试世界书-${n}`, entries };
}

for (const n of [1000, 10000, 50000]) {
  const file = path.join(OUT, `worldbook-${n}.json`);
  fs.writeFileSync(file, JSON.stringify(worldbook(n)), 'utf-8');
  console.log(`${file}  ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
}

/* 人物卡样本 */
const base = {
  name: '测试角色',
  description: '用于格式测试的角色。包含特殊字符：<>&"\'`~!@#$%^&*()_+-=[]{}|;:,.<>/?\n第二行。',
  personality: '冷静',
  scenario: '测试场景',
  first_mes: '你好。',
  mes_example: '<START>\n{{user}}: hi\n{{char}}: hello',
  creator_notes: '测试用',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: ['替代一', '替代二'],
  tags: ['测试', 'V2'],
  creator: 'CardForge',
  character_version: '0.0.1',
  extensions: { foo: { bar: [1, 2, 3] } },
};

fs.writeFileSync(
  path.join(OUT, 'card-v1.json'),
  JSON.stringify(base, null, 2),
  'utf-8',
);

fs.writeFileSync(
  path.join(OUT, 'card-v2-with-book.json'),
  JSON.stringify(
    {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        ...base,
        character_book: {
          name: '测试内嵌世界书',
          description: '',
          scan_depth: 4,
          token_budget: 1024,
          recursive_scanning: false,
          extensions: {},
          entries: [entry(0), entry(1), entry(2)],
        },
      },
      third_party_root: { note: '未知根字段' },
    },
    null,
    2,
  ),
  'utf-8',
);

fs.writeFileSync(
  path.join(OUT, 'card-v3-full.json'),
  JSON.stringify(
    {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        ...base,
        nickname: '小测',
        creator_notes_multilingual: { en: 'test card', 'zh-cn': '测试卡' },
        source: ['https://example.invalid'],
        group_only_greetings: ['群聊开场'],
        creation_date: 1764000000,
        modification_date: 1764000000,
        assets: [{ type: 'icon', uri: 'embeded://assets/icon.png', name: 'icon', ext: 'png' }],
        unknown_extension_field: { keep: true },
      },
    },
    null,
    2,
  ),
  'utf-8',
);

/* 正则样本（含风险表达式，注意：仅作为数据，不会在导入时执行） */
const regex = [
  {
    id: 'test-1',
    scriptName: '把 <status> 转成 HTML',
    findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
    replaceString: '<div class="status">$1</div>',
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    trimStrings: [],
  },
  {
    id: 'test-2',
    scriptName: '压缩空行',
    findRegex: '/\\n{3,}/g',
    replaceString: '\n\n',
    placement: [1, 3],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    trimStrings: [],
  },
  {
    id: 'test-3',
    scriptName: '高风险：嵌套量词',
    findRegex: '/(a+)+$/g',
    replaceString: 'x',
    placement: [3],
    disabled: true,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    trimStrings: [],
  },
];
fs.writeFileSync(path.join(OUT, 'regex-set.json'), JSON.stringify(regex, null, 2), 'utf-8');

/* 脚本样本 */
const scripts = [
  {
    id: 'script-1',
    name: 'MVU Schema 示例',
    content: `const schema = z.object({\n  角色: z.object({\n    姓名: z.string().default('测试'),\n    等级: z.number().int().min(1).max(99).default(1),\n    背包: z.array(z.object({ 名称: z.string(), 数量: z.number().int().min(1) })).default([]),\n  }),\n});\nregisterVariableSchema(schema);\n`,
    info: '测试脚本，不会被编辑器执行',
    enabled: true,
    button: { enabled: true, buttons: [{ name: '测试按钮', visible: true }] },
    data: { note: 'arbitrary' },
    export_with: { stat_data: true },
  },
  {
    id: 'script-2',
    name: '语法错误示例',
    content: `function broken( {\n  return 1;\n}\n`,
    info: '',
    enabled: true,
    button: { enabled: false, buttons: [] },
    data: {},
  },
];
fs.writeFileSync(path.join(OUT, 'scripts.json'), JSON.stringify(scripts, null, 2), 'utf-8');

/* MVU 多楼层变量 */
const floors = [
  { index: 0, label: '开场', stat_data: { 角色: { 姓名: '测试', 等级: 1, 生命: 100, 好感度: 0, 状态: '正常', 背包: [] }, 世界: { 时间: '第一天', 地点: '门口' } } },
  { index: 3, label: '第 3 楼', stat_data: { 角色: { 姓名: '测试', 等级: 2, 生命: 92, 好感度: 6, 状态: '正常', 背包: [{ 名称: '钥匙', 数量: 1 }] }, 世界: { 时间: '第一天', 地点: '走廊' } } },
  { index: 8, label: '第 8 楼', stat_data: { 角色: { 姓名: '测试', 等级: 2, 生命: 55, 好感度: 14, 状态: '轻伤', 背包: [{ 名称: '钥匙', 数量: 1 }, { 名称: '绷带', 数量: 2 }] }, 世界: { 时间: '第二天', 地点: '地下' } } },
  { index: 15, label: '第 15 楼', stat_data: { 角色: { 姓名: '测试', 等级: 3, 生命: 48, 好感度: 21, 状态: '重伤', 背包: [{ 名称: '钥匙', 数量: 1 }] }, 世界: { 时间: '第二天', 地点: '地下' } } },
];
fs.writeFileSync(path.join(OUT, 'mvu-floors.json'), JSON.stringify(floors, null, 2), 'utf-8');

console.log('测试数据生成完成：' + OUT);
