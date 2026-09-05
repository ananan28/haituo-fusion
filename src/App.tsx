import { useCallback, useState } from 'react';
import { TranslatePanel } from './components/TranslatePanel';
import { SettingsModal } from './components/SettingsModal';
import { SignalHub } from './components/SignalHub';
import { WhatsAppHub } from './components/WhatsAppHub';
import { WebPlatformHub } from './components/WebPlatformHub';
import { platformRegistry, type PlatformId } from './platformRegistry';
import { HistoryModal } from './components/HistoryModal';
import type { ActiveConversation, ComposerActions } from './types';
import whatsappLogo from './assets/whatsapp.png';
import signalLogo from './assets/signal.png';

const ignoreText = (_text: string) => {};

export default function App() {
  const [signalActivated, setSignalActivated] = useState(false);
  const [service, setService] = useState<PlatformId>('whatsapp');
  const [source, setSource] = useState('');
  const [translated, setTranslated] = useState('');
  const [conversation, setConversation] = useState<ActiveConversation | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);

  const [whatsappComposer, setWhatsAppComposer] = useState<ComposerActions | null>(null);
  const [signalComposer, setSignalComposer] = useState<ComposerActions | null>(null);

  const switchService = (next: PlatformId) => {
    if (next === 'signal') setSignalActivated(true);
    setService(next);
    setConversation(null);
    setSource('');
    setTranslated('');
  };

  const activeComposer = service === 'whatsapp' ? whatsappComposer : service === 'signal' ? signalComposer : null;
  const onWhatsAppConversation = useCallback((info: ActiveConversation | null) => { if (service === 'whatsapp') setConversation(info); }, [service]);
  const onSignalConversation = useCallback((info: ActiveConversation | null) => { if (service === 'signal') setConversation(info); }, [service]);

  return <div className="app-shell v3-shell">
    <header>
      <div className="brand">
        <span className="logo">译</span>
        <div><b>ChatTranslator <em>v0.5.0 Managed Signal</em></b><small>WhatsApp + Signal · 实时双语内部版</small></div>
      </div>
      <div className="header-actions">
        <span className="status-pill">TranGPT 翻译接口保留</span>
        <span className="status-pill bilingual-pill">原文 + 译文</span>
        <button onClick={() => setHistoryOpen(true)}>翻译历史</button>
        <button onClick={() => setSettingsOpen(true)}>完整设置</button>
      </div>
    </header>

    <div className="body">
      <nav className="side-nav">
        {platformRegistry.map(platform => <button key={platform.id} className={service === platform.id ? `active ${platform.id}` : ''} onClick={() => switchService(platform.id)}>
          {platform.id === 'whatsapp' ? <img src={whatsappLogo} className="nav-logo" /> : platform.id === 'signal' ? <img src={signalLogo} className="nav-logo" /> : <span className="nav-platform-letter" style={{ background: platform.color }}>{platform.shortName}</span>}
          <span>{platform.name}</span>
        </button>)}
        <div className="nav-spacer" />
        <button onClick={() => setHistoryOpen(true)}><span className="icon history-icon">H</span><span>历史</span></button>
        <button onClick={() => setSettingsOpen(true)}><span className="icon">⚙</span><span>设置</span></button>
      </nav>

      <main className="service-area">
        <section className={service === 'whatsapp' ? 'service-page show' : 'service-page'}>
          <WhatsAppHub
            onSource={service === 'whatsapp' ? setSource : ignoreText}
            onTranslated={service === 'whatsapp' ? setTranslated : ignoreText}
            onConversationChange={onWhatsAppConversation}
            onComposerReady={setWhatsAppComposer}
            settingsRevision={settingsRevision}
          />
        </section>

        <section className={service === 'signal' ? 'service-page show' : 'service-page'}>
          {signalActivated && <SignalHub
            onSource={service === 'signal' ? setSource : ignoreText}
            onTranslated={service === 'signal' ? setTranslated : ignoreText}
            onConversationChange={onSignalConversation}
            onComposerReady={setSignalComposer}
            settingsRevision={settingsRevision}
          />}
        </section>
        <section className={service === 'telegram' ? 'service-page show' : 'service-page'}>
          <WebPlatformHub platformId="telegram" settingsRevision={settingsRevision} />
        </section>
      </main>

      <TranslatePanel
        service={service}
        conversation={conversation}
        sourceText={source}
        setSourceText={setSource}
        translatedText={translated}
        setTranslatedText={setTranslated}
        settingsRevision={settingsRevision}
        onWrite={activeComposer ? (text, send) => activeComposer.write(text, send) : undefined}
        onBilingualWrite={activeComposer ? (sourceText, translatedText, send, mode) => activeComposer.writeBilingual(sourceText, translatedText, send, mode) : undefined}
      />
    </div>

    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsRevision(v => v + 1)} />
    <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
  </div>;
}
