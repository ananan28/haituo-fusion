import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ActiveConversation, ComposerActions } from '../types';
export type Conversation = SignalConversation;
type Props = { sessionId: string; externalSelection?: { id: string; nonce: number }; onCatalog(id: string, items: Conversation[]): void; onAccountChanged(): void; onSource(text: string): void; onTranslated(text: string): void; onComposerReady(actions: ComposerActions): void; onConversationChange(info: ActiveConversation | null): void; settingsRevision?: number };
type ChatWebview = HTMLElement & { getWebContentsId(): number };
const Webview = 'webview' as any;
export function SignalView(props: Props) {
  const { sessionId, externalSelection, settingsRevision = 0, onCatalog, onConversationChange, onComposerReady } = props;
  const callbacks = useRef(props); callbacks.current = props;
  const [status, setStatus] = useState<SignalStatus>({ sessionId, phase: 'starting' });
  const [catalog, setCatalog] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState(''); const selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const [query, setQuery] = useState(''); const [recipient, setRecipient] = useState(''); const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); const [syncing, setSyncing] = useState(false); const [error, setError] = useState('');
  const [inputSettings, setInputSettings] = useState<AppSettings | null>(null);
  const [url, setUrl] = useState(''); const [surfaceReady, setSurfaceReady] = useState(0);
  const view = useRef<ChatWebview | null>(null); const seen = useRef(new Set<string>()); const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    const off = window.chatLite.signal.onStatus(s => { if (!disposed && s.sessionId === sessionId) setStatus(s); });
    void window.chatLite.signal.ensure(sessionId).then(s => { if (!disposed) setStatus(s); }).catch(() => { if (!disposed) setStatus({ sessionId, phase: 'error', message: '暂时无法启动连接，请点击重试。' }); });
    // Frontend polls typed status only. All loopback HTTP access belongs to the main process.
    const timer = window.setInterval(() => { void window.chatLite.signal.status(sessionId).then(s => { if (!disposed) setStatus(s); }).catch(() => {}); }, 1500);
    void window.chatLite.signal.surfaceUrl(sessionId).then(value => { if (!disposed) setUrl(value); });
    return () => { disposed = true; mounted.current = false; clearInterval(timer); off(); };
  }, [sessionId]);
  useEffect(() => { void window.chatLite.settings.get().then(setInputSettings); }, [settingsRevision]);
  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const items = await window.chatLite.signal.catalog(sessionId);
      if (!mounted.current) return;
      setCatalog(old => items.map(item => ({ ...item, unread: old.find(c => c.id === item.id)?.unread || 0 })));
    } catch (e: any) { if (mounted.current) setError(e.message); } finally { if (mounted.current) setSyncing(false); }
  }, [sessionId]);
  useEffect(() => {
    if (status.phase !== 'ready') return;
    void refresh(); const timer = window.setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [status.phase, refresh, settingsRevision]);
  useEffect(() => { onCatalog(sessionId, catalog); }, [catalog, onCatalog, sessionId]);
  useEffect(() => { if (externalSelection) setSelectedId(externalSelection.id); }, [externalSelection]);
  useEffect(() => {
    const off = window.chatLite.signal.onMessage(({ sessionId: id, message: msg }) => {
      if (id !== sessionId) return;
      const fresh = !seen.current.has(msg.id); seen.current.add(msg.id);
      if (seen.current.size > 5000) seen.current.delete(seen.current.values().next().value!);
      setCatalog(old => {
        const previous = old.find(c => c.id === msg.conversationId);
        const next: Conversation = { ...(previous || { id: msg.conversationId, kind: msg.conversationKind, title: msg.direction === 'in' && msg.conversationKind === 'contact' ? msg.sender : msg.peer, subtitle: msg.peer, recipient: msg.conversationKind === 'contact' ? msg.peer : undefined, groupId: msg.conversationKind === 'group' ? msg.peer : undefined }), lastText: (previous?.lastAt || 0) > msg.at ? previous?.lastText : msg.text, lastAt: Math.max(previous?.lastAt || 0, msg.at), unread: (previous?.unread || 0) + (fresh && !msg.translatedText && msg.direction === 'in' && selectedRef.current !== msg.conversationId ? 1 : 0) };
        return [...old.filter(c => c.id !== next.id), next].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
      });
      if (selectedRef.current === msg.conversationId && msg.direction === 'in') { callbacks.current.onSource(msg.text); if (msg.translatedText) callbacks.current.onTranslated(msg.translatedText); }
    });
    const offSelect = window.chatLite.signal.onSelectText(({ sessionId: id, message }) => { if (id === sessionId) { callbacks.current.onSource(message.originalText || message.text); callbacks.current.onTranslated(message.translatedText || ''); } });
    const offError = window.chatLite.signal.onTranslationError(e => { if (e.sessionId === sessionId) setError(e.message); });
    return () => { off(); offSelect(); offError(); };
  }, [sessionId]);
  const selected = useMemo(() => catalog.find(c => c.id === selectedId), [catalog, selectedId]);
  useEffect(() => {
    onConversationChange(selected ? { id: sessionId === 'signal-main' ? selected.id : `${sessionId}:${selected.id}`, sessionId, service: 'signal', title: selected.title, kind: selected.kind } : null);
  }, [selected?.id, selected?.title, selected?.kind, sessionId, onConversationChange]);
  useEffect(() => { setDraft(''); setError(''); setCatalog(old => old.map(c => c.id === selectedId ? { ...c, unread: 0 } : c)); }, [selectedId]);
  useEffect(() => {
    const element = view.current; if (!element) return;
    const ready = () => setSurfaceReady(x => x + 1);
    element.addEventListener('dom-ready', ready);
    return () => element.removeEventListener('dom-ready', ready);
  }, [url, status.phase === 'ready']);
  useEffect(() => {
    if (!selectedId || !view.current || !surfaceReady) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const select = async (attempt = 0) => {
      if (disposed || !view.current) return;
      try { await window.chatLite.signal.selectSurface(view.current.getWebContentsId(), sessionId, selectedId); }
      catch { if (!disposed && attempt < 5) timer = setTimeout(() => void select(attempt + 1), 150); }
    };
    void select(); return () => { disposed = true; clearTimeout(timer); };
  }, [selectedId, sessionId, surfaceReady, settingsRevision]);
  const sendLock = useRef(false);
  const send = useCallback(async (text: string, smart = false, pair?: { originalText?: string; translatedText?: string }, attachments?: string[]) => {
    if (!selectedRef.current) throw new Error('请先选择 Signal 会话');
    if (sendLock.current) throw new Error('上一条消息正在发送，请稍候');
    const conversationId = selectedRef.current;
    sendLock.current = true; setBusy(true); setError('');
    try {
      const msg = await window.chatLite.signal.send(sessionId, { conversationId, text, smart, ...pair, attachments });
      if (mounted.current && selectedRef.current === conversationId) { setDraft(''); callbacks.current.onSource(msg.originalText || text); callbacks.current.onTranslated(msg.translatedText || ''); }
    } catch (e: any) { if (mounted.current) setError(`发送未确认，请先检查聊天记录再重试。${e.message || ''}`); throw e; }
    finally { sendLock.current = false; if (mounted.current) setBusy(false); }
  }, [sessionId]);
  useEffect(() => {
    onComposerReady({ write: async (text, shouldSend) => { setDraft(text); if (shouldSend) await send(text); }, writeBilingual: async (original, translated, shouldSend, mode) => { const text = mode === 'both' ? `${original}\n${translated}` : mode === 'original' ? original : translated; setDraft(text); if (shouldSend) await send(text, false, { originalText: original, translatedText: translated }); } });
  }, [onComposerReady, send]);
  const retry = async () => { setError(''); setStatus({ sessionId, phase: 'starting' }); try { setStatus(await window.chatLite.signal.retry(sessionId)); } catch { setStatus({ sessionId, phase: 'error', message: '暂时无法恢复连接，请稍后重试。' }); } };
  const changeDraft = async (value: string) => {
    if (!inputSettings?.tripleSpaceTranslate || !value.endsWith('   ')) { setDraft(value); return; }
    const original = value.slice(0, -3).trimEnd();
    if (!original || !selectedRef.current || busy) { setDraft(original); return; }
    setDraft(original); setBusy(true); setError('');
    try {
      const key = sessionId === 'signal-main' ? selectedRef.current : `${sessionId}:${selectedRef.current}`;
      const pref = await window.chatLite.prefs.get('signal', key, selected?.title || '');
      const out = await window.chatLite.translation.translate({ text: original, srcLang: pref.sourceLanguage, targetLang: pref.targetLanguage,
        model: pref.translateModel, service: 'signal', conversationId: key, conversationTitle: selected?.title, sessionId, direction: 'out' });
      if (mounted.current && selectedRef.current) { setDraft(out.translatedText); callbacks.current.onSource(original); callbacks.current.onTranslated(out.translatedText); }
    } catch (e: any) { if (mounted.current) setError(`翻译失败，原文已保留。${e?.message || ''}`); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (status.phase !== 'ready') return <div className="signal-pairing-screen">
    <div className="signal-pairing-card"><div className="signal-pairing-mark">S</div><h2>连接你的 Signal</h2>
      {status.phase === 'pairing' && status.qrUri ? <><div className="signal-qr"><QRCodeSVG value={status.qrUri} size={230} level="M" /></div><p>手机 Signal → 设置 → 已连接设备 → 添加新设备</p><p className="muted">扫码并在手机确认后，将自动进入聊天。</p><small>{status.message}</small></> : status.phase === 'error' ? <><p>{status.message || '连接暂未完成。'}</p><button className="primary" onClick={retry}>{status.code === 'PAIRING_EXPIRED' ? '重新生成二维码' : '重试连接'}</button>{status.code && <small className="muted">诊断编号：{status.code}</small>}</> : <><div className="signal-spinner" /><p>{status.message || '正在准备安全连接…'}</p></>}
    </div></div>;
  return <div className="signal-view">
    <div className="service-toolbar"><strong>Signal</strong><span className="dot online" /><small>{status.account} · 已连接</small><button onClick={() => void refresh()} disabled={syncing}>{syncing ? '同步中…' : '同步会话'}</button></div>
    <div className="signal-layout"><aside className="signal-conversation-pane">
      <input className="conversation-search" placeholder="搜索会话" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="new-recipient"><input placeholder="号码 / UUID" value={recipient} onChange={e => setRecipient(e.target.value)} /><button onClick={() => { const peer = recipient.trim(); if (!peer) return; const id = `contact:${peer}`; setCatalog(old => old.some(c => c.id === id) ? old : [{ id, kind: 'contact', title: peer, subtitle: peer, recipient: peer }, ...old]); setSelectedId(id); setRecipient(''); }}>打开</button></div>
      <div className="conversation-list">{catalog.filter(c => `${c.title} ${c.lastText || ''}`.toLowerCase().includes(query.toLowerCase())).map(c => <button key={c.id} className={`conversation-item ${c.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(c.id)}><span className="conversation-copy"><b>{c.title}</b><span>{c.lastText || c.subtitle}</span>{!!c.unread && <small>{c.unread} 未读</small>}</span></button>)}</div>
    </aside><section className="signal-chat-pane"><div className="signal-chat-head"><b>{selected?.title || '选择一个会话'}</b>{selected && <button onClick={async () => { if (confirm('清空此账号的当前会话本地记录？')) { await window.chatLite.signal.clearMessages(selected.id, sessionId); void refresh(); } }}>清空本地记录</button>}</div>
      {url && <Webview ref={view} src={url} className="signal-chat-webview" partition={`signal-surface-${sessionId}`} />}
      <div className="signal-composer advanced"><button disabled={busy || !selected} onClick={async () => { const files = await window.chatLite.dialog.pickFiles(); if (files.length) await send('', false, undefined, files).catch(() => {}); }}>＋</button><textarea disabled={!selected} value={draft} onChange={e => void changeDraft(e.target.value)} placeholder={inputSettings?.efficiencyMode ? '效率模式：Enter 翻译并发送；三空格仅翻译' : '普通模式：Enter 发送原文；三空格翻译'} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && draft.trim()) void send(draft, inputSettings?.efficiencyMode === true).catch(() => {}); } }} /><button className="send" disabled={busy || !selected || !draft.trim()} onClick={() => void send(draft, inputSettings?.efficiencyMode === true).catch(() => {})}>{busy ? '处理中…' : '发送'}</button></div>
    </section></div>{error && <div className="error floating">{error}<button onClick={() => setError('')}>×</button></div>}
  </div>;
}
