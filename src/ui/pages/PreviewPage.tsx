import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Empty, KeyValue, Labeled, Segmented, Toggle, useCopy } from '../common';
import { markdownToHtml } from '../../core/format';
import { testChainSafe } from '../../core/runtime';
import { estimateTokens } from '../../core/card';
import { downloadBlob } from '../../core/util';

type Device = 'desktop' | 'mobile' | 'narrow' | 'custom';

const DEVICES: Record<Exclude<Device, 'custom'>, { w: number; h: number; label: string }> = {
  desktop: { w: 900, h: 640, label: '桌面 900×640' },
  mobile: { w: 390, h: 720, label: '移动 390×720' },
  narrow: { w: 320, h: 640, label: '窄屏 320×640' },
};

interface RenderedMsg {
  role: 'assistant' | 'user' | 'system';
  raw: string;
  output: string;
  steps?: number;
  hasHtml: boolean;
}

export default function PreviewPage() {
  const { doc } = useStore();
  const card = doc.card;
  const [device, setDevice] = useState<Device>('desktop');
  const [customW, setCustomW] = useState(720);
  const [customH, setCustomH] = useState(600);
  const [greeting, setGreeting] = useState(0);
  const [applyRegex, setApplyRegex] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [showStatus, setShowStatus] = useState(true);
  const [userText, setUserText] = useState('（你把湿透的外套挂在门边）这里的通讯真的断了？');
  const [msgs, setMsgs] = useState<RenderedMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const copy = useCopy();

  const greetings = useMemo(() => [card?.data.first_mes || '', ...(card?.data.alternate_greetings || [])], [card?.data.first_mes, card?.data.alternate_greetings]);
  const w = device === 'custom' ? customW : DEVICES[device].w;
  const h = device === 'custom' ? customH : DEVICES[device].h;

  const scripts = useMemo(() => doc.regexes.flatMap((p) => p.scripts), [doc.regexes]);
  const activeMarkdown = scripts.filter((s) => !s.disabled && (s.placement || []).includes(1));

  useEffect(() => {
    if (!card) return;
    let alive = true;
    const run = async () => {
      setBusy(true);
      const rawAssistant = greetings[greeting] || '';
      const userMsg: RenderedMsg = { role: 'user', raw: userText, output: userText, hasHtml: /<[a-z][\s\S]*>/i.test(userText) };
      let assistant: RenderedMsg = { role: 'assistant', raw: rawAssistant, output: rawAssistant, hasHtml: /<[a-z][\s\S]*>/i.test(rawAssistant) };
      if (applyRegex && activeMarkdown.length) {
        const r = await testChainSafe(activeMarkdown, rawAssistant, { char: card.data.name || 'char', user: 'user', placement: 1, messageDepth: 0 }, 1500);
        if (alive && r && (r as any).final !== undefined) {
          const out = (r as any).final as string;
          assistant = { role: 'assistant', raw: rawAssistant, output: out, hasHtml: /<[a-z][\s\S]*>/i.test(out), steps: ((r as any).steps || []).length };
        }
      }
      if (alive) {
        setMsgs([assistant, userMsg]);
        setBusy(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [greeting, applyRegex, userText, card?.data.name, activeMarkdown.length, doc.regexes]);

  if (!card) {
    return (
      <div className="page">
        <div className="page-head"><h1>前端预览</h1></div>
        <Empty icon="▷" title="没有可预览的人物卡" desc="导入人物卡后，这里会模拟 SillyTavern 的聊天界面，并把正则替换结果、MVU 状态栏一起渲染出来。" />
      </div>
    );
  }

  const stat = doc.mvu?.statData || {};
  const statusEntries = Object.entries(stat).slice(0, 4);

  const exportHtml = () => {
    const body = msgs
      .map((m) => `<div class="msg ${m.role}"><div class="bubble"><div class="who">${m.role === 'user' ? 'User' : card.data.name}</div>${m.hasHtml ? m.output : markdownToHtml(m.output)}</div></div>`)
      .join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${card.data.name} · 预览</title>
<style>
body{background:#0f131a;color:#dbe3f0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;margin:0;padding:24px}
.wrap{max-width:${w}px;margin:0 auto}
.card{background:#151b24;border:1px solid #263140;border-radius:12px;overflow:hidden}
.head{display:flex;gap:12px;padding:14px;border-bottom:1px solid #263140;align-items:center}
.head img{width:48px;height:48px;border-radius:10px;object-fit:cover;background:#222c3a}
.name{font-weight:700;font-size:15px}.sub{font-size:11px;color:#8d9aad}
.chat{padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{display:flex}.msg.user{justify-content:flex-end}
.bubble{background:#1b2330;border:1px solid #2a3442;border-radius:10px;padding:9px 12px;max-width:80%;font-size:13px;line-height:1.7;white-space:pre-wrap}
.msg.user .bubble{background:#1d2a3f;border-color:#2f4360}
.who{font-size:10.5px;color:#8d9aad;margin-bottom:3px}
.status{margin:0 14px 14px;border:1px solid #2a3442;border-radius:10px;padding:10px;background:#131922}
.srow{display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0;color:#b9c4d4}
</style></head><body><div class="wrap"><div class="card"><div class="head">${card.image ? `<img src="${card.image.dataUrl}" alt="">` : ''}<div><div class="name">${card.data.name}</div><div class="sub">${(card.data.tags || []).slice(0, 4).join(' · ')}</div></div></div><div class="chat">${body}</div>
${showStatus ? `<div class="status">${statusEntries.map(([k, v]) => `<div class="srow"><span>${k}</span><span>${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v)}</span></div>`).join('')}</div>` : ''}
</div></div></body></html>`;
    downloadBlob(new Blob([html], { type: 'text/html' }), `${(card.data.name || 'card').replace(/[\\/:*?"<>|]/g, '_')}-preview.html`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>前端预览</h1>
        <span className="badge info">{(card.version || '').toUpperCase()}</span>
        <span className="sub">模拟渲染，不会执行人物卡中的脚本</span>
        <span className="spacer" />
        <button className="btn sm" onClick={exportHtml}>导出预览 HTML</button>
      </div>

      <div className="split">
        <div className="pane" style={{ maxWidth: 320 }}>
          <div className="pane-head"><span style={{ fontWeight: 600, color: 'var(--text)' }}>预览设置</span></div>
          <div className="pane-body pad">
            <Labeled label="设备尺寸">
              <Segmented
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'desktop', label: '桌面' },
                  { value: 'mobile', label: '移动' },
                  { value: 'narrow', label: '窄屏' },
                  { value: 'custom', label: '自定义' },
                ]}
              />
            </Labeled>
            {device === 'custom' ? (
              <div className="row" style={{ gap: 8 }}>
                <div className="grow">
                  <Labeled label="宽度"><input className="input mono" type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} /></Labeled>
                </div>
                <div className="grow">
                  <Labeled label="高度"><input className="input mono" type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} /></Labeled>
                </div>
              </div>
            ) : (
              <div className="faint mb10" style={{ fontSize: 11 }}>{DEVICES[device].label}</div>
            )}

            <Labeled label="开场白">
              <select className="select" value={greeting} onChange={(e) => setGreeting(Number(e.target.value))}>
                <option value={0}>主开场白 first_mes</option>
                {greetings.slice(1).map((_, i) => <option key={i} value={i + 1}>替代开场白 #{i + 1}</option>)}
              </select>
            </Labeled>

            <Labeled label="模拟用户输入">
              <textarea className="textarea" rows={3} value={userText} onChange={(e) => setUserText(e.target.value)} />
            </Labeled>

            <div className="col" style={{ gap: 6 }}>
              <Toggle checked={applyRegex} onChange={setApplyRegex} label={`应用正则（${activeMarkdown.length} 条 placement=1）`} />
              <Toggle checked={showRaw} onChange={setShowRaw} label="同时显示原文" />
              <Toggle checked={showStatus} onChange={setShowStatus} label="显示 MVU 状态栏" />
            </div>

            <div className="divider" />
            <div className="label">字符统计</div>
            <KeyValue k="开场白">{greetings[greeting]?.length || 0} 字符 ≈ {estimateTokens(greetings[greeting] || '')} tok</KeyValue>
            <KeyValue k="正则条数">{activeMarkdown.length}</KeyValue>
            <KeyValue k="变量字段">{Object.keys(stat).length}</KeyValue>

            <div className="divider" />
            <div className="faint" style={{ fontSize: 10.5, lineHeight: 1.7 }}>
              HTML 内容会被放进 <span className="code-inline">sandbox="allow-scripts"</span> 的 iframe（不含 allow-same-origin），无法访问编辑器页面与本地数据。
            </div>
          </div>
        </div>

        <div className="pane">
          <div className="pane-head">
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>预览</span>
            <span className="badge outline">{w}×{h}</span>
            {busy ? <span className="badge warn">渲染中…</span> : null}
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => copy(msgs.map((m) => `[${m.role}]\n${m.output}`).join('\n\n'), '预览文本')}>复制文本</button>
          </div>
          <div className="preview-stage">
            <div className="device" style={{ width: w, height: h }}>
              <div className="device-bar">
                <span className="badge ok" style={{ height: 14, fontSize: 9 }}>本地沙箱</span>
                <span>{(card.data.name || '')}</span>
                <span className="spacer" />
                <span>{msgs.length} 条消息</span>
              </div>
              <div className="device-body">
                <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  {card.image ? (
                    <img src={card.image.dataUrl} alt="avatar" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-3)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
                      {(card.data.name || '?').slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 700 }}>{card.data.name}{card.data.nickname ? <span className="faint" style={{ fontWeight: 400 }}>（{card.data.nickname}）</span> : null}</div>
                    <div className="faint" style={{ fontSize: 11 }}>{(card.data.tags || []).slice(0, 5).join(' · ') || card.data.creator}</div>
                  </div>
                </div>

                <div className="chat">
                  {msgs.map((m, i) => (
                    <div key={i}>
                      <div className={`msg ${m.role}`}>
                        <div className="bubble">
                          <div className="who">{m.role === 'user' ? 'User' : card.data.name}{m.steps ? ` · 经过 ${m.steps} 条正则` : ''}</div>
                          {m.hasHtml ? (
                            <Sandbox html={m.output} height={Math.min(360, Math.max(90, m.output.length / 2))} />
                          ) : (
                            <div dangerouslySetInnerHTML={{ __html: markdownToHtml(m.output) }} />
                          )}
                        </div>
                      </div>
                      {showRaw && m.output !== m.raw ? (
                        <details style={{ marginLeft: 38 }}>
                          <summary className="faint" style={{ fontSize: 10.5, cursor: 'pointer' }}>原始文本</summary>
                          <div className="code-pre" style={{ fontSize: 10.5, marginTop: 4 }}>{m.raw}</div>
                        </details>
                      ) : null}
                    </div>
                  ))}

                  {showStatus && Object.keys(stat).length ? (
                    <div className="panel" style={{ padding: 10 }}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>状态栏（MVU 变量）</span>
                        <span className="spacer" />
                        <span className="badge outline">{doc.mvu?.flavor || 'mvu'}</span>
                      </div>
                      {statusEntries.map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 6 }}>
                          <div className="faint" style={{ fontSize: 10.5 }}>{k}</div>
                          {typeof v === 'object' && v !== null ? (
                            Object.entries(v as any).map(([k2, v2]) => (
                              <div key={k2} style={{ marginBottom: 2 }}>
                                <div className="row" style={{ fontSize: 11.5, justifyContent: 'space-between' }}>
                                  <span className="faint">{k2}</span>
                                  <span className="ellipsis" style={{ maxWidth: 180, textAlign: 'right' }}>
                                    {Array.isArray(v2)
                                      ? `${v2.length} 项`
                                      : typeof v2 === 'object' && v2 !== null
                                      ? JSON.stringify(v2).slice(0, 30)
                                      : String(v2)}
                                  </span>
                                </div>
                                {typeof v2 === 'number' && v2 >= 0 && v2 <= 100 ? (
                                  <div className="progress" style={{ height: 4, marginTop: 3 }}>
                                    <i style={{ width: `${v2}%` }} />
                                  </div>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <div className="row" style={{ fontSize: 11.5 }}>
                              <span>{String(v)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Sandbox({ html, height }: { html: string; height: number }) {
  return (
    <iframe
      title="html-preview"
      sandbox="allow-scripts"
      srcDoc={`<style>body{margin:0;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:12.5px;line-height:1.7;color:#dbe3f0;background:transparent}</style>${html}`}
      style={{ width: '100%', height, border: 'none', background: 'transparent' }}
    />
  );
}
