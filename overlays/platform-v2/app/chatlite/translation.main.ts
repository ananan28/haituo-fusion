// SPDX-License-Identifier: AGPL-3.0-only
// No provider, endpoint, token import, or network request in this build.
export type TranslateInput = {
  text: string;
  service?: 'signal' | 'whatsapp';
  sessionId?: string;
  direction?: 'in' | 'out' | 'manual';
  targetLang?: string;
};
export async function translateText(
  _input: TranslateInput
): Promise<{ translatedText: string }> {
  throw new Error('本版未接入翻译服务');
}
