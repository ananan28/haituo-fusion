'use strict';
// Opt-in, offline native guest regression. No account, cookies or network.
async function run({electron,bootstrap,preloadPath,reportPath}){
 const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
 const {app,BrowserWindow,session}=electron;const report={scope:'REAL_ELECTRON_WEBVIEW_SYNTHETIC_PAGE',realAccount:'UNTESTED',versions:process.versions,checks:[],errors:[],events:[]};let host,timer;
 try{const partition='haituo-wa-startup-fixture-'+Date.now(),guestSession=session.fromPartition(partition);
 // Match the production WhatsApp session's ASCII browser UA. Electron's
 // default Chinese product-name UA cannot be converted to fetch Headers by
 // protocol.handle (ByteString), which would invalidate the offline fixture.
 guestSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
 guestSession.protocol.handle('https',()=>new Response('<!doctype html><html><body><div id="main">Guest startup fixture</div><script>window.firstScript={hooksReady:window.__haituoWACreationHooks===true,nodeIntegration:typeof require};document.body.dataset.firstScript="ran";</script></body></html>',{headers:{'content-type':'text/html'}}));
 bootstrap.installSession(guestSession,'https://web.whatsapp.com/haituo-startup-fixture');
 host=new BrowserWindow({show:true,width:800,height:600,webPreferences:{webviewTag:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 // The production global guard permits guests only in the real main window.
 // This isolated offline fixture replaces that guard on THIS temporary host
 // only, with an exact URL/partition/preload allowlist. Production is unchanged.
 host.webContents.removeAllListeners('will-attach-webview');
 host.webContents.on('will-attach-webview',(event,prefs,params)=>{report.events.push({type:'will-attach',url:params.src,partition:params.partition});if(params.src!=='https://web.whatsapp.com/haituo-startup-fixture'||params.partition!==partition){event.preventDefault();report.errors.push('Fixture attach allowlist rejected');return}bootstrap.prepare(prefs,params)});
 host.webContents.on('console-message',(_e,details)=>report.events.push({type:'host-console',message:typeof details==='object'?details.message:String(details)}));
 const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Guest did not finish navigation/preload within 30s')),30000);
 host.webContents.on('did-attach-webview',(_event,guest)=>{report.events.push({type:'did-attach',id:guest.id});bootstrap.attach(guest,host.webContents);let handshake=false;guest.on('did-start-navigation',(_e,url,inPlace,main)=>report.events.push({type:'navigation',url,inPlace,main}));guest.on('did-fail-load',(_e,code,message,url,main)=>{report.events.push({type:'load-failed',code,message,url,main});if(main&&code!==-3)reject(Error('Fixture navigation failed: '+code+' '+message))});
 guest.on('ipc-message',(_e,channel,value)=>{if(channel==='haituo-wa-preload-ready'){handshake=value?.hooksReady===true;report.events.push({type:'preload-ready',handshake})}});
 guest.on('preload-error',(_e,_file,error)=>{report.errors.push(String(error.stack||error));reject(error)});
 guest.on('console-message',(_e,details)=>{const message=typeof details==='object'?details.message:String(details);report.events.push({type:'guest-console',message});if(/startupData|script failed to run|Unable to load preload/.test(message)){report.errors.push(message);reject(Error(message))}});
 guest.once('did-finish-load',async()=>{try{const state=await guest.executeJavaScript('({url:location.href,body:document.body.innerText,firstScript:window.firstScript})'),prefs=guest.getLastWebPreferences();report.checks.push({id:'GUEST-NAVIGATION',ok:state.url==='https://web.whatsapp.com/haituo-startup-fixture'&&state.body.includes('Guest startup fixture'),state},{id:'PRELOAD-HOOKS-BEFORE-FIRST-PAGE-SCRIPT',ok:handshake&&state.firstScript?.hooksReady===true,handshake},{id:'GUEST-SANDBOX-AND-PRELOAD-PATH',ok:prefs.sandbox===true&&prefs.contextIsolation===true&&prefs.nodeIntegration===false&&state.firstScript?.nodeIntegration==='undefined'&&prefs.preload===preloadPath,preload:prefs.preload,sandbox:prefs.sandbox});resolve()}catch(error){reject(error)}});
 });});
 const html='<!doctype html><html><body><webview style="width:780px;height:560px" partition="'+partition+'" preload="'+pathToFileURL(preloadPath).href+'" src="https://web.whatsapp.com/haituo-startup-fixture"></webview></body></html>';
 await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await result;report.ok=report.checks.every(item=>item.ok)&&!report.errors.length;
 }catch(error){report.ok=false;report.fatal=String(error.stack||error)}finally{clearTimeout(timer);host?.destroy();fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log('WA_GUEST_STARTUP_REPORT',JSON.stringify(report));app.exit(report.ok?0:1)}
}
module.exports={run};
