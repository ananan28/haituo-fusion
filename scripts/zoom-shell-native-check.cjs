'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const out=path.resolve('audit-results'),logPath=path.join(out,'zoom-shell.log');fs.mkdirSync(out,{recursive:true});
const report={scope:'PACKAGED_APP_REAL_ZOOM_UNAUTHENTICATED_LOGIN',platform:process.platform,errors:[],realAccount:'UNTESTED',checks:[]};
let client,proc;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const safeURL=value=>{try{const u=new URL(value);return u.origin+u.pathname}catch{return'[invalid url]'}};
const redact=value=>typeof value==='string'?value.replace(/https?:\/\/[^\s"'<>]+/gi,url=>safeURL(url)):value;
const redactJSON=(_key,value)=>redact(value);
const isZoomURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='zoom.us'||u.hostname.endsWith('.zoom.us'))}catch{return false}};
const emailInputExpression=`(()=>{const visible=element=>{const rect=element.getBoundingClientRect();return rect.width>80&&rect.height>20&&getComputedStyle(element).visibility!=='hidden'};const inputs=[...document.querySelectorAll('input')].filter(visible);const input=inputs.find(element=>element.type==='email'||/email/i.test(element.name||'')||/email/i.test(element.placeholder||'')||element.autocomplete==='username')||inputs.find(element=>element.type==='text');if(!input)return null;const rect=input.getBoundingClientRect();return{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`;
const nextButtonExpression=`(()=>{const button=[...document.querySelectorAll('button')].find(element=>{const rect=element.getBoundingClientRect();return rect.width>40&&rect.height>20&&getComputedStyle(element).visibility!=='hidden'&&/^(next|continue|下一步|继续)$/i.test(element.innerText.trim())});if(!button)return null;const rect=button.getBoundingClientRect();return{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`;
async function clickPoint(client,point){if(!point)return false;await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await client.call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});return true}
async function fillSyntheticEmail(client){
 const result=await client.call('Runtime.evaluate',{expression:emailInputExpression,returnByValue:true}),point=result.result?.value;
 if(!await clickPoint(client,point))return false;
 const modifiers=process.platform==='darwin'?4:2;
 await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers});
 await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers});
 await client.call('Input.insertText',{text:'zoom.shell.qa@example.com'});
 return true
}
async function attach(target,onMessage){const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('websocket connection timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',reject,{once:true})});let sequence=0;const pending=new Map(),contexts=new Set();ws.addEventListener('message',event=>{const message=JSON.parse(event.data);onMessage?.(message);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}}else if(message.method==='Runtime.executionContextCreated')contexts.add(message.params.context.id);else if(message.method==='Runtime.executionContextsCleared')contexts.clear();else if(message.method==='Runtime.exceptionThrown')report.errors.push(message.params.exceptionDetails);else if(message.method==='Log.entryAdded')report.errors.push(message.params.entry);else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')report.errors.push({console:message.params.args.map(x=>x.value||x.description)})});return{ws,contexts,call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},7000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}}}
async function evaluate(expression,contextId){const r=await client.call('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}

(async()=>{const log=fs.openSync(logPath,'w'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-zoom-shell-'));
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
 while(Date.now()<end){try{report.shell=await evaluate(`(()=>{const v=[...document.querySelectorAll('webview')].find(v=>String(v.getAttribute('partition')).includes('-zoom-'));return v?{src:v.src,partition:v.partition,phase:v.dataset.haituoZoomState,status:[...v.parentElement.querySelectorAll('[data-haituo-zoom-status]')].map(n=>n.textContent).join(' '),visibility:getComputedStyle(v).visibility,width:v.getBoundingClientRect().width,height:v.getBoundingClientRect().height,id:(()=>{try{return v.getWebContentsId()}catch{return null}})()}:null})()`);const candidates=(await targets()).filter(t=>t.type==='webview'&&/zoom\.(us|com)/.test(t.url));if(candidates.length===1&&report.shell?.id&&Date.now()-guestPollStarted>=5000){const t=candidates[0];guest=await attach(t);report.guestTargetId=t.id;await guest.call('Runtime.enable');break}}catch(error){if(!/navigated or closed|Execution context|Cannot find context/i.test(String(error.message)))throw error;}await pause(400)}
 if(!guest){report.targets=(await targets()).map(t=>({type:t.type,url:t.url.split('?')[0]}));throw Error('Zoom guest target missing: '+JSON.stringify(report.shell));}
 let emailRect=null;end=Date.now()+45000;
 while(Date.now()<end){try{const r=await guest.call('Runtime.evaluate',{expression:`({url:location.href,ready:document.readyState,text:document.body?.innerText?.slice(0,2000)||'',children:document.body?.children.length||0,title:document.title,userAgent:navigator.userAgent,clientHints:navigator.userAgentData?{brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform}:null,webdriver:navigator.webdriver})`,returnByValue:true});report.page=r.result?.value;const rect=await guest.call('Runtime.evaluate',{expression:emailInputExpression,returnByValue:true});emailRect=rect.result?.value||null;if(report.page?.text.length>80&&emailRect)break;if(/(?:400 Bad Request|403 Forbidden|Access Denied|unsupported browser)/i.test(report.page?.text||'')||/^Error\b/i.test(report.page?.title||''))break}catch(error){if(!/navigated or closed|Execution context|Cannot find context/i.test(String(error.message)))throw error;}await pause(500)}
 report.lifecycle=await evaluate(`(()=>{const v=[...document.querySelectorAll('webview')].find(v=>String(v.getAttribute('partition')).includes('-zoom-'));return{visible:!!v&&getComputedStyle(v).visibility==='visible'&&getComputedStyle(v).opacity!=='0',overlayVisible:[...document.querySelectorAll('[data-haituo-zoom-status]')].some(p=>getComputedStyle(p).display!=='none')}})()`);
 if(!report.lifecycle.visible||report.lifecycle.overlayVisible)throw Error('Zoom guest is hidden by host UI');
 const image=await client.call('Page.captureScreenshot');fs.writeFileSync(path.join(out,'zoom-shell.png'),Buffer.from(image.data,'base64'));
 if(!report.shell?.id||report.shell.width<100||report.shell.height<100||report.shell.visibility!=='visible')throw Error('Zoom webview not attached/visible');
 if(/(?:400 Bad Request|403 Forbidden|Access Denied|unsupported browser)/i.test(report.page?.text||'')||/^Error\b/i.test(report.page?.title||''))throw Error('Zoom returned an error page: '+JSON.stringify(report.page));
 if(!report.page||report.page.children===0||report.page.text.length<80)throw Error('Real Zoom page empty: '+JSON.stringify(report.page));
 if(!emailRect)throw Error('Zoom email input missing on the real login page');
 const emailStarted=Date.now(),syntheticAddress='zoom.shell.qa@example.com';
 if(!await fillSyntheticEmail(guest))throw Error('Zoom email input missing on the real login page');
 const nextResult=await guest.call('Runtime.evaluate',{expression:nextButtonExpression,returnByValue:true});
 if(!await clickPoint(guest,nextResult.result?.value))throw Error('Zoom email Next button missing on the real login page');
 let emailPage=null,emailProbeError='';end=Date.now()+30000;
 while(Date.now()<end){try{const r=await guest.call('Runtime.evaluate',{expression:`({url:location.href,ready:document.readyState,title:document.title,text:document.body?.innerText?.slice(0,2000)||'',password:!!document.querySelector('input[type="password"]'),children:document.body?.children.length||0,userAgent:navigator.userAgent,webdriver:navigator.webdriver})`,returnByValue:true});emailPage=r.result?.value||null;if(/此浏览器或应用不安全|浏览器或应用可能不安全|请尝试使用其他浏览器|This browser or app may not be secure/i.test(emailPage?.text||''))throw Error('Zoom email login reached a browser rejection page');if(emailPage?.password||/enter your password|输入.*密码|type your password/i.test(emailPage?.text||''))break}catch(error){emailProbeError=String(error.message||error);if(/unsafe|rejection/i.test(String(error.message)))throw error}await pause(500)}
 report.identityPolicy={google:'NOT_OPENED_BY_DESIGN',reason:'EMBEDDED_OAUTH_UNSUPPORTED',fallback:'ZOOM_EMAIL_LOGIN',realAccount:'UNTESTED'};
 report.emailLogin={syntheticAddress,page:emailPage?{url:safeURL(emailPage.url),ready:emailPage.ready,title:emailPage.title,text:emailPage.text.slice(0,1200),passwordField:emailPage.password,userAgent:emailPage.userAgent,webdriver:emailPage.webdriver,children:emailPage.children}:null,probeError:redact(emailProbeError),ms:Date.now()-emailStarted};
 if(!emailPage||!isZoomURL(emailPage.url))throw Error('Zoom email login left the Zoom origin');
 if(!emailPage.password&&!/enter your password|输入.*密码|type your password/i.test(emailPage.text||''))throw Error('Synthetic Zoom email did not reach the password step');
 const emailImage=await guest.call('Page.captureScreenshot');fs.writeFileSync(path.join(out,'zoom-email-login.png'),Buffer.from(emailImage.data,'base64'));
 report.ok=true;guest.ws.close();
}catch(error){report.ok=false;report.error=String(error.stack||error);process.exitCode=1}
finally{if(client){try{await client.call('Browser.close')}catch{}client.ws.close()}if(proc)proc.kill();fs.closeSync(log);fs.writeFileSync(logPath,redact(fs.readFileSync(logPath,'utf8')));fs.writeFileSync(path.join(out,'zoom-shell.json'),JSON.stringify(report,redactJSON,2));console.log('ZOOM_SHELL',JSON.stringify(report,redactJSON))}
})();
