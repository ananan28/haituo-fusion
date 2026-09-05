import { signalEvents, signalRpc } from './signalBridge';
import { readSignalMessages, upsertSignalMessage, type StoredSignalMessage } from './signalStore';
import { getConversationPreference } from './conversationPrefs';
import { loadSettings } from './settings';
import { translateAndRecord } from './translationService';
import { parseSignalEvent, normalizeContacts, normalizeGroups } from './signalMessages';
import type { SignalConversation } from './signalTypes';
export function signalConversationKey(sessionId: string, id: string) { return sessionId === 'signal-main' ? id : `${sessionId}:${id}`; }
const tasks = new Map<string, Promise<StoredSignalMessage>>();
let inFlight = 0; const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= 3) await new Promise<void>(resolve => waiting.push(resolve));
  else inFlight++;
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else inFlight--; }
}
export function translateSignalMessage(sessionId: string, conversationId: string, id: string): Promise<StoredSignalMessage> {
  const key = JSON.stringify([sessionId, conversationId, id]); const existing = tasks.get(key); if (existing) return existing;
  const task = slot(async () => {
    const item = readSignalMessages(conversationId, 4000, sessionId).find(x => x.id === id);
    if (!item) throw new Error('MESSAGE_NOT_FOUND');
    if (item.translatedText || item.direction !== 'in' || !item.text.trim()) return item;
    const s = loadSettings(); const pref = getConversationPreference('signal', signalConversationKey(sessionId, conversationId), item.sender);
    if (!s.signalEnabled || !s.signalSessions.some(x => x.id === sessionId && x.enabled) || !pref.translateReceived || (item.conversationKind === 'group' && !pref.translateGroup)) return item;
    const result = await translateAndRecord({ text: item.text, service: 'signal', sessionId, conversationId: signalConversationKey(sessionId, conversationId), conversationTitle: item.sender, srcLang: pref.sourceLanguage, targetLang: pref.targetLanguage, model: pref.translateModel, direction: 'in' });
    const current = readSignalMessages(conversationId, 4000, sessionId).find(x => x.id === id);
    if (!current) return item; // Clearing while translating must not resurrect messages.
    const next = upsertSignalMessage({ ...current, translatedText: result.translatedText }, sessionId);
    signalEvents.emit('message', { sessionId, message: next }); return next;
  }).finally(() => tasks.delete(key));
  tasks.set(key, task); return task;
}
let installed = false;
export function installSignalPipeline() {
  if (installed) return; installed = true;
  signalEvents.on('event', ({ sessionId, payload }) => {
    const parsed = parseSignalEvent(payload); if (!parsed) return;
    if (readSignalMessages(parsed.conversationId, 4000, sessionId).some(x => x.id === parsed.id)) return;
    upsertSignalMessage(parsed, sessionId); signalEvents.emit('message', { sessionId, message: parsed });
    void translateSignalMessage(sessionId, parsed.conversationId, parsed.id).catch(() => signalEvents.emit('translation-error', { sessionId, messageId: parsed.id, message: '此条消息暂未翻译，可在气泡中重试。' }));
  });
}
export async function signalCatalog(sessionId: string): Promise<SignalConversation[]> {
  const [contacts, groups] = await Promise.allSettled([signalRpc('listContacts', {}, sessionId), signalRpc('listGroups', {}, sessionId)]);
  const items = [...(contacts.status === 'fulfilled' ? normalizeContacts(contacts.value) : []), ...(groups.status === 'fulfilled' ? normalizeGroups(groups.value) : [])];
  const map = new Map(items.map(x => [x.id, x]));
  for (const msg of readSignalMessages(undefined, 4000, sessionId)) {
    const old = map.get(msg.conversationId);
    map.set(msg.conversationId, { ...(old || { id: msg.conversationId, kind: msg.conversationKind, title: msg.direction === 'in' && msg.conversationKind === 'contact' ? msg.sender : msg.peer, subtitle: msg.peer, recipient: msg.conversationKind === 'contact' ? msg.peer : undefined, groupId: msg.conversationKind === 'group' ? msg.peer : undefined }), lastAt: msg.at, lastText: msg.text });
  }
  if (contacts.status === 'rejected' && groups.status === 'rejected' && !map.size) throw new Error('会话同步暂未完成，请稍后刷新。');
  return [...map.values()].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}
export async function sendSignal(sessionId: string, input: { conversationId: string; text: string; smart?: boolean; originalText?: string; translatedText?: string; attachments?: string[] }) {
  const { conversationId } = input;
  if (!/^(contact|group):.+/.test(conversationId) || typeof input.text !== 'string' || input.text.length > 100000) throw new Error('INVALID_MESSAGE');
  const kind = conversationId.startsWith('group:') ? 'group' : 'contact'; const peer = conversationId.slice(kind.length + 1);
  const pref = getConversationPreference('signal', signalConversationKey(sessionId, conversationId));
  let text = input.text.trim(); let originalText = input.originalText; let translatedText = input.translatedText;
  if (!text && !input.attachments?.length) throw new Error('EMPTY_MESSAGE');
  if (text && input.smart && pref.translateSent) {
    const out = await translateAndRecord({ text, service: 'signal', sessionId, conversationId: signalConversationKey(sessionId, conversationId), srcLang: pref.sourceLanguage, targetLang: pref.targetLanguage, model: pref.translateModel, direction: 'out' });
    originalText = text; translatedText = out.translatedText;
    text = pref.bilingualSendMode === 'both' ? `${text}\n${translatedText}` : pref.bilingualSendMode === 'original' ? text : translatedText;
  }
  const out = await signalRpc('send', { ...(kind === 'group' ? { groupId: peer } : { recipient: [peer] }), message: text, ...(input.attachments?.length ? { attachments: input.attachments } : {}) }, sessionId);
  const at = Number(out?.timestamp || Date.now());
  const msg = upsertSignalMessage({ id: `out:${conversationId}:${at}`, conversationId, conversationKind: kind, peer, sender: '我', direction: 'out', text: text || `[附件 ${input.attachments?.length}]`, originalText, translatedText, attachments: input.attachments, at }, sessionId);
  signalEvents.emit('message', { sessionId, message: msg }); return msg;
}
