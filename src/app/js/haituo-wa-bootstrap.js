'use strict';
const {installHooks}=require('./haituo-wa-node-hooks.js');
function createBootstrap({app,webContents,log=()=>{}}){
 const sessions=new WeakSet,gates=new Map;
 function arm(contents){if(gates.has(contents.id))return gates.get(contents.id);let resolve;const gate=new Promise(done=>resolve=done);gates.set(contents.id,gate);
 const timer=setTimeout(()=>resolve(false),5000);contents.once('destroyed',()=>{clearTimeout(timer);gates.delete(contents.id);resolve(false)});
 (async()=>{try{if(contents.debugger.isAttached())throw Error('Debugger already in use');contents.debugger.attach('1.3');await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:"if(location.hostname==='web.whatsapp.com'){("+installHooks.toString()+')({document,window})}'});clearTimeout(timer);resolve(true);log('WA creation hook registered before navigation gate opens')}catch{clearTimeout(timer);resolve(false);log('WA creation hook registration failed; navigation blocked')}})();return gate;
 }
 function installSession(session){if(sessions.has(session))return;sessions.add(session);session.webRequest.onBeforeRequest({urls:['https://web.whatsapp.com/*']},(details,callback)=>{if(details.resourceType!=='mainFrame')return callback({});const contents=webContents.fromId(details.webContentsId);if(!contents)return callback({cancel:true});if(contents.getType()!=='webview')return callback({});arm(contents).then(ok=>callback(ok?{}:{cancel:true}),()=>callback({cancel:true}))})}
 app.on('web-contents-created',(_event,contents)=>{if(contents.getType()==='webview'&&sessions.has(contents.session))arm(contents)});
 return{installSession,arm};
}
module.exports={createBootstrap};
