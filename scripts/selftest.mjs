/**
 * CardForge 核心模块自测（Node 环境，不依赖浏览器 DOM）
 * 运行：npx tsx scripts/selftest.mjs
 * 产出：控制台结果 + docs/test-report-generated.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSampleProject } from '../src/core/sample.ts';
import { normalizeCard, serializeCard } from '../src/core/card.ts';
import { parseWorldbook, exportWorldbookFile, nextUid, uidConflicts, keyConflicts, worldbookStats } from '../src/core/worldbook.ts';
import { parseYamlSubset } from '../src/core/yaml.ts';
import { parseZodSchema, buildMvuState, findInitVarEntry, parseInitVar, checkDataAgainstSchema } from '../src/core/mvu.ts';
import { parseFindRegex, runRegexOnText, runRegexChain, detectRegexRisk, createRegexScript } from '../src/core/regex.ts';
import { simulateWorldbook } from '../src/core/simulate.ts';
import { applyPatch, generatePatch, parseUpdateCommands } from '../src/core/patch.ts';
import { validateAll } from '../src/core/validate.ts';
import { writeCardToPng, readPngInfo, isPng } from '../src/core/png.ts';
import { checkSyntax, analyzeScript, normalizeScript } from '../src/core/scripts.ts';
import { roundTripCard } from '../src/core/roundtrip.ts';
import { deepEqual, utf8ToBase64, base64ToUtf8 } from '../src/core/util.ts';

const results = [];
let failures = 0;

async function test(name, fn) {
  try {
    const info = await fn();
    results.push({ name, ok: true, info: info || '' });
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } catch (e) {
    failures++;
    results.push({ name, ok: false, info: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(a, b, msg) {
  if (!deepEqual(a, b)) throw new Error(`${msg || '不相等'}：${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`);
}

console.log('\n== 1. 数据格式与归一化 ==');
const sample = createSampleProject();

await test('示例卡识别为 V3', () => {
  assert(sample.card.version === 'v3', sample.card.version);
  return 'spec=chara_card_v3';
});

await test('内嵌世界书解析为 14 条、数组形状', () => {
  assert(sample.worldbook.entries.length === 14, String(sample.worldbook.entries.length));
  assert(sample.worldbook.shape === 'array');
  return `${sample.worldbook.entries.length} 条 / shape=${sample.worldbook.shape}`;
});

await test('V1 平面结构识别', () => {
  const v1 = normalizeCard({ name: 'A', description: 'd', first_mes: 'f', mes_example: 'm' });
  assert(v1.version === 'v1');
  assert(v1.data === v1.root);
  return '无 spec → V1';
});

await test('V2 → V3 序列化保留未知字段', () => {
  const src = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'X', description: 'd', first_mes: 'f', extensions: { foo: { bar: 1 } }, weird_third_party: 'keep-me' },
    custom_root_meta: { a: 1 },
  };
  const card = normalizeCard(src);
  const out = serializeCard(card, 'v3').json;
  assert(out.spec === 'chara_card_v3');
  assert(out.data.weird_third_party === 'keep-me');
  assert(out.custom_root_meta.a === 1);
  return '未知 data 字段 + 根级扩展字段均保留';
});

await test('V2 导出时对 V3 专属字段给出警告', () => {
  const w = serializeCard(sample.card, 'v2').warnings;
  assert(w.some((x) => x.includes('V3')), w.join('|'));
  return w[0];
});

await test('V1 导出时对内嵌世界书给出数据丢失警告', () => {
  const w = serializeCard(sample.card, 'v1').warnings;
  assert(w.some((x) => x.includes('世界书')), w.join('|'));
  return w[0];
});

console.log('\n== 2. 世界书 ==');
await test('record 形状解析（entries 为对象）', () => {
  const wb = parseWorldbook({ entries: { 0: { uid: 0, key: ['a'], content: 'x' }, 1: { uid: 1, key: [], content: 'y' } } }, { name: 'T' });
  assert(wb.shape === 'record' && wb.entries.length === 2);
  return '2 条';
});

await test('裸 record 形状解析（无 entries 包装）', () => {
  const wb = parseWorldbook({ 0: { key: ['a'], content: 'x' } }, { name: 'T' });
  assert(wb.shape === 'bare' && wb.entries.length === 1);
  return 'shape=bare';
});

await test('导出/再解析无损（14 条）', () => {
  const file = exportWorldbookFile(sample.worldbook);
  assert(Object.keys(file.entries).length === 14);
  const back = parseWorldbook(file, { name: 'T' });
  const a = sample.worldbook.entries.map((e) => ({ ...e, displayIndex: 0 }));
  const b = back.entries.map((e) => ({ ...e, displayIndex: 0 }));
  eq(a, b, '条目内容');
  return '14/14 一致';
});

await test('默认字段补全', () => {
  const wb = parseWorldbook({ entries: [{}] }, { name: 'T' });
  const e = wb.entries[0];
  assert(e.order === 100 && e.probability === 100 && e.selective === true && e.position === 0 && e.depth === 4);
  return 'order=100 probability=100 depth=4';
});

await test('UID 冲突与关键词冲突检测', () => {
  const wb = parseWorldbook({ entries: [{ uid: 1, key: ['k'], content: 'a' }, { uid: 1, key: ['k'], content: 'b' }] }, { name: 'T' });
  assert(uidConflicts(wb.entries).size === 1);
  const kc = keyConflicts(wb.entries).filter((c) => c.kind === 'across');
  assert(kc.length === 1 && kc[0].entries.length === 2);
  return 'UID 冲突 1 组，跨条目重复关键词 1 组';
});

await test('世界书统计', () => {
  const s = worldbookStats(sample.worldbook.entries);
  assert(s.count === 14 && s.disabled >= 2 && s.constant >= 3, JSON.stringify(s));
  return `count=${s.count} enabled=${s.enabled} constant=${s.constant} chars=${s.totalChars}`;
});

console.log('\n== 3. YAML / MVU ==');
await test('YAML 子集解析：嵌套映射 + 序列 + 数字', () => {
  const r = parseYamlSubset(`角色:\n  姓名: 星见澪\n  等级: 3\n  背包:\n    - 名称: 记录仪\n      数量: 1\n    - 名称: 口粮\n      数量: 4\n世界:\n  地点: 观测站\n`);
  assert(r.ok, r.error);
  assert(r.value.角色.姓名 === '星见澪');
  assert(r.value.角色.等级 === 3);
  assert(r.value.角色.背包.length === 2);
  assert(r.value.角色.背包[1].数量 === 4);
  return '4 层结构正确';
});

await test('YAML 引号 / 布尔 / null / 行内数组', () => {
  const r = parseYamlSubset(`a: "x, y"\nb: true\nc: null\nd: [1, 2, 3]\ne: 'it''s'`);
  assert(r.ok, r.error);
  assert(r.value.a === 'x, y');
  assert(r.value.b === true);
  assert(r.value.c === null);
  assert(r.value.d.length === 3);
  assert(r.value.e === "it's");
  return 'ok';
});

await test('初始化条目识别 + 解析', () => {
  const e = findInitVarEntry(sample.worldbook.entries);
  assert(e && e.uid === 0, '未找到');
  const p = parseInitVar(e.content);
  assert(p.ok && p.data.角色.生命 === 88);
  return `#${e.uid} ${e.comment}`;
});

await test('Zod Schema 静态解析', () => {
  const script = sample.scripts.scripts.find((s) => s.content.includes('z.object'));
  const r = parseZodSchema(script.content);
  assert(r.found);
  const hu = r.fields.find((f) => f.path === '角色.好感度');
  const bag = r.fields.find((f) => f.path === '角色.背包[].名称');
  assert(hu && hu.type === 'number' && hu.constraints.some((c) => c.includes('≤ 100')), JSON.stringify(hu));
  assert(bag, '未解析数组元素字段');
  return `${r.fields.length} 个字段，含数组元素路径`;
});

await test('MVU 版本识别为 mvuzod', () => {
  assert(sample.mvu.flavor === 'mvuzod', sample.mvu.flavor);
  assert(sample.mvu.confidence === 'high', sample.mvu.confidence);
  return `${sample.mvu.flavor} / ${sample.mvu.confidence} / 证据 ${sample.mvu.evidence.length} 条`;
});

await test('变量来源为世界书初始化', () => {
  assert(sample.mvu.statSource === 'worldbook', sample.mvu.statSource);
  assert(sample.mvu.statData.角色.好感度 === 24);
  return sample.mvu.statSourceDetail;
});

await test('Schema 与数据校验（含故意错误）', () => {
  const bad = { 角色: { 姓名: 'x', 等级: 3, 生命: 180, 好感度: '24', 状态: '正常' } };
  const issues = checkDataAgainstSchema(bad, sample.mvu.schemaFields);
  assert(issues.some((i) => i.path === '角色.生命' && i.level === 'error'), JSON.stringify(issues));
  assert(issues.some((i) => i.path === '角色.好感度' && i.level === 'error'));
  return `${issues.length} 个问题（范围+类型）`;
});

await test('脚本语法检查：顶层 await 不误报', () => {
  const r = checkSyntax("const a = await getWorldbook('x');");
  assert(r.ok && r.note && r.note.includes('await'), JSON.stringify(r));
  return r.note;
});

await test('脚本语法检查：ES module 语法不误报', () => {
  const r = checkSyntax("import { x } from 'y';\nexport const a = 1;");
  assert(r.ok && r.note, JSON.stringify(r));
  return r.note;
});

await test('脚本语法检查：真实语法错误被捕获', () => {
  const r = checkSyntax('function broken( {');
  assert(!r.ok && !!r.error, JSON.stringify(r));
  return r.error.slice(0, 60);
});

await test('脚本静态分析提取 API 与 import', () => {
  const meta = analyzeScript(normalizeScript({ name: 't', content: "import { z } from 'zod';\nconst v = await getVariables({type:'chat'});\neventOn('x', () => {});\nfetch('/a');" }));
  assert(meta.imports.includes('zod'), JSON.stringify(meta.imports));
  assert(meta.apiCalls.includes('getVariables'));
  assert(meta.hasFetch);
  return `API ${meta.apiCalls.length} 个 / import ${meta.imports.length} 个`;
});

console.log('\n== 4. 正则 ==');
await test('findRegex 解析（/pattern/flags）', () => {
  const p = parseFindRegex('/<status>([\\s\\S]*?)<\\/status>/gi');
  assert(p.ok && p.flags === 'gi' && p.pattern.includes('status'));
  return 'pattern + flags 分离正确';
});

await test('替换与捕获组', () => {
  const r = runRegexOnText(createRegexScript({ findRegex: '/(\\d+)\\/(\\d+)/g', replaceString: '[$1 of $2]' }), '生命 88/100，好感 24/100');
  assert(r.ok && r.matches.length === 2, String(r.matches.length));
  assert(r.output.includes('[88 of 100]'), r.output);
  return `2 处匹配 → ${r.output}`;
});

await test('零宽匹配不死循环', () => {
  const r = runRegexOnText({ ...createRegexScript(), findRegex: '/(?=a)/g', replaceString: '-' }, 'aaa');
  assert(r.ok && r.matches.length === 3);
  return '3 处零宽匹配';
});

await test('trimStrings 预处理', () => {
  const r = runRegexOnText({ ...createRegexScript(), findRegex: '/x/g', replaceString: 'y', trimStrings: ['\u200b'] }, 'a\u200bx');
  assert(r.output === 'ay');
  return '零宽字符被移除后替换';
});

await test('非法正则报错不抛异常', () => {
  const r = runRegexOnText({ ...createRegexScript(), findRegex: '/(/g' }, 'x');
  assert(!r.ok && r.error.includes('编译失败'));
  return r.error;
});

await test('灾难性回溯启发式检测', () => {
  assert(detectRegexRisk('(a+)+$').level === 'high');
  assert(detectRegexRisk('(.*)*').level === 'high');
  assert(detectRegexRisk('\\d{3}-\\d{4}').level === 'low');
  return '(a+)+ → high；(.*)* → high；普通分组 → low';
});

await test('执行链 + placement / depth 过滤', () => {
  const scripts = [
    { ...createRegexScript({ scriptName: 'A', findRegex: '/foo/g', replaceString: 'bar', placement: [1] }) },
    { ...createRegexScript({ scriptName: 'B', findRegex: '/bar/g', replaceString: 'baz', placement: [3] }) },
    { ...createRegexScript({ scriptName: 'C', findRegex: '/baz/g', replaceString: 'qux', placement: [1], minDepth: 5 }) },
  ];
  const r = runRegexChain(scripts, 'foo', { placement: 1, messageDepth: 0 });
  assert(r.final === 'bar', r.final);
  assert(r.steps.filter((s) => s.skipped).length === 2, JSON.stringify(r.steps.map((s) => s.skipped)));
  return '位置/深度不匹配的规则被跳过';
});

console.log('\n== 5. 世界书触发模拟 ==');
await test('常驻/禁用/关键词/包含组/概率', () => {
  const report = simulateWorldbook(sample.worldbook.entries, {
    messages: [{ role: 'user', content: '暴风雪停了，天放晴了。星见澪走进观测站，把门关好。' }],
    globalScanDepth: 4,
    seed: 42,
    recursion: false,
  });
  const byUid = new Map(report.results.map((r) => [r.uid, r]));
  assert(byUid.get(2).status === 'constant', JSON.stringify(byUid.get(2)));
  assert(byUid.get(0).status === 'disabled');
  assert(byUid.get(3).status === 'matched', JSON.stringify(byUid.get(3)));
  assert(byUid.get(4).status === 'matched', JSON.stringify(byUid.get(4)));
  const weather = [7, 8].filter((u) => byUid.get(u).included);
  assert(weather.length === 1, `同组条目应只注入 1 条，实际 ${weather.length}`);
  const gd = report.groupDecisions.find((g) => g.group === '天气');
  assert(gd && gd.winner !== null, '包含组未产生决策');
  const injected = report.injection.filter((r) => r.included).map((r) => r.uid);
  assert(injected.includes(9), '常驻风格条目应注入');
  assert(!injected.includes(0), '禁用条目不应注入');
  return `注入 ${injected.length} 条：${injected.join(',')}；天气组胜出 #${gd.winner}`;
});

await test('次关键词不满足时不触发', () => {
  const report = simulateWorldbook(sample.worldbook.entries, {
    messages: [{ role: 'user', content: '澪。' }],
    globalScanDepth: 4,
    seed: 1,
    recursion: false,
  });
  const r4 = report.results.find((r) => r.uid === 4);
  assert(r4.status === 'secondary-miss', JSON.stringify(r4));
  return r4.reasons.join('；');
});

await test('递归扫描可激活新条目', () => {
  const entries = [
    { uid: 0, key: ['苹果'], content: '苹果派的做法需要苹果和面粉。', constant: false, selective: true, order: 100, position: 0, probability: 100, useProbability: true, depth: 4, role: 0, disable: false },
    { uid: 1, key: ['面粉'], content: '面粉来自北境磨坊。', constant: false, selective: true, order: 100, position: 0, probability: 100, useProbability: true, depth: 4, role: 0, disable: false },
  ];
  const noRec = simulateWorldbook(entries, { messages: [{ role: 'user', content: '我想吃苹果' }], globalScanDepth: 4, recursion: false });
  const rec = simulateWorldbook(entries, { messages: [{ role: 'user', content: '我想吃苹果' }], globalScanDepth: 4, recursion: true, maxRecursionDepth: 3 });
  assert(noRec.injection.length === 1, String(noRec.injection.length));
  assert(rec.injection.length === 2, String(rec.injection.length));
  return `关闭递归 1 条 → 开启递归 ${rec.injection.length} 条（第 ${rec.recursionRounds} 轮）`;
});

await test('扫描深度限制生效', () => {
  const entries = [{ uid: 0, key: ['目标'], content: 'c', constant: false, selective: true, order: 100, position: 0, probability: 100, useProbability: true, depth: 4, role: 0, disable: false }];
  const msgs = [{ role: 'user', content: '目标' }, { role: 'assistant', content: '无关内容' }, { role: 'user', content: '另一句话' }];
  const r1 = simulateWorldbook(entries, { messages: msgs, globalScanDepth: 1, recursion: false });
  const r3 = simulateWorldbook(entries, { messages: msgs, globalScanDepth: 3, recursion: false });
  assert(r1.injection.length === 0 && r3.injection.length === 1);
  return 'depth=1 不命中；depth=3 命中';
});

await test('概率判定可复现且可失败', () => {
  const entries = [{ uid: 0, key: ['x'], content: 'c', constant: false, selective: true, order: 100, position: 0, probability: 10, useProbability: true, depth: 4, role: 0, disable: false }];
  const a = simulateWorldbook(entries, { messages: [{ role: 'user', content: 'x' }], globalScanDepth: 4, seed: 7 });
  const b = simulateWorldbook(entries, { messages: [{ role: 'user', content: 'x' }], globalScanDepth: 4, seed: 7 });
  assert(a.results[0].status === b.results[0].status, '同种子结果不一致');
  return `同种子结果一致（${a.results[0].status}）`;
});

console.log('\n== 6. JSON Patch / 变量更新 ==');
await test('RFC6902 add/replace/remove/test', () => {
  const doc = { a: 1, list: [1, 2] };
  const r = applyPatch(doc, [
    { op: 'replace', path: '/a', value: 2 },
    { op: 'add', path: '/list/-', value: 3 },
    { op: 'add', path: '/b', value: { c: true } },
    { op: 'test', path: '/a', value: 2 },
    { op: 'remove', path: '/b' },
  ]);
  assert(r.ok, r.error);
  eq(r.result, { a: 2, list: [1, 2, 3] });
  return '5 个操作全部成功';
});

await test('非法路径返回明确错误', () => {
  const r = applyPatch({ a: 1 }, [{ op: 'replace', path: '/x/y', value: 1 }]);
  assert(!r.ok && r.failedAt === 0 && r.error.includes('路径不存在'), JSON.stringify(r));
  return r.error;
});

await test('MVU _.set 调用风格解析', () => {
  const p = parseUpdateCommands("_.set('角色.好感度', 30);\n_.remove('世界.天气')");
  assert(p.format === 'mvu-calls' && p.ops.length === 2, JSON.stringify(p));
  assert(p.ops[0].path === '/角色/好感度');
  assert(p.ops[0].value === 30);
  return '2 个操作，点路径转 JSON Pointer';
});

await test('更新指令应用到变量', () => {
  const p = parseUpdateCommands('[{"op":"replace","path":"/角色/生命","value":72}]');
  const r = applyPatch(sample.mvu.statData, p.ops);
  assert(r.ok && r.result.角色.生命 === 72);
  return '生命 88 → 72';
});

await test('generatePatch 往返', () => {
  const a = { x: { y: 1, z: [1, 2] } };
  const b = { x: { y: 2, z: [1, 2, 3] }, w: 'new' };
  const ops = generatePatch(a, b);
  const r = applyPatch(a, ops);
  assert(r.ok);
  eq(r.result, b);
  return `${ops.length} 个操作`;
});

console.log('\n== 7. PNG 元数据 ==');
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

await test('识别 PNG 签名', () => {
  assert(isPng(PNG_1PX));
  return `${PNG_1PX.length} 字节`;
});

await test('写入 chara/ccv3 并回读', async () => {
  const json = serializeCard(sample.card, 'v3').json;
  const out = writeCardToPng(PNG_1PX, json, { writeCcv3: true });
  const info = await readPngInfo(out);
  assert(info.cardChunks.length === 2, String(info.cardChunks.length));
  const kw = info.cardChunks.map((c) => c.keyword).sort().join(',');
  assert(kw === 'ccv3,chara', kw);
  const decoded = JSON.parse(info.cardChunks[0].json);
  assert(decoded.data.name === '星见澪');
  assert(decoded.data.character_book.entries.length === 14);
  return `2 个元数据块，回读 ${decoded.data.character_book.entries.length} 条世界书`;
});

await test('重复写入不产生重复块', async () => {
  const json = serializeCard(sample.card, 'v3').json;
  const once = writeCardToPng(PNG_1PX, json, { writeCcv3: true });
  const twice = writeCardToPng(once, json, { writeCcv3: true });
  const info = await readPngInfo(twice);
  assert(info.cardChunks.length === 2, String(info.cardChunks.length));
  assert(info.width === 1 && info.height === 1);
  return '仍然只有 chara + ccv3 各一个，IHDR 保留';
});

await test('base64 编解码 UTF-8 无损', () => {
  const text = JSON.stringify({ n: '星见澪 · 极光', e: 'emoji 🙂' });
  assert(base64ToUtf8(utf8ToBase64(text)) === text);
  return `${text.length} 字符`;
});

console.log('\n== 8. 校验与往返 ==');
await test('示例项目校验产出结果', () => {
  const issues = validateAll({
    card: sample.card,
    worldbooks: [sample.worldbook],
    regexes: [sample.regex],
    scripts: [sample.scripts],
    mvu: sample.mvu,
  });
  const err = issues.filter((i) => i.level === 'error');
  assert(issues.length > 0);
  return `${issues.length} 条（错误 ${err.length}，警告 ${issues.filter((i) => i.level === 'warning').length}）`;
});

for (const v of ['v1', 'v2', 'v3']) {
  await test(`JSON 往返 ${v.toUpperCase()}`, () => {
    const r = roundTripCard(sample.card, v);
    assert(r.ok, `差异 ${r.diffs.map((d) => d.path).join(',')}`);
    return `${r.jsonBytes} 字节，${r.elapsedMs.toFixed(1)}ms`;
  });
}

console.log('\n== 9. 性能（合成数据）==');
function makeEntries(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      uid: i,
      key: [`关键词${i}`, `kw${i}`],
      keysecondary: i % 7 === 0 ? [`副键${i}`] : [],
      comment: `条目 ${i} · ${i % 5 === 0 ? '常驻' : '普通'}`,
      content: `这是第 ${i} 条世界书正文。`.repeat(1 + (i % 6)),
      constant: i % 50 === 0,
      selective: true,
      selectiveLogic: 0,
      order: 100 + (i % 10),
      position: i % 4,
      disable: i % 37 === 0,
      probability: i % 11 === 0 ? 50 : 100,
      useProbability: true,
      depth: 4,
      group: i % 23 === 0 ? 'g' + (i % 3) : '',
      groupWeight: 100,
      role: 0,
    });
  }
  return arr;
}

for (const n of [10000, 50000]) {
  await test(`${n.toLocaleString()} 条目：解析 + 统计 + 搜索`, () => {
    const entries = makeEntries(n);
    const t0 = performance.now();
    const wb = parseWorldbook({ entries }, { name: `perf-${n}` });
    const t1 = performance.now();
    const stats = worldbookStats(wb.entries);
    const t2 = performance.now();
    const needle = '关键词49999';
    const hit = wb.entries.filter((e) => `${e.comment}${e.key.join(',')}${e.content}`.includes(needle)).length;
    const t3 = performance.now();
    const file = exportWorldbookFile(wb);
    const t4 = performance.now();
    assert(stats.count === n);
    return `解析 ${(t1 - t0).toFixed(0)}ms / 统计 ${(t2 - t1).toFixed(0)}ms / 全量搜索 ${(t3 - t2).toFixed(0)}ms（命中 ${hit}）/ 导出 ${(t4 - t3).toFixed(0)}ms`;
  });
}

await test('5 万条目触发模拟（常驻 + 关键词）', () => {
  const entries = makeEntries(50000);
  const t0 = performance.now();
  const r = simulateWorldbook(entries, { messages: [{ role: 'user', content: '关键词123 关键词49999' }], globalScanDepth: 4, recursion: false });
  const t1 = performance.now();
  return `${(t1 - t0).toFixed(0)}ms，注入 ${r.injection.length} 条`;
});

console.log(`\n== 结果：${results.length - failures}/${results.length} 通过 ==`);
if (failures) console.log(`失败 ${failures} 项`);

/* 生成报告 */
const md = [];
md.push('# CardForge 自测报告（自动生成）');
md.push('');
md.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
md.push(`运行环境：Node ${process.version} / ${process.platform}`);
md.push('');
md.push(`**结果：${results.length - failures}/${results.length} 通过**`);
md.push('');
md.push('| # | 测试 | 结果 | 说明 |');
md.push('| --- | --- | --- | --- |');
results.forEach((r, i) => {
  md.push(`| ${i + 1} | ${r.name} | ${r.ok ? '通过' : '**失败**'} | ${String(r.info).replace(/\|/g, '\\|')} |`);
});
md.push('');
md.push('> 说明：本报告由 `scripts/selftest.mjs` 在 Node 环境中直接调用核心模块生成，覆盖数据模型、解析、模拟、Patch、PNG 元数据与性能档位。UI 交互测试需在浏览器中手动执行（见 `docs/使用说明.md`）。');

fs.mkdirSync(path.join(process.cwd(), 'docs'), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), 'docs', 'test-report-generated.md'), md.join('\n'), 'utf-8');
console.log('\n报告已写入 docs/test-report-generated.md');

if (failures) process.exitCode = 1;
