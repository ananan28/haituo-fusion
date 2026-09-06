import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  SignalAccountSummary,
  SignalAttachment,
  SignalAttachmentDraft,
  SignalConversation,
  SignalMessage,
  SignalQuote,
  SignalServiceAdapter,
} from '../../../services/signal/types';

type Props = { accountId: string; adapter: SignalServiceAdapter; translate?: (text: string) => Promise<string> };
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || 'S';
const Avatar = ({ conversation }: { conversation: SignalConversation }) => conversation.avatarUrl
  ? <img className="cs-signal-avatar" src={conversation.avatarUrl} alt="" />
  : <span className="cs-signal-avatar cs-signal-avatar--fallback">{initials(conversation.title)}</span>;

const asDataUrl = (attachment: SignalAttachment) =>
  attachment.url ?? (attachment.bytesBase64 ? `data:${attachment.contentType || 'application/octet-stream'};base64,${attachment.bytesBase64}` : undefined);

const fileToDraft = (file: File, voiceNote = false): Promise<SignalAttachmentDraft> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('文件读取失败'));
  reader.onload = () => {
    const value = String(reader.result || '');
    const bytesBase64 = value.slice(value.indexOf(',') + 1);
    resolve({ fileName: file.name || (voiceNote ? '语音消息.webm' : '附件'), contentType: file.type || 'application/octet-stream', bytesBase64, voiceNote });
  };
  reader.readAsDataURL(file);
});

function AttachmentView({ attachment }: { attachment: SignalAttachment }) {
  const source = asDataUrl(attachment);
  const type = attachment.contentType || '';
  if (!source) return <span className="cs-signal-file">📎 {attachment.fileName || '附件暂不可用'}</span>;
  if (type.startsWith('image/')) return <a href={source} download={attachment.fileName}><img className="cs-signal-media" src={source} alt={attachment.fileName || '图片'} /></a>;
  if (type.startsWith('video/')) return <video className="cs-signal-media" src={source} controls />;
  if (type.startsWith('audio/') || attachment.voiceNote) return <audio className="cs-signal-audio" src={source} controls />;
  return <a className="cs-signal-file" href={source} download={attachment.fileName || '附件'}>📎 下载 {attachment.fileName || '附件'}</a>;
}

