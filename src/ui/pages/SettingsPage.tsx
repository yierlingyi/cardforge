import { useEffect, useState } from 'react';
import { useStore, serializeDoc } from '../../store/store';
import { Labeled, TextInput, Toggle, useCopy } from '../common';
import { idbClear, idbGet, idbKeys, storageKeys } from '../../core/idb';
import { downloadBlob, formatJson, humanSize } from '../../core/util';
import type { ProjectMeta } from '../../core/types';

export default function SettingsPage() {
  const { doc, settings, setSettings, mutate, saveNow, toast, loadSample, newProject, createBlankProject, openProject } = useStore();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const copy = useCopy();

  useEffect(() => {
    idbGet<ProjectMeta[]>(storageKeys.projectIndex).then((p) => setProjects(p || []));
    idbKeys().then(setKeys);
  }, [doc.meta.id]);

  const projectSize = (() => {
    try {
      return new TextEncoder().encode(serializeDoc(doc)).length;
    } catch {
      return 0;
    }
  })();

  const exportBackup = () => {
    const payload = {
      format: 'cardforge-project-backup',
      version: 1,
      exportedAt: Date.now(),
      project: JSON.parse(serializeDoc(doc)),
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `cardforge-backup-${doc.meta.id.slice(0, 8)}.json`);
    toast('success', '已导出项目备份（JSON）');
  };

  const clearAll = async () => {
    if (!confirm('将清空本浏览器中保存的所有 CardForge 项目与设置，且不可恢复。确定继续？')) return;
    await idbClear();
    setProjects([]);
    setKeys([]);
    toast('info', '本地数据已清空。刷新页面将从示例项目重新开始。');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>项目设置</h1>
        <span className="sub">{doc.meta.id}</span>
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => saveNow()}>立即保存</button>
      </div>

      <div className="scroll" style={{ flex: 1 }}>
        <div className="pane-body pad" style={{ maxWidth: 1000 }}>
          <div className="card">
            <div className="card-head">项目</div>
            <div className="card-body">
              <Labeled label="项目名称" hint="仅影响编辑器内的显示，不会写入人物卡字段">
                <TextInput value={doc.meta.name} onChange={(v) => mutate('重命名项目', (d) => { d.meta.name = v; }, { coalesce: 'meta:name' })} />
              </Labeled>
              <div className="row wrap" style={{ gap: 16 }}>
                <div className="faint" style={{ fontSize: 11.5 }}>创建：{new Date(doc.meta.createdAt).toLocaleString('zh-CN')}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>更新：{new Date(doc.meta.updatedAt).toLocaleString('zh-CN')}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>估算大小：{humanSize(projectSize)}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>来源：{doc.meta.sourceFileName || '本地新建'}</div>
              </div>
              <div className="row wrap mt10" style={{ gap: 6 }}>
                <button className="btn sm" onClick={exportBackup}>导出项目备份</button>
                <button className="btn sm" onClick={() => copy(serializeDoc(doc), '项目 JSON')}>复制项目 JSON</button>
                <button className="btn sm" onClick={() => { if (confirm('新建空项目？当前项目仍保存在本地，可从「最近项目」打开。')) newProject('新项目'); }}>新建空项目</button>
                <button className="btn sm" onClick={() => createBlankProject()}>新建空白人物卡</button>
                <button className="btn sm" onClick={() => loadSample()}>重新载入示例</button>
              </div>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">编辑器</div>
            <div className="card-body">
              <div className="row wrap" style={{ gap: 24 }}>
                <div>
                  <div className="label mb6">主题</div>
                  <div className="btn-group">
                    <button className={`btn sm ${settings.theme === 'dark' ? 'active' : ''}`} onClick={() => setSettings({ theme: 'dark' })}>深色</button>
                    <button className={`btn sm ${settings.theme === 'light' ? 'active' : ''}`} onClick={() => setSettings({ theme: 'light' })}>浅色</button>
                  </div>
                </div>
                <div>
                  <div className="label mb6">字号</div>
                  <div className="btn-group">
                    {[12, 13, 14, 15].map((n) => (
                      <button key={n} className={`btn sm ${settings.fontSize === n ? 'active' : ''}`} onClick={() => setSettings({ fontSize: n })}>{n}px</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label mb6">自动保存</div>
                  <Toggle checked={settings.autosave} onChange={(v) => setSettings({ autosave: v })} label={settings.autosave ? '开启' : '关闭'} />
                </div>
                <div style={{ width: 160 }}>
                  <Labeled label="防抖间隔（ms）">
                    <input className="input mono" type="number" value={settings.autosaveMs} onChange={(e) => setSettings({ autosaveMs: Math.max(300, Number(e.target.value)) })} />
                  </Labeled>
                </div>
              </div>

              <div className="row wrap mt10" style={{ gap: 20 }}>
                <Toggle checked={settings.wordWrap} onChange={(v) => setSettings({ wordWrap: v })} label="代码自动换行" />
                <Toggle checked={settings.showLineNumbers} onChange={(v) => setSettings({ showLineNumbers: v })} label="显示行号" />
                <Toggle checked={settings.confirmDelete} onChange={(v) => setSettings({ confirmDelete: v })} label="删除前确认" />
              </div>
              <div className="faint mt10" style={{ fontSize: 11 }}>
                说明：世界书条目正文使用原生 textarea，不受「代码自动换行」影响；该开关作用于 CodeMirror 编辑器。
              </div>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">模拟与安全</div>
            <div className="card-body">
              <div className="row wrap" style={{ gap: 20 }}>
                <Toggle checked={settings.simRecursion} onChange={(v) => setSettings({ simRecursion: v })} label="世界书模拟默认启用递归" />
                <Toggle checked={settings.simRollProbability} onChange={(v) => setSettings({ simRollProbability: v })} label="默认执行概率判定" />
                <div style={{ width: 170 }}>
                  <Labeled label="随机种子">
                    <input className="input mono" type="number" value={settings.simSeed} onChange={(e) => setSettings({ simSeed: Number(e.target.value) })} />
                  </Labeled>
                </div>
                <div style={{ width: 180 }}>
                  <Labeled label="正则测试超时（ms）">
                    <input className="input mono" type="number" value={settings.regexTimeoutMs} onChange={(e) => setSettings({ regexTimeoutMs: Math.max(50, Number(e.target.value)) })} />
                  </Labeled>
                </div>
              </div>
              <div className="faint mt10" style={{ fontSize: 11, lineHeight: 1.7 }}>
                正则测试在独立 Worker 中执行，超过阈值会被 terminate；概率模拟使用可复现的本地伪随机数。这些都不是 SillyTavern 运行时的真实随机源。
              </div>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">本地存储（IndexedDB）</div>
            <div className="card-body">
              <div className="row" style={{ gap: 10 }}>
                <span className="badge outline">{keys.length} 个键</span>
                <span className="badge outline">{projects.length} 个项目</span>
                <span className="badge outline">当前项目 {humanSize(projectSize)}</span>
              </div>
              <div className="mt10">
                {projects.length === 0 ? <div className="faint" style={{ fontSize: 11.5 }}>暂无保存的项目。</div> : null}
                {projects.slice(0, 10).map((p) => (
                  <div key={p.id} className={`list-row ${p.id === doc.meta.id ? 'active' : ''}`} onClick={() => openProject(p.id)}>
                    <span className="grow ellipsis">{p.name}</span>
                    <span className="meta mono">{p.id.slice(0, 8)}</span>
                    <span className="meta">{new Date(p.updatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                ))}
              </div>
              <div className="row mt10">
                <button className="btn sm danger" onClick={clearAll}>清空本地数据</button>
                <span className="faint" style={{ fontSize: 11 }}>会删除所有已保存项目与设置，请在操作前导出备份。</span>
              </div>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">快捷键</div>
            <div className="card-body">
              <table className="table">
                <tbody>
                  {[
                    ['Ctrl + S', '立即保存'],
                    ['Ctrl + Z', '撤销（代码编辑器内为编辑器自身撤销）'],
                    ['Ctrl + Shift + Z', '重做'],
                    ['Ctrl + K', '全局搜索'],
                    ['Ctrl + O', '导入'],
                    ['Ctrl + E', '导出'],
                    ['Ctrl + B', '折叠 / 展开侧栏'],
                    ['Esc', '关闭弹窗'],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ width: 180 }}><span className="kbd">{k}</span></td>
                      <td className="faint">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mt16">
            <div className="card-head">关于 / 能力边界</div>
            <div className="card-body faint" style={{ fontSize: 11.5, lineHeight: 1.9 }}>
              <div><b>CardForge 1.0</b> · 本地运行、离线优先，不发起任何网络请求。</div>
              <div>· <b>已实现</b>：Character Card V1/V2/V3 解析与序列化、PNG tEXt/zTXt/iTXt 元数据读写、世界书完整字段编辑与触发模拟、正则隔离测试、脚本静态检查、MVU 多版本识别与变量管理、JSON Patch 模拟、导入导出与无损往返验证。</div>
              <div>· <b>近似实现</b>：包含组竞争权重、递归扫描轮次、token 预算截断、触发概率随机源。</div>
              <div>· <b>明确不实现</b>：CHARX ZIP 解包（会提示取 card.json）、向量化语义召回、MVU 运行时真实执行、任意脚本/HTML 在编辑器内执行。</div>
              <div>· <b>数据安全</b>：不会上传人物卡内容；不执行导入的 JavaScript；HTML 预览使用 sandbox iframe；正则测试有超时兜底；所有编辑可撤销。</div>
            </div>
          </div>

          <div style={{ height: 30 }} />
        </div>
      </div>
    </div>
  );
}
