import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto('http://localhost:5178/', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

const client = await ctx.newCDPSession(p);
await client.send('Performance.enable');
const heap = async () => {
  const { metrics } = await client.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), domNodes: m.Nodes };
};

async function importFile(file) {
  await p.getByRole('button', { name: '导入' }).first().click();
  await p.waitForTimeout(300);
  const t0 = Date.now();
  await p.locator('input[type=file]').setInputFiles(file);
  const target = file.match(/worldbook-(\d+)/)?.[1];
  await p.waitForFunction((n) => document.body.innerText.includes(`${n} 条`), target, { timeout: 180000 });
  // 等待列表出现
  await p.waitForFunction(() => document.querySelectorAll('.vrow').length > 3, null, { timeout: 120000 });
  const t1 = Date.now();
  await p.waitForTimeout(2500); // 等待自动保存
  return t1 - t0;
}

for (const n of [10000, 50000]) {
  const file = `testdata/worldbook-${n}.json`;
  if (!fs.existsSync(file)) continue;
  const t = await importFile(file);
  const info = await heap();
  const rows = await p.locator('.vrow').count();
  const header = await p.locator('.page-head').innerText();
  console.log(`导入 ${n}：${t}ms，可见行 ${rows}，堆 ${info.heapMB}MB，DOM ${info.domNodes}`);
  console.log('  页面：', header.replace(/\n/g, ' ').slice(0, 80));

  // 搜索性能
  const q = p.locator('.pane input.input').first();
  const s0 = Date.now();
  await q.fill('49999');
  await p.waitForTimeout(150);
  const s1 = Date.now();
  const visible = await p.locator('.vrow').count();
  console.log(`  搜索 49999：输入→${s1 - s0}ms，结果行 ${visible}`);

  const s2 = Date.now();
  await q.fill('暴雪');
  await p.waitForTimeout(400);
  const rows2 = await p.locator('.vrow').count();
  console.log(`  搜索 暴雪：${Date.now() - s2}ms，结果行 ${rows2}（虚拟化只渲染可视区）`);

  // 滚动
  const sc = Date.now();
  await p.locator('.pane .scroll.grow').last().evaluate((el) => { el.scrollTop = el.scrollHeight * 0.5; });
  await p.waitForTimeout(250);
  console.log(`  滚动到中部：${Date.now() - sc}ms，行 ${await p.locator('.vrow').count()}`);

  await p.screenshot({ path: `tmp/shots/40-perf-${n}.png` });
  // 新建空白项目，避免后续导入叠加
  // 通过 dev store 读取日志与序列化耗时
  const diag = await p.evaluate(() => {
    const st = window.__cardforge.useStore.getState();
    const t0 = performance.now();
    const text = window.__cardforge.serializeDoc(st.doc);
    const t1 = performance.now();
    return {
      serializeMs: +(t1 - t0).toFixed(0),
      sizeMB: +(text.length / 1048576).toFixed(2),
      logs: st.logs.filter((l) => l.text.includes('保存')).slice(-3).map((l) => l.text),
    };
  });
  console.log('  序列化：', diag.serializeMs + 'ms', diag.sizeMB + 'MB');
  console.log('  保存日志：', diag.logs.join(' | ').slice(0, 240));
  await p.locator('.nav-item', { hasText: '项目设置' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: '新建空项目' }).click();
  await p.waitForTimeout(400);
  await p.locator('.nav-item', { hasText: '世界书' }).first().click();
  await p.waitForTimeout(300);
}
console.log('错误：', errors.slice(0, 5));
await b.close();
