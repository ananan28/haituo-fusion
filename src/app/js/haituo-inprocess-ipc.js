'use strict';
// Capture the public registration API once, before handlers register. No access
// to Electron's private _invokeHandlers map; dormant without the feature flag.
function capture(ipcMain){const handlers=new Map;const handle=ipcMain.handle.bind(ipcMain),remove=ipcMain.removeHandler.bind(ipcMain);ipcMain.handle=(channel,fn)=>{const result=handle(channel,fn);handlers.set(channel,fn);return result};ipcMain.removeHandler=channel=>{handlers.delete(channel);return remove(channel)};return{async dispatch(channel,args,event){if(typeof channel!=='string'||!Array.isArray(args))throw Error('Invalid inprocess IPC request');const fn=handlers.get(channel);if(fn)return fn(event,...args);if(ipcMain.listenerCount(channel)){ipcMain.emit(channel,event,...args);return;}throw Error('Unknown inprocess IPC channel: '+channel)}}}
function wrapRenderer(ipc){const invoke=ipc.invoke.bind(ipc),send=ipc.send.bind(ipc),on=ipc.on.bind(ipc),remove=ipc.removeListener.bind(ipc);const listeners=new Map;
 ipc.invoke=(channel,...args)=>invoke('haituo-child-invoke',{channel,args});ipc.send=(channel,...args)=>send('haituo-child-send',{channel,args});
 const add=(channel,fn,once)=>{const wrapped=(event,payload)=>{if(once)ipc.removeListener(channel,fn);fn(event,...(payload?.args||[]))};let list=listeners.get(channel);if(!list){list=[];listeners.set(channel,list)}list.push({fn,wrapped});on('haituo-child-push:'+channel,wrapped);return ipc};
 ipc.on=(channel,fn)=>add(channel,fn,false);ipc.once=(channel,fn)=>add(channel,fn,true);ipc.removeListener=(channel,fn)=>{const list=listeners.get(channel)||[];const index=list.map(x=>x.fn).lastIndexOf(fn);if(index>=0){const [entry]=list.splice(index,1);remove('haituo-child-push:'+channel,entry.wrapped)}if(!list.length)listeners.delete(channel);return ipc};ipc.off=ipc.removeListener;
 const removeAll=ipc.removeAllListeners.bind(ipc);ipc.removeAllListeners=channel=>{if(channel===undefined){for(const key of listeners.keys())removeAll('haituo-child-push:'+key);listeners.clear();}else{removeAll('haituo-child-push:'+channel);listeners.delete(channel);}return ipc};return ipc;
}
module.exports={capture,wrapRenderer};
