'use strict';
function isZoomURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='zoom.us'||u.hostname.endsWith('.zoom.us'))}catch{return false}}
function install({electron:e,session,getOwner,log=()=>{}}){
 const granted=new Set();
 const trusted=(contents,origin)=>contents&&!contents.isDestroyed()&&isZoomURL(contents.getURL())&&isZoomURL(origin);
 const validTypes=types=>Array.isArray(types)&&types.length>0&&types.every(t=>t==='audio'||t==='video');
 session.setPermissionCheckHandler((contents,permission,origin,details)=>{
  if(!trusted(contents,origin))return false;
  if(permission==='persistent-storage')return true;
  if(permission==='display-capture')return Date.now()-Number(contents.haituoLastGestureAt||0)<8000;
  if(permission==='media'){const types=details?.mediaTypes||(['audio','video'].includes(details?.mediaType)?[details.mediaType]:[]);return validTypes(types)&&types.every(t=>granted.has(t))}
  return permission==='notifications'&&granted.has('notifications');
 });
 session.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
  let done=false;const finish=value=>{if(!done){done=true;callback(value)}};
  try{
   if(!trusted(contents,details?.requestingUrl||details?.securityOrigin||contents?.getURL()))return finish(false);
   if(permission==='persistent-storage')return finish(true);
   if(permission==='display-capture')return finish(Date.now()-Number(contents.haituoLastGestureAt||0)<8000);
   const types=permission==='media'?details?.mediaTypes:permission==='notifications'?['notifications']:[];
   if(!validTypes(types)&&permission!=='notifications')return finish(false);
   if(types.every(t=>granted.has(t)))return finish(true);
   if(Date.now()-Number(contents.haituoLastGestureAt||0)>=8000)return finish(false);
   const names={audio:'麦克风',video:'摄像头',notifications:'通知'};
   const result=await e.dialog.showMessageBox(getOwner(),{type:'question',message:'允许此 Zoom 账号使用'+types.map(t=>names[t]).join('、')+'？',detail:'仅供当前账号使用；会议音视频由 Zoom 处理，海拓不会因此开始录音。',buttons:['取消','允许'],defaultId:0,cancelId:0});
   if(result.response!==1||contents.isDestroyed())return finish(false);
   types.forEach(t=>granted.add(t));finish(true);
  }catch(error){log('Zoom permission failed: '+String(error?.message||error));finish(false)}
 });
 session.setDisplayMediaRequestHandler(async(request,callback)=>{
  let done=false;const finish=value=>{if(!done){done=true;callback(value)}};
  try{
   if(!request.userGesture||!isZoomURL(request.frame?.url))return finish({});
   const sources=await e.desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
   if(!sources.length)return finish({});
   const result=await e.dialog.showMessageBox(getOwner(),{type:'question',message:'选择此 Zoom 会议要共享的屏幕或窗口',buttons:['取消',...sources.map((s,i)=>(i+1)+'. '+s.name.slice(0,80))],defaultId:0,cancelId:0});
   if(result.response<1||result.response>sources.length||!isZoomURL(request.frame?.url))return finish({});
   finish({video:sources[result.response-1]});
  }catch(error){log('Zoom screen sharing failed: '+String(error?.message||error));finish({})}
 },{useSystemPicker:true});
 return{clearConsent:()=>granted.clear()};
}
module.exports={isZoomURL,install};
// Zoom's own login buttons hand off to these identity providers. Google rejects
// OAuth inside Electron webviews, so the pane delegates them to an app-owned
// top-level window that shares the same persist:caisheng-zoom-* session.
const IDENTITY_HOSTS=new Set([`accounts.google.com`,`accounts.youtube.com`,`oauth2.googleapis.com`,`id.apple.com`,`appleid.apple.com`,`login.microsoftonline.com`,`login.microsoft.com`,`login.live.com`,`facebook.com`,`www.facebook.com`,`m.facebook.com`]);
// Zoom enterprise SSO leaves zoom.us for a customer identity provider and
// returns; only that bounded hop may navigate the pane off Zoom.
const AUTH_HOP_MS=12e4;
function isIdentityURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&IDENTITY_HOSTS.has(u.hostname.toLowerCase())}catch{return false}}
function authPageURL(value){try{const u=new URL(value);return u.origin+u.pathname}catch{return`[invalid auth url]`}}
function isZoomSSOURL(value){try{const u=new URL(value);return isZoomURL(value)&&/^\/web\/sso\/login(?:[/?#]|$)/.test(u.pathname)}catch{return false}}
function installNavigation(contents,{openExternal,openAuth,log=()=>{}}){
 let hopUntil=0,hopOrigin='',lastExternalUrl='',lastExternalAt=0;
 const guard=(event,url)=>{
  if(isZoomURL(url)){
   if(hopUntil)log('Zoom returned to Zoom from the identity hop');
   if(isZoomSSOURL(url)){hopUntil=Date.now()+AUTH_HOP_MS;hopOrigin=''}else{hopUntil=0;hopOrigin=''}
   return;
  }
  if(isIdentityURL(url)){
   hopUntil=Date.now()+AUTH_HOP_MS;
   if(!hopOrigin)hopOrigin=new URL(url).origin;
   log('Zoom identity hand-off requested: '+authPageURL(url));
   if(openAuth){
    event.preventDefault();
    try{openAuth(url)}catch(error){log('Zoom auth window failed: '+String(error?.name||'auth window failed'))}
   }
   return;
  }
  if(Date.now()<hopUntil&&/^https:/i.test(url)){
   let origin='';try{origin=new URL(url).origin}catch{}
   if(origin&&(!hopOrigin||origin===hopOrigin)){if(!hopOrigin)hopOrigin=origin;log('Zoom SSO hop kept in Haituo: '+authPageURL(url));return}
  }
  event.preventDefault();
  const now=Date.now();
  if(/^https?:/i.test(url)&&Date.now()-Number(contents.haituoLastGestureAt||0)<8000&&!(url===lastExternalUrl&&now-lastExternalAt<1000)){
   lastExternalUrl=url;lastExternalAt=now;
   log('Zoom link sent to system browser: '+authPageURL(url));Promise.resolve().then(()=>openExternal(url)).catch(error=>log('Zoom external link failed: '+String(error?.code||error?.name||'external open failed')))
  }
 };
 contents.on('will-navigate',guard);contents.on('will-redirect',guard);
 contents.on('did-create-window',child=>{child.haituoLastGestureAt=Date.now();installNavigation(child,{openExternal,log})});
 contents.once('destroyed',()=>{contents.removeListener('will-navigate',guard);contents.removeListener('will-redirect',guard)});
}
function openAuthWindow({electron,parent,url,partition,onReturn,openExternal,log=()=>{}}){
 if(!isIdentityURL(url))throw Error('Refusing non-identity Zoom auth URL');
 let done=false,returned=false,timer;
 const finish=()=>{
  if(done)return;
  done=true;
  clearTimeout(timer);
  if(win.isDestroyed())return;
  try{Promise.resolve(onReturn?.()).catch(error=>log('Zoom auth return failed: '+String(error?.code||error?.name||'return failed')))}catch(error){log('Zoom auth return failed: '+String(error?.code||error?.name||'return failed'))}
  win.destroy();
 };
 const finishWhenLoaded=contents=>{
  if(!returned||done||win.isDestroyed()||contents.isDestroyed()||contents.isLoading())return;
  if(!isZoomURL(contents.getURL()))return;
  clearTimeout(timer);
  timer=setTimeout(()=>{if(!win.isDestroyed()&&!contents.isDestroyed()&&!contents.isLoading()&&isZoomURL(contents.getURL()))finish()},750);
 };
 const watched=new Set();
 const observe=contents=>{
  if(watched.has(contents))return;
  watched.add(contents);
  contents.on('did-navigate',(_event,current)=>{
   if(!isZoomURL(current))return;
   returned=true;
   log('Zoom auth returned to Zoom: '+authPageURL(current));
   clearTimeout(timer);
   timer=setTimeout(()=>finishWhenLoaded(contents),1500);
  });
  contents.on('did-stop-loading',()=>finishWhenLoaded(contents));
 };
 const popupHandler=details=>{
  if(isZoomURL(details.url)||isIdentityURL(details.url))return{action:'allow',overrideBrowserWindowOptions:{parent:win,autoHideMenuBar:true,width:1024,height:768,webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false}}};
  return{action:'deny'};
 };
 const manageChild=child=>{
  child.setWindowOpenHandler(popupHandler);
  installAuthUserAgentMetadata(child,{log});
  observe(child);
  child.on('did-create-window',manageChild);
 };
 const win=new electron.BrowserWindow({parent,autoHideMenuBar:true,width:560,height:820,title:'Zoom 登录 — 海拓',webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 observe(win.webContents);
 installAuthUserAgentMetadata(win.webContents,{log});
 win.webContents.haituoLastGestureAt=Date.now();
 win.webContents.on('before-input-event',(_event,input)=>{if(input.type==='mouseDown'||input.type==='keyDown')win.webContents.haituoLastGestureAt=Date.now()});
 win.webContents.setWindowOpenHandler(popupHandler);
 win.webContents.on('did-create-window',manageChild);
 installNavigation(win.webContents,{openExternal,log});
 win.webContents.on('did-fail-load',(_event,code,_description,url,isMainFrame)=>{if(isMainFrame)log('Zoom auth main-frame load failed: '+String(code)+' '+authPageURL(url))});
 win.once('closed',()=>clearTimeout(timer));
 timer=setTimeout(()=>{log('Zoom auth window timed out');if(!win.isDestroyed())win.destroy()},600000);
 win.loadURL(url).catch(error=>{log('Zoom auth window load failed: '+String(error?.code||error?.name||'load failed'))});
 return win;
}
function installAuthUserAgentMetadata(contents,{chrome=process.versions.chrome,platform=process.platform,architecture=process.arch,log=()=>{}}={}){
 if(!contents?.debugger)return;
 const userAgent=browserUserAgent(chrome,platform),major=String(chrome).split('.')[0],full=String(chrome);
 const name=platform==='win32'?'Windows':platform==='darwin'?'macOS':'Linux';
 const brands=[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major},{brand:'Not=A?Brand',version:'99'}];
 try{
  contents.debugger.attach('1.3');
  Promise.resolve(contents.debugger.sendCommand('Emulation.setUserAgentOverride',{
   userAgent,
   userAgentMetadata:{brands,fullVersionList:brands.map(item=>({brand:item.brand,version:item.brand==='Not=A?Brand'?'99.0.0.0':full})),fullVersion:full,mobile:false,platform:name,platformVersion:platform==='win32'?'10.0.0':'10.15.7',architecture:architecture==='arm64'?'arm':'x86',model:'',bitness:architecture==='ia32'?'32':'64'}
  })).catch(error=>log('Zoom auth client hints unavailable: '+String(error?.message||'client hints unavailable')));
 }catch(error){log('Zoom auth client hints unavailable: '+String(error?.message||'client hints unavailable'))}
}
module.exports.installNavigation=installNavigation;
module.exports.isIdentityURL=isIdentityURL;
module.exports.openAuthWindow=openAuthWindow;
module.exports.authPageURL=authPageURL;
module.exports.installAuthUserAgentMetadata=installAuthUserAgentMetadata;

function browserUserAgent(chrome=process.versions.chrome,platform=process.platform){
 if(!/^\d+(?:\.\d+){1,3}$/.test(String(chrome)))throw Error('Invalid Chromium runtime version');
 const os=platform==='win32'?'Windows NT 10.0; Win64; x64':platform==='darwin'?'Macintosh; Intel Mac OS X 10_15_7':'X11; Linux x86_64';
 return 'Mozilla/5.0 ('+os+') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+chrome+' Safari/537.36';
}
function browserClientHints(chrome=process.versions.chrome,platform=process.platform){
 browserUserAgent(chrome,platform);
 const major=String(chrome).split('.')[0];
 const name=platform==='win32'?'Windows':platform==='darwin'?'macOS':'Linux';
 return{
  'sec-ch-ua':`"Chromium";v="${major}", "Google Chrome";v="${major}", "Not=A?Brand";v="99"`,
  'sec-ch-ua-mobile':'?0',
  'sec-ch-ua-platform':`"${name}"`
 };
}
function installUserAgent(session,{chrome=process.versions.chrome,platform=process.platform}={}){
 const userAgent=browserUserAgent(chrome,platform),hints=browserClientHints(chrome,platform);
 session.setUserAgent(userAgent);
 session.webRequest.onBeforeSendHeaders((details,callback)=>{
  if(!/^https:\/\//i.test(details.url)){callback({requestHeaders:details.requestHeaders});return}
  const headers={...details.requestHeaders};
  for(const key of Object.keys(headers)){
   const name=key.toLowerCase();
   if(name==='user-agent'||name.startsWith('sec-ch-ua'))delete headers[key]
  }
  Object.assign(headers,{'User-Agent':userAgent,...hints});
  callback({requestHeaders:headers})
 });
}
module.exports.browserUserAgent=browserUserAgent;
module.exports.browserClientHints=browserClientHints;
module.exports.installUserAgent=installUserAgent;
