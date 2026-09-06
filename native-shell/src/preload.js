'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listeners = new Map();
contextBridge.exposeInMainWorld('caisheng', {
  catalog: () => invoke('catalog:list'),
  services: () => invoke('services:list'),
  add: id => invoke('services:add', id),
  update: (id, patch) => invoke('services:update', id, patch),
  move: (id, direction) => invoke('services:move', id, direction),
  remove: id => invoke('services:remove', id),
  open: service => invoke('services:open', typeof service === 'string' ? service : service?.id),
  refresh: (id, mode) => invoke('services:refresh', id, mode),
  testProxy: id => invoke('services:test-proxy', id),
  hide: () => invoke('view:hide'),
  getSettings: () => invoke('settings:get'),
  setSettings: patch => invoke('settings:set', patch),
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  closeWindow: () => invoke('window:close'),
  showDataFolder: () => invoke('window:show-data'),
  translation: {
    getSettings: () => invoke('translation:settings:get'),
    updateSettings: patch => invoke('translation:settings:update', patch),
    updateAccount: (accountId, patch) => invoke('translation:account:update', accountId, patch),
    getScope: (accountId, conversationId) => invoke('translation:scope:get', accountId, conversationId),
    updateScope: (accountId, conversationId, patch) => invoke('translation:scope:update', accountId, conversationId, patch),
    translate: request => invoke('translation:translate', request),
    validate: payload => invoke('translation:validate', payload),
    clearCache: () => invoke('translation:cache:clear')
  },
  onServiceState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('service:state', listener); listeners.set(callback, listener);
    return () => { ipcRenderer.removeListener('service:state', listener); listeners.delete(callback); };
  },
  onSignalRefresh: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('signal:refresh', listener);
    return () => ipcRenderer.removeListener('signal:refresh', listener);
  },
  signal: {
    state: id => invoke('signal:state', id), link: id => invoke('signal:link', id), start: id => invoke('signal:start', id),
    conversations: id => invoke('signal:conversations', id), history: (id, conversationId, limit) => invoke('signal:history', id, conversationId, limit),
    send: (id,to,text,files,quote) => invoke('signal:send', id,to,text,files,quote),
    reaction: (id,to,emoji,target,remove) => invoke('signal:reaction', id,to,emoji,target,remove),
    edit: (id,to,timestamp,text) => invoke('signal:edit', id,to,timestamp,text), delete: (id,to,timestamp) => invoke('signal:delete', id,to,timestamp),
    reconnect: id => invoke('signal:reconnect', id), stop: id => invoke('signal:stop', id),
    onState: callback => { const listener=(_e,x)=>callback(x); ipcRenderer.on('signal:state',listener); return()=>ipcRenderer.removeListener('signal:state',listener); },
    onMessage: callback => { const listener=(_e,x)=>callback(x); ipcRenderer.on('signal:message',listener); return()=>ipcRenderer.removeListener('signal:message',listener); }
  },
  ready: () => ipcRenderer.send('renderer:ready')
});
