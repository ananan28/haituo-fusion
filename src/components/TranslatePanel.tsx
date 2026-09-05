import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveConversation } from '../types';

type Props = {
  service: 'whatsapp' | 'signal' | 'telegram';
  conversation: ActiveConversation | null;
  sourceText: string;
  setSourceText(v: string): void;
  translatedText: string;
  setTranslatedText(v: string): void;
  onWrite?(text: string, send: boolean): Promise<void>;
  onBilingualWrite?(sourceText: string, translatedText: string, send: boolean, mode: 'translated' | 'both' | 'original'): Promise<void>;
  settingsRevision?: number;
};

const languages = [
  ['auto', '自动检测'], ['zh', '简体中文'], ['en', 'English'], ['yue', '粤语'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
  ['pt', 'Português'], ['ru', 'Русский'], ['ja', '日本語'], ['ko', '한국어'],
  ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['hi', 'हिन्दी'],
  ['km', 'ភាសាខ្មែរ'], ['tr', 'Türkçe'], ['ar', 'العربية']
];

export function TranslatePanel({
  service,
  conversation,
  sourceText,
  setSourceText,
  translatedText,
  setTranslatedText,
  onWrite,
  onBilingualWrite,
  settingsRevision = 0
}: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pref, setPref] = useState<ConversationPreference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [src, setSrc] = useState('auto');
  const [target, setTarget] = useState('en');
  const [live, setLive] = useState(false);
  const liveSeq = useRef(0);
  const activeIdentity = useRef(''); activeIdentity.current = `${service}:${conversation?.id || ''}`;
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  useEffect(() => { liveSeq.current++; setBusy(false); setError(''); }, [service, conversation?.id, sourceText, src, target]);

  useEffect(() => {
    let disposed = false;
    window.chatLite.settings.get().then(s => {
      if (disposed) return;
      setSettings(s);
      if (!conversation) { setSrc(s.defaultSourceLanguage); setTarget(s.defaultTargetLanguage); }
    });
    return () => { disposed = true; };
  }, [settingsRevision, conversation]);

  useEffect(() => {
    if (!conversation) { setPref(null); return; }
    let disposed = false;
    window.chatLite.prefs.get(service, conversation.id, conversation.title).then(p => {
      if (!disposed) { setPref(p); setSrc(p.sourceLanguage); setTarget(p.targetLanguage); }
    });
    return () => { disposed = true; };
  }, [conversation?.id, conversation?.title, service, settingsRevision]);

  const model = pref?.translateModel || settings?.translateModel || 'trangpt';

  const translate = async (text = sourceText, quiet = false) => {
    if (!text.trim()) return '';
    const seq = ++liveSeq.current;
    if (!quiet) { setBusy(true); setError(''); }
    try {
      const out = await window.chatLite.translation.translate({
        text,
        srcLang: src,
        targetLang: target,
        model,
        service,
        conversationId: conversation?.id,
        conversationTitle: conversation?.title,
        sessionId: conversation?.sessionId,
        direction: conversation ? 'out' : 'manual'
      });
      if (seq === liveSeq.current) setTranslatedText(out.translatedText);
      return out.translatedText;
    } catch (e: any) {
      if (seq === liveSeq.current) setError(e?.message || String(e));
      return '';
    } finally { if (!quiet && seq === liveSeq.current) setBusy(false); }
  };

  useEffect(() => {
    if (!live || !sourceText.trim()) return;
    const timer = window.setTimeout(async () => {
      await translate(sourceText, true);
    }, 700);
    return () => { window.clearTimeout(timer); liveSeq.current++; };
  }, [sourceText, live, src, target, model]);

  const savePref = async (patch: Partial<ConversationPreference>) => {
    if (!conversation) return;
    const identity = activeIdentity.current;
    const next = await window.chatLite.prefs.save(service, conversation.id, { title: conversation.title, ...patch });
    if (identity === activeIdentity.current) { setPref(next); setSrc(next.sourceLanguage); setTarget(next.targetLanguage); }
  };

  const swap = () => {
    if (src === 'auto') { setSrc(target); setTarget(settings?.defaultSourceLanguage === 'auto' ? 'zh' : settings?.defaultSourceLanguage || 'zh'); }
    else { const a = src; setSrc(target); setTarget(a); }
    setSourceText(translatedText); setTranslatedText(sourceText);
  };

  const write = async (send: boolean) => {
    if (!conversation || sendLock.current) return;
    sendLock.current = true; setSending(true); setError('');
    try {
      const mode = pref?.bilingualSendMode || settings?.bilingualSendMode || 'translated';
      if (onBilingualWrite) await onBilingualWrite(sourceText, translatedText, send, mode);
      else if (onWrite) await onWrite(translatedText, send);
    } catch (e: any) { setError(e.message || '操作未完成'); }
    finally { sendLock.current = false; setSending(false); }
  };

  const sendMode = pref?.bilingualSendMode || settings?.bilingualSendMode || 'translated';
  const displayName = useMemo(() => conversation ? conversation.title : '未选择会话', [conversation]);

  return <aside className="translate-panel v3">
    <div className="panel-title">
      <div><strong>实时双语翻译</strong><small>{displayName}</small></div>
      <div className="panel-chips">
        {pref?.translateReceived && <span className="chip auto-chip">收译</span>}
        {pref?.translateSent && <span className="chip auto-chip">发译</span>}
        <span className="chip">{service === 'whatsapp' ? 'WhatsApp' : service === 'signal' ? 'Signal' : 'Telegram'}</span>
      </div>
    </div>

    <div className="language-row">
      <select value={src} onChange={e => { setSrc(e.target.value); void savePref({ sourceLanguage: e.target.value }); }}>
        {languages.map(([v, n]) => <option value={v} key={v}>{n}</option>)}
      </select>
      <button className="swap-btn" onClick={swap}>⇄</button>
      <select value={target} onChange={e => { setTarget(e.target.value); void savePref({ targetLanguage: e.target.value }); }}>
        {languages.filter(([v]) => v !== 'auto').map(([v, n]) => <option value={v} key={v}>{n}</option>)}
      </select>
    </div>

    <div className="conversation-flags">
      <label><input type="checkbox" checked={pref?.translateReceived ?? settings?.autoTranslateIncoming ?? false} disabled={!conversation} onChange={e => savePref({ translateReceived: e.target.checked })} />接收实时翻译</label>
      <label><input type="checkbox" checked={pref?.translateSent ?? settings?.autoTranslateOutgoing ?? false} disabled={!conversation} onChange={e => savePref({ translateSent: e.target.checked })} />发送智能翻译</label>
      {conversation?.kind === 'group' && <label><input type="checkbox" checked={pref?.translateGroup ?? true} onChange={e => savePref({ translateGroup: e.target.checked })} />群组翻译</label>}
      <label><input type="checkbox" checked={pref?.bilingualDisplay ?? settings?.bilingualDisplay ?? true} disabled={!conversation} onChange={e => savePref({ bilingualDisplay: e.target.checked })} />气泡双语</label>
      <label><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />编辑区实时</label>
    </div>

    <label>原文 / 我的输入</label>
    <textarea className="source-box" value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="收到的新消息会自动进入这里，也可以直接输入你的语言…" />

    <div className="translation-actions-row">
      <button className="primary" onClick={() => translate()} disabled={busy || !sourceText.trim()}>{busy ? '翻译中…' : '翻译'}</button>
      <select className="send-mode" value={sendMode} disabled={!conversation} onChange={e => savePref({ bilingualSendMode: e.target.value as any })}>
        <option value="translated">发送译文</option><option value="both">发送双语</option><option value="original">发送原文</option>
      </select>
    </div>

    <label>译文</label>
    <textarea className="result-box" value={translatedText} onChange={e => setTranslatedText(e.target.value)} placeholder="实时译文会显示在这里，并同步保存在历史记录中" />

    {error && <div className="error">{error}</div>}

    <div className="button-grid">
      <button onClick={() => navigator.clipboard.writeText(translatedText)} disabled={!translatedText}>复制译文</button>
      <button onClick={() => void write(false)} disabled={sending || !conversation || !translatedText || (!onWrite && !onBilingualWrite)}>写入输入框</button>
      <button className="send" onClick={() => void write(true)} disabled={sending || !conversation || !translatedText || (!onWrite && !onBilingualWrite)}>按当前双语模式发送</button>
    </div>

    <div className="chat-pref-card">
      <div><span>模型</span><b>{model}</b></div>
      <div><span>会话语言</span><b>{src} → {target}</b></div>
      <div><span>发送模式</span><b>{sendMode === 'translated' ? '译文' : sendMode === 'both' ? '双语' : '原文'}</b></div>
    </div>

    <div className="api-note">翻译接口：{settings?.translateBaseUrl || '读取中…'}<br />接口版本：{settings?.translateClientVersion || '3.1.174'} · 历史自动保存</div>
  </aside>;
}
