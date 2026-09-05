import { useEffect, useState } from 'react';

export function SettingsModal({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose(): void;
  onSaved?(settings: AppSettings): void;
}) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (open) window.chatLite.settings.get().then(setS); }, [open]);
  if (!open || !s) return null;

  const set = (k: keyof AppSettings, v: any) => setS({ ...s, [k]: v });
  const updateSession = (index: number, patch: Partial<WhatsAppSession>) => {
    const next = [...s.whatsappSessions]; next[index] = { ...next[index], ...patch }; set('whatsappSessions', next);
  };
  const addSession = () => {
    const id = `wa-${Date.now().toString(36)}`;
    set('whatsappSessions', [...s.whatsappSessions, { id, name: `WhatsApp ${s.whatsappSessions.length + 1}`, enabled: true, partition: `persist:${id}` }]);
  };
  const removeSession = (index: number) => {
    if (s.whatsappSessions.length <= 1) return;
    set('whatsappSessions', s.whatsappSessions.filter((_, i) => i !== index));
  };
  const save = async () => {
    const next = await window.chatLite.settings.save(s); setS(next); onSaved?.(next); setSaved(true); setTimeout(() => setSaved(false), 1200);
  };

  return <div className="modal-backdrop"><div className="modal settings-v3">
    <div className="modal-head"><div><h2>完整设置</h2><small>WhatsApp + Signal + 实时双语翻译</small></div><button onClick={onClose}>×</button></div>

    <section className="settings-section">
      <h3>原 TranGPT 翻译接口兼容</h3>
      <label>接口地址<input value={s.translateBaseUrl} onChange={e => set('translateBaseUrl', e.target.value)} /></label>
      <label>Bearer Token<input type="password" value={s.translateToken} onChange={e => set('translateToken', e.target.value)} placeholder="填你自己的有效 Token" /></label>
      <div className="two"><label>模型<input value={s.translateModel} onChange={e => set('translateModel', e.target.value)} /></label><label>兼容版本<input value={s.translateClientVersion} onChange={e => set('translateClientVersion', e.target.value)} /></label></div>
      <div className="two"><label>默认源语言<input value={s.defaultSourceLanguage} onChange={e => set('defaultSourceLanguage', e.target.value)} /></label><label>默认目标语言<input value={s.defaultTargetLanguage} onChange={e => set('defaultTargetLanguage', e.target.value)} /></label></div>
    </section>

    <section className="settings-section">
      <h3>双语翻译</h3>
      <label className="toggle-row"><input type="checkbox" checked={s.autoTranslateIncoming} onChange={e => set('autoTranslateIncoming', e.target.checked)} /><span><b>默认接收实时翻译</b><small>新会话默认继承；可在每个聊天单独覆盖。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.autoTranslateOutgoing} onChange={e => set('autoTranslateOutgoing', e.target.checked)} /><span><b>默认发送智能翻译</b><small>Signal 输入框 Enter 可直接翻译后发送；WhatsApp 使用右侧智能输入区。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.autoTranslateHistory} onChange={e => set('autoTranslateHistory', e.target.checked)} /><span><b>自动翻译近期历史消息</b><small>首次进入 WhatsApp 会话时最多处理最近 6 条收到的文字。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.tripleSpaceTranslate} onChange={e => set('tripleSpaceTranslate', e.target.checked)} /><span><b>连续三次空格翻译</b><small>只翻译并替换输入框，不自动发送。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.efficiencyMode} onChange={e => set('efficiencyMode', e.target.checked)} /><span><b>效率模式</b><small>开启后 Enter 翻译并发送；关闭时 Enter 发送原文。Shift+Enter 始终换行。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.bilingualDisplay} onChange={e => set('bilingualDisplay', e.target.checked)} /><span><b>默认显示原文 + 译文</b><small>WhatsApp 注入译文，Signal 直接显示双语气泡。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.enableBackTranslation} onChange={e => set('enableBackTranslation', e.target.checked)} /><span><b>启用回译能力</b><small>保留与原版设置兼容，后续语音/高级输入也可复用。</small></span></label>
      <div className="two"><label>翻译文字颜色<input type="color" value={s.translationFontColor} onChange={e => set('translationFontColor', e.target.value)} /></label><label>翻译字号<input type="number" min="10" max="24" value={s.translationFontSize} onChange={e => set('translationFontSize', Number(e.target.value))} /></label></div>
      <label>默认发送模式<select value={s.bilingualSendMode} onChange={e => set('bilingualSendMode', e.target.value)}><option value="translated">仅发送译文</option><option value="both">原文 + 译文一起发送</option><option value="original">仅发送原文</option></select></label>
    </section>

    <section className="settings-section">
      <h3>WhatsApp</h3>
      <div className="two"><label>默认模式<select value={s.whatsappMode} onChange={e => set('whatsappMode', e.target.value)}><option value="aggregate">聚合会话</option><option value="pure">纯净模式</option></select></label><label>气泡译文<select value={s.inlineWhatsAppTranslation ? 'on' : 'off'} onChange={e => set('inlineWhatsAppTranslation', e.target.value === 'on')}><option value="on">显示</option><option value="off">不显示</option></select></label></div>
      <label className="toggle-row"><input type="checkbox" checked={s.whatsappCompatibilityMode} onChange={e => set('whatsappCompatibilityMode', e.target.checked)} /><span><b>WhatsApp 兼容模式</b><small>减少对 WhatsApp 页面 DOM 的注入；开启后气泡内译文会停用，但读取、翻译和智能发送仍保留。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.whatsappFastAutoRead} onChange={e => set('whatsappFastAutoRead', e.target.checked)} /><span><b>WhatsApp 快速自动已读</b><small>当前打开的聊天收到新消息时主动触发窗口读取状态。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.whatsappStableVersion} onChange={e => set('whatsappStableVersion', e.target.checked)} /><span><b>使用稳定 WhatsApp UA</b><small>固定浏览器标识，降低 Web 端升级造成的兼容波动。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.whatsappPreferPhoneId} onChange={e => set('whatsappPreferPhoneId', e.target.checked)} /><span><b>手机号优先作为会话 ID</b><small>页面能够识别手机号时优先使用手机号，否则回退到聊天名称。</small></span></label>
      <label className="toggle-row"><input type="checkbox" checked={s.whatsappRemarkDetails} onChange={e => set('whatsappRemarkDetails', e.target.checked)} /><span><b>显示 WhatsApp 备注详情</b><small>聚合会话列表显示 WhatsApp 侧栏可读到的备注/预览文本。</small></span></label>

      <div className="session-editor-head"><b>WhatsApp 账号/端口</b><button onClick={addSession}>＋ 新增账号</button></div>
      <div className="session-editor">{s.whatsappSessions.map((session, index) => <div className="session-row" key={session.id}>
        <input type="checkbox" checked={session.enabled} onChange={e => updateSession(index, { enabled: e.target.checked })} />
        <input value={session.name} onChange={e => updateSession(index, { name: e.target.value })} />
        <code>{session.partition}</code>
        <button onClick={() => removeSession(index)} disabled={s.whatsappSessions.length <= 1}>删除</button>
      </div>)}</div>
    </section>

    <section className="settings-section">
      <h3>Signal</h3>
      <label className="toggle-row"><input type="checkbox" checked={s.signalEnabled} onChange={e => set('signalEnabled', e.target.checked)} /><span><b>启用 Signal 支持</b><small>关闭后将停止托管的 Signal 服务并释放资源。</small></span></label>
      <p className="muted">Signal 组件随应用托管，账号独立运行，无需配置地址或端口。</p>
      <p className="muted">账号在 Signal 页面新增、绑定与自动识别。每个账号保留独立消息记录。</p>
      {s.signalSessions.map(a => <div key={a.id} className="session-row"><input type="checkbox" checked={a.enabled} onChange={e => set('signalSessions', s.signalSessions.map(x => x.id === a.id ? { ...x, enabled: e.target.checked } : x))} /><input value={a.name} onChange={e => set('signalSessions', s.signalSessions.map(x => x.id === a.id ? { ...x, name: e.target.value } : x))} /><code>{a.account || '待绑定'}</code></div>)}
      <div className="two"><label>Signal 发送气泡颜色<input type="color" value={s.signalBubbleColor} onChange={e => set('signalBubbleColor', e.target.value)} /></label><label>Signal 文字颜色<input type="color" value={s.signalTextColor} onChange={e => set('signalTextColor', e.target.value)} /></label></div>
    </section>

    <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={save}>{saved ? '已保存' : '保存设置'}</button></div>
  </div></div>;
}
