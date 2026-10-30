'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const managedGuests=new WeakSet();
// Never attach CDP to a just-created guest. Electron 44 can initialize its
// sandbox before startupData exists. Main-world hooks now run synchronously
// from the sandboxed preload, before page scripts, without a debugger or gate.
function createBootstrap({app,webContents,log=()=>{},preloadPath,timers={setTimeout,clearTimeout},blankTimeout=45000}){
 const sessions=new WeakMap,watchers=new WeakMap;
 const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='web.whatsapp.com'}catch{return false}};
 function validate(){if(!path.isAbsolute(preloadPath||'')||!fs.statSync(preloadPath).isFile())throw Error('WhatsApp preload missing or not absolute');return pathToFileURL(preloadPath).href}
 function prepare(preferences,params){if(!allowed(params.src))throw Error('Invalid WhatsApp guest URL');const fileURL=validate();
  preferences.preload=preloadPath;preferences.sandbox=true;preferences.contextIsolation=true;preferences.nodeIntegration=false;preferences.nodeIntegrationInWorker=false;preferences.nodeIntegrationInSubFrames=false;
  params.preload=fileURL;return fileURL;
 }
 function installSession(session,url){if(url){if(!allowed(url))throw Error('Invalid WhatsApp recovery URL');sessions.set(session,url)}else if(!sessions.has(session))sessions.set(session,'https://web.whatsapp.com/?lang=zh_CN')}
 function attach(contents,host){if(!sessions.has(contents.session))return false;if(watchers.has(contents))return true;
  managedGuests.add(contents);
  const target=sessions.get(contents.session);let timer,recoveryTimer,retries=0,ready=false,loaded=false,domReady=false,dead=false,failed=false,announcedReady=false,generation=0;
  const alive=()=>!dead&&!contents.isDestroyed();
  const cancel=()=>{if(timer!==undefined)timers.clearTimeout(timer);timer=undefined};
  const cancelRecovery=()=>{if(recoveryTimer!==undefined)timers.clearTimeout(recoveryTimer);recoveryTimer=undefined};
  const execute=source=>{if(host&&!host.isDestroyed())host.executeJavaScript(source).catch(error=>log('WA guest status update failed: '+error.message))};
  const clear=()=>execute('('+clearGuestStatus.toString()+')('+contents.id+')');
  const show=reason=>{announcedReady=false;log('WA guest startup error: '+reason+' [preload='+ready+', dom='+domReady+', load='+loaded+']');execute('('+showGuestStatus.toString()+')('+JSON.stringify({id:contents.id,reason,target})+')')};
  function complete(){if(!alive()||failed||!ready||!(domReady||loaded)||!allowed(contents.getURL()))return false;cancel();cancelRecovery();retries=0;if(!announcedReady){announcedReady=true;clear()}return true}
  const probe=()=>{if(alive()&&allowed(contents.getURL()))contents.send?.('haituo-wa-preload-probe')};
  function schedule(){cancel();if(alive())timer=timers.setTimeout(check,blankTimeout)}
  function recover(reason){if(!alive()||recoveryTimer!==undefined||retries>=2)return;
   const delay=1500*Math.pow(2,retries++);log('WA guest recovery '+retries+': '+reason);
   recoveryTimer=timers.setTimeout(()=>{recoveryTimer=undefined;if(!alive())return;ready=false;loaded=false;domReady=false;failed=false;schedule();contents.loadURL(target).catch(()=>{})},delay);
  }
  async function check(){timer=undefined;if(!alive()||complete())return;probe();
   // dom-ready can precede attachment on a warm renderer. Read only document
   // readiness, never chat contents, to recover that missed lifecycle event.
   const token=generation;
   if(ready&&allowed(contents.getURL())&&typeof contents.executeJavaScript==='function'){
    try{const state=await contents.executeJavaScript('({interactive:document.readyState!=="loading",body:!!document.body})');if(!alive()||token!==generation)return;if(state?.interactive&&state.body)domReady=true;if(complete())return}catch{}
   }
   if(!alive()||token!==generation)return;
   const url=contents.getURL();show(!url||url==='about:blank'?'WhatsApp 页面尚未启动':'WhatsApp 页面启动超时');recover('startup timeout');
  }
  contents.on('ipc-message',(_event,channel,payload)=>{if(channel!=='haituo-wa-preload-ready'||payload?.hooksReady!==true)return;if(payload.url&&payload.url!==contents.getURL())return;ready=true;log('WA sandbox preload + isolated observer ready');complete()});
  contents.on('did-start-navigation',(_e,_url,inPlace,main)=>{if(main&&!inPlace){generation++;announcedReady=false;cancelRecovery();ready=false;loaded=false;domReady=false;failed=false;clear();schedule()}});
  contents.on('dom-ready',()=>{domReady=true;probe();complete()});
  contents.on('did-finish-load',()=>{loaded=true;probe();complete()});
  contents.on('preload-error',(_event,_file,error)=>{ready=false;show('WhatsApp preload 启动失败：'+String(error?.message||error).slice(0,200));recover('preload error')});
  contents.on('did-fail-load',(_event,code,_description,url,main)=>{
   if(!main||code===-3||!allowed(url))return;
   if(ready&&(domReady||loaded)){log('WA navigation failure after usable page; keeping current session ('+code+')');return}
   failed=true;cancel();show('WhatsApp 页面加载失败（'+code+'）');
   if([-2,-7,-21,-100,-101,-102,-105,-106,-109,-118,-130].includes(code))recover('network '+code);
  });
  contents.on('render-process-gone',(_event,details)=>{generation++;ready=false;loaded=false;domReady=false;failed=true;cancel();show('WhatsApp 渲染进程退出：'+details.reason);recover('renderer '+details.reason)});
  contents.once('destroyed',()=>{managedGuests.delete(contents);dead=true;generation++;cancel();cancelRecovery();clear()});watchers.set(contents,{check});schedule();
  if(host&&!host.isDestroyed())execute('('+mirrorGuestPreload.toString()+')('+JSON.stringify({id:contents.id,preload:validate()})+')');
  return true;
 }
 return{prepare,installSession,attach};
}
function mirrorGuestPreload({id,preload}){for(const node of document.querySelectorAll('webview')){try{if(node.getWebContentsId()===id){if(node.getAttribute('preload')!==preload)node.setAttribute('preload',preload);return true}}catch{}}return false}
function clearGuestStatus(id){document.querySelector('[data-haituo-wa-startup="'+id+'"]')?.remove()}
function showGuestStatus({id,preload,reason,target}){for(const node of document.querySelectorAll('webview')){try{if(node.getWebContentsId()!==id)continue}catch{continue}
 let panel=document.querySelector('[data-haituo-wa-startup="'+id+'"]');if(!panel){panel=document.createElement('section');panel.dataset.haituoWaStartup=String(id);Object.assign(panel.style,{position:'absolute',inset:'0',zIndex:'5',background:'Canvas',color:'CanvasText',padding:'32px',boxSizing:'border-box'});const text=document.createElement('p'),button=document.createElement('button');button.textContent='重试 WhatsApp';button.addEventListener('click',()=>{text.textContent='正在重新打开 WhatsApp…';node.loadURL(target).catch(error=>{text.textContent='WhatsApp 重试失败：'+String(error.message).slice(0,200)})});panel.append(text,button);node.after(panel);const update=()=>{panel.style.display=node.dataset.haituoActive==='false'?'none':'block'};const observer=new MutationObserver(()=>{if(!panel.isConnected||!node.isConnected){panel.remove();observer.disconnect()}else update()});observer.observe(node,{attributes:true,attributeFilter:['data-haituo-active']});observer.observe(node.parentNode,{childList:true});update()}panel.querySelector('p').textContent=reason+'。正在尝试恢复；也可点击重试。不会清除登录数据。';return true}return false}
module.exports={createBootstrap,owns:contents=>managedGuests.has(contents)};
