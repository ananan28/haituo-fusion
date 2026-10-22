'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('haituoScreenshot',{select:rect=>ipcRenderer.invoke('haituo:screenshot-select',rect),cancel:()=>ipcRenderer.send('haituo:screenshot-cancel'),copyImage:data=>ipcRenderer.invoke('haituo:screenshot-copy-image',data),copy:text=>ipcRenderer.send('haituo:screenshot-copy',text),onResult:callback=>ipcRenderer.on('haituo:screenshot-result',(_event,value)=>callback(value))});
