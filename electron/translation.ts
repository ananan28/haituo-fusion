import { loadSettings } from './settings';

export type TranslateInput = {
  text: string; targetLang?: string; srcLang?: string; model?: string; serviceId?: string;
  service?: 'whatsapp' | 'signal' | 'manual'; conversationId?: string; conversationTitle?: string;
  sessionId?: string; direction?: 'in' | 'out' | 'manual'; role?: string; tone?: string;
};
export type TranslateOutput = { translatedText: string; raw: unknown; provider?: string };

function pickString(obj: any): string | undefined {
  if (!obj) return undefined;
  if (typeof obj === 'string') return obj;
  const candidates = [obj.translatedText, obj.translated_text, obj.translation, obj.text, obj.result, obj.msg,
    obj.data?.translatedText, obj.data?.translated_text, obj.data?.translation, obj.data?.text,
    obj.data?.result, obj.data?.targetText, obj.data?.target_text,
    obj.result?.translatedText, obj.result?.translation, obj.result?.text];
  return candidates.find((v: unknown) => typeof v === 'string' && v.trim()) as string | undefined;
}

async function timedFetch(url: string, init?: RequestInit, timeout = 12_000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}

async function aiTranslate(input: TranslateInput, target: string, source: string): Promise<TranslateOutput> {
  const s = loadSettings();
  if (!s.translateToken.trim()) throw new Error('AI_NOT_CONFIGURED');
  const body: Record<string, unknown> = { msg: input.text, lang: target, blacklist: [], src_lang: source,
    model: input.model || s.translateModel, service_id: input.serviceId || undefined, source_entry: 1 };
  if (input.role) body.role = input.role; if (input.tone) body.tone = input.tone;
  const res = await timedFetch(`${s.translateBaseUrl.replace(/\/$/, '')}/clients/api/smart/legacy/translate/text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.translateToken}`,
      'X-Trangpt-Version': s.translateClientVersion, 'X-Trangpt-Locale': s.translateLocale,
      'X-Trangpt-Timestamp': new Date().toISOString(), 'X-Trangpt-Machine-Id': s.machineId }, body: JSON.stringify(body)
  }, 20_000);
  const text = await res.text(); let payload: any = text;
  try { payload = JSON.parse(text); } catch { /* plain response */ }
  if (!res.ok) throw new Error(payload?.message || payload?.msg || text || `${res.status} ${res.statusText}`);
  const translatedText = pickString(payload); if (!translatedText) throw new Error('AI_EMPTY_RESULT');
  return { translatedText, raw: payload, provider: 'ai' };
}

async function googleTranslate(text: string, target: string, source: string): Promise<TranslateOutput> {
  const query = new URLSearchParams({ client: 'gtx', sl: source || 'auto', tl: target, dt: 't', q: text });
  const res = await timedFetch(`https://translate.googleapis.com/translate_a/single?${query}`, undefined, 10_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload: any = await res.json();
  const translatedText = Array.isArray(payload?.[0]) ? payload[0].map((x: any) => x?.[0] || '').join('') : '';
  if (!translatedText.trim()) throw new Error('empty result');
  return { translatedText, raw: payload, provider: 'google' };
}

async function myMemoryTranslate(text: string, target: string, source: string): Promise<TranslateOutput> {
  const query = new URLSearchParams({ q: text, langpair: `${source === 'auto' ? 'autodetect' : source}|${target}` });
  const res = await timedFetch(`https://api.mymemory.translated.net/get?${query}`, undefined, 10_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload: any = await res.json(); const translatedText = payload?.responseData?.translatedText;
  if (typeof translatedText !== 'string' || !translatedText.trim()) throw new Error(payload?.responseDetails || 'empty result');
  return { translatedText, raw: payload, provider: 'mymemory' };
}

export async function translateText(input: TranslateInput): Promise<TranslateOutput> {
  const text = input.text?.trim(); if (!text) throw new Error('请输入需要翻译的文字');
  const s = loadSettings(); const target = input.targetLang || s.defaultTargetLanguage; const source = input.srcLang || s.defaultSourceLanguage;
  if (!target || target === 'auto') throw new Error('请选择目标语言');
  const errors: string[] = [];
  for (const [name, run] of [
    ['AI', () => aiTranslate(input, target, source)],
    ['Google', () => googleTranslate(text, target, source)],
    ['MyMemory', () => myMemoryTranslate(text, target, source)]
  ] as const) {
    try { return await run(); }
    catch (error: any) { if (error?.message !== 'AI_NOT_CONFIGURED') errors.push(`${name}: ${error?.message || String(error)}`); }
  }
  throw new Error(`翻译暂时不可用（${errors.join('；')}）`);
}
