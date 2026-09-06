import { TRANSLATION_MESSAGES } from './messages';
import type { TranslationProvider, TranslationProviderId, TranslationRequest, TranslationResult } from './types';

export class TranslationService {
  private readonly providers = new Map<TranslationProviderId, TranslationProvider>();

  constructor(providers: readonly TranslationProvider[], private readonly defaultProvider: TranslationProviderId = 'google') {
    providers.forEach(provider => this.providers.set(provider.id, provider));
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const providerId = request.provider ?? this.defaultProvider;
    const source = request.text.trim();
    if (!source) return { text: '', error: false, provider: providerId };

    const provider = this.providers.get(providerId);
    if (!provider) {
      return { text: TRANSLATION_MESSAGES.unavailable, error: true, provider: providerId, message: TRANSLATION_MESSAGES.unavailable };
    }
    return provider.translate({ ...request, text: source, targetLanguage: request.targetLanguage || 'zh-CN' });
  }
}
