import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import whatsappLogo from '../assets/whatsapp.png';
import type { ActiveConversation, ComposerActions } from '../types';
import {
  openWhatsAppChat,
  readCurrentWhatsAppChat,
  readRecentWhatsAppMessages,
  readWhatsAppChatList,
  renderWhatsAppInlineTranslation,
  touchWhatsAppReadState,
  writeWhatsAppComposer,
  type WebviewLike,
  type WhatsAppChatPreview,
  type WhatsAppMessage
} from '../lib/whatsapp';

const WebviewTag: any = 'webview';
const stableUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type AggregateChat = WhatsAppChatPreview & {
  sessionId: string;
  sessionName: string;
};

type PendingPair = {
  originalText: string;
  translatedText: string;
  sentText: string;
  chatId: string;
  chatTitle: string;
  sessionId: string;
  createdAt: number;
};

function storedFromMessage(sessionId: string, message: WhatsAppMessage): StoredWhatsAppMessage {
  return {
    id: `${sessionId}:${message.key}`,
    sessionId,
    chatId: message.chatId,
    chatTitle: message.chatTitle,
    direction: message.direction,
    text: message.text,
    at: message.at,
    locatorType: message.locatorType,
    locator: message.locator
  };
}

export function WhatsAppHub({
  onSource,
  onTranslated,
  onConversationChange,
  onComposerReady,
  settingsRevision = 0
}: {
  onSource(text: string): void;
  onTranslated(text: string): void;
  onConversationChange(info: ActiveConversation | null): void;
  onComposerReady(actions: ComposerActions): void;
  settingsRevision?: number;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [chatLists, setChatLists] = useState<Record<string, WhatsAppChatPreview[]>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [activeInfo, setActiveInfo] = useState<ActiveConversation | null>(null);
  const [busy, setBusy] = useState(false);

  const views = useRef<Record<string, WebviewLike | null>>({});
  const seen = useRef(new Set<string>());
  const bootstrapped = useRef(new Set<string>());
  const translating = useRef(new Set<string>());
  const pendingPairs = useRef<PendingPair[]>([]);
  const activeConversationRef = useRef<ActiveConversation | null>(null);

  useEffect(() => {
    window.chatLite.settings.get().then(s => {
      setSettings(s);
      const first = s.whatsappSessions.find(x => x.enabled) || s.whatsappSessions[0];
      setSelectedSessionId(old => old || first?.id || '');
    });
  }, [settingsRevision]);

  const sessions = useMemo(() => (settings?.whatsappSessions || []).filter(x => x.enabled), [settings]);
  const selectedSession = sessions.find(x => x.id === selectedSessionId) || sessions[0];

  const updateActiveConversation = useCallback(async (sessionId: string) => {
    const view = views.current[sessionId];
    const s = settings;
    if (!view || !s) return null;
    try {
      const info = await readCurrentWhatsAppChat(view, s.whatsappPreferPhoneId);
      const next: ActiveConversation = {
        service: 'whatsapp',
        id: `${sessionId}:${info.id}`,
        title: info.title,
        sessionId
      };
      activeConversationRef.current = next;
      setActiveInfo(next);
      if (sessionId === selectedSessionId) onConversationChange(next);
      return { rawId: info.id, ...next };
    } catch { return null; }
  }, [onConversationChange, selectedSessionId, settings]);

  const translateMessage = useCallback(async (
    sessionId: string,
    message: WhatsAppMessage,
    pref: ConversationPreference,
    initial = false
  ) => {
    const s = settings;
    const view = views.current[sessionId];
    if (!s || !view) return;
    const taskKey = `${sessionId}:${message.key}`;
    if (translating.current.has(taskKey)) return;
    translating.current.add(taskKey);
    try {
      const result = await window.chatLite.translation.translate({
        text: message.text,
        srcLang: pref.sourceLanguage,
        targetLang: pref.targetLanguage,
        model: pref.translateModel,
        service: 'whatsapp',
        conversationId: `${sessionId}:${message.chatId}`,
        conversationTitle: message.chatTitle,
        sessionId,
        direction: message.direction
      });
      const stored = {
        ...storedFromMessage(sessionId, message),
        translatedText: result.translatedText
      };
      await window.chatLite.whatsapp.storeMessage(stored);
      if (sessionId === selectedSessionId && (!initial || message.direction === 'in')) {
        onSource(message.text);
        onTranslated(result.translatedText);
      }
      if (
        pref.bilingualDisplay &&
        s.inlineWhatsAppTranslation &&
        !s.whatsappCompatibilityMode
      ) {
        await renderWhatsAppInlineTranslation(view, message, result.translatedText, {
          color: s.translationFontColor,
          fontSize: s.translationFontSize,
          label: message.direction === 'out' ? '译' : '译'
        });
      }
    } finally {
      translating.current.delete(taskKey);
    }
  }, [onSource, onTranslated, selectedSessionId, settings]);

  const processSession = useCallback(async (sessionId: string) => {
    const s = settings;
    const view = views.current[sessionId];
    if (!s || !view) return;
    try {
      const recent = await readRecentWhatsAppMessages(view, 26, s.whatsappPreferPhoneId);
      if (!recent.length) return;
      const current = recent[recent.length - 1];
      const conversationId = `${sessionId}:${current.chatId}`;
      if (sessionId === selectedSessionId && activeConversationRef.current?.id !== conversationId) {
        const nextConversation: ActiveConversation = { service: 'whatsapp', id: conversationId, title: current.chatTitle, sessionId };
        activeConversationRef.current = nextConversation;
        setActiveInfo(nextConversation);
        onConversationChange(nextConversation);
      }
      const bootKey = conversationId;
      const pref = await window.chatLite.prefs.get('whatsapp', conversationId, current.chatTitle);

      if (!bootstrapped.current.has(bootKey)) {
        for (const msg of recent) {
          seen.current.add(`${sessionId}:${msg.key}`);
          await window.chatLite.whatsapp.storeMessage(storedFromMessage(sessionId, msg));
        }
        bootstrapped.current.add(bootKey);
        setStatus(old => ({ ...old, [sessionId]: `已监听 · ${current.chatTitle}` }));
        if (s.autoTranslateHistory && pref.translateReceived) {
          const candidates = recent.filter(x => x.direction === 'in').slice(-6);
          for (const msg of candidates) {
            try { await translateMessage(sessionId, msg, pref, true); } catch { /* history continues */ }
          }
        }
        return;
      }

      const fresh = recent.filter(m => !seen.current.has(`${sessionId}:${m.key}`));
      recent.forEach(m => seen.current.add(`${sessionId}:${m.key}`));
      if (!fresh.length) return;

      for (const msg of fresh) {
        let stored = storedFromMessage(sessionId, msg);
        if (msg.direction === 'out') {
          const now = Date.now();
          pendingPairs.current = pendingPairs.current.filter(x => now - x.createdAt < 120_000);
          const index = pendingPairs.current.findIndex(x => x.sessionId === sessionId && x.sentText.trim() === msg.text.trim());
          if (index >= 0) {
            const pair = pendingPairs.current.splice(index, 1)[0];
            stored = { ...stored, originalText: pair.originalText, translatedText: pair.translatedText };
            if (pref.bilingualDisplay && s.inlineWhatsAppTranslation && !s.whatsappCompatibilityMode) {
              const secondary = pair.sentText === pair.translatedText ? pair.originalText : pair.translatedText;
              await renderWhatsAppInlineTranslation(view, msg, secondary, {
                color: s.translationFontColor,
                fontSize: s.translationFontSize,
                label: pair.sentText === pair.translatedText ? '原' : '译'
              });
            }
          }
        }
        await window.chatLite.whatsapp.storeMessage(stored);

        if (msg.direction === 'in') {
          if (s.whatsappFastAutoRead && sessionId === selectedSessionId) void touchWhatsAppReadState(view);
          if (sessionId === selectedSessionId) onSource(msg.text);
          if (pref.translateReceived) {
            try {
              await translateMessage(sessionId, msg, pref);
              setStatus(old => ({ ...old, [sessionId]: `双语翻译完成 · ${msg.chatTitle}` }));
            } catch (e: any) {
              setStatus(old => ({ ...old, [sessionId]: `翻译失败：${e?.message || String(e)}` }));
            }
          }
        }
      }
    } catch {
      // QR 登录、WhatsApp DOM 短暂重建或页面升级时，下一轮继续。
    }
  }, [onConversationChange, onSource, selectedSessionId, settings, translateMessage]);

  useEffect(() => {
    if (!settings || !sessions.length) return;
    let disposed = false;
    const poll = async () => {
      if (disposed) return;
      for (const session of sessions) await processSession(session.id);
    };
    const id = window.setInterval(() => void poll(), 1150);
    void poll();
    return () => { disposed = true; window.clearInterval(id); };
  }, [processSession, sessions, settings]);

  useEffect(() => {
    if (!settings || !sessions.length) return;
    let disposed = false;
    const refresh = async () => {
      const next: Record<string, WhatsAppChatPreview[]> = {};
      for (const session of sessions) {
        const view = views.current[session.id];
        if (!view) continue;
        try {
          next[session.id] = await readWhatsAppChatList(
            view,
            settings.whatsappPreferPhoneId,
            settings.whatsappRemarkDetails
          );
        } catch { /* session may still be at QR login */ }
      }
      if (!disposed) setChatLists(old => ({ ...old, ...next }));
    };
    const id = window.setInterval(() => void refresh(), 3200);
    void refresh();
    return () => { disposed = true; window.clearInterval(id); };
  }, [sessions, settings]);

  useEffect(() => {
    if (selectedSessionId) void updateActiveConversation(selectedSessionId);
  }, [selectedSessionId, updateActiveConversation]);

  useEffect(() => {
    onComposerReady({
      write: async (text, send) => {
        const sessionId = selectedSession?.id;
        const view = sessionId ? views.current[sessionId] : null;
        if (!view) throw new Error('WhatsApp 尚未加载');
        const ok = await writeWhatsAppComposer(view, text, send);
        if (!ok) throw new Error('没有找到 WhatsApp 输入框，请刷新服务后重试');
      },
      writeBilingual: async (sourceText, translatedText, send, mode) => {
        const sessionId = selectedSession?.id;
        const view = sessionId ? views.current[sessionId] : null;
        if (!sessionId || !view) throw new Error('WhatsApp 尚未加载');
        const chat = await readCurrentWhatsAppChat(view, settings?.whatsappPreferPhoneId || false);
        const sentText = mode === 'both' ? `${sourceText}\n${translatedText}` : mode === 'original' ? sourceText : translatedText;
        const ok = await writeWhatsAppComposer(view, sentText, send);
        if (!ok) throw new Error('没有找到 WhatsApp 输入框，请刷新服务后重试');
        if (send) {
          pendingPairs.current.push({
            originalText: sourceText,
            translatedText,
            sentText,
            chatId: chat.id,
            chatTitle: chat.title,
            sessionId,
            createdAt: Date.now()
          });
        }
      }
    });
  }, [onComposerReady, selectedSession, settings]);

  const aggregate = useMemo<AggregateChat[]>(() => {
    const result: AggregateChat[] = [];
    for (const session of sessions) {
      for (const chat of chatLists[session.id] || []) result.push({ ...chat, sessionId: session.id, sessionName: session.name });
    }
    const q = search.trim().toLowerCase();
    return result
      .filter(x => !q || `${x.title} ${x.subtitle} ${x.sessionName}`.toLowerCase().includes(q))
      .sort((a, b) => (b.unread || 0) - (a.unread || 0) || a.title.localeCompare(b.title));
  }, [chatLists, search, sessions]);

  const selectChat = async (item: AggregateChat) => {
    setSelectedSessionId(item.sessionId);
    const view = views.current[item.sessionId];
    if (view) {
      await openWhatsAppChat(view, item.title);
      window.setTimeout(() => void updateActiveConversation(item.sessionId), 350);
    }
  };

  const updateMode = async (mode: 'aggregate' | 'pure') => {
    if (!settings) return;
    const next = await window.chatLite.settings.save({ whatsappMode: mode });
    setSettings(next);
  };

  const addSession = async () => {
    if (!settings) return;
    const id = `wa-${Date.now().toString(36)}`;
    const nextSessions = [...settings.whatsappSessions, {
      id,
      name: `WhatsApp ${settings.whatsappSessions.length + 1}`,
      enabled: true,
      partition: `persist:${id}`
    }];
    const next = await window.chatLite.settings.save({ whatsappSessions: nextSessions });
    setSettings(next);
    setSelectedSessionId(id);
  };

  const removeSelected = async () => {
    if (!settings || settings.whatsappSessions.length <= 1 || !selectedSession) return;
    const nextSessions = settings.whatsappSessions.filter(x => x.id !== selectedSession.id);
    const next = await window.chatLite.settings.save({ whatsappSessions: nextSessions });
    setSettings(next);
    setSelectedSessionId(nextSessions.find(x => x.enabled)?.id || nextSessions[0]?.id || '');
  };

  const refreshSelected = () => selectedSession && views.current[selectedSession.id]?.reload();

  return <div className="whatsapp-hub">
    <div className="service-toolbar wa-toolbar">
      <div className="wa-toolbar-left">
        <img src={whatsappLogo} className="service-logo" />
        <strong>WhatsApp</strong>
        <span className="dot online"></span>
        <small>{selectedSession ? `${selectedSession.name} · ${status[selectedSession.id] || '等待登录/监听'}` : '无会话'}</small>
      </div>
      <div className="wa-toolbar-actions">
        <div className="segmented">
          <button className={settings?.whatsappMode === 'aggregate' ? 'active' : ''} onClick={() => updateMode('aggregate')}>聚合会话</button>
          <button className={settings?.whatsappMode === 'pure' ? 'active' : ''} onClick={() => updateMode('pure')}>纯净模式</button>
        </div>
        <select value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}>
          {sessions.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}
        </select>
        <button onClick={addSession}>＋账号</button>
        <button onClick={removeSelected} disabled={sessions.length <= 1}>删除</button>
        <button onClick={refreshSelected}>刷新服务</button>
      </div>
    </div>

    <div className={`wa-main ${settings?.whatsappMode === 'aggregate' ? 'aggregate' : 'pure'}`}>
      {settings?.whatsappMode === 'aggregate' && <aside className="wa-aggregate-pane">
        <div className="wa-aggregate-head">
          <b>WhatsApp 聚合会话</b>
          <span>{aggregate.length}</span>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索全部 WhatsApp 会话" />
        <div className="wa-aggregate-list">
          {aggregate.length === 0 ? <div className="muted empty-list">登录 WhatsApp 后，这里会聚合可见会话</div> : aggregate.map(item => <button
            key={`${item.sessionId}:${item.id}:${item.title}`}
            className={`wa-aggregate-item ${selectedSessionId === item.sessionId && item.active ? 'selected' : ''}`}
            onClick={() => void selectChat(item)}
          >
            <span className="wa-avatar">{item.title[0]?.toUpperCase() || 'W'}</span>
            <span className="wa-aggregate-copy">
              <span><b>{item.title}</b><i>{item.sessionName}</i></span>
              <small>{item.subtitle || item.phoneHint || 'WhatsApp'}</small>
            </span>
            {!!item.unread && <em>{item.unread > 99 ? '99+' : item.unread}</em>}
          </button>)}
        </div>
      </aside>}

      <section className="wa-webviews">
        {sessions.map(session => <WebviewTag
          key={session.id}
          ref={(el: any) => { views.current[session.id] = el as WebviewLike; }}
          className={`whatsapp-webview ${selectedSessionId === session.id ? 'active' : ''}`}
          src="https://web.whatsapp.com/"
          partition={session.partition}
          allowpopups="true"
          useragent={settings?.whatsappStableVersion ? stableUA : undefined}
          onLoad={() => setStatus(old => ({ ...old, [session.id]: '页面已载入，正在监听消息' }))}
        />)}
        {!sessions.length && <div className="muted center">请新增一个 WhatsApp 账号</div>}
      </section>
    </div>

    <div className="wa-feature-strip">
      <span className={settings?.whatsappFastAutoRead ? 'on' : ''}>快速自动已读</span>
      <span className={settings?.whatsappStableVersion ? 'on' : ''}>稳定版本 UA</span>
      <span className={settings?.whatsappCompatibilityMode ? 'warn' : 'on'}>{settings?.whatsappCompatibilityMode ? '兼容模式' : '完整翻译模式'}</span>
      <span className={settings?.whatsappPreferPhoneId ? 'on' : ''}>手机号优先 ID</span>
      <span className={settings?.whatsappRemarkDetails ? 'on' : ''}>备注详情</span>
      {activeInfo && <span className="active-chat-pill">当前：{activeInfo.title}</span>}
      {busy && <span>处理中…</span>}
    </div>
  </div>;
}
