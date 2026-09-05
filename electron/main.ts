import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { loadSettings, saveSettings } from './settings';
import { clearHistory, readHistory } from './history';
import { translateAndRecord } from './translationService';
import { ensureSignal, retrySignal, stopSignal, stopAllSignals, signalStatus, signalEvents } from './signalBridge';
import { clearSignalMessages, readSignalMessages } from './signalStore';
import { clearWhatsAppMessages, readWhatsAppMessages, upsertWhatsAppMessage } from './whatsappStore';
import { getConversationPreference, listConversationPreferences, saveConversationPreference } from './conversationPrefs';
import { installSignalPipeline, signalCatalog, sendSignal } from './signalPipeline';
import { installSurfaceIPC, registerSurface, selectSurface, surfaceSession, surfaceUrl, refreshSurfaces } from './signalSurface';
let win: BrowserWindow | null = null;
let quitting = false;
const approvedAttachments = new Set<string>();
function mainHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!win || event.sender.id !== win.webContents.id || event.senderFrame !== win.webContents.mainFrame) throw new Error('FORBIDDEN');
    return handler(event, ...args);
  });
}
function sessionId(id: unknown): string {
  if (typeof id !== 'string' || !loadSettings().signalSessions.some(x => x.id === id && x.enabled)) throw new Error('INVALID_SESSION'); return id;
}
function createWindow() {
  win = new BrowserWindow({ width: 1580, height: 930, minWidth: 1180, minHeight: 720, backgroundColor: '#0b1017', title: 'ChatTranslator Lite', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload; preferences.nodeIntegration = false; preferences.contextIsolation = true; preferences.sandbox = true;
    const signalId = surfaceSession(params.src);
    if (signalId) {
      preferences.preload = path.join(__dirname, 'signalChatPreload.js');
      preferences.partition = `signal-surface-${signalId}`;
      return;
    }
    try {
      const origin = new URL(params.src).origin;
      if (!['https://web.whatsapp.com', 'https://web.telegram.org'].includes(origin)) event.preventDefault();
      if (origin === 'https://web.telegram.org' && !String(preferences.partition || '').startsWith('persist:caisheng-telegram-')) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  win.webContents.on('did-attach-webview', (_event, contents) => { registerSurface(contents, win!.webContents); });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) void win.loadURL(dev); else void win.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => { installSignalPipeline(); installSurfaceIPC(); createWindow(); });
  app.on('second-instance', () => { win?.restore(); win?.focus(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', event => {
  if (quitting) return; event.preventDefault(); quitting = true;
  void stopAllSignals().finally(() => app.quit());
});
for (const name of ['status', 'message', 'translation-error', 'select-text']) signalEvents.on(name, payload => {
  if (win && !win.isDestroyed()) win.webContents.send(`signal:${name}`, payload);
});
mainHandle('settings:get', () => loadSettings());
mainHandle('settings:save', async (_e, data) => {
  const previous = loadSettings(); const next = saveSettings(data || {});
  await Promise.all(previous.signalSessions.filter(old => !next.signalEnabled || !next.signalSessions.some(s => s.id === old.id && s.enabled)).map(s => stopSignal(s.id)));
  refreshSurfaces(); return next;
});
mainHandle('history:list', () => readHistory());
mainHandle('history:clear', () => clearHistory());
mainHandle('translate:text', (_e, input) => translateAndRecord(input));
mainHandle('prefs:get', (_e, service, id, title) => getConversationPreference(service, id, title));
mainHandle('prefs:save', (_e, service, id, patch) => { const result = saveConversationPreference(service, id, patch || {}); refreshSurfaces(); return result; });
mainHandle('prefs:list', () => listConversationPreferences());
mainHandle('whatsapp:messages', (_e, chatId, limit) => readWhatsAppMessages(chatId, limit));
mainHandle('whatsapp:store-message', (_e, item) => upsertWhatsAppMessage(item));
mainHandle('whatsapp:clear-messages', (_e, chatId) => clearWhatsAppMessages(chatId));
mainHandle('signal:ensure', (_e, id) => ensureSignal(sessionId(id)));
mainHandle('signal:status', (_e, id) => signalStatus(sessionId(id)));
mainHandle('signal:retry', (_e, id) => retrySignal(sessionId(id)));
mainHandle('signal:catalog', (_e, id) => signalCatalog(sessionId(id)));
mainHandle('signal:messages', (_e, conversationId, limit, id) => readSignalMessages(conversationId, limit, sessionId(id)));
mainHandle('signal:clear-messages', (_e, conversationId, id) => { clearSignalMessages(conversationId, sessionId(id)); refreshSurfaces(); });
mainHandle('signal:send', (_e, id, input) => {
  if (input.attachments && (!Array.isArray(input.attachments) || input.attachments.some((file: unknown) => typeof file !== 'string' || !approvedAttachments.has(file)))) throw new Error('INVALID_ATTACHMENT');
  return sendSignal(sessionId(id), input);
});
mainHandle('signal:surface-url', (_e, id) => surfaceUrl(sessionId(id)));
mainHandle('signal:surface-select', (e, guestId, id, conversationId) => selectSurface(e.sender, guestId, sessionId(id), conversationId));
mainHandle('dialog:pick-files', async () => {
  const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], title: '选择要发送的文件' };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  result.filePaths.forEach(file => approvedAttachments.add(file)); return result.filePaths;
});
