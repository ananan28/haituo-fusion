import { useEffect, useMemo, useRef, useState } from 'react';
import { getPlatform, type PlatformId } from '../platformRegistry';

const WebviewTag: any = 'webview';
type EmbeddedWebview = HTMLElement & { reload(): void };
const stableUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function WebPlatformHub({ platformId, settingsRevision = 0 }: { platformId: Exclude<PlatformId, 'signal' | 'whatsapp'>; settingsRevision?: number }) {
  const platform = getPlatform(platformId);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const views = useRef<Record<string, EmbeddedWebview | null>>({});

  useEffect(() => {
    window.chatLite.settings.get().then(next => {
      setSettings(next);
      const first = next.telegramSessions.find(item => item.enabled) || next.telegramSessions[0];
      setSelectedId(old => old || first?.id || '');
    });
  }, [settingsRevision]);

  const sessions = useMemo(() => (settings?.telegramSessions || []).filter(item => item.enabled), [settings]);
  const selected = sessions.find(item => item.id === selectedId) || sessions[0];

  const persist = async (nextSessions: WebPlatformSession[], nextSelected?: string) => {
    const next = await window.chatLite.settings.save({ telegramSessions: nextSessions });
    setSettings(next);
    if (nextSelected) setSelectedId(nextSelected);
  };

  const add = async () => {
    if (!settings) return;
    const id = `tg-${Date.now().toString(36)}`;
    await persist([...settings.telegramSessions, { id, name: `Telegram ${settings.telegramSessions.length + 1}`, enabled: true, partition: `persist:caisheng-telegram-${id}` }], id);
  };

  const rename = async () => {
    if (!settings || !selected) return;
    const name = window.prompt('账号备注', selected.name)?.trim();
    if (!name) return;
    await persist(settings.telegramSessions.map(item => item.id === selected.id ? { ...item, name } : item));
  };

  const remove = async () => {
    if (!settings || !selected || settings.telegramSessions.length <= 1) return;
    const next = settings.telegramSessions.filter(item => item.id !== selected.id);
    await persist(next, next.find(item => item.enabled)?.id || next[0]?.id || '');
  };

  return <div className="web-platform-hub">
    <div className="service-toolbar web-platform-toolbar">
      <div className="wa-toolbar-left">
        <span className="platform-letter" style={{ background: platform.color }}>{platform.shortName}</span>
        <strong>{platform.name}</strong>
        <span className="dot online" />
        <small>{selected?.name || '无账号'} · 独立登录环境</small>
      </div>
      <div className="wa-toolbar-actions">
        <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
          {sessions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <button onClick={() => void add()}>＋账号</button>
        <button onClick={() => void rename()} disabled={!selected}>备注</button>
        <button onClick={() => void remove()} disabled={sessions.length <= 1}>删除</button>
        <button onClick={() => selected && views.current[selected.id]?.reload()}>刷新服务</button>
      </div>
    </div>
    <section className="generic-webviews">
      {sessions.map(item => <WebviewTag
        key={item.id}
        ref={(node: EmbeddedWebview | null) => { views.current[item.id] = node; }}
        className={`generic-webview ${item.id === selected?.id ? 'active' : ''}`}
        src={platform.url}
        partition={item.partition}
        useragent={stableUA}
        allowpopups="true"
      />)}
    </section>
  </div>;
}
