import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webContents, ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron';
import { readSignalMessages } from './signalStore';
import { loadSettings } from './settings';
import { getConversationPreference } from './conversationPrefs';
import { signalConversationKey, translateSignalMessage } from './signalPipeline';
import { signalEvents } from './signalBridge';
const guests = new Map<number, { contents: WebContents; sessionId: string; conversationId: string }>();
export function surfaceBase() { return process.env.VITE_DEV_SERVER_URL ? new URL('/signal-chat.html', process.env.VITE_DEV_SERVER_URL).href : pathToFileURL(path.join(__dirname, '../dist/signal-chat.html')).href; }
export function surfaceSession(raw: string): string | null {
  try {
    const url = new URL(raw); const base = new URL(surfaceBase());
    if (url.protocol !== base.protocol || url.host !== base.host || url.pathname !== base.pathname || url.hash) return null;
    const id = url.searchParams.get('sessionId');
    return id && loadSettings().signalSessions.some(x => x.id === id && x.enabled) ? id : null;
  } catch { return null; }
}
export function surfaceUrl(sessionId: string) {
  if (!loadSettings().signalSessions.some(x => x.id === sessionId && x.enabled)) throw new Error('INVALID_SESSION');
  const url = new URL(surfaceBase()); url.searchParams.set('sessionId', sessionId); return url.href;
}
function validate(e: IpcMainInvokeEvent) {
  const id = surfaceSession(e.senderFrame?.url || '');
  if (!id || e.senderFrame !== e.sender.mainFrame || !e.sender.hostWebContents) throw new Error('FORBIDDEN');
  const guest = guests.get(e.sender.id);
  if (!guest || guest.sessionId !== id) throw new Error('UNKNOWN_SURFACE'); return guest;
}
function push(guest: { contents: WebContents; sessionId: string; conversationId: string }) {
  if (guest.contents.isDestroyed()) return;
  const pref = getConversationPreference('signal', signalConversationKey(guest.sessionId, guest.conversationId));
  const s = loadSettings();
  guest.contents.send('signal:surface-messages', { conversationId: guest.conversationId, messages: guest.conversationId ? readSignalMessages(guest.conversationId, 500, guest.sessionId) : [], bilingual: pref.bilingualDisplay, color: /^#[0-9a-f]{6}$/i.test(s.translationFontColor) ? s.translationFontColor : '#55baff', fontSize: Math.max(10, Math.min(s.translationFontSize, 28)), autoHistory: s.autoTranslateHistory });
}
export function registerSurface(contents: WebContents, owner: WebContents) {
  contents.on('did-finish-load', () => {
    const sessionId = surfaceSession(contents.getURL());
    if (!sessionId || contents.hostWebContents?.id !== owner.id) return;
    if (!guests.has(contents.id)) guests.set(contents.id, { contents, sessionId, conversationId: '' });
    push(guests.get(contents.id)!);
  });
  contents.once('destroyed', () => guests.delete(contents.id));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (surfaceSession(contents.getURL()) && url !== contents.getURL()) event.preventDefault(); });
}
export function selectSurface(owner: WebContents, guestId: number, sessionId: string, conversationId: string) {
  let guest = guests.get(guestId);
  const contents = webContents.fromId(guestId);
  if (!guest && contents && contents.hostWebContents?.id === owner.id && surfaceSession(contents.getURL()) === sessionId) {
    guest = { contents, sessionId, conversationId: '' }; guests.set(guestId, guest);
  }
  if (!guest || guest.sessionId !== sessionId || guest.contents.hostWebContents?.id !== owner.id || !/^(contact|group):.+/.test(conversationId)) throw new Error('INVALID_SURFACE_SELECTION');
  guest.conversationId = conversationId; push(guest); return true;
}
export function refreshSurfaces() { for (const guest of guests.values()) push(guest); }
export function installSurfaceIPC() {
  ipcMain.handle('signal:surface-translate', async (e, conversationId, messageId) => {
    const guest = validate(e);
    if (guest.conversationId !== conversationId || typeof messageId !== 'string') throw new Error('INVALID_MESSAGE');
    const msg = await translateSignalMessage(guest.sessionId, conversationId, messageId);
    return { translatedText: msg.translatedText || '' };
  });
  ipcMain.handle('signal:surface-copy', async (e, conversationId, messageId) => {
    const guest = validate(e); if (guest.conversationId !== conversationId) throw new Error('INVALID_CONVERSATION');
    const msg = readSignalMessages(conversationId, 500, guest.sessionId).find(x => x.id === messageId);
    if (msg) signalEvents.emit('select-text', { sessionId: guest.sessionId, message: msg });
  });
  signalEvents.on('message', ({ sessionId, message }) => { for (const guest of guests.values()) if (guest.sessionId === sessionId && guest.conversationId === message.conversationId) push(guest); });
}
