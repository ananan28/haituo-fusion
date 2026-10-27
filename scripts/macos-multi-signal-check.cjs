'use strict';
// Native macOS integration: five independent, unlinked Signal profiles.
// Uses a dedicated CI profile and records no message text or credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
if(process.platform!=='darwin'||process.env.GITHUB_ACTIONS!=='true')throw Error('This test requires the isolated macOS CI runner');
const app=path.resolve('macos/out/海拓-darwin-arm64/海拓.app'),out=path.resolve('audit-results'),profile=path.join(process.env.RUNNER_TEMP||os.tmpdir(),'haituo-multisignal-ci');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile,{recursive:true});
const ids=Array.from({length:5},(_,i)=>`signal-ci-multi-${i+1}`),report={platform:process.platform,realAccounts:'UNTESTED',profiles:ids.length,checks:[],events:[],externalFocus:{status:'UNTESTED'}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let root,proc,log;const clients=new Map();
async function attach(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connect timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',reject,{once:true})});
 let seq=0;const pending=new Map(),contexts=new Set();
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const item=pending.get(msg.id);if(item){pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(Error(JSON.stringify(msg.error))):item.resolve(msg.result)}}else if(msg.method==='Runtime.executionContextCreated')contexts.add(msg.params.context.id);else if(msg.method==='Runtime.executionContextsCleared')contexts.clear()});
 return{ws,contexts,call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}};
}
async function evaluate(client,expression,contextId){const r=await client.call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}
async function api(expression){for(const id of root.contexts){try{if(await evaluate(root,"typeof window.SignalContext?.caishengLaunchSignalProfile==='function'",id))return await evaluate(root,expression,id)}catch(error){if(!/context|destroyed/i.test(String(error)))throw error}}throw Error('Root SignalContext unavailable')}
async function rootReady(){const deadline=Date.now()+45000;while(Date.now()<deadline){try{const list=await(await fetch('http://127.0.0.1:19343/json/list')).json(),target=list.find(x=>x.type==='page'&&x.url.includes('background.html'));if(target){root=await attach(target);await root.call('Runtime.enable');break}}catch{}await pause(300)}if(!root)throw Error('Root CDP page unavailable');while(Date.now()<deadline){try{if(await evaluate(root,"!!document.querySelector('.CaishengPlatformShell') && ![...document.querySelectorAll('.app-loading-screen')].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')"))return}catch{}await pause(400)}throw Error('Main shell did not start')}
async function select(id){await evaluate(root,`document.querySelector(${JSON.stringify('button[data-caisheng-tab-workspace="'+id+'"]')})?.click()`);const deadline=Date.now()+15000;while(Date.now()<deadline){if(await evaluate(root,`document.querySelector(${JSON.stringify('button[data-caisheng-tab-workspace="'+id+'"]')})?.getAttribute('aria-pressed')==='true'`))return;await pause(150)}throw Error('Tab did not select: '+id)}
async function findChild(id){
 const deadline=Date.now()+65000;while(Date.now()<deadline){
  let targets=[];try{targets=await(await fetch('http://127.0.0.1:19343/json/list')).json()}catch{}
  for(const target of targets.filter(t=>t.type==='page'&&t.url.includes('background.html')&&t.webSocketDebuggerUrl!==root.ws.url&&!([...clients.values()].some(v=>v.ws.url===t.webSocketDebuggerUrl)))){
   let c,retain=false;try{c=await attach(target);await c.call('Runtime.enable');let match=false;
    for(const contextId of c.contexts){try{const value=await evaluate(c,"(()=>({child:window.SignalContext?.caishengIsChildProfile,path:window.SignalContext?.config?.userDataPath,loading:!!document.querySelector('.app-loading-screen')}))()",contextId);if(value?.child&&String(value.path||'').endsWith(id)&&!value.loading){match=true;break}}catch{}}
    if(match){retain=true;return c;}
   }catch{}finally{if(c&&!retain&&c.ws.readyState===WebSocket.OPEN)c.ws.close()}
  }
  await pause(500);
 }throw Error('Child profile did not initialize: '+id);
}
async function inspect(id,stage,saveImage=false){
 const c=clients.get(id);if(!c||c.ws.readyState!==WebSocket.OPEN)throw Error('Child renderer missing: '+id);
 const state=await evaluate(c,`(()=>{const b=document.body,t=b?.innerText||'',x=Math.max(1,Math.floor(innerWidth/2)),y=Math.max(1,Math.floor(innerHeight/2)),at=document.elementFromPoint(x,y);return {marker:b?.dataset.haituoMultiSignalMarker,visibility:document.visibilityState,width:innerWidth,height:innerHeight,textLength:t.trim().length,bodyVisible:!!b&&getComputedStyle(b).visibility==='visible'&&getComputedStyle(b).display!=='none',hitElement:!!at,loading:!!document.querySelector('.app-loading-screen')}})()`);
 if(state.marker!==id||state.visibility!=='visible'||state.width<100||state.height<100||state.textLength<10||!state.bodyVisible||!state.hitElement||state.loading)throw Error('Selected child not usable: '+JSON.stringify({id,stage,...state}));
 await evaluate(c,`window.__haituoMultiMouse=0;document.addEventListener('mousemove',()=>window.__haituoMultiMouse++,{once:true})`);
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.floor(state.width/2),y:Math.floor(state.height/2)});await pause(100);
 if(!(await evaluate(c,'window.__haituoMultiMouse > 0')))throw Error('Selected child did not receive a test pointer event: '+id);
 if(saveImage){const shot=await c.call('Page.captureScreenshot',{format:'png'});const bytes=Buffer.from(shot.data,'base64');if(bytes.length<1000)throw Error('Child screenshot unexpectedly small: '+id);fs.writeFileSync(path.join(out,`multi-${id}-${stage}.png`),bytes);state.screenshotBytes=bytes.length}
 report.events.push({id,stage,...state});
}
function frontmost(){const r=cp.spawnSync('/usr/bin/osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true'],{encoding:'utf8',timeout:10000});return r.status===0?r.stdout.trim():null}
async function externalFocusTest(id){
 const previous=frontmost();const finder=cp.spawnSync('/usr/bin/osascript',['-e','tell application "Finder" to activate'],{encoding:'utf8',timeout:10000});await pause(700);const away=frontmost();
 if(finder.status!==0||!away||away===previous){report.externalFocus={status:'UNTESTED',reason:'Finder activation/frontmost state unavailable on CI runner'};return}
 const restore=cp.spawnSync('/usr/bin/open',['-a',app],{encoding:'utf8',timeout:10000});await pause(1200);const back=frontmost();
 if(restore.status!==0||!back||back===away){report.externalFocus={status:'UNTESTED',reason:'Unable to verify application returned to foreground'};return}
 await inspect(id,'external-return',true);report.externalFocus={status:'PASS',away,back};
}
(async()=>{try{
 log=fs.openSync(path.join(out,'multi-signal-startup.log'),'w');proc=cp.spawn('/usr/bin/open',['-n','-a',app,'--args','--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=19343'],{stdio:['ignore',log,log]});await rootReady();
 await evaluate(root,`(()=>{const list=JSON.parse(localStorage.getItem('caisheng.workspaces.v3')||'[]').filter(x=>!${JSON.stringify(ids)}.includes(x.id));for(const [i,id] of ${JSON.stringify(ids)}.entries())list.push({id,platformId:'signal',label:'CI Signal '+(i+1),createdAt:Date.now()});localStorage.setItem('caisheng.workspaces.v3',JSON.stringify(list));localStorage.setItem('caisheng.lastWorkspace','signal-main')})()`);
 await root.call('Page.reload');let deadline=Date.now()+30000;while(Date.now()<deadline){try{if(await evaluate(root,`!!document.querySelector(${JSON.stringify('button[data-caisheng-tab-workspace="'+ids[4]+'"]')})`))break}catch{}await pause(300)}
 for(const id of ids){await select(id);const c=await findChild(id);clients.set(id,c);await evaluate(c,`document.body.dataset.haituoMultiSignalMarker=${JSON.stringify(id)}`);await pause(350);await inspect(id,'initial',true)}
 if(new Set([...clients.values()].map(c=>c.ws.url)).size!==5)throw Error('Signal profiles did not use five distinct renderers');
 report.checks.push({id:'FIVE-INDEPENDENT-CHILD-VIEWS',ok:true,count:clients.size});
 for(let round=0;round<3;round++)for(const id of (round%2?[...ids].reverse():ids)){await select(id);await pause(450);await inspect(id,`switch-${round+1}`,round===2)}
 report.checks.push({id:'FIFTEEN-ACCOUNT-SWITCHES',ok:true,count:15});
 const current=ids[ids.length-1];await select(current);await pause(300);
 await evaluate(root,"document.querySelector('.CaishengPlatformShell__settingsButton').click()");await pause(450);await evaluate(root,"document.querySelector('.CaishengPlatformShell__settingsButton').click()");await pause(600);await inspect(current,'settings-return',true);report.checks.push({id:'OPEN-CLOSE-SETTINGS',ok:true});
 await externalFocusTest(current);
}catch(error){report.fatal=String(error.stack||error)}finally{
 if(root){for(const id of ids)try{await api(`window.SignalContext.caishengStopSignalProfile(${JSON.stringify(id)})`)}catch{}try{await root.call('Browser.close')}catch{}try{root.ws.close()}catch{}}
 for(const c of clients.values())try{c.ws.close()}catch{}if(log!==undefined)fs.closeSync(log);
 report.ok=!report.fatal&&report.checks.length===3&&report.checks.every(c=>c.ok);fs.writeFileSync(path.join(out,'multi-signal-report.json'),JSON.stringify(report,null,2));console.log('MULTI_SIGNAL_SUMMARY',JSON.stringify(report));process.exitCode=report.ok?0:1;
}})();
