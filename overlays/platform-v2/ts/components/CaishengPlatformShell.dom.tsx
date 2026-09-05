// Copyright 2026 Caisheng; ChatTranslatorLite integration
// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, useEffect, useRef, useState, type HTMLAttributes, type JSX, type ReactNode } from 'react';
import { getCaishengPlatformAdapter, type CaishengPlatformId } from '../services/caishengPlatformRegistry.std.ts';
import { createCaishengWorkspaceId, getCaishengWorkspacePartition, isValidCaishengWorkspaceId, type CaishengWorkspace } from '../services/caishengWorkspace.std.ts';

const STORAGE = 'caisheng.platform.workspaces.v2';
const NAMES: Readonly<Record<CaishengPlatformId, string>> = { signal: 'Signal', whatsapp: 'WhatsApp', telegram: 'Telegram' };

function loadAccounts(): Array<CaishengWorkspace> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (!Array.isArray(raw)) return [];
    const used = new Set<string>();
    return raw.flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const value = entry as Partial<CaishengWorkspace>;
      if (typeof value.id !== 'string' || !isValidCaishengWorkspaceId(value.id) || used.has(value.id) ||
          !['signal', 'whatsapp', 'telegram'].includes(value.platformId || '') || typeof value.label !== 'string' ||
          !value.id.startsWith(`${value.platformId}-`)) return [];
      used.add(value.id);
      const platformId = value.platformId as CaishengPlatformId;
      return [{ id: value.id, platformId, label: value.label.trim().slice(0, 40) || NAMES[platformId], createdAt: value.createdAt || 0 }];
    });
  } catch { return []; }
}

function WebService({ account, active }: Readonly<{ account: CaishengWorkspace; active: boolean }>): JSX.Element {
  const element = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const adapter = getCaishengPlatformAdapter(account.platformId);
  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    const ready = (): void => { setLoading(false); setError(''); };
    const failed = (event: Event): void => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.errorCode === -3 || detail.isMainFrame === false) return;
      setLoading(false); setError(detail.errorDescription || `${adapter.label} 加载失败`);
    };
    node.addEventListener('did-finish-load', ready); node.addEventListener('did-fail-load', failed);
    return () => { node.removeEventListener('did-finish-load', ready); node.removeEventListener('did-fail-load', failed); };
  }, [adapter.label]);
  return (
    <section className="CaishengPlatformShell__webviewSlot" hidden={!active}>
      {createElement('webview', { ref: (node: HTMLElement | null) => { element.current = node; }, src: adapter.startUrl,
        partition: getCaishengWorkspacePartition(account), className: 'CaishengPlatformShell__webview' } as HTMLAttributes<HTMLElement> & { src: string; partition: string })}
      {(loading || error) && <div className="CaishengPlatformShell__loadError"><strong>{error || `正在加载 ${adapter.label}`}</strong>
        <span>{error ? '请检查网络或代理设置后重试。' : '首次打开可能需要一些时间。'}</span>
        {error && <button type="button" onClick={() => { setError(''); setLoading(true); (element.current as HTMLElement & { reload?: () => void })?.reload?.(); }}>重新加载</button>}
      </div>}
    </section>
  );
}

