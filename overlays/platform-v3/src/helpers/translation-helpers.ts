import translateGoogle from 'google-translate-api-x';
import { LIVE_API_FERDIUM_LIBRETRANSLATE } from '../config';

export type TranslationEngine = 'Google' | 'LibreTranslate' | 'AI';

export type TranslationResult = Readonly<{
  text: string;
  error: boolean;
}>;

export type AiTranslationSettings = Readonly<{
  endpoint: string;
  model: string;
  apiKey?: string;
}>;

const ERROR_TEXT = '翻译失败，请检查网络后重试。';

// AI translation is intentionally an interface only for now. The platform
// settings page can provide endpoint/model/apiKey without changing callers.
export async function translateWithAi(
  _text: string,
  _targetLanguage: string,
  _settings: AiTranslationSettings,
): Promise<TranslationResult> {
  return { text: '尚未配置 AI 翻译模型。', error: true };
}

export async function translateTo(
  text: string,
  translateToLanguage: string,
  translatorEngine: string,
): Promise<TranslationResult> {
  const source = text.trim();
  if (!source) {
    return { text: '', error: false };
  }

  if (translatorEngine === 'Google' || !translatorEngine) {
    try {
      const result = await translateGoogle(source, {
        to: translateToLanguage || 'zh-CN',
        autoCorrect: true,
      });
      return { text: result.text, error: false };
    } catch {
      return { text: ERROR_TEXT, error: true };
    }
  }

  if (translatorEngine === 'LibreTranslate') {
    try {
      const response = await fetch(LIVE_API_FERDIUM_LIBRETRANSLATE, {
        method: 'POST',
        body: JSON.stringify({
          q: source,
          source: 'auto',
          target: translateToLanguage || 'zh-CN',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        return { text: ERROR_TEXT, error: true };
      }
      const payload = (await response.json()) as { translatedText?: string };
      if (!payload.translatedText) {
        return { text: ERROR_TEXT, error: true };
      }
      return { text: payload.translatedText, error: false };
    } catch {
      return { text: ERROR_TEXT, error: true };
    }
  }

  return { text: '尚未配置 AI 翻译模型。', error: true };
}
