import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
// 运行前请先启动 npm run dev（默认 http://localhost:5178）

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();

const errors = [];
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  else logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    errors.push(`[step:${name}] ${e.message}`);
    console.log(`✗ ${name} — ${e.message}`);
  }
};

await page.goto('http://localhost:5178/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await step('首屏渲染', async () => {
  await page.waitForSelector('.app', { timeout: 8000 });
  const text = await page.locator('body').innerText();
  if (!text.includes('CardForge')) throw new Error('未见品牌名');
  if (text.includes('界面渲染出错')) throw new Error('出现渲染错误边界');
  await page.screenshot({ path: `${OUT}/01-home.png` });
});

const nav = async (label, file) => {
  await page.getByRole('button', { name: label, exact: false }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${file}` });
};

await step('人物卡页', async () => {
  await nav('人物卡编辑', '02-character.png');
  const t = await page.locator('body').innerText();
  if (!t.includes('星见澪')) throw new Error('未显示角色名');
  if (!t.includes('正文内容')) throw new Error('未显示字段分组');
});

await step('编辑字段触发保存', async () => {
  const area = page.locator('.pane-body textarea.textarea').first();
  await area.fill((await area.inputValue()) + '\n（测试编辑）');
  await page.waitForTimeout(1600);
  const body = await page.locator('body').innerText();
  if (!body.includes('已保存') && !body.includes('未保存')) throw new Error('保存状态未更新');
});

await step('人物卡字段搜索', async () => {
  await nav('人物卡编辑', '02b-character.png');
  const search = page.locator('.pane input.input').first();
  await search.fill('first_mes');
  await page.waitForTimeout(300);
  const body = await page.locator('body').innerText();
  if (!body.includes('正文内容')) throw new Error('字段搜索结果未显示分组');
  await search.fill('');
  await page.waitForTimeout(200);
});

await step('世界书页', async () => {
  await nav('世界书', '03-worldbook.png');
  const rows = await page.locator('.vrow').count();
  if (rows < 8) throw new Error(`虚拟列表行数过少：${rows}`);
});

await step('选中条目并编辑', async () => {
  await page.locator('.vrow').nth(3).click();
  await page.waitForTimeout(400);
  const body = await page.locator('body').innerText();
  if (!body.includes('触发条件')) throw new Error('未显示条目编辑器');
  await page.screenshot({ path: `${OUT}/04-worldbook-entry.png` });
});

await step('条目右键菜单', async () => {
  await page.locator('.vrow').nth(5).click({ button: 'right' });
  await page.waitForTimeout(300);
  const menu = await page.locator('body').innerText();
  if (!menu.includes('复制条目') || !menu.includes('设为常驻') && !menu.includes('取消常驻')) throw new Error('右键菜单项缺失');
  await page.getByRole('button', { name: /设为常驻|取消常驻/ }).last().click();
  await page.waitForTimeout(400);
});

await step('世界书关系视图', async () => {
  await page.getByRole('button', { name: '关系', exact: true }).click();
  await page.waitForTimeout(400);
  const body = await page.locator('body').innerText();
  if (!body.includes('包含组')) throw new Error('关系视图缺失');
  await page.screenshot({ path: `${OUT}/05b-worldbook-relations.png` });
  await page.getByRole('button', { name: '列表', exact: true }).click();
});

await step('关键词索引视图', async () => {
  await page.getByRole('button', { name: '关键词', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-worldbook-keywords.png` });
});

await step('世界书 JSON 视图', async () => {
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();
  if (!body.includes('"entries"')) throw new Error('JSON 视图无内容');
});

await step('触发模拟', async () => {
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.getByRole('button', { name: '触发模拟' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '运行模拟' }).click();
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();
  if (!body.includes('最终注入顺序')) throw new Error('模拟结果未渲染');
  await page.screenshot({ path: `${OUT}/06-worldbook-sim.png` });
  await page.keyboard.press('Escape');
});

await step('正则页 + 测试', async () => {
  await nav('正则规则', '07-regex.png');
  await page.getByRole('button', { name: '正则测试' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '运行测试' }).click();
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();
  if (!body.includes('匹配明细')) throw new Error('未显示匹配结果');
  await page.screenshot({ path: `${OUT}/08-regex-test.png` });
});

