import { useEffect, useMemo, useState } from 'react';

export function HistoryModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [service, setService] = useState<'all' | 'whatsapp' | 'signal' | 'manual'>('all');
  const [direction, setDirection] = useState<'all' | 'in' | 'out' | 'manual'>('all');
  const [account, setAccount] = useState('all');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { if (open) window.chatLite.settings.get().then(s => setNames(Object.fromEntries([...s.whatsappSessions, ...s.signalSessions].map(x => [x.id, x.name])))); }, [open]);
  const [query, setQuery] = useState('');
  const load = () => window.chatLite.translation.history().then(setItems);
  useEffect(() => { if (open) load(); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(x => {
      if (account !== 'all' && (x.sessionId || (x.service === 'signal' ? 'signal-main' : 'legacy')) !== account) return false;
      if (service !== 'all' && x.service !== service) return false;
      if (direction !== 'all' && (x.direction || 'manual') !== direction) return false;
      if (q && !`${x.sourceText} ${x.translatedText} ${x.conversationTitle || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, service, direction, query, account]);

  if (!open) return null;
  return <div className="modal-backdrop"><div className="modal history-modal v3-history">
    <div className="modal-head"><div><h2>翻译历史</h2><small>WhatsApp / Signal / 手动翻译统一保存，最多 5000 条</small></div><button onClick={onClose}>×</button></div>
    <div className="history-tools">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索原文、译文或联系人…" />
      <select value={service} onChange={e => setService(e.target.value as any)}><option value="all">全部平台</option><option value="whatsapp">WhatsApp</option><option value="signal">Signal</option><option value="manual">手动</option></select>
      <select value={direction} onChange={e => setDirection(e.target.value as any)}><option value="all">全部方向</option><option value="in">收到</option><option value="out">发送</option><option value="manual">手动</option></select>
      <select value={account} onChange={e => setAccount(e.target.value)}><option value="all">全部账号</option>{[...new Set(items.map(x => x.sessionId || (x.service === 'signal' ? 'signal-main' : 'legacy')))].map(id => <option key={id} value={id}>{names[id] || (id === 'legacy' ? '旧记录 / 手动' : id)}</option>)}</select>
      <span>{filtered.length} 条</span>
    </div>
    <div className="history-list">{filtered.length === 0 ? <div className="muted center">没有符合条件的翻译历史</div> : filtered.map(x => <div className="history-item" key={x.id}>
      <div className="history-meta"><span className="chip">{x.service}</span><b>{names[x.sessionId || (x.service === 'signal' ? 'signal-main' : '')] || x.sessionId}</b><span>{x.direction === 'in' ? '收到' : x.direction === 'out' ? '发送' : '手动'}</span>{x.conversationTitle && <b>{x.conversationTitle}</b>}<span>{x.sourceLanguage} → {x.targetLanguage}</span><span>{new Date(x.at).toLocaleString()}</span></div>
      <div className="history-bilingual"><div><b>原文</b><p>{x.sourceText}</p><button onClick={() => navigator.clipboard.writeText(x.sourceText)}>复制原文</button></div><div><b>译文</b><p>{x.translatedText}</p><button onClick={() => navigator.clipboard.writeText(x.translatedText)}>复制译文</button></div></div>
    </div>)}</div>
    <div className="modal-actions"><button onClick={async () => { if (confirm('确定清空全部本地翻译历史？')) { await window.chatLite.translation.clearHistory(); load(); } }}>清空历史</button><button className="primary" onClick={onClose}>关闭</button></div>
  </div></div>;
}