export function CaishengPlatformShell({ renderSignal }: Readonly<{ renderSignal: () => ReactNode }>): JSX.Element {
  const [currentSignalInstance, setCurrentSignalInstance] = useState<string | null>();
  const [accounts, setAccounts] = useState(loadAccounts);
  const [active, setActive] = useState('home');
  const [picker, setPicker] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const selected = accounts.find(account => account.id === active);
  useEffect(() => {
    void window.SignalContext.caishengSignalInstances.current().then(id => {
      setCurrentSignalInstance(id ?? null);
    });
  }, []);
  const commit = (next: Array<CaishengWorkspace>): void => { localStorage.setItem(STORAGE, JSON.stringify(next)); setAccounts(next); };
  const select = (id: string): void => {
    const account = accounts.find(a => a.id === id);
    setActive(id);
    setSettings(false);
    setPicker(false);
    if (account?.platformId === 'signal') {
      setNotice(`正在启动 ${account.label}…`);
      void window.SignalContext.caishengSignalInstances.start(account.id).then(() => {
        setNotice(`${account.label} 已在独立窗口启动。`);
      }).catch(error => {
        setNotice(`无法启动 ${account.label}：${error instanceof Error ? error.message : '未知错误'}`);
      });
    }
  };
  const add = (platformId: CaishengPlatformId): void => {
    const count = accounts.filter(a => a.platformId === platformId).length;
    const id = createCaishengWorkspaceId(platformId, crypto.randomUUID().replaceAll('-', ''));
    const account: CaishengWorkspace = { id, platformId, label: count ? `${NAMES[platformId]} ${count + 1}` : NAMES[platformId], createdAt: Date.now() };
    commit([...accounts, account]); setPicker(false); setActive(id);
    if (platformId === 'signal') {
      setNotice(`正在创建独立的 ${account.label}…`);
      void window.SignalContext.caishengSignalInstances.start(id).then(() => {
        setNotice(`${account.label} 已在独立窗口启动，请完成配对。`);
      }).catch(error => {
        setNotice(`无法启动 ${account.label}：${error instanceof Error ? error.message : '未知错误'}`);
      });
    }
  };
  const remove = (account: CaishengWorkspace): void => {
    commit(accounts.filter(item => item.id !== account.id));
    if (account.platformId === 'signal') {
      void window.SignalContext.caishengSignalInstances.stop(account.id);
    } else {
      void window.SignalContext.caishengClearWorkspaceData(getCaishengWorkspacePartition(account));
    }
    if (active === account.id) setActive('home');
  };
  if (currentSignalInstance === undefined) {
    return <div className="CaishengPlatformShell__boot">正在启动…</div>;
  }
  if (currentSignalInstance !== null) {
    return <>{renderSignal()}</>;
  }
  return (
    <div className="CaishengPlatformShell">
      <aside className="CaishengPlatformShell__nav">
        <div className="CaishengPlatformShell__brand"><span className="CaishengPlatformShell__brandMark">财</span><span><strong>财盛聚合聊天</strong><small>企业多平台通信中心</small></span></div>
        <button type="button" className={active === 'home' ? 'is-active' : ''} onClick={() => select('home')}><span className="CaishengPlatformShell__iconFallback">首</span><span className="CaishengPlatformShell__tabLabel"><strong>工作台</strong><small>平台首页</small></span></button>
        <div className="CaishengPlatformShell__tabs">{accounts.map(account => <button type="button" key={account.id} className={active === account.id ? 'is-active' : ''} onClick={() => select(account.id)} onDoubleClick={() => setRename({ id: account.id, name: account.label })} title="双击可重命名"><span className={`CaishengPlatformShell__iconFallback is-${account.platformId}`}>{account.platformId === 'signal' ? 'S' : account.platformId === 'whatsapp' ? 'W' : 'T'}</span><span className="CaishengPlatformShell__tabLabel"><strong>{account.label}</strong><small>{NAMES[account.platformId]}</small></span></button>)}</div>
        <button type="button" className="CaishengPlatformShell__add" onClick={() => setPicker(value => !value)}><span>＋</span><strong>添加服务</strong></button>
        <button type="button" className="CaishengPlatformShell__settingsButton" onClick={() => setSettings(value => !value)}><span>⚙</span><strong>平台设置</strong></button>
        {picker && <div className="CaishengPlatformShell__picker"><button type="button" onClick={() => add('signal')}><span className="CaishengPlatformShell__menuIcon">S</span>添加 Signal</button><button type="button" onClick={() => add('whatsapp')}><span className="CaishengPlatformShell__menuIcon is-whatsapp">W</span>添加 WhatsApp</button><button type="button" onClick={() => add('telegram')}><span className="CaishengPlatformShell__menuIcon is-telegram">T</span>添加 Telegram</button></div>}
        {settings && <div className="CaishengPlatformShell__settings"><strong>平台设置</strong><p>启动时进入财盛工作台，不自动打开聊天服务。</p><p>已添加服务：{accounts.length} 个</p>{selected && <button type="button" className="is-danger" onClick={() => remove(selected)}>移除当前服务并清除数据</button>}</div>}
      </aside>
      <main className="CaishengPlatformShell__content">
        {active === 'home' && <section className="CaishengPlatformShell__home"><span className="CaishengPlatformShell__homeMark">财盛</span><h1>聚合聊天工作台</h1><p>Signal、WhatsApp 和 Telegram 都是平台中的独立服务。</p><button type="button" onClick={() => setPicker(true)}>添加聊天服务</button>{notice && <div role="status">{notice}</div>}</section>}
        {selected?.platformId === 'signal' && <section className="CaishengPlatformShell__instanceStatus"><span className="CaishengPlatformShell__homeMark">S</span><h1>{selected.label}</h1><p>这个账号在独立 Signal 窗口中运行，数据与其他账号完全隔离。</p><button type="button" onClick={() => select(selected.id)}>打开账号</button>{notice && <div role="status">{notice}</div>}</section>}
        {accounts.filter(account => account.platformId !== 'signal').map(account => <WebService key={account.id} account={account} active={active === account.id} />)}
      </main>
      {rename && <div className="CaishengPlatformShell__modal"><form onSubmit={event => { event.preventDefault(); const name = rename.name.trim(); if (!name) return; commit(accounts.map(account => account.id === rename.id ? { ...account, label: name.slice(0, 40) } : account)); setRename(null); }}><h2>重命名账户</h2><input autoFocus maxLength={40} value={rename.name} onChange={event => setRename({ ...rename, name: event.target.value })} /><div><button type="button" onClick={() => setRename(null)}>取消</button><button type="submit">保存</button></div></form></div>}
    </div>
  );
}
