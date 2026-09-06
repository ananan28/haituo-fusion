export type TranslationProviderId = 'google' | 'libretranslate' | 'ai';

export interface TranslationRequest {
  readonly text: string;
  readonly targetLanguage?: string;
  readonly sourceLanguage?: string;
  readonly provider?: TranslationProviderId;
  readonly signal?: AbortSignal;
}

export interface TranslationResult {
  readonly text: string;
  readonly error: boolean;
  readonly provider: TranslationProviderId;
  readonly detectedLanguage?: string;
  readonly message?: string;
}

export interface TranslationProvider {
  readonly id: TranslationProviderId;
  translate(request: Required<Pick<TranslationRequest, 'text' | 'targetLanguage'>> & TranslationRequest): Promise<TranslationResult>;
}

/** OpenAI-compatible AI translation endpoint. API keys must never be stored here. */
export interface AiModelSettings {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly systemPrompt?: string;
}

export interface AiModelSecret {
  readonly apiKey: string;
}

export interface AiModelConfiguration extends AiModelSettings, AiModelSecret {}

export interface AiModelSettingsView extends AiModelSettings {
  readonly hasApiKey: boolean;
}

export interface AiModelSettingsPatch extends Partial<AiModelSettings> {
  /** undefined keeps the existing key, empty string removes it. */
  readonly apiKey?: string;
}

export interface AiModelSettingsStore {
  load(): Promise<AiModelConfiguration | undefined>;
  save(patch: AiModelSettingsPatch): Promise<AiModelSettingsView>;
  view(): Promise<AiModelSettingsView>;
  clear(): Promise<void>;
}
