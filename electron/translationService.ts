import { randomUUID } from 'node:crypto';
import { translateText, type TranslateInput } from './translation';
import { loadSettings } from './settings';
import { addHistory } from './history';
export async function translateAndRecord(input: TranslateInput) {
  const result = await translateText(input); const s = loadSettings();
  addHistory({ id: randomUUID(), at: new Date().toISOString(), service: input.service || 'manual', sourceText: input.text, translatedText: result.translatedText,
    sourceLanguage: input.srcLang || s.defaultSourceLanguage, targetLanguage: input.targetLang || s.defaultTargetLanguage, direction: input.direction || 'manual',
    conversationId: input.conversationId, conversationTitle: input.conversationTitle, sessionId: input.sessionId, model: input.model || s.translateModel });
  return result;
}
