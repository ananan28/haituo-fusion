'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const out=path.resolve('audit-results'),logPath=path.join(out,'zoom-shell.log');fs.mkdirSync(out,{recursive:true});
const report={scope:'PACKAGED_APP_REAL_ZOOM_UNAUTHENTICATED_LOGIN',platform:process.platform,errors:[],realAccount:'UNTESTED',checks:[]};
let client,proc;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const safeURL=value=>{try{const u=new URL(value);return u.origin+u.pathname}catch{return'[invalid url]'}};
const redact=value=>typeof value==='string'?value.replace(/https?:\/\/[^\s"'<>]+/gi,url=>safeURL(url)):value;
const redactJSON=(_key,value)=>redact(value);
const isGoogleURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='accounts.google.com'}catch{return false}};
async function probeAuthEgress(url){
 const started=Date.now(),controller=new AbortController(),abort=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Accept-Language':'en-US,en;q=0.9'}});
  const text=await response.text(),location=response.headers.get('location');
  return{status:response.status,responseUrl:safeURL(response.url),location:location?safeURL(new URL(location,url).href):null,unsafe:/此浏览器或应用不安全|浏览器或应用可能不安全|请尝试使用其他浏览器|This browser or app may not be secure/i.test(text.slice(0,4000)),ms:Date.now()-started}
 }catch(error){return{status:null,error:String(error?.name||error?.code||'fetch failed'),ms:Date.now()-started}}
 finally{clearTimeout(abort)}
}
async function probeAuthDocument(client,url){
 const started=Date.now();let navigateError='',page=null;
 try{const result=await client.call('Page.navigate',{url});navigateError=result?.errorText||''}catch(error){navigateError=String(error.message||error)}
 const end=Date.now()+12000;
 while(Date.now()<end){try{const r=await client.call('Runtime.evaluate',{expression:`({url:location.href,ready:document.readyState,title:document.title,text:document.body?.innerText?.slice(0,300)||'',userAgent:navigator.userAgent,webdriver:navigator.webdriver,clientHints:navigator.userAgentData?{brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform}:null,highEntropy:navigator.userAgentData?.getHighEntropyValues?navigator.userAgentData.getHighEntropyValues(['architecture','bitness','fullVersionList','platformVersion','uaFullVersion']):null})`,returnByValue:true,awaitPromise:true});page=r.result?.value||null;if(page?.ready==='complete')break}catch{}await pause(250)}
 return{url:safeURL(url),navigateError,page,ms:Date.now()-started}
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
 let googleRect=null;end=Date.now()+45000;
 while(Date.now()<end){try{const r=await guest.call('Runtime.evaluate',{expression:`({url:location.href,ready:document.readyState,text:document.body?.innerText?.slice(0,2000)||'',children:document.body?.children.length||0,title:document.title,userAgent:navigator.userAgent,clientHints:navigator.userAgentData?{brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform}:null,webdriver:navigator.webdriver})`,returnByValue:true});report.page=r.result?.value;const rect=await guest.call('Runtime.evaluate',{expression:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Google$/.test(b.innerText.trim()));if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,returnByValue:true});googleRect=rect.result?.value||null;if(report.page?.text.length>80&&googleRect)break;if(/(?:400 Bad Request|403 Forbidden|Access Denied|unsupported browser)/i.test(report.page?.text||'')||/^Error\b/i.test(report.page?.title||''))break}catch(error){if(!/navigated or closed|Execution context|Cannot find context/i.test(String(error.message)))throw error;}await pause(500)}
 report.lifecycle=await evaluate(`(()=>{const v=[...document.querySelectorAll('webview')].find(v=>String(v.getAttribute('partition')).includes('-zoom-'));return{visible:!!v&&getComputedStyle(v).visibility==='visible'&&getComputedStyle(v).opacity!=='0',overlayVisible:[...document.querySelectorAll('[data-haituo-zoom-status]')].some(p=>getComputedStyle(p).display!=='none')}})()`);
 if(!report.lifecycle.visible||report.lifecycle.overlayVisible)throw Error('Zoom guest is hidden by host UI');
 const image=await client.call('Page.captureScreenshot');fs.writeFileSync(path.join(out,'zoom-shell.png'),Buffer.from(image.data,'base64'));
 if(!report.shell?.id||report.shell.width<100||report.shell.height<100||report.shell.visibility!=='visible')throw Error('Zoom webview not attached/visible');
 if(/(?:400 Bad Request|403 Forbidden|Access Denied|unsupported browser)/i.test(report.page?.text||'')||/^Error\b/i.test(report.page?.title||''))throw Error('Zoom returned an error page: '+JSON.stringify(report.page));
 if(!report.page||report.page.children===0||report.page.text.length<80)throw Error('Real Zoom page empty: '+JSON.stringify(report.page));
 if(!googleRect)throw Error('Google login button missing on real Zoom page');
 const existingPages=new Set((await targets()).filter(t=>t.type==='page').map(t=>t.id));
 const point=googleRect;
 await guest.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
 await guest.call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 await guest.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 const authStarted=Date.now();end=Date.now()+45000;let authTarget,auth;const authNetwork=[],authRequests=new Map();
 const recordAuthNetwork=message=>{
  if(authNetwork.length>=30)return;
  const p=message.params||{};
  if(message.method==='Network.requestWillBeSent'&&p.type==='Document'){
   const requestURL=redact(p.request?.url||'');authRequests.set(p.requestId,requestURL);const headers=p.request?.headers||{},selected={};
   for(const key of Object.keys(headers)){const name=key.toLowerCase();if(['user-agent','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','sec-fetch-site','sec-fetch-mode','sec-fetch-user','sec-fetch-dest','accept-language'].includes(name))selected[key]=headers[key]}
   authNetwork.push({kind:'request',url:requestURL,method:p.request?.method,type:p.type,headers:selected})
  }else if(message.method==='Network.responseReceived'&&p.type==='Document'){
   const headers=p.response?.headers||{},selected={};
   for(const key of Object.keys(headers)){const name=key.toLowerCase();if(['content-type','x-frame-options'].includes(name))selected[key]=headers[key]}
   authNetwork.push({kind:'response',url:redact(p.response?.url||''),status:p.response?.status,protocol:p.response?.protocol,mimeType:p.response?.mimeType,blockedReason:p.blockedReason||null,headers:selected})
  }else if(message.method==='Network.loadingFailed'){
   authNetwork.push({kind:'failed',url:authRequests.get(p.requestId)||null,type:p.type,errorText:p.errorText,blockedReason:p.blockedReason||null,canceled:!!p.canceled})
  }
 };
 while(Date.now()<end){try{const t=(await targets()).find(t=>t.type==='page'&&!existingPages.has(t.id));if(t){authTarget=t;auth=await attach(t,recordAuthNetwork);await auth.call('Network.enable');await auth.call('Page.enable');await auth.call('Runtime.enable');break}}catch{}await pause(300)}
 if(!auth)throw Error('Google did not open in an app-owned top-level auth window');
 let retryURL=authTarget.url,historyError='';
 try{const history=await auth.call('Page.getNavigationHistory');const current=history.currentIndex||0,entries=history.entries||[];for(let i=current;i>=0;i--)if(isGoogleURL(entries[i]?.url)){retryURL=entries[i].url;break}}catch(error){historyError=String(error.message||error)}
 if(!isGoogleURL(retryURL))retryURL='';
 const isolation={googleHome:await probeAuthDocument(auth,'https://www.google.com/'),googleAccount:await probeAuthDocument(auth,'https://accounts.google.com/')};
 const egressProbe=retryURL?await probeAuthEgress(retryURL):{status:null,error:'Original Google authorization URL unavailable',ms:0};
 let retryError='';
 if(retryURL){try{const result=await auth.call('Page.navigate',{url:retryURL});retryError=result?.errorText||''}catch(error){retryError=String(error.message||error)}}else await auth.call('Page.reload').catch(error=>retryError=String(error.message||error));
 const authOpenedMs=Date.now()-authStarted;let authPage=null,lastText='',stableSince=0,authProbeError='';end=Date.now()+30000;
 while(Date.now()<end){try{const r=await auth.call('Runtime.evaluate',{expression:`({url:location.href,title:document.title,text:document.body?.innerText||'',userAgent:navigator.userAgent,clientHints:navigator.userAgentData?{brands:navigator.userAgentData.brands,mobile:navigator.userAgentData.mobile,platform:navigator.userAgentData.platform}:null,webdriver:navigator.webdriver,children:document.body?.children.length||0})`,returnByValue:true});authPage=r.result?.value;if(/此浏览器或应用不安全|浏览器或应用可能不安全|请尝试使用其他浏览器|This browser or app may not be secure/i.test(authPage?.text||''))throw Error('Google rejects the Electron auth window as unsafe before stability check');if(authPage?.text.length>20){if(authPage.text===lastText){if(!stableSince)stableSince=Date.now()}else{stableSince=0;lastText=authPage.text}if(stableSince&&Date.now()-stableSince>=4000)break}}catch(error){authProbeError=String(error.message||error);if(/unsafe/i.test(String(error.message)))throw error}await pause(500)}
 const appLog=fs.readFileSync(path.join(out,'zoom-shell.log'),'utf8');
 const authLoadFailure=appLog.split(/\r?\n/).find(line=>/Failed to load URL|Zoom auth .*load failed/.test(line));
 report.googleAuth={targetId:authTarget.id,targetType:authTarget.type,targetUrl:redact(authTarget.url),guestTargetId:report.guestTargetId,openedMs:authOpenedMs,loadFailure:authLoadFailure?redact(authLoadFailure):null,probeError:authProbeError?redact(authProbeError):null,isolation,retry:{url:redact(retryURL),historyError:redact(historyError),error:redact(retryError)},egressProbe,page:authPage?{url:authPage.url,title:authPage.title,text:authPage.text.slice(0,1200),userAgent:authPage.userAgent,clientHints:authPage.clientHints,webdriver:authPage.webdriver,children:authPage.children}:null,network:authNetwork};
 if(/此浏览器或应用不安全|浏览器或应用可能不安全|请尝试使用其他浏览器|This browser or app may not be secure/i.test(authPage?.text||''))throw Error('Google still rejects the Electron auth window as unsafe');
 if(/Electron|海拓|Haituo/i.test(authPage?.userAgent||''))throw Error('Auth window exposes an application user agent');
 if(!authPage||authPage.children===0||authPage.text.length<20)throw Error('Google auth window is empty'+(report.googleAuth.loadFailure?': '+report.googleAuth.loadFailure:''));
 report.guestUrlAfterGoogle=(await guest.call('Runtime.evaluate',{expression:'location.href',returnByValue:true})).result?.value;
 if(/accounts\.google\.com/.test(report.guestUrlAfterGoogle||''))throw Error('Google navigated the embedded Zoom webview instead of the auth window');
 await auth.call('Page.navigate',{url:'https://zoom.us/meeting/login'});
 const returnStarted=Date.now();end=Date.now()+15000;let returnedGuest=null,authClosed=false;
 while(Date.now()<end){const list=await targets();authClosed=!list.some(t=>t.id===authTarget.id);returnedGuest=list.find(t=>t.id===report.guestTargetId);if(authClosed&&returnedGuest)break;await pause(300)}
 report.syntheticReturn={authClosed,guestTargetId:returnedGuest?.id||null,guestUrl:returnedGuest?.url?.split('?')[0]||null,ms:Date.now()-returnStarted};
 if(!authClosed||!returnedGuest)throw Error('Auth window did not close and return to the Zoom pane after a Zoom navigation');
 try{auth.ws.close()}catch{}
 report.ok=true;guest.ws.close();
}catch(error){report.ok=false;report.error=String(error.stack||error);process.exitCode=1}
finally{if(client){try{await client.call('Browser.close')}catch{}client.ws.close()}if(proc)proc.kill();fs.closeSync(log);fs.writeFileSync(logPath,redact(fs.readFileSync(logPath,'utf8')));fs.writeFileSync(path.join(out,'zoom-shell.json'),JSON.stringify(report,redactJSON,2));console.log('ZOOM_SHELL',JSON.stringify(report,redactJSON))}
})();
