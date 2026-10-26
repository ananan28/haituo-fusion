'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
delete process.env.HAITUO_INPROCESS; // Verify ordinary launch defaults to embedded views.
const mac=process.platform==='darwin',out=path.resolve('audit-results'),profile=process.env.HAITUO_NATIVE_PROFILE||(process.env.GITHUB_ACTIONS==='true'?path.join(process.env.RUNNER_TEMP||os.tmpdir(),'haituo-native-162'):fs.mkdtempSync(path.join(os.tmpdir(),'haituo-fresh-')));
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile,{recursive:true});const report={platform:process.platform,checks:[],errors:[],settingsInventory:[]};
const app=path.resolve(mac?'macos/out/海拓-darwin-arm64/海拓.app':'windows/out/win-unpacked/海拓.exe');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let proc,client,log;
let fixtureCalls=0; const fixtureServer=require("node:http").createServer((req,res)=>{req.resume();req.on("end",()=>{fixtureCalls++;res.setHeader("content-type","application/json");res.end(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"原消息下方的常驻译文"}}]}))})});
async function attach(target){const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('websocket connection timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',reject,{once:true})});let sequence=0;const pending=new Map(),contexts=new Set();ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}}else if(message.method==='Runtime.executionContextCreated')contexts.add(message.params.context.id);else if(message.method==='Runtime.executionContextsCleared')contexts.clear();else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);else if(message.method==='Log.entryAdded')report.errors.push(message.params.entry);else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')report.errors.push({console:message.params.args.map(x=>x.value||x.description)})});return{ws,contexts,call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},7000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}}}
async function evaluate(expression,contextId){const r=await client.call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}
async function apiEvaluate(expression){for(const id of client.contexts){let available=false;try{available=await evaluate("typeof window.SignalContext?.caishengGetTranslationConfig==='function'",id)}catch{}if(available)return await evaluate(expression,id)}throw Error('TEST_BLOCKED: no initialized SignalContext in inspected execution worlds')}
const snapshot=`(()=>{const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';return{shell:!!document.querySelector('.CaishengPlatformShell'),loading:[...document.querySelectorAll('.app-loading-screen')].some(visible),installed:[...document.querySelectorAll('[class*=InstallScreen],.inbox')].some(visible),visibility:document.visibilityState,settings:!!document.querySelector('.CaishengPlatformShell__settings'),bridge:typeof window.SignalContext?.caishengGetTranslationConfig==='function'}})()`;
async function start(){log=fs.openSync(path.join(out,'inprocess-'+report.checks.length+'.log'),'w');const args=['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=19342'];proc=mac?cp.spawn('/usr/bin/open',['-n','-a',app,'--args',...args],{stdio:['ignore',log,log]}):cp.spawn(app,args,{stdio:['ignore',log,log]});let last;const deadline=Date.now()+30000;while(Date.now()<deadline){try{const list=await(await fetch('http://127.0.0.1:19342/json/list')).json(),target=list.find(x=>x.type==='page'&&x.url.includes('background.html'));if(target){client=await attach(target);await client.call('Runtime.enable');await client.call('Log.enable');break}}catch(e){last=e}await pause(250)}if(!client)throw Error('Application page unavailable: '+last);let state;while(Date.now()<deadline){state=await evaluate(snapshot);if(state.shell&&state.installed&&!state.loading)break;await pause(500)}return state}
function fileEvidence(stage){const item={stage,profile,files:[]};const roots=[profile,path.join(os.homedir(),'Library/Application Support/Haituo'),path.join(process.env.APPDATA||os.tmpdir(),'Haituo')];for(const base of roots){for(const name of ['Local State','config.json','translation-settings.json']){const file=path.join(base,name);if(fs.existsSync(file)){const bytes=fs.readFileSync(file);let data;try{data=JSON.parse(bytes)}catch{}item.files.push({file,size:bytes.length,hash:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),encrypted:data?.haituoEncrypted===1,cryptoKeyHash:data?.os_crypt?.encrypted_key?require('node:crypto').createHash('sha256').update(data.os_crypt.encrypted_key).digest('hex'):undefined})}}}report.files??=[];report.files.push(item)}
function collectStartupLogs(){
 const childRoots=[path.join(os.homedir(),'Library/Application Support/Haituo/SignalProfiles/signal-ci-inprocess'),path.join(process.env.APPDATA||os.tmpdir(),'Haituo/SignalProfiles/signal-ci-inprocess')];report.childDatabases=childRoots.map(root=>({root,exists:fs.existsSync(path.join(root,'sql/db.sqlite'))}));
 const roots=[...childRoots.map(root=>path.join(root,'logs')),path.join(profile,'logs'),path.join(os.homedir(),'Library/Application Support/Haituo/logs'),path.join(process.env.APPDATA||os.tmpdir(),'Haituo/logs')];
 report.startupLogs=[];
 for(const root of roots)if(fs.existsSync(root))for(const name of fs.readdirSync(root))if(/\.(?:log|json)$/.test(name))try{const body=fs.readFileSync(path.join(root,name),'utf8').replace(/Bearer\s+[A-Za-z0-9_.-]+/g,'Bearer [redacted]');fs.writeFileSync(path.join(out,'startup-'+report.startupLogs.length+'.log'),body);report.startupLogs.push({name,tail:body.split('\n').slice(-45).join('\n')})}catch{}
}
async function stop(){if(client){try{await client.call('Browser.close')}catch{}try{client.ws.close()}catch{}client=null}await pause(700);if(!mac&&proc?.pid){cp.spawnSync('taskkill',['/PID',String(proc.pid),'/T','/F'],{timeout:10000,stdio:'ignore'})}if(mac){const lines=cp.execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');for(const line of lines)if(line.includes('--user-data-dir='+profile)){const pid=Number(line.trim().split(/\s+/)[0]);try{process.kill(pid,'SIGTERM')}catch{}}}if(log!==undefined){fs.closeSync(log);log=undefined}}
async function check(id,work){try{const result=await work();report.checks.push({id,ok:true,result})}catch(e){report.checks.push({id,ok:false,error:String(e.stack||e)})}}
(async()=>{try{
 await check('MAIN-DEFAULT-EMBEDDED-START',async()=>{const state=await start();if(!state.installed||state.loading)throw Error(JSON.stringify(state));return state});
 if(client){
  await check('CHILD-PROFILE-CREATE',async()=>{
   // Register a real shell workspace, then reload its persisted UI state.
   // A phantom IPC-only profile leaves React on the main tab; ResizeObserver
   // can legitimately hide that profile and invalidate a focus comparison.
   await evaluate(`(()=>{const key='caisheng.workspaces.v3',items=JSON.parse(localStorage.getItem(key)||'[]').filter(x=>x.id!=='signal-ci-inprocess');items.push({id:'signal-ci-inprocess',platformId:'signal',label:'CI embedded account',createdAt:Date.now()});localStorage.setItem(key,JSON.stringify(items));localStorage.setItem('caisheng.lastWorkspace','signal-main')})()`);
   await client.call('Page.reload');const deadline=Date.now()+30000;
   while(Date.now()<deadline){try{if(await evaluate(`!!document.querySelector('button[data-caisheng-tab-workspace="signal-ci-inprocess"]')`))return{registered:true}}catch{}await pause(250)}
   throw Error('Persisted child workspace did not appear in the shell');
  });
  await check('CHILD-PROFILE-SELECT',async()=>{
   await evaluate(`document.querySelector('button[data-caisheng-tab-workspace="signal-ci-inprocess"]').click()`);
   const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(`document.querySelector('button[data-caisheng-tab-workspace="signal-ci-inprocess"]')?.getAttribute('aria-pressed')==='true'`))return{selectedInUI:true};await pause(100)}throw Error('Child tab was not selected in the actual shell');
  });
  let childClient;
  await check('CHILD-VIEW-BOOTSTRAP-AND-SQL',async()=>{
   const deadline=Date.now()+45000;
   while(Date.now()<deadline){
    const targets=await(await fetch('http://127.0.0.1:19342/json/list')).json();
    for(const target of targets.filter(x=>x.type==='page'&&x.url.includes('background.html'))){
      if(target.webSocketDebuggerUrl===client.ws.url)continue;
      const other=await attach(target);await other.call('Runtime.enable');
      let identity;for(const contextId of other.contexts){try{const response=await other.call('Runtime.evaluate',{expression:`(()=>({child:window.SignalContext?.caishengIsChildProfile,path:window.SignalContext?.config?.userDataPath,loading:!!document.querySelector('.app-loading-screen'),body:document.body.innerText.slice(-300)}))()`,contextId,returnByValue:true});identity=response.result?.value;if(identity?.child){childClient=other;if(identity.loading)break;if(!identity.path?.includes('signal-ci-inprocess'))throw Error('Wrong child profile path: '+JSON.stringify(identity));return identity;}}catch(error){if(error.message.startsWith('Wrong child'))throw error;}}
      if(other!==childClient)other.ws.close();
    }
    await pause(500);
   }
   throw Error('Child profile never reached initialized renderer; inspect child stderr/startup log');
  });
  if(childClient){
   await check('CHILD-FOCUS-SERVICE',async()=>{
    // Let the hidden backend's legacy 10s focus timer fire; it must not
    // overwrite the actual parent/view focus state. Reset document activity on
    // both sides before comparing: Signal also has a separate 15s idle cutoff.
    await pause(10500);
    const selectedInUI=await evaluate(`document.querySelector('button[data-caisheng-tab-workspace="signal-ci-inprocess"]')?.getAttribute('aria-pressed')==='true'`);if(!selectedInUI)throw Error('Focus comparison requires the child tab to be selected');
    const parentActive=await apiEvaluate(`(()=>{document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));return window.SignalContext.activeWindowService.isActive()})()`);let childActive;
    for(const contextId of childClient.contexts){const result=await childClient.call('Runtime.evaluate',{expression:`(()=>{if(!window.SignalContext?.caishengIsChildProfile)return null;document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));return window.SignalContext.activeWindowService.isActive()})()`,contextId,returnByValue:true});if(typeof result.result?.value==='boolean'){childActive=result.result.value;break;}}
    if(typeof parentActive!=='boolean'||childActive!==parentActive)throw Error('Embedded focus does not match parent '+JSON.stringify({parentActive,childActive}));return{parentActive,childActive,selectedInUI};
   });
   await check('CHILD-VIEW-BOUNDS-UPDATE',async()=>{
    const sizes=[];
    for(const bounds of [{x:20,y:90,width:360,height:300},{x:30,y:80,width:420,height:320}]){
      await apiEvaluate(`window.SignalContext.caishengSyncSignalProfile(${JSON.stringify({id:'signal-ci-inprocess',...bounds,keepVisible:true})})`);await pause(150);
      const result=await childClient.call('Runtime.evaluate',{expression:'({width:innerWidth,height:innerHeight})',returnByValue:true});
      const actual=result.result?.value;if(actual.width!==bounds.width||actual.height!==bounds.height)throw Error('Subview bounds mismatch '+JSON.stringify({bounds,actual}));sizes.push(actual);
    }
    return sizes;
   });
   await check('CHILD-ACCOUNT-LABEL-IN-VIEW',async()=>{
    const operation=apiEvaluate(`window.SignalContext.caishengEditAccountLabel({id:'signal-ci-inprocess',platformId:'signal',label:'Fixture label'})`).then(value=>({value}),error=>({error}));
    let shown;const deadline=Date.now()+2000;
    while(Date.now()<deadline){shown=await childClient.call('Runtime.evaluate',{expression:`!!document.querySelector('#haituo-account-label-overlay input')`,returnByValue:true});if(shown.result?.value)break;await pause(50);}
    if(!shown?.result?.value)throw Error('Account label overlay was not shown in embedded view');
    await childClient.call('Runtime.evaluate',{expression:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,returnByValue:true});
    const result=await operation;if(result.error)throw result.error;if(result.value!==null)throw Error('Account label cancel did not return null');return{shown:true,cancelled:true};
   });
   await check('CHILD-VIEW-SCREENSHOT',async()=>{const screenshot=await childClient.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'inprocess-child.png'),Buffer.from(screenshot.data,'base64'));return{file:'inprocess-child.png'}});
   childClient.ws.close();
  }
  await check('CHILD-PROFILE-REFRESH',async()=>{
   const before=(await(await fetch('http://127.0.0.1:19342/json/list')).json()).filter(x=>x.type==='page'&&x.url.includes('background.html')).map(x=>x.webSocketDebuggerUrl);
   const result=await apiEvaluate(`window.SignalContext.caishengRefreshSignalProfile('signal-ci-inprocess')`);if(!result?.ok)throw Error('Embedded profile refresh failed');
   const deadline=Date.now()+30000;
   while(Date.now()<deadline){
    const targets=await(await fetch('http://127.0.0.1:19342/json/list')).json();
    for(const target of targets.filter(x=>x.type==='page'&&x.url.includes('background.html')&&!before.includes(x.webSocketDebuggerUrl))){
      const other=await attach(target);try{await other.call('Runtime.enable');for(const contextId of other.contexts){const response=await other.call('Runtime.evaluate',{expression:`({child:window.SignalContext?.caishengIsChildProfile,path:window.SignalContext?.config?.userDataPath,loading:!!document.querySelector('.app-loading-screen')})`,contextId,returnByValue:true});const identity=response.result?.value;if(identity?.child&&!identity.loading&&identity.path?.endsWith('signal-ci-inprocess'))return{restarted:true,path:identity.path};}}finally{other.ws.close();}
    }
    await pause(250);
   }
   throw Error('Refreshed embedded renderer did not initialize');
  });
  await check('SWITCH-BACK-TO-MAIN',async()=>{await evaluate(`document.querySelector('button[data-caisheng-tab-workspace="signal-main"]').click()`);await pause(200);if(!await evaluate(`document.querySelector('button[data-caisheng-tab-workspace="signal-main"]')?.getAttribute('aria-pressed')==='true'`))throw Error('Main tab was not selected');return{selectedInUI:true}});
  await check('CHILD-PROFILE-STOP',async()=>{const result=await apiEvaluate(`window.SignalContext.caishengStopSignalProfile('signal-ci-inprocess')`);if(result!==true)throw Error('Child backend did not shut down gracefully');return result});
 }
}catch(error){report.fatal=String(error.stack||error)}finally{collectStartupLogs();await stop();report.ok=!report.fatal&&report.checks.every(x=>x.ok);fs.writeFileSync(path.join(out,'inprocess-native.json'),JSON.stringify(report,null,2));console.log('INPROCESS_NATIVE_SUMMARY',JSON.stringify({ok:report.ok,checks:report.checks,fatal:report.fatal}));process.exitCode=report.ok?0:1}})();
