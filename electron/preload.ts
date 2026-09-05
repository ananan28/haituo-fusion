import { contextBridge, ipcRenderer } from 'electron';

function subscribe(channel: string, cb: (data: unknown) => void) {
  const fn = (_e: unknown, data: unknown) => cb(data);
  ipcRenderer.on(channel, fn); return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('chatLite', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data: unknown) => ipcRenderer.invoke('settings:save', data)
  },
  prefs: {
    get: (service: string, conversationId: string, title?: string) => ipcRenderer.invoke('prefs:get', service, conversationId, title || ''),
    save: (service: string, conversationId: string, patch: unknown) => ipcRenderer.invoke('prefs:save', service, conversationId, patch || {}),
    list: () => ipcRenderer.invoke('prefs:list')
  },
  translation: {
    translate: (data: unknown) => ipcRenderer.invoke('translate:text', data),
    history: () => ipcRenderer.invoke('history:list'),
    clearHistory: () => ipcRenderer.invoke('history:clear')
  },
  whatsapp: {
    messages: (chatId?: string, limit?: number) => ipcRenderer.invoke('whatsapp:messages', chatId, limit),
    storeMessage: (item: unknown) => ipcRenderer.invoke('whatsapp:store-message', item),
    clearMessages: (chatId?: string) => ipcRenderer.invoke('whatsapp:clear-messages', chatId)
  },
  signal: {
    ensure: (id: string) => ipcRenderer.invoke('signal:ensure', id),
    status: (id: string) => ipcRenderer.invoke('signal:status', id),
    retry: (id: string) => ipcRenderer.invoke('signal:retry', id),
    catalog: (id: string) => ipcRenderer.invoke('signal:catalog', id),
    messages: (conversationId: string | undefined, limit: number | undefined, id: string) => ipcRenderer.invoke('signal:messages', conversationId, limit, id),
    clearMessages: (conversationId: string, id: string) => ipcRenderer.invoke('signal:clear-messages', conversationId, id),
    send: (id: string, input: unknown) => ipcRenderer.invoke('signal:send', id, input),
    surfaceUrl: (id: string) => ipcRenderer.invoke('signal:surface-url', id),
    selectSurface: (guestId: number, id: string, conversationId: string) => ipcRenderer.invoke('signal:surface-select', guestId, id, conversationId),
    onStatus: (cb: (data: unknown) => void) => subscribe('signal:status', cb),
    onMessage: (cb: (data: unknown) => void) => subscribe('signal:message', cb),
    onTranslationError: (cb: (data: unknown) => void) => subscribe('signal:translation-error', cb),
    onSelectText: (cb: (data: unknown) => void) => subscribe('signal:select-text', cb)
  },
  dialog: {
    pickFiles: () => ipcRenderer.invoke('dialog:pick-files')
  }
});
