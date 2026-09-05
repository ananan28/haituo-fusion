// SPDX-License-Identifier: AGPL-3.0-only
export type ChatLiteConfig = Readonly<{
  translateBaseUrl: string;
  translateModel: string;
  defaultSourceLanguage: string;
  defaultTargetLanguage: string;
  autoTranslateIncoming: boolean;
  autoTranslateOutgoing: boolean;
  bilingualDisplay: boolean;
  tokenConfigured: boolean;
}>;
export type ChatLitePatch = Partial<Omit<ChatLiteConfig, 'tokenConfigured'>> & {
  translateToken?: string;
};
export type ChatLiteHistory = Readonly<{
  id: string;
  sourceText: string;
  translatedText: string;
  at: string;
  service: string;
  sessionId?: string;
}>;
export type ChatLiteAPI = {
  getConfig(): Promise<ChatLiteConfig>;
  saveConfig(patch: ChatLitePatch): Promise<ChatLiteConfig>;
  importConfig(): Promise<ChatLiteConfig | null>;
  history(): Promise<Array<ChatLiteHistory>>;
};
