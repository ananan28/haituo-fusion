import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalView, type Conversation } from './SignalView';
import type { ActiveConversation, ComposerActions } from '../types';

type Props = {
  onSource(text: string): void; onTranslated(text: string): void;
  onConversationChange(info: ActiveConversation | null): void;
  onComposerReady(actions: ComposerActions): void; settingsRevision: number;
};
export function SignalHub(props: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [active, setActive] = useState('signal-main');
  const [revision, setRevision] = useState(0);
  const [catalogs, setCatalogs] = useState<Record<string, Conversation[]>>({});
  const [selection, setSelection] = useState<Record<string, { id: string; nonce: number }>>({});
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState<Record<string, SignalStatus>>({});
  useEffect(() => window.chatLite.signal.onStatus(state => setStates(old => ({ ...old, [state.sessionId]: state }))), []);
  const [rename, setRename] = useState<string | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const propsRef = useRef(props); propsRef.current = props;
  const callbacks = useRef<Record<string, any>>({});
  const composers = useRef<Record<string, ComposerActions>>({});
  const conversations = useRef<Record<string, ActiveConversation | null>>({});
  const reload = useCallback(async () => { setSettings(await window.chatLite.settings.get()); setRevision(x => x + 1); }, []);
  useEffect(() => { void reload(); }, [props.settingsRevision, reload]);
  const catalog = useCallback((id: string, list: Conversation[]) => setCatalogs(old => ({ ...old, [id]: list })), []);
  const sessions = settings?.signalSessions.filter(x => x.enabled) || [];
  useEffect(() => { if (sessions.length && !sessions.some(x => x.id === active)) setActive(sessions[0].id); }, [settings, active]);
  useEffect(() => {
    props.onConversationChange(conversations.current[active] || null);
    props.onSource(''); props.onTranslated('');
    props.onComposerReady(composers.current[active] || { write: async () => { throw new Error('请先选择会话'); }, writeBilingual: async () => { throw new Error('请先选择会话'); } });
  }, [active, props.onConversationChange]);
  async function save(next: AppSettings['signalSessions']) {
    await window.chatLite.settings.save({ signalSessions: next }); await reload();
  }
  async function discover() {
    setBusy(true); setError('');
    try { for (const s of settings?.signalSessions.filter(x => x.enabled) || []) await window.chatLite.signal.ensure(s.id); }
    catch { setError('连接暂未完成，请在对应账号页面重试。'); }
    finally { setBusy(false); }
  }
  if (!settings) return <div className="center">加载账号…</div>;
  const selected = sessions.find(x => x.id === active);
  const rows = sessions.flatMap(s => (catalogs[s.id] || []).map(c => ({ ...c, session: s })))
    .filter(c => `${c.title} ${c.lastText || ''} ${c.session.name}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  return <div className="signal-multi">
    <div className="service-toolbar">
      <strong>Signal 多账号</strong>
      <select value={active} onChange={e => setActive(e.target.value)}>{sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {states[s.id]?.account || s.account || '待扫码'}</option>)}</select>
      <button onClick={async () => { const id = `signal-${crypto.randomUUID()}`; await save([...settings.signalSessions, { id, name: `Signal ${settings.signalSessions.length + 1}`, account: '', enabled: true }]); setActive(id); }}>＋ 账号</button>
      <button onClick={() => setRename(selected?.name || '')}>改名</button>
      <button disabled={sessions.length < 2} onClick={async () => { if (confirm('从界面停用此账号？本地历史和手机绑定会保留。')) await save(settings.signalSessions.map(s => s.id === active ? { ...s, enabled: false } : s)); }}>停用</button>
      {settings.signalSessions.some(s => !s.enabled) && <button onClick={() => save(settings.signalSessions.map(s => ({ ...s, enabled: true })))}>恢复账号</button>}
      <button disabled={busy} onClick={discover}>{busy ? '识别中…' : '连接全部账号'}</button>
    </div>
    {rename !== null && <div className="service-toolbar"><input aria-label="Signal 账号名称" value={rename} onChange={e => setRename(e.target.value)} /><button onClick={async () => { if (rename.trim()) { await save(settings.signalSessions.map(s => s.id === active ? { ...s, name: rename.trim() } : s)); setRename(null); } }}>保存名称</button><button onClick={() => setRename(null)}>取消</button></div>}
    {error && <div className="error">{error}<button onClick={() => setError('')}>×</button></div>}
    <div className="signal-multi-body">
      <aside className="signal-all-chats"><b>聚合会话 · {rows.length}</b><input placeholder="搜索所有 Signal 账号" value={query} onChange={e => setQuery(e.target.value)} />
      {rows.map(c => <button key={`${c.session.id}:${c.id}`} onClick={() => { setActive(c.session.id); setSelection(old => ({ ...old, [c.session.id]: { id: c.id, nonce: Date.now() } })); }}><b>{c.title}</b><small>{c.session.name} {c.unread ? ` · ${c.unread} 未读` : ''}</small><span>{c.lastText || c.subtitle}</span></button>)}
      {!rows.length && <p className="muted">绑定后同步联系人，或在右侧用号码发起会话。</p>}</aside>
      <div className="signal-account-views">{sessions.map(s => {
        if (!callbacks.current[s.id]) callbacks.current[s.id] = {
          onSource: (text: string) => { if (activeRef.current === s.id) propsRef.current.onSource(text); },
          onTranslated: (text: string) => { if (activeRef.current === s.id) propsRef.current.onTranslated(text); },
          onConversationChange: (c: ActiveConversation | null) => { conversations.current[s.id] = c; if (activeRef.current === s.id) propsRef.current.onConversationChange(c); },
          onComposerReady: (c: ComposerActions) => { composers.current[s.id] = c; if (activeRef.current === s.id) propsRef.current.onComposerReady(c); }
        };
        return <div key={`${s.id}:${s.account}`} className={`signal-account-view ${s.id === active ? 'active' : ''}`}><SignalView sessionId={s.id} settingsRevision={revision} externalSelection={selection[s.id]} onCatalog={catalog} onAccountChanged={reload} {...callbacks.current[s.id]} /></div>;
      })}</div>
    </div>
  </div>;
}
