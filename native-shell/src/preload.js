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
  open: service => invoke('services:open', service),
  refresh: (id, mode) => invoke('services:refresh', id, mode),
  testProxy: id => invoke('services:test-proxy', id),
  hide: () => invoke('view:hide'),
  getSettings: () => invoke('settings:get'),
  setSettings: patch => invoke('settings:set', patch),
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  closeWindow: () => invoke('window:close'),
  showDataFolder: () => invoke('window:show-data'),
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
  ready: () => ipcRenderer.send('renderer:ready')
});
