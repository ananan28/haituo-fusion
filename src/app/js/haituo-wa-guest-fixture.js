'use strict';
// Opt-in real Electron integration using six isolated, offline guest sessions.
// No real account, stored cookie, credential, or chat is used by this fixture.
async function run({electron,bootstrap,preloadPath,reportPath,waitForAppReady,shutdown}){
 const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
 const {app,BrowserWindow,session}=electron,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const report={scope:'REAL_ELECTRON_SIX_WEBVIEWS_SYNTHETIC_PAGES',realAccount:'UNTESTED',versions:process.versions,checks:[],errors:[],events:[]};let host;
 const guests=new Map,fixtures=new Map,slowTimers=new Set;
 const check=(id,ok,result)=>{report.checks.push({id,ok,result});if(!ok)throw Error(id+' failed: '+JSON.stringify(result))};
 async function until(work,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await work())return;await wait(50)}throw Error(label+' timeout')}
 try{
  const attachHandler=await waitForAppReady();if(typeof attachHandler!=='function')throw Error('Production attach handler unavailable');
  for(let slot=0;slot<6;slot++){
   const partition='persist:caisheng-whatsapp-startup-fixture-'+Date.now()+'-'+slot,url='https://web.whatsapp.com/haituo-startup-fixture?slot='+slot,guestSession=session.fromPartition(partition);
   guestSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
   guestSession.protocol.handle('https',request=>{
    if(new URL(request.url).pathname==='/slow.png')return new Promise(resolve=>{const timer=setTimeout(()=>{slowTimers.delete(timer);resolve(new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'),{headers:{'content-type':'image/png'}}))},16000);slowTimers.add(timer)});
    return new Response('<!doctype html><html><body><div id="main">Guest startup fixture '+slot+'</div><script>window.firstScript={hooksReady:window.__haituoWACreationHooks===true,nodeIntegration:typeof require};</script>'+(slot===0?'<img src="/slow.png">':'')+'</body></html>',{headers:{'content-type':'text/html'}});
   });
   bootstrap.installSession(guestSession,url);fixtures.set(partition,{slot,url});
  }
  host=new BrowserWindow({show:true,width:900,height:700,webPreferences:{webviewTag:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  // Only THIS disposable offline host replaces the app's main-window guard.
  host.webContents.removeAllListeners('will-attach-webview');
  host.webContents.on('will-attach-webview',(event,prefs,params)=>{const fixture=fixtures.get(params.partition);if(!fixture||params.src!==fixture.url){event.preventDefault();report.errors.push('Fixture attach allowlist rejected');return}attachHandler(event,prefs,params);if(event.defaultPrevented)report.errors.push('Production attach rejected slot '+fixture.slot)});
  host.webContents.on('did-attach-webview',(_event,guest)=>{
   const fixture=[...fixtures].find(([partition])=>session.fromPartition(partition)===guest.session)?.[1];if(!fixture){report.errors.push('Unexpected guest session');return}
   const state={guest,...fixture,dom:0,handshakes:0,loads:0,crashes:0};guests.set(fixture.slot,state);
   guest.setBackgroundThrottling(false);bootstrap.attach(guest,host.webContents);
   guest.on('dom-ready',()=>{state.dom++;report.events.push({type:'dom-ready',slot:state.slot,count:state.dom})});
   guest.on('did-finish-load',()=>state.loads++);
   guest.on('ipc-message',(_e,channel,value)=>{if(channel==='haituo-wa-preload-ready'&&value?.hooksReady===true)state.handshakes++});
   guest.on('render-process-gone',()=>state.crashes++);
   guest.on('preload-error',(_e,_file,error)=>report.errors.push('slot '+state.slot+': '+String(error.message)));
  });
  const html='<!doctype html><html><body>'+[...fixtures].map(([partition,{slot,url}])=>'<webview data-caisheng-workspace="fixture-'+slot+'" data-haituo-active="'+(slot===0)+'" style="position:absolute;inset:0;width:880px;height:650px;visibility:'+(slot===0?'visible':'hidden')+'" partition="'+partition+'" preload="'+pathToFileURL(preloadPath).href+'" src="'+url+'"></webview>').join('')+'</body></html>';
  await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  await until(()=>guests.size===6&&[...guests.values()].every(x=>x.dom&&x.handshakes),'six guest initialization');
  for(const state of guests.values()){
   const page=await state.guest.executeJavaScript('({url:location.href,body:document.body.innerText,firstScript:window.firstScript})'),prefs=state.guest.getLastWebPreferences();
   check('GUEST-'+state.slot+'-SANDBOX-PRELOAD',prefs.sandbox===true&&prefs.contextIsolation===true&&prefs.nodeIntegration===false&&page.url===state.url&&page.body.includes('Guest startup fixture')&&page.firstScript?.nodeIntegration==='undefined'&&page.firstScript?.hooksReady===false,{page,sandbox:prefs.sandbox});
  }
  // At 13s a pending image still prevents did-finish-load. It must not block a
  // document whose isolated preload and DOM already work (the old 12s gate did).
  await wait(13000);
  const slow=guests.get(0),panels=await host.webContents.executeJavaScript("document.querySelectorAll('[data-haituo-wa-startup]').length");
  check('SLOW-RESOURCE-NO-STARTUP-OVERLAY',slow.dom>0&&slow.handshakes>0&&slow.loads===0&&panels===0,{dom:slow.dom,handshakes:slow.handshakes,loads:slow.loads,panels});
  for(let round=0;round<3;round++){
   const before=[...guests.values()].map(x=>[x,x.dom]);
   await host.webContents.executeJavaScript(`(()=>{for(const [index,node] of [...document.querySelectorAll('webview')].entries()){node.dataset.haituoActive=String(index===${round%6});node.style.visibility=index===${round%6}?'visible':'hidden';node.reload()}})()`);
   await until(()=>before.every(([state,count])=>state.dom>count),'six guest reload '+round);
   const count=await host.webContents.executeJavaScript("document.querySelectorAll('[data-haituo-wa-startup]').length");check('SIX-GUEST-RELOAD-'+round,count===0,{panels:count,guests:guests.size});
  }
  const crashed=guests.get(5),before=crashed.dom,others=[...guests.values()].filter(x=>x!==crashed).map(x=>[x,x.dom]);
  crashed.guest.forcefullyCrashRenderer();await until(()=>crashed.crashes===1&&crashed.dom>before,'crashed guest automatic recovery');
  check('CRASH-RECOVERY-ACCOUNT-ISOLATION',others.every(([state,count])=>state.dom===count),{crashes:crashed.crashes,recoveredDOM:crashed.dom,otherDOM:others.map(([state])=>state.dom)});
  const finalPanels=await host.webContents.executeJavaScript("document.querySelectorAll('[data-haituo-wa-startup]').length");check('RECOVERY-CLEARS-ERROR-OVERLAY',finalPanels===0,{panels:finalPanels});
  report.ok=!report.errors.length&&report.checks.every(x=>x.ok);
 }catch(error){report.ok=false;report.fatal=String(error.stack||error)}finally{
  host?.destroy();for(const timer of slowTimers)clearTimeout(timer);
  try{await shutdown()}catch(error){report.ok=false;report.teardownError=String(error.stack||error)}
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log('WA_GUEST_STARTUP_REPORT',JSON.stringify(report));app.exit(report.ok?0:1);
 }
}
module.exports={run};