export default function SignalServicePane({ accountId, adapter, translate }: Props) {
  const [account, setAccount] = useState<SignalAccountSummary>();
  const [conversations, setConversations] = useState<SignalConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<SignalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<SignalMessage>();
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder>();
  const recorderStream = useRef<MediaStream>();

  const loadConversations = useCallback(async () => {
    const next = await adapter.listConversations(accountId);
    setConversations(next);
    setSelectedId(current => current ?? next[0]?.id);
  }, [accountId, adapter]);

  useEffect(() => {
    let mounted = true;
    adapter.getAccount(accountId).then(next => { if (mounted) setAccount(next); }).catch(() => { if (mounted) setError('Signal 服务暂时不可用，请稍后重试'); });
    const unsubscribe = adapter.subscribe(accountId, event => {
      if (event.type === 'account') setAccount(event.account);
      if (event.type === 'conversation') setConversations(items => [event.conversation, ...items.filter(item => item.id !== event.conversation.id)]);
      if (event.type === 'message') setMessages(items => items.some(item => item.conversationId === event.message.conversationId) ? [...items.filter(item => item.id !== event.message.id), event.message] : items);
    });
    return () => { mounted = false; unsubscribe(); recorderStream.current?.getTracks().forEach(track => track.stop()); };
  }, [accountId, adapter]);

  useEffect(() => {
    if (account?.connectionState !== 'ready') { setConversations([]); setSelectedId(undefined); setMessages([]); return; }
    void loadConversations().catch(() => setError('会话列表加载失败'));
  }, [account?.connectionState, loadConversations]);

  useEffect(() => {
    if (!selectedId || account?.connectionState !== 'ready') return;
    adapter.listMessages(accountId, selectedId).then(setMessages).then(() => adapter.markRead(accountId, selectedId)).catch(() => setError('历史消息加载失败'));
  }, [account?.connectionState, accountId, adapter, selectedId]);

  const visibleConversations = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return keyword ? conversations.filter(item => item.title.toLocaleLowerCase().includes(keyword)) : conversations;
  }, [conversations, search]);
  const selected = conversations.find(item => item.id === selectedId);
  const quote = (message?: SignalMessage): SignalQuote | undefined => message ? { messageId: message.id, sentAt: message.sentAt, body: message.body } : undefined;

  const send = async () => {
    const body = draft.trim();
    if (!body || !selectedId) return;
    setDraft('');
    try {
      const message = await adapter.sendMessage(accountId, selectedId, body, quote(replyTo));
      setMessages(items => [...items, message]); setReplyTo(undefined); await loadConversations();
    } catch { setDraft(body); setError('消息发送失败，请检查网络后重试'); }
  };

  const sendFile = async (file: File, voiceNote = false) => {
    if (!selectedId) return;
    setSendingAttachment(true);
    try {
      const attachment = await fileToDraft(file, voiceNote);
      const message = await adapter.sendAttachment(accountId, selectedId, attachment, quote(replyTo));
      setMessages(items => [...items, message]); setReplyTo(undefined); await loadConversations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '附件发送失败，请稍后重试'); }
    finally { setSendingAttachment(false); }
  };

  const toggleRecording = async () => {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      recorder.current = next; recorderStream.current = stream;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: next.mimeType || 'audio/webm' });
        const file = new File([blob], `语音-${Date.now()}.webm`, { type: blob.type });
        void sendFile(file, true);
      };
      next.start(); setRecording(true);
    } catch { setError('无法使用麦克风，请在系统设置中允许财盛聚合聊天访问麦克风'); }
  };

  const translateMessage = async (message: SignalMessage) => {
    if (!translate || !message.body.trim()) return;
    try {
      const translatedBody = await translate(message.body);
      setMessages(items => items.map(item => item.id === message.id ? { ...item, translatedBody } : item));
    } catch { setError('翻译失败，请稍后重试'); }
  };

  const react = async (message: SignalMessage, emoji: string) => {
    if (!selectedId) return;
    try { await adapter.reactMessage(accountId, selectedId, message.sentAt, emoji); }
    catch { setError('表情回应发送失败'); }
  };
  const remove = async (message: SignalMessage) => {
    if (!selectedId || !window.confirm('确定撤回这条消息吗？')) return;
    try {
      await adapter.deleteMessage(accountId, selectedId, message.sentAt);
      setMessages(items => items.map(item => item.id === message.id ? { ...item, deleted: true, body: '', attachments: [] } : item));
    } catch { setError('消息撤回失败，可能已超过 Signal 允许的撤回时间'); }
  };
  const edit = async (message: SignalMessage) => {
    if (!selectedId) return;
    const body = window.prompt('编辑消息', message.body)?.trim();
    if (!body || body === message.body) return;
    try {
      const updated = await adapter.editMessage(accountId, selectedId, message.sentAt, body);
      setMessages(items => items.map(item => item.id === message.id ? updated : item));
    } catch { setError('消息编辑失败，可能已超过 Signal 允许的编辑时间'); }
  };

  if (!account || account.connectionState !== 'ready') return (
    <section className="cs-signal-link"><div className="cs-signal-link__card">
      <div className="cs-signal-mark">S</div><h1>连接 Signal</h1>
      <p>使用手机 Signal 扫描二维码，将此账号连接到财盛聚合聊天。</p>
      {account?.qrCodeDataUrl ? <img className="cs-signal-qr" src={account.qrCodeDataUrl} alt="Signal 登录二维码" /> : <button type="button" onClick={() => adapter.beginLink(accountId)}>生成二维码</button>}
      {account?.connectionState === 'linking' && <button type="button" className="cs-link-button" onClick={() => adapter.refreshQrCode(accountId).then(setAccount)}>刷新二维码</button>}
      {error && <p className="cs-signal-error">{error}</p>}
    </div></section>
  );

  return <section className="cs-signal-shell">
    <aside className="cs-signal-list">
      <header><strong>Signal</strong><span>{account.label}</span></header>
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索会话" />
      <div className="cs-signal-conversations">{visibleConversations.map(conversation =>
        <button type="button" className={conversation.id === selectedId ? 'is-active' : ''} key={conversation.id} onClick={() => setSelectedId(conversation.id)}>
          <Avatar conversation={conversation} /><span className="cs-signal-preview"><strong>{conversation.title}</strong><small>{conversation.lastMessage}</small></span>
          {conversation.unreadCount > 0 && <b className="cs-signal-unread">{conversation.unreadCount}</b>}
        </button>)}</div>
    </aside>
    <main className="cs-signal-chat">
      <header><strong>{selected?.title ?? '请选择会话'}</strong></header>
      <div className="cs-signal-messages">{messages.map(message =>
        <article className={`cs-signal-message cs-signal-message--${message.direction}`} key={message.id}>
          {message.quote && <blockquote><small>回复 {message.quote.author || ''}</small>{message.quote.body || '附件消息'}</blockquote>}
          {message.deleted ? <em>此消息已撤回</em> : <>
            {message.body && <div>{message.body}{message.editedAt && <small className="cs-signal-edited">（已编辑）</small>}</div>}
            {message.attachments?.map(item => <AttachmentView attachment={item} key={item.id} />)}
            {message.translatedBody && <p>{message.translatedBody}</p>}
            <div className="cs-signal-reactions">{message.reactions?.map((item, index) => <span key={`${item.emoji}-${index}`}>{item.emoji}</span>)}</div>
            <nav className="cs-signal-actions">
              <button type="button" onClick={() => setReplyTo(message)}>回复</button>
              {['👍', '❤️', '😂'].map(emoji => <button type="button" key={emoji} onClick={() => void react(message, emoji)}>{emoji}</button>)}
              {translate && message.body && <button type="button" onClick={() => translateMessage(message)}>翻译</button>}
              {message.direction === 'outgoing' && message.body && <button type="button" onClick={() => void edit(message)}>编辑</button>}
              {message.direction === 'outgoing' && <button type="button" onClick={() => void remove(message)}>撤回</button>}
            </nav>
          </>}
          <time>{new Date(message.sentAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
        </article>)}</div>
      {replyTo && <div className="cs-signal-reply"><span>回复：{replyTo.body || '附件消息'}</span><button type="button" onClick={() => setReplyTo(undefined)}>取消</button></div>}
      <footer>
        <input ref={fileInput} hidden type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" onChange={event => { const file = event.target.files?.[0]; if (file) void sendFile(file); event.target.value = ''; }} />
        <button type="button" className="cs-signal-tool" disabled={!selectedId || sendingAttachment} title="发送图片、视频或文件" onClick={() => fileInput.current?.click()}>📎</button>
        <button type="button" className={`cs-signal-tool ${recording ? 'is-recording' : ''}`} disabled={!selectedId || sendingAttachment} title={recording ? '停止并发送语音' : '录制语音'} onClick={() => void toggleRecording()}>{recording ? '■' : '🎙'}</button>
        <textarea value={draft} disabled={!selectedId} placeholder="输入消息，Enter 发送，Shift+Enter 换行" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        <button type="button" disabled={!draft.trim() || !selectedId} onClick={() => void send()}>发送</button>
      </footer>
      {error && <button className="cs-signal-toast" type="button" onClick={() => setError('')}>{error}</button>}
    </main>
  </section>;
}
