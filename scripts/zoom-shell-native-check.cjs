'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const out=path.resolve('audit-results');fs.mkdirSync(out,{recursive:true});
const report={scope:'PACKAGED_APP_REAL_ZOOM_UNAUTHENTICATED_LOGIN',platform:process.platform,errors:[],realAccount:'UNTESTED',checks:[]};
let client,proc;const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function attach(target){const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('websocket connection timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',reject,{once:true})});let sequence=0;const pending=new Map(),contexts=new Set();ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}}else if(message.method==='Runtime.executionContextCreated')contexts.add(message.params.context.id);else if(message.method==='Runtime.executionContextsCleared')contexts.clear();else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);else if(message.method==='Log.entryAdded')report.errors.push(message.params.entry);else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')report.errors.push({console:message.params.args.map(x=>x.value||x.description)})});return{ws,contexts,call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},7000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}}}
async function evaluate(expression,contextId){const r=await client.call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}

(async()=>{const log=fs.openSync(path.join(out,'zoom-shell.log'),'w'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-zoom-shell-'));
try{
 const app=path.resolve(process.platform==='darwin'?'macos/out/海拓-darwin-arm64/海拓.app/Contents/MacOS/海拓':'windows/out/win-unpacked/海拓.exe');
 proc=cp.spawn(app,['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=19343'],{stdio:['ignore',log,log]});
 const targets=async()=>await(await fetch('http://127.0.0.1:19343/json/list')).json();
 let end=Date.now()+45000;
 while(Date.now()<end){try{const t=(await targets()).find(t=>t.type==='page'&&t.url.includes('background.html'));if(t){client=await attach(t);await client.call('Runtime.enable');break}}catch{}await pause(250)}
 if(!client)throw Error('Main shell CDP unavailable');
 while(Date.now()<end){if(await evaluate(`!!document.querySelector('.CaishengPlatformShell__add')`))break;await pause(250)}
 if(process.platform==='darwin'){
  await evaluate(`(()=>{const key='caisheng.workspaces.v3',items=JSON.parse(localStorage.getItem(key)||'[]');items.push({id:'zoom-shell-qa',platformId:'zoom',label:'Zoom QA',createdAt:Date.now()});localStorage.setItem(key,JSON.stringify(items));localStorage.setItem('caisheng.lastWorkspace','zoom-shell-qa')})()`);await client.call('Page.reload');
  report.creationPath='PERSISTED_ACCOUNT_RESTORE_NATIVE_MENU_ASSERTED_IN_UNIT_TEST';
 }else{
  await evaluate(`document.querySelector('.CaishengPlatformShell__add').click()`);await pause(200);
  const clicked=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='新增 Zoom 账号');if(!b)return false;b.click();return true})()`);if(!clicked)throw Error('Add Zoom button unavailable in production shell');
  report.creationPath='ACTUAL_ADD_ACCOUNT_BUTTON';
 }
 const guestPollStarted=Date.now();end=Date.now()+45000;let guest;
 while(Date.now()<end){try{report.shell=await evaluate(`(()=>{const v=[...document.querySelectorAll('webview')].find(v=>String(v.getAttribute('partition')).includes('-zoom-'));return v?{src:v.src,partition:v.partition,phase:v.dataset.haituoZoomState,status:[...v.parentElement.querySelectorAll('[data-haituo-zoom-status]')].map(n=>n.textContent).join(' '),visibility:getComputedStyle(v).visibility,width:v.getBoundingClientRect().width,height:v.getBoundingClientRect().height,id:(()=>{try{return v.getWebContentsId()}catch{return null}})()}:null})()`);const t=(await targets()).find(t=>/zoom\.(us|com)/.test(t.url));if(t&&report.shell?.id&&Date.now()-guestPollStarted>=5000){guest=await attach(t);await guest.call('Runtime.enable');break}}catch(error){if(!/navigated or closed|Execution context|Cannot find context/i.test(String(error.message)))throw error;}await pause(400)}
 if(!guest){report.targets=(await targets()).map(t=>({type:t.type,url:t.url.split('?')[0]}));throw Error('Zoom guest target missing: '+JSON.stringify(report.shell));}
 while(Date.now()<end){try{const r=await guest.call('Runtime.evaluate',{expression:`({url:location.href,ready:document.readyState,text:document.body?.innerText?.slice(0,2000)||'',children:document.body?.children.length||0,title:document.title,userAgent:navigator.userAgent})`,returnByValue:true});report.page=r.result?.value;if(report.page?.text.length>80)break}catch{}await pause(500)}
 report.lifecycle=await evaluate(`(()=>{const v=[...document.querySelectorAll('webview')].find(v=>String(v.getAttribute('partition')).includes('-zoom-'));return{visible:!!v&&getComputedStyle(v).visibility==='visible'&&getComputedStyle(v).opacity!=='0',overlayVisible:[...document.querySelectorAll('[data-haituo-zoom-status]')].some(p=>getComputedStyle(p).display!=='none')}})()`);
 if(!report.lifecycle.visible||report.lifecycle.overlayVisible)throw Error('Zoom guest is hidden by host UI');
 const image=await client.call('Page.captureScreenshot');fs.writeFileSync(path.join(out,'zoom-shell.png'),Buffer.from(image.data,'base64'));
 if(!report.shell?.id||report.shell.width<100||report.shell.height<100||report.shell.visibility!=='visible')throw Error('Zoom webview not attached/visible');
 if(/(?:400 Bad Request|403 Forbidden|Access Denied|unsupported browser)/i.test(report.page?.text||'')||/^Error\b/i.test(report.page?.title||''))throw Error('Zoom returned an error page: '+JSON.stringify(report.page));
 if(!report.page||report.page.children===0||report.page.text.length<80)throw Error('Real Zoom page empty: '+JSON.stringify(report.page));
 report.ok=true;guest.ws.close();
}catch(error){report.ok=false;report.error=String(error.stack||error);process.exitCode=1}
finally{if(client){try{await client.call('Browser.close')}catch{}client.ws.close()}if(proc)proc.kill();fs.closeSync(log);fs.writeFileSync(path.join(out,'zoom-shell.json'),JSON.stringify(report,null,2));console.log('ZOOM_SHELL',JSON.stringify(report));}
})();
