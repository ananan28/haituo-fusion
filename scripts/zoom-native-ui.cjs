'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async function(e,resources){
 const security=require(path.join(resources,'js/haituo-zoom-security.js'));
 const preload=path.join(resources,'js/haituo-zoom-preload.js');
 const win=new e.BrowserWindow({show:true,width:700,height:600,webPreferences:{sandbox:true,contextIsolation:true,webviewTag:true}});
 const accounts=new Map,guests=[],sessions=[],errors=[],counts=new Map;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 e.ipcMain.handle('caisheng:get-translation-config',event=>{assert.ok(accounts.has(event.sender.session));return {chatTranslationProvider:'fixture',backTranslationEnabled:true}});
 e.ipcMain.handle('caisheng:translate',(event,payload)=>{const account=accounts.get(event.sender.session);assert.ok(account);assert.equal(payload.purpose,'chat');counts.set(account,(counts.get(account)||0)+1);return {text:account+'：'+payload.text}});
 const gesture=event=>{if(accounts.has(event.sender.session))event.sender.haituoLastGestureAt=Date.now()};
 e.ipcMain.on('haituo-user-gesture',gesture);
 win.webContents.on('will-attach-webview',(_event,prefs,params)=>{prefs.preload=preload;params.preload=require('node:url').pathToFileURL(preload).href;prefs.sandbox=true;prefs.contextIsolation=true;prefs.nodeIntegration=false});
 win.webContents.on('did-attach-webview',(_event,guest)=>{guests.push(guest);guest.on('preload-error',(_e,_file,error)=>errors.push(String(error)));guest.on('render-process-gone',(_e,detail)=>errors.push(detail.reason))});
 try{
  await win.loadURL('data:text/html,<body style="margin:0"></body>');
  for(let i=0;i<2;i++){
   const account='zoom-native-'+i,partition='persist:caisheng-zoom-native-qa-'+i,ses=e.session.fromPartition(partition);accounts.set(ses,account);sessions.push(ses);
   // Synthetic HTTPS origin only; never signs into or sends traffic to real Zoom.
   await ses.protocol.handle('https',request=>new Response(new URL(request.url).hostname==='app.zoom.us'?'<section role="log"><article data-message-id="one"><span data-testid="message-body">Hello Zoom</span></article></section>':'Blocked',{headers:{'Content-Type':'text/html'}}));
   security.install({electron:e,session:ses,getOwner:()=>win});
   await win.webContents.executeJavaScript('(function(){const view=document.createElement("webview");view.partition='+JSON.stringify(partition)+';view.src="https://app.zoom.us/wc/home";view.style.cssText="width:690px;height:250px;display:flex";document.body.append(view)})()');
   for(let n=0;n<100&&!guests[i];n++)await wait(30);assert.ok(guests[i],'native webview must attach');
   const guest=guests[i];let text;
   for(let n=0;n<100;n++){text=await guest.executeJavaScript('document.querySelector("[data-haituo-zoom-owned=translation]")?.textContent').catch(()=>null);if(text)break;await wait(30)}
   assert.equal(text,account+'：Hello Zoom','sandboxed preload automatically translates');
   assert.equal(counts.get(account),1);assert.equal(guest.getLastWebPreferences().sandbox,true);assert.equal(guest.getLastWebPreferences().contextIsolation,true);
   guest.send('caisheng:translation-config-changed',{autoTranslateIncoming:false});await wait(150);
   assert.equal(await guest.executeJavaScript('!!document.querySelector("[data-haituo-zoom-owned=translation]")'),false);
   guest.send('caisheng:translation-config-changed',{autoTranslateIncoming:true});await wait(150);
   assert.equal(await guest.executeJavaScript('document.querySelector("[data-haituo-zoom-owned=translation]")?.textContent'),account+'：Hello Zoom');assert.equal(counts.get(account),1);
  }
  assert.equal(errors.length,0,errors.join('; '));assert.notEqual(guests[0].session,guests[1].session);
  return{ok:true,scope:'REAL_ELECTRON_SANDBOX_SYNTHETIC_HTTPS_ZOOM_ORIGIN',accounts:2,defaultAutomaticTranslation:true,disableAndRestore:true,cacheReplayExtraIPC:0,realZoomLogin:'UNTESTED',realChatSelectors:'UNTESTED',realMeeting:'UNTESTED'};
 }finally{e.ipcMain.removeHandler('caisheng:get-translation-config');e.ipcMain.removeHandler('caisheng:translate');e.ipcMain.removeListener('haituo-user-gesture',gesture);if(!win.isDestroyed())win.destroy();for(const ses of sessions)await ses.protocol.unhandle('https')}
};
