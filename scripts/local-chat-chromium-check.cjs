'use strict';
// Run the exact native-app layout fixture in a fast real Chromium session
// before spending time packaging either desktop platform. No linked accounts.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-layout-')),port=19453;
const browser=cp.spawn(process.env.HAITUO_QA_CHROME||'google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let socket,serial=0;const pending=new Map,pause=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
(async()=>{try{
 let target,last;const deadline=Date.now()+20000;while(Date.now()<deadline){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.type==='page');if(target)break}catch(error){last=error}await pause(100)}if(!target)throw Error('Chromium unavailable: '+last);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});socket.addEventListener('message',event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(item){pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result)}});
 const source=fs.readFileSync(path.resolve('src/app/js/haituo-local-chat-view.js'),'utf8'),fixture=require('./local-chat-layout-fixture.cjs').toString();
   const webSource=fs.readFileSync(path.resolve('src/app/js/caisheng-webview-preload.js'),'utf8'),positionSource=webSource.slice(webSource.indexOf('function haituoTranslationScroller('),webSource.indexOf('// Apply only to WhatsApp.'));
 const result=await call('Runtime.evaluate',{expression:`(async()=>{const local={exports:{}};((module)=>{${source}\n})(local);const keep=(()=>{${positionSource};return haituoKeepTranslationPosition})();return (${fixture})(local.exports.install,keep)})()`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);console.log('WHATSAPP_CHROMIUM_LAYOUT_OK',JSON.stringify(result.result.value));
 }catch(error){console.error(error);process.exitCode=1}finally{try{await call('Browser.close')}catch{}try{socket?.close()}catch{}browser.kill();await pause(250);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}})();
