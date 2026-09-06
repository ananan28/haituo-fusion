import { LIVE_API_FERDIUM_LIBRETRANSLATE } from '../config';
import { AiTranslationProvider, GoogleTranslationProvider, LibreTranslationProvider } from '../translation/providers';
import { SecureAiSettingsStore } from '../translation/SecureAiSettingsStore.main';
import { TranslationService } from '../translation/service';
import type { TranslationProviderId } from '../translation/types';

const settings = new SecureAiSettingsStore();
const service = new TranslationService([
  new GoogleTranslationProvider(),
  new LibreTranslationProvider(LIVE_API_FERDIUM_LIBRETRANSLATE),
  new AiTranslationProvider(settings),
]);

const providerAliases: Record<string, TranslationProviderId> = {
  Google: 'google',
  LibreTranslate: 'libretranslate',
  AI: 'ai',
};

/** Compatibility entry point for OneChat's existing get-selection-translation IPC. */
export async function translateTo(text: string, translateToLanguage: string, translatorEngine: string) {
  return service.translate({
    text,
    targetLanguage: translateToLanguage,
    provider: providerAliases[translatorEngine] ?? 'google',
  });
}

export { service as caishengTranslationService, settings as caishengAiSettingsStore };
