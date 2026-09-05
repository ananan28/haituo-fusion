export {};

declare global {
  type SignalStatus = import('../electron/signalTypes').SignalStatus;
  type SignalConversation = import('../electron/signalTypes').SignalConversation;
  interface Window {
    chatLite: {
      settings: {
        get(): Promise<AppSettings>;
        save(data: Partial<AppSettings>): Promise<AppSettings>;
      };
      prefs: {
        get(service: 'whatsapp' | 'signal' | 'telegram', conversationId: string, title?: string): Promise<ConversationPreference>;
        save(service: 'whatsapp' | 'signal' | 'telegram', conversationId: string, patch: Partial<ConversationPreference>): Promise<ConversationPreference>;
        list(): Promise<ConversationPreference[]>;
      };
      translation: {
        translate(data: TranslateInput): Promise<{ translatedText: string; raw: unknown }>;
        history(): Promise<HistoryItem[]>;
        clearHistory(): Promise<void>;
      };
      whatsapp: {
        messages(chatId?: string, limit?: number): Promise<StoredWhatsAppMessage[]>;
        storeMessage(item: StoredWhatsAppMessage): Promise<StoredWhatsAppMessage>;
        clearMessages(chatId?: string): Promise<void>;
      };
      signal: {
        ensure(id: string): Promise<SignalStatus>;
        status(id: string): Promise<SignalStatus>;
        retry(id: string): Promise<SignalStatus>;
        catalog(id: string): Promise<SignalConversation[]>;
        messages(conversationId: string | undefined, limit: number | undefined, id: string): Promise<StoredSignalMessage[]>;
        clearMessages(conversationId: string, id: string): Promise<void>;
        send(id: string, input: { conversationId: string; text: string; smart?: boolean; originalText?: string; translatedText?: string; attachments?: string[] }): Promise<StoredSignalMessage>;
        surfaceUrl(id: string): Promise<string>;
        selectSurface(guestId: number, id: string, conversationId: string): Promise<boolean>;
        onStatus(cb: (data: SignalStatus) => void): () => void;
        onMessage(cb: (data: { sessionId: string; message: StoredSignalMessage }) => void): () => void;
        onTranslationError(cb: (data: { sessionId: string; messageId: string; message: string }) => void): () => void;
        onSelectText(cb: (data: { sessionId: string; message: StoredSignalMessage }) => void): () => void;
      };
      dialog: { pickFiles(): Promise<string[]>; };
    };
  }

  type WhatsAppSession = {
    id: string;
    name: string;
    enabled: boolean;
    partition: string;
  };
  type WebPlatformSession = WhatsAppSession;

  type AppSettings = {
    translateBaseUrl: string;
    translateToken: string;
    translateModel: string;
    translateClientVersion: string;
    translateLocale: string;
    machineId: string;
    defaultSourceLanguage: string;
    defaultTargetLanguage: string;
    autoTranslateIncoming: boolean;
    autoTranslateOutgoing: boolean;
    autoTranslateHistory: boolean;
    efficiencyMode: boolean;
    tripleSpaceTranslate: boolean;
    enableBackTranslation: boolean;
    bilingualDisplay: boolean;
    bilingualSendMode: 'translated' | 'both' | 'original';
    translationFontColor: string;
    translationFontSize: number;
    inlineWhatsAppTranslation: boolean;
    whatsappMode: 'aggregate' | 'pure';
    whatsappSessions: WhatsAppSession[];
    telegramSessions: WebPlatformSession[];
    whatsappCompatibilityMode: boolean;
    whatsappFastAutoRead: boolean;
    whatsappStableVersion: boolean;
    whatsappPreferPhoneId: boolean;
    whatsappRemarkDetails: boolean;
    signalSessions: { id: string; name: string; account: string; enabled: boolean }[];
  signalEnabled: boolean;
    signalBaseUrl: string;
    signalAccount: string;
    signalBubbleColor: string;
    signalTextColor: string;
  };

  type ConversationPreference = {
    key: string;
    service: 'whatsapp' | 'signal' | 'telegram';
    conversationId: string;
    title: string;
    sourceLanguage: string;
    targetLanguage: string;
    translateReceived: boolean;
    translateSent: boolean;
    translateGroup: boolean;
    translateModel: string;
    bilingualDisplay: boolean;
    bilingualSendMode: 'translated' | 'both' | 'original';
    updatedAt: string;
  };

  type TranslateInput = {
    text: string;
    targetLang?: string;
    srcLang?: string;
    model?: string;
    serviceId?: string;
    service?: 'whatsapp' | 'signal' | 'telegram' | 'manual';
    conversationId?: string;
    conversationTitle?: string;
    sessionId?: string;
    direction?: 'in' | 'out' | 'manual';
    role?: string;
    tone?: string;
  };

  type HistoryItem = {
    id: string;
    at: string;
    service: 'whatsapp' | 'signal' | 'telegram' | 'manual';
    sourceText: string;
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    direction?: 'in' | 'out' | 'manual';
    conversationId?: string;
    conversationTitle?: string;
    sessionId?: string;
    model?: string;
  };

  type StoredWhatsAppMessage = {
    id: string;
    sessionId: string;
    chatId: string;
    chatTitle: string;
    direction: 'in' | 'out';
    text: string;
    originalText?: string;
    translatedText?: string;
    at: number;
    locatorType?: string;
    locator?: string;
  };

  type StoredSignalMessage = {
    id: string;
    conversationId: string;
    conversationKind: 'contact' | 'group';
    peer: string;
    sender: string;
    direction: 'in' | 'out';
    text: string;
    originalText?: string;
    translatedText?: string;
    attachments?: string[];
    at: number;
  };
}
