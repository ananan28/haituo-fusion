export type ActiveConversation = {
  service: 'whatsapp' | 'signal' | 'telegram';
  id: string;
  title: string;
  sessionId?: string;
  kind?: 'contact' | 'group';
};

export type ComposerActions = {
  write(text: string, send: boolean): Promise<void>;
  writeBilingual(sourceText: string, translatedText: string, send: boolean, mode: 'translated' | 'both' | 'original'): Promise<void>;
};
