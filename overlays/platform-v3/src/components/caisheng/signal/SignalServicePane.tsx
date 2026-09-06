import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  SignalAccountSummary,
  SignalConversation,
  SignalMessage,
  SignalServiceAdapter,
} from '../../../services/signal/types';


type Props = {
  accountId: string;
  adapter: SignalServiceAdapter;
  translate?: (text: string) => Promise<string>;
};

const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || 'S';

const Avatar = ({ conversation }: { conversation: SignalConversation }) =>
  conversation.avatarUrl ? (
    <img className="cs-signal-avatar" src={conversation.avatarUrl} alt="" />
  ) : (
    <span className="cs-signal-avatar cs-signal-avatar--fallback">
      {initials(conversation.title)}
    </span>
  );

export default function SignalServicePane({ accountId, adapter, translate }: Props) {
  const [account, setAccount] = useState<SignalAccountSummary>();
  const [conversations, setConversations] = useState<SignalConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<SignalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const loadConversations = useCallback(async () => {
    const next = await adapter.listConversations(accountId);
    setConversations(next);
    setSelectedId(current => current ?? next[0]?.id);
  }, [accountId, adapter]);

  useEffect(() => {
    let mounted = true;
    Promise.all([adapter.getAccount(accountId), adapter.listConversations(accountId)])
      .then(([nextAccount, nextConversations]) => {
        if (!mounted) return;
        setAccount(nextAccount);
        setConversations(nextConversations);
        setSelectedId(nextConversations[0]?.id);
      })
      .catch(() => setError('Signal 服务暂时不可用，请稍后重试'));

    const unsubscribe = adapter.subscribe(accountId, event => {
      if (event.type === 'account') setAccount(event.account);
      if (event.type === 'conversation') {
        setConversations(items => [
          event.conversation,
          ...items.filter(item => item.id !== event.conversation.id),
        ]);
      }
      if (event.type === 'message' && event.message.conversationId === selectedId) {
        setMessages(items => [...items.filter(item => item.id !== event.message.id), event.message]);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [accountId, adapter, selectedId]);

  useEffect(() => {
    if (!selectedId || account?.connectionState !== 'ready') return;
    adapter.listMessages(accountId, selectedId)
      .then(setMessages)
      .then(() => adapter.markRead(accountId, selectedId))
      .catch(() => setError('历史消息加载失败'));
  }, [account?.connectionState, accountId, adapter, selectedId]);

  const visibleConversations = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return keyword
      ? conversations.filter(item => item.title.toLocaleLowerCase().includes(keyword))
      : conversations;
  }, [conversations, search]);

  const selected = conversations.find(item => item.id === selectedId);

  const send = async () => {
    const body = draft.trim();
    if (!body || !selectedId) return;
    setDraft('');
    try {
      const message = await adapter.sendMessage(accountId, selectedId, body);
      setMessages(items => [...items, message]);
      await loadConversations();
    } catch {
      setDraft(body);
      setError('消息发送失败，请检查网络后重试');
    }
  };

  const translateMessage = async (message: SignalMessage) => {
    if (!translate || !message.body.trim()) return;
    try {
      const translatedBody = await translate(message.body);
      setMessages(items => items.map(item =>
        item.id === message.id ? { ...item, translatedBody } : item,
      ));
    } catch {
      setError('翻译失败，请稍后重试');
    }
  };

  if (!account || account.connectionState !== 'ready') {
    return (
      <section className="cs-signal-link">
        <div className="cs-signal-link__card">
          <div className="cs-signal-mark">S</div>
          <h1>连接 Signal</h1>
          <p>使用手机 Signal 扫描二维码，将此账号连接到财盛聚合聊天。</p>
          {account?.qrCodeDataUrl ? (
            <img className="cs-signal-qr" src={account.qrCodeDataUrl} alt="Signal 登录二维码" />
          ) : (
            <button type="button" onClick={() => adapter.beginLink(accountId)}>生成二维码</button>
          )}
          {account?.connectionState === 'linking' && (
            <button type="button" className="cs-link-button" onClick={() => adapter.refreshQrCode(accountId).then(setAccount)}>
              刷新二维码
            </button>
          )}
          {error && <p className="cs-signal-error">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="cs-signal-shell">
      <aside className="cs-signal-list">
        <header><strong>Signal</strong><span>{account.label}</span></header>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索会话" />
        <div className="cs-signal-conversations">
          {visibleConversations.map(conversation => (
            <button
              type="button"
              className={conversation.id === selectedId ? 'is-active' : ''}
              key={conversation.id}
              onClick={() => setSelectedId(conversation.id)}
            >
              <Avatar conversation={conversation} />
              <span className="cs-signal-preview">
                <strong>{conversation.title}</strong>
                <small>{conversation.lastMessage}</small>
              </span>
              {conversation.unreadCount > 0 && <b className="cs-signal-unread">{conversation.unreadCount}</b>}
            </button>
          ))}
        </div>
      </aside>
      <main className="cs-signal-chat">
        <header><strong>{selected?.title ?? '请选择会话'}</strong></header>
        <div className="cs-signal-messages">
          {messages.map(message => (
            <article className={`cs-signal-message cs-signal-message--${message.direction}`} key={message.id}>
              <div>{message.body}</div>
              {message.translatedBody && <p>{message.translatedBody}</p>}
              {translate && (
                <button type="button" onClick={() => translateMessage(message)}>翻译</button>
              )}
              <time>{new Date(message.sentAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
            </article>
          ))}
        </div>
        <footer>
          <textarea
            value={draft}
            disabled={!selectedId}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" disabled={!draft.trim() || !selectedId} onClick={() => void send()}>发送</button>
        </footer>
        {error && <button className="cs-signal-toast" type="button" onClick={() => setError('')}>{error}</button>}
      </main>
    </section>
  );
}
