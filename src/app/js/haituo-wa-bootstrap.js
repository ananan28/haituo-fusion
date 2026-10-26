'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
// Never attach CDP to a just-created guest. Electron 44 can initialize its
// sandbox before startupData exists. Main-world hooks now run synchronously
// from the sandboxed preload, before page scripts, without a debugger or gate.
function createBootstrap({app,webContents,log=()=>{},preloadPath,timers={setTimeout,clearTimeout},blankTimeout=12000}){
 const sessions=new WeakMap,watchers=new WeakMap;
 function validate(){if(!path.isAbsolute(preloadPath||'')||!fs.statSync(preloadPath).isFile())throw Error('WhatsApp preload missing or not absolute');return pathToFileURL(preloadPath).href}
 function prepare(preferences,params){const url=new URL(params.src);if(url.protocol!=='https:'||url.hostname!=='web.whatsapp.com')throw Error('Invalid WhatsApp guest URL');const fileURL=validate();
  preferences.preload=preloadPath;preferences.sandbox=true;preferences.contextIsolation=true;preferences.nodeIntegration=false;preferences.nodeIntegrationInWorker=false;preferences.nodeIntegrationInSubFrames=false;
  params.preload=fileURL;return fileURL;
 }
 function installSession(session,url){if(url){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='web.whatsapp.com')throw Error('Invalid WhatsApp recovery URL');sessions.set(session,url)}else if(!sessions.has(session))sessions.set(session,'https://web.whatsapp.com/?lang=zh_CN')}
 function attach(contents,host){if(!sessions.has(contents.session)||watchers.has(contents))return;const target=sessions.get(contents.session);let timer,retries=0,ready=false,loaded=false,dead=false;
  const cancel=()=>{if(timer)timers.clearTimeout(timer);timer=undefined};
  const show=(reason)=>{log('WA guest startup error: '+reason);if(!host||host.isDestroyed())return;host.executeJavaScript('('+showGuestStatus.toString()+')('+JSON.stringify({id:contents.id,preload:validate(),reason,target})+')').catch(error=>log('WA guest error panel failed: '+error.message))};
  function schedule(){cancel();timer=timers.setTimeout(check,blankTimeout)}
  function check(){timer=undefined;if(dead||contents.isDestroyed())return;const url=contents.getURL();if(url&&url!=='about:blank'&&loaded&&ready)return;
   show(!url||url==='about:blank'?'WhatsApp 页面停在 about:blank':'WhatsApp 预加载或页面启动未完成');
   if((!url||url==='about:blank')&&retries++<2){log('WA guest retry '+retries);contents.loadURL(target).catch(error=>log('WA guest retry failed: '+error.message));schedule()}
  }
  contents.on('ipc-message',(_event,channel,payload)=>{if(channel==='haituo-wa-preload-ready'&&payload?.hooksReady===true){ready=true;log('WA sandbox preload + synchronous main-world hooks ready');if(loaded)cancel()}});
  contents.on('did-start-navigation',(_e,_url,inPlace,main)=>{if(main&&!inPlace){ready=false;loaded=false;schedule()}});
  contents.on('did-finish-load',()=>{loaded=true;if(ready&&contents.getURL()&&contents.getURL()!=='about:blank'){cancel();host?.executeJavaScript('('+clearGuestStatus.toString()+')('+contents.id+')').catch(()=>{})}});
  contents.on('preload-error',(_event,_file,error)=>show('WhatsApp preload 启动失败：'+String(error?.message||error).slice(0,200)));
  contents.on('render-process-gone',(_event,details)=>{ready=false;loaded=false;show('WhatsApp 渲染进程退出：'+details.reason);schedule()});
  contents.once('destroyed',()=>{dead=true;cancel()});watchers.set(contents,{check});schedule();
  // Mirror the authoritative main-process preference into the DOM for 9444
  // inspection. Electron already received the absolute path in will-attach.
  if(host&&!host.isDestroyed())host.executeJavaScript('('+mirrorGuestPreload.toString()+')('+JSON.stringify({id:contents.id,preload:validate()})+')').catch(()=>{});
 }
 return{prepare,installSession,attach};
}
function mirrorGuestPreload({id,preload}){for(const node of document.querySelectorAll('webview')){try{if(node.getWebContentsId()===id){if(node.getAttribute('preload')!==preload)node.setAttribute('preload',preload);return true}}catch{}}return false}
function clearGuestStatus(id){document.querySelector('[data-haituo-wa-startup="'+id+'"]')?.remove()}
function showGuestStatus({id,preload,reason,target}){for(const node of document.querySelectorAll('webview')){try{if(node.getWebContentsId()!==id)continue}catch{continue}
 let panel=document.querySelector('[data-haituo-wa-startup="'+id+'"]');if(!panel){panel=document.createElement('section');panel.dataset.haituoWaStartup=String(id);Object.assign(panel.style,{position:'absolute',inset:'0',zIndex:'5',background:'Canvas',color:'CanvasText',padding:'32px',boxSizing:'border-box'});const text=document.createElement('p'),button=document.createElement('button');button.textContent='重试 WhatsApp';button.addEventListener('click',()=>{text.textContent='正在重新打开 WhatsApp…';node.loadURL(target).catch(error=>{text.textContent='WhatsApp 重试失败：'+String(error.message).slice(0,200)})});panel.append(text,button);node.after(panel);const update=()=>{panel.style.display=node.dataset.haituoActive==='false'?'none':'block'};const observer=new MutationObserver(()=>{if(!panel.isConnected||!node.isConnected){panel.remove();observer.disconnect()}else update()});observer.observe(node,{attributes:true,attributeFilter:['data-haituo-active']});observer.observe(node.parentNode,{childList:true});update()}panel.querySelector('p').textContent=reason+'。请点击重试；诊断端口 9444 可检查 preload。';return true}return false}
module.exports={createBootstrap};
