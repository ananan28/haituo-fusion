'use strict';
// Opt-in, offline native guest regression. No account, cookies or network.
async function run({electron,bootstrap,preloadPath,reportPath}){
 const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
 const {app,BrowserWindow,session}=electron;const report={scope:'REAL_ELECTRON_WEBVIEW_SYNTHETIC_PAGE',realAccount:'UNTESTED',versions:process.versions,checks:[],errors:[]};let host,timer;
 try{const partition='haituo-wa-startup-fixture-'+Date.now(),guestSession=session.fromPartition(partition);
 guestSession.protocol.handle('https',()=>new Response('<!doctype html><html><body><div id="main">Guest startup fixture</div><script>window.firstScript={hooksReady:window.__haituoWACreationHooks===true,nodeIntegration:typeof require};document.body.dataset.firstScript="ran";</script></body></html>',{headers:{'content-type':'text/html'}}));
 bootstrap.installSession(guestSession,'https://web.whatsapp.com/haituo-startup-fixture');
 host=new BrowserWindow({show:true,width:800,height:600,webPreferences:{webviewTag:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 host.webContents.on('will-attach-webview',(_event,prefs,params)=>bootstrap.prepare(prefs,params));
 const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Guest did not finish navigation/preload within 30s')),30000);
 host.webContents.on('did-attach-webview',(_event,guest)=>{bootstrap.attach(guest,host.webContents);let handshake=false;
 guest.on('ipc-message',(_e,channel,value)=>{if(channel==='haituo-wa-preload-ready')handshake=value?.hooksReady===true});
 guest.on('preload-error',(_e,_file,error)=>{report.errors.push(String(error.stack||error));reject(error)});
 guest.on('console-message',(_e,details)=>{const message=typeof details==='object'?details.message:String(details);if(/startupData|script failed to run|Unable to load preload/.test(message)){report.errors.push(message);reject(Error(message))}});
 guest.once('did-finish-load',async()=>{try{const state=await guest.executeJavaScript('({url:location.href,body:document.body.innerText,firstScript:window.firstScript})'),prefs=guest.getLastWebPreferences();report.checks.push({id:'GUEST-NAVIGATION',ok:state.url==='https://web.whatsapp.com/haituo-startup-fixture'&&state.body.includes('Guest startup fixture'),state},{id:'PRELOAD-HOOKS-BEFORE-FIRST-PAGE-SCRIPT',ok:handshake&&state.firstScript?.hooksReady===true,handshake},{id:'GUEST-SANDBOX-AND-PRELOAD-PATH',ok:prefs.sandbox===true&&prefs.contextIsolation===true&&prefs.nodeIntegration===false&&state.firstScript.nodeIntegration==='undefined'&&prefs.preload===preloadPath,preload:prefs.preload,sandbox:prefs.sandbox});resolve()}catch(error){reject(error)}});
 });});
 const html='<!doctype html><html><body><webview style="width:780px;height:560px" partition="'+partition+'" preload="'+pathToFileURL(preloadPath).href+'" src="https://web.whatsapp.com/haituo-startup-fixture"></webview></body></html>';
 await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await result;report.ok=report.checks.every(item=>item.ok)&&!report.errors.length;
 }catch(error){report.ok=false;report.fatal=String(error.stack||error)}finally{clearTimeout(timer);host?.destroy();fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log('WA_GUEST_STARTUP_REPORT',JSON.stringify(report));app.exit(report.ok?0:1)}
}
module.exports={run};
