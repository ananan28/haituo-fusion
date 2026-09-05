import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadSettings } from './settings';

export type ConversationPreference = {
  key: string;
  service: 'whatsapp' | 'signal';
  conversationId: string;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  translateReceived: boolean;
  translateSent: boolean;
  translateGroup: boolean;
  translateModel: string;
  bilingualDisplay: boolean;
  bilingualSendMode: 'translated' | 'both' | 'original';
  updatedAt: string;
};

function filePath() { return path.join(app.getPath('userData'), 'conversation-prefs.json'); }
function key(service: string, conversationId: string) { return `${service}:${conversationId}`; }

function readAllRaw(): Record<string, ConversationPreference> {
  try { return JSON.parse(fs.readFileSync(filePath(), 'utf8')); }
  catch { return {}; }
}

function writeAll(data: Record<string, ConversationPreference>) {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2));
}

export function getConversationPreference(
  service: 'whatsapp' | 'signal',
  conversationId: string,
  title = ''
): ConversationPreference {
  const s = loadSettings();
  const k = key(service, conversationId);
  const stored = readAllRaw()[k];
  return {
    key: k,
    service,
    conversationId,
    title: stored?.title || title || conversationId,
    sourceLanguage: stored?.sourceLanguage || s.defaultSourceLanguage,
    targetLanguage: stored?.targetLanguage || s.defaultTargetLanguage,
    translateReceived: stored?.translateReceived ?? s.autoTranslateIncoming,
    translateSent: stored?.translateSent ?? s.autoTranslateOutgoing,
    translateGroup: stored?.translateGroup ?? true,
    translateModel: stored?.translateModel || s.translateModel,
    bilingualDisplay: stored?.bilingualDisplay ?? s.bilingualDisplay,
    bilingualSendMode: stored?.bilingualSendMode || s.bilingualSendMode,
    updatedAt: stored?.updatedAt || new Date().toISOString()
  };
}

export function saveConversationPreference(
  service: 'whatsapp' | 'signal',
  conversationId: string,
  patch: Partial<ConversationPreference>
): ConversationPreference {
  const all = readAllRaw();
  const current = getConversationPreference(service, conversationId, patch.title || '');
  const next: ConversationPreference = {
    ...current,
    ...patch,
    key: key(service, conversationId),
    service,
    conversationId,
    updatedAt: new Date().toISOString()
  };
  all[next.key] = next;
  writeAll(all);
  return next;
}

export function listConversationPreferences(): ConversationPreference[] {
  return Object.values(readAllRaw()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