await step('执行链模拟', async () => {
  await page.getByRole('button', { name: '执行链模拟' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '运行执行链' }).click();
  await page.waitForTimeout(1000);
  const body = await page.locator('body').innerText();
  if (!body.includes('最终输出')) throw new Error('执行链无结果');
  await page.screenshot({ path: `${OUT}/09-regex-chain.png` });
});

await step('脚本页', async () => {
  await nav('酒馆助手脚本', '10-scripts.png');
  const body = await page.locator('body').innerText();
  if (!body.includes('MVU Zod Schema')) throw new Error('脚本列表为空');
  if (!body.includes('不会执行')) throw new Error('缺少安全提示');
});

await step('脚本分析页', async () => {
  await page.getByRole('button', { name: '分析', exact: true }).click();
  await page.waitForTimeout(400);
  const body = await page.locator('body').innerText();
  if (!body.includes('静态依赖')) throw new Error('分析区缺失');
  await page.screenshot({ path: `${OUT}/11-scripts-analysis.png` });
});

await step('MVU 树形视图', async () => {
  await nav('MVU 变量', '12-mvu-tree.png');
  const body = await page.locator('body').innerText();
  if (!body.includes('MVU Zod')) throw new Error('未识别 MVU 版本');
  if (!body.includes('好感度')) throw new Error('变量树为空');
});

await step('MVU 表格/历史/Schema', async () => {
  await page.getByRole('button', { name: '表格视图' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/13-mvu-table.png` });
  await page.getByRole('button', { name: '历史楼层' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/14-mvu-history.png` });
  await page.getByRole('button', { name: 'Schema', exact: true }).click();
  await page.waitForTimeout(500);
  const body = await page.locator('body').innerText();
  if (!body.includes('Schema 字段')) throw new Error('Schema 视图为空');
  await page.screenshot({ path: `${OUT}/15-mvu-schema.png` });
});

await step('MVU Patch 测试', async () => {
  await page.getByRole('button', { name: 'Patch 测试' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '执行补丁' }).click();
  await page.waitForTimeout(500);
  const body = await page.locator('body').innerText();
  if (!body.includes('执行成功')) throw new Error('补丁未执行');
  await page.screenshot({ path: `${OUT}/16-mvu-patch.png` });
});

await step('前端预览', async () => {
  await nav('前端预览', '17-preview.png');
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();
  if (!body.includes('模拟渲染')) throw new Error('预览页缺失');
  if (!body.includes('状态栏')) throw new Error('状态栏未渲染');
});

await step('数据校验', async () => {
  await nav('数据校验', '18-validation.png');
  const body = await page.locator('body').innerText();
  if (!body.includes('导出前检查')) throw new Error('校验页缺失');
});

await step('无损往返测试', async () => {
  await page.getByRole('button', { name: 'JSON V3' }).click();
  await page.waitForTimeout(900);
  const body = await page.locator('body').innerText();
  if (!body.includes('无损')) throw new Error('往返测试未通过或未渲染');
});

await step('历史记录', async () => {
  await nav('历史记录', '19-history.png');
  const body = await page.locator('body').innerText();
  if (!body.includes('编辑历史')) throw new Error('历史页缺失');
});

await step('设置与浅色主题', async () => {
  await nav('项目设置', '20-settings.png');
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.waitForTimeout(500);
});

await step('全局搜索', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await page.locator('.modal input.input').fill('观测站');
  await page.waitForTimeout(500);
  const body = await page.locator('body').innerText();
  if (!body.includes('世界书')) throw new Error('搜索无结果');
  await page.screenshot({ path: `${OUT}/21-search.png` });
  await page.keyboard.press('Escape');
});

await step('导出 PNG（下载事件）', async () => {
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(500);
  await page.getByText('人物卡 PNG').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: '导出并下载' }).click(),
  ]);
  const p = await download.path();
  const size = fs.statSync(p).size;
  if (size < 1000) throw new Error(`PNG 过小：${size}`);
  console.log(`  下载 PNG：${download.suggestedFilename()} (${size} bytes)`);
  await page.keyboard.press('Escape');
});

await step('回到深色主题并截图', async () => {
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/22-settings-dark.png` });
});

const summary = { errors, shotCount: fs.readdirSync(OUT).length };
fs.writeFileSync('tmp/ui-check-result.json', JSON.stringify(summary, null, 2));
console.log('\n错误数：', errors.length);
errors.slice(0, 20).forEach((e) => console.log(' -', e));

await browser.close();
if (errors.length) process.exitCode = 1;
