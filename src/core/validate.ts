import type {
  MvuState,
  NormalizedCard,
  NormalizedWorldbook,
  RegexPreset,
  ScriptCollection,
  ValidationIssue,
} from './types';
import { WI_POSITION_LABELS, WI_ROLE_LABELS } from './types';
import { detectRegexRisk, parseFindRegex } from './regex';
import { checkSyntax } from './scripts';
import { checkDataAgainstSchema } from './mvu';
import { deadEntries, keyConflicts, uidConflicts, worldbookStats } from './worldbook';
import { isPlainObject } from './util';

export interface ValidateOptions {
  card: NormalizedCard | null;
  worldbooks: NormalizedWorldbook[];
  regexes: RegexPreset[];
  scripts: ScriptCollection[];
  mvu: MvuState | null;
}

export function validateAll(opt: ValidateOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);

  /* ------------------------------------------------------------- 人物卡 */
  if (opt.card) {
    const d = opt.card.data;
    if (!d.name || !String(d.name).trim()) add({ level: 'error', scope: 'card', path: '/name', message: '角色名称 name 为空（V2/V3 规范要求必填）' });
    if (!d.first_mes || !String(d.first_mes).trim()) add({ level: 'warning', scope: 'card', path: '/first_mes', message: '开场白 first_mes 为空' });
    if (!d.description || !String(d.description).trim()) add({ level: 'warning', scope: 'card', path: '/description', message: '角色描述 description 为空' });

    for (const [k, v] of Object.entries(d)) {
      if (k === 'name' || k === 'description' || k === 'personality' || k === 'scenario' || k === 'first_mes' || k === 'mes_example' || k === 'creator_notes' || k === 'system_prompt' || k === 'post_history_instructions') {
        if (v !== undefined && v !== null && typeof v !== 'string') {
          add({ level: 'error', scope: 'card', path: `/${k}`, message: `字段 ${k} 应为字符串，实际为 ${typeof v}` });
        }
      }
    }
    if (d.alternate_greetings !== undefined && !Array.isArray(d.alternate_greetings)) {
      add({ level: 'error', scope: 'card', path: '/alternate_greetings', message: 'alternate_greetings 必须是字符串数组' });
    } else if (Array.isArray(d.alternate_greetings)) {
      d.alternate_greetings.forEach((g: any, i: number) => {
        if (typeof g !== 'string') add({ level: 'error', scope: 'card', path: `/alternate_greetings/${i}`, message: '替代开场白必须为字符串' });
        else if (!g.trim()) add({ level: 'info', scope: 'card', path: `/alternate_greetings/${i}`, message: '存在空的替代开场白' });
      });
    }
    if (d.tags !== undefined && !Array.isArray(d.tags)) add({ level: 'error', scope: 'card', path: '/tags', message: 'tags 必须是字符串数组' });
    if (d.extensions !== undefined && !isPlainObject(d.extensions)) add({ level: 'error', scope: 'card', path: '/extensions', message: 'extensions 必须是对象' });

    const dp = d.depth_prompt;
    if (dp !== undefined && dp !== null) {
      if (!isPlainObject(dp)) add({ level: 'warning', scope: 'card', path: '/depth_prompt', message: 'depth_prompt 结构异常，通常应为 { prompt, depth, role }' });
      else {
        if (dp.depth !== undefined && typeof dp.depth !== 'number') add({ level: 'warning', scope: 'card', path: '/depth_prompt/depth', message: 'depth_prompt.depth 应为数字' });
        if (dp.role !== undefined && ![0, 1, 2].includes(dp.role)) add({ level: 'warning', scope: 'card', path: '/depth_prompt/role', message: 'depth_prompt.role 通常为 0(system)/1(user)/2(assistant)' });
      }
    }

    if (d.character_book !== undefined && d.character_book !== null) {
      if (!isPlainObject(d.character_book)) add({ level: 'error', scope: 'card', path: '/character_book', message: 'character_book 必须是对象' });
      else if (d.character_book.entries !== undefined && !Array.isArray(d.character_book.entries)) {
        add({ level: 'warning', scope: 'card', path: '/character_book/entries', message: '内嵌世界书的 entries 在 V2/V3 规范中应为数组' });
      }
    }

    if (opt.card.version === 'v1') {
      add({ level: 'info', scope: 'card', path: '', message: '当前卡片按 V1 平面结构解析；如需世界书/扩展字段建议导出为 V2 或 V3。' });
    }

    if (opt.card.image) {
      const chunks = opt.card.image.metaChunks;
      if (!chunks.length) add({ level: 'warning', scope: 'image', path: '', message: 'PNG 中未找到人物卡元数据块' });
      const chara = chunks.find((c) => c.keyword === 'chara');
      const ccv3 = chunks.find((c) => c.keyword === 'ccv3');
      if (chara && ccv3 && chara.json && ccv3.json) {
        try {
          const a = JSON.parse(chara.json);
          const b = JSON.parse(ccv3.json);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            add({
              level: 'warning',
              scope: 'image',
              path: '',
              message: 'PNG 同时包含 chara 与 ccv3 元数据块且内容不一致（常见于手工改卡）。本工具读取时以规范版本较高者为准，重新导出会统一两者。',
            });
          }
        } catch {
          add({ level: 'warning', scope: 'image', path: '', message: 'PNG 元数据块内容无法解析为 JSON' });
        }
      }
      if (chara && !chara.spec) {
        add({ level: 'info', scope: 'image', path: '', message: 'chara 块为 V1 平面格式（无 spec 字段）' });
      }
    }
  }

  /* ------------------------------------------------------------- 世界书 */
  for (const wb of opt.worldbooks) {
    const tag = wb.origin === 'card' ? '内嵌' : '独立';
    if (!wb.entries.length) add({ level: 'info', scope: 'worldbook', path: wb.name, message: `${tag}世界书「${wb.name}」为空` });

    for (const [uid, list] of uidConflicts(wb.entries)) {
      add({
        level: 'error',
        scope: 'worldbook',
        path: `${wb.name} #${uid}`,
        message: `UID ${uid} 重复出现 ${list.length} 次（导出为以 uid 为键的对象时会互相覆盖）`,
        hint: '在「世界书」页面使用「修复 UID」批量重排。',
      });
    }

    const stats = worldbookStats(wb.entries);
    if (stats.dead > 0) {
      const dead = deadEntries(wb.entries);
      add({
        level: 'warning',
        scope: 'worldbook',
        path: wb.name,
        message: `${stats.dead} 个条目既非常驻也无关键词，永远不会被触发（示例 UID：${dead.slice(0, 8).map((e) => e.uid).join(', ')}）`,
      });
    }
    if (stats.duplicateKeys > 0) {
      const conf = keyConflicts(wb.entries).filter((c) => c.kind === 'across').slice(0, 6);
      add({
        level: 'info',
        scope: 'worldbook',
        path: wb.name,
        message: `${stats.duplicateKeys} 个关键词被多个条目共用（例：${conf.map((c) => `「${c.key}」→${c.entries.join('/')}`).join('，')}）`,
        hint: '共用关键词不一定是错误，但会导致同时触发；可用包含组或次关键词区分。',
      });
    }

    for (const e of wb.entries) {
      const p = `${wb.name} #${e.uid}`;
      if (typeof e.uid !== 'number' || !Number.isInteger(e.uid) || e.uid < 0) {
        add({ level: 'error', scope: 'worldbook', path: p, message: 'uid 必须是非负整数' });
      }
      if (!Array.isArray(e.key)) add({ level: 'error', scope: 'worldbook', path: p, message: 'key 必须是字符串数组' });
      if (e.position !== undefined && !(e.position in WI_POSITION_LABELS)) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: `未知插入位置 position=${e.position}` });
      }
      if (e.role !== undefined && !(e.role in WI_ROLE_LABELS)) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: `未知插入角色 role=${e.role}` });
      }
      if (typeof e.probability === 'number' && (e.probability < 0 || e.probability > 100)) {
        add({ level: 'error', scope: 'worldbook', path: p, message: `probability 应在 0-100 之间，当前 ${e.probability}` });
      }
      if (typeof e.selectiveLogic === 'number' && ![0, 1, 2, 3].includes(e.selectiveLogic)) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: `未知 selectiveLogic=${e.selectiveLogic}` });
      }
      if (typeof e.depth === 'number' && (e.depth < 0 || e.depth > 10000)) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: `depth 数值异常：${e.depth}` });
      }
      if (e.position === 4 && typeof e.depth !== 'number') {
        add({ level: 'warning', scope: 'worldbook', path: p, message: 'position 为「按深度插入」但 depth 不是数字' });
      }
      if (!e.content?.trim() && (e.key?.length || e.constant)) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: '条目会被触发但正文为空（会注入空内容）' });
      }
      if (!e.constant && e.key?.length && e.key.every((k) => !String(k).trim())) {
        add({ level: 'warning', scope: 'worldbook', path: p, message: 'key 数组中存在空关键词' });
      }
      const contentLen = (e.content || '').length;
      if (contentLen > 20000) {
        add({ level: 'info', scope: 'worldbook', path: p, message: `条目正文长度 ${contentLen} 字符，可能占用大量上下文` });
      }
    }
  }

  /* --------------------------------------------------------------- 正则 */
  for (const preset of opt.regexes) {
    const ids = new Set<string>();
    for (const s of preset.scripts) {
      const p = `${preset.name} / ${s.scriptName}`;
      if (ids.has(s.id)) add({ level: 'error', scope: 'regex', path: p, message: `规则 id 重复：${s.id}` });
      ids.add(s.id);
      if (!s.findRegex?.trim()) {
        add({ level: 'error', scope: 'regex', path: p, message: 'findRegex 为空' });
        continue;
      }
      const parsed = parseFindRegex(s.findRegex);
      if (!parsed.ok) add({ level: 'warning', scope: 'regex', path: p, message: parsed.error || '正则格式不标准' });
      try {
        new RegExp(parsed.pattern, parsed.flags.includes('g') ? parsed.flags : parsed.flags + 'g');
      } catch (e: any) {
        add({ level: 'error', scope: 'regex', path: p, message: `正则编译失败：${e.message}` });
        continue;
      }
      const risk = detectRegexRisk(parsed.pattern);
      if (risk.level === 'high') add({ level: 'warning', scope: 'regex', path: p, message: `灾难性回溯风险：${risk.reason}` });
      else if (risk.level === 'medium') add({ level: 'info', scope: 'regex', path: p, message: `性能提示：${risk.reason}` });

      if (!Array.isArray(s.placement) || !s.placement.length) {
        add({ level: 'warning', scope: 'regex', path: p, message: '未设置 placement，规则可能不会在任何位置生效' });
      }
      if (s.markdownOnly && s.promptOnly) {
        add({ level: 'error', scope: 'regex', path: p, message: 'markdownOnly 与 promptOnly 同时为 true：SillyTavern 会把该规则视为无效配置' });
      }
      if (typeof s.minDepth === 'number' && typeof s.maxDepth === 'number' && s.maxDepth >= 0 && s.minDepth > s.maxDepth) {
        add({ level: 'error', scope: 'regex', path: p, message: `minDepth(${s.minDepth}) 大于 maxDepth(${s.maxDepth})，规则永远不会生效` });
      }
      if (s.substituteRegex !== undefined && ![0, 1, 2].includes(s.substituteRegex)) {
        add({ level: 'warning', scope: 'regex', path: p, message: `substituteRegex 取值异常：${s.substituteRegex}（常见为 0/1/2）` });
      }
    }
  }

  /* --------------------------------------------------------------- 脚本 */
  for (const col of opt.scripts) {
    const ids = new Set<string>();
    for (const s of col.scripts) {
      const p = `${col.origin === 'character' ? '卡片脚本' : '脚本集'} / ${s.name}`;
      if (ids.has(s.id)) add({ level: 'error', scope: 'scripts', path: p, message: `脚本 id 重复：${s.id}` });
      ids.add(s.id);
      const syn = checkSyntax(s.content || '');
      if (!syn.ok) add({ level: 'error', scope: 'scripts', path: p, message: `语法错误：${syn.error}`, hint: '语法检查使用 new Function 编译，不会执行代码。' });
      if (/\beval\s*\(|new\s+Function\s*\(/.test(s.content || '')) {
        add({ level: 'warning', scope: 'scripts', path: p, message: '脚本使用 eval / new Function 动态执行代码，编辑器无法做静态安全分析' });
      }
      if (/\bfetch\s*\(/.test(s.content || '')) add({ level: 'info', scope: 'scripts', path: p, message: '脚本包含 fetch 网络请求' });
      if (!s.content?.trim()) add({ level: 'warning', scope: 'scripts', path: p, message: '脚本内容为空' });
    }
  }

  /* ----------------------------------------------------------------- MVU */
  if (opt.mvu) {
    const m = opt.mvu;
    if (m.statSource === 'empty') {
      add({ level: 'info', scope: 'mvu', path: '', message: '未找到变量初始化数据（可在 MVU 页面手动导入变量快照）' });
    }
    if (m.flavor === 'unknown') {
      add({ level: 'info', scope: 'mvu', path: '', message: '未识别到 MVU 相关特征，MVU 功能以只读/手动导入模式提供' });
    }
    if (m.schemaFields.length && m.statSource === 'worldbook') {
      for (const issue of checkDataAgainstSchema(m.statData, m.schemaFields)) {
        add({
          level: issue.level === 'error' ? 'error' : 'warning',
          scope: 'mvu',
          path: issue.path,
          message: issue.message,
          hint: 'Schema 为静态推断结果，最终以运行时 Zod 校验为准。',
        });
      }
    }
    if (m.schemaNote?.includes('无法静态')) {
      add({ level: 'info', scope: 'mvu', path: '', message: m.schemaNote });
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

export function summarizeIssues(issues: ValidationIssue[]) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
