import translateGoogle from 'google-translate-api-x';
import { TRANSLATION_MESSAGES } from './messages';
import type {
  AiModelConfiguration,
  AiModelSettingsStore,
  TranslationProvider,
  TranslationResult,
} from './types';

type Fetch = typeof fetch;

function failure(provider: TranslationProvider['id'], message: string): TranslationResult {
  return { text: message, error: true, provider, message };
}

export class GoogleTranslationProvider implements TranslationProvider {
  readonly id = 'google' as const;

  async translate(request: Parameters<TranslationProvider['translate']>[0]): Promise<TranslationResult> {
    try {
      const value = await translateGoogle(request.text, {
        to: request.targetLanguage,
        autoCorrect: true,
      });
      if (!value.text?.trim()) return failure(this.id, TRANSLATION_MESSAGES.invalidResponse);
      return {
        text: value.text,
        error: false,
        provider: this.id,
        detectedLanguage: value.from?.language?.iso,
      };
    } catch {
      return failure(this.id, TRANSLATION_MESSAGES.network);
    }
  }
}

export class LibreTranslationProvider implements TranslationProvider {
  readonly id = 'libretranslate' as const;
  constructor(private readonly endpoint: string, private readonly fetcher: Fetch = fetch) {}

  async translate(request: Parameters<TranslationProvider['translate']>[0]): Promise<TranslationResult> {
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: request.text,
          source: request.sourceLanguage || 'auto',
          target: request.targetLanguage,
        }),
        signal: request.signal,
      });
      if (!response.ok) return failure(this.id, TRANSLATION_MESSAGES.unavailable);
      const payload = (await response.json()) as { translatedText?: string; detectedLanguage?: { language?: string } };
      if (!payload.translatedText?.trim()) return failure(this.id, TRANSLATION_MESSAGES.invalidResponse);
      return {
        text: payload.translatedText,
        error: false,
        provider: this.id,
        detectedLanguage: payload.detectedLanguage?.language,
      };
    } catch {
      return failure(this.id, TRANSLATION_MESSAGES.network);
    }
  }
}

export class AiTranslationProvider implements TranslationProvider {
  readonly id = 'ai' as const;
  constructor(private readonly settings: AiModelSettingsStore, private readonly fetcher: Fetch = fetch) {}

  async translate(request: Parameters<TranslationProvider['translate']>[0]): Promise<TranslationResult> {
    const config = await this.settings.load();
    if (!config?.enabled || !config.endpoint || !config.model || !config.apiKey) {
      return failure(this.id, TRANSLATION_MESSAGES.aiNotConfigured);
    }
    return this.request(config, request);
  }

  private async request(
    config: AiModelConfiguration,
    request: Parameters<TranslationProvider['translate']>[0],
  ): Promise<TranslationResult> {
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 30_000);
    try {
      const response = await this.fetcher(config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature ?? 0.1,
          messages: [
            { role: 'system', content: config.systemPrompt || '你是专业翻译。只输出译文，不要解释。' },
            { role: 'user', content: `翻译为 ${request.targetLanguage}\n\n${request.text}` },
          ],
        }),
        signal: request.signal ?? timeout,
      });
      if (!response.ok) return failure(this.id, TRANSLATION_MESSAGES.unavailable);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content?.trim();
      return text
        ? { text, error: false, provider: this.id }
        : failure(this.id, TRANSLATION_MESSAGES.invalidResponse);
    } catch {
      return failure(this.id, TRANSLATION_MESSAGES.network);
    }
  }
}
