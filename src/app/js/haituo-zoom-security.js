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
// Identity providers reject OAuth in embedded browsers, including Electron BrowserWindow.
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
   event.preventDefault();
   log('Zoom identity hand-off blocked in embedded browser: '+authPageURL(url));
   if(openAuth){try{openAuth(url)}catch(error){log('Zoom auth notice failed: '+String(error?.name||'auth notice failed'))}}
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
 contents.on('did-create-window',child=>{child.haituoLastGestureAt=Date.now();installNavigation(child,{openExternal,openAuth,log})});
 contents.once('destroyed',()=>{contents.removeListener('will-navigate',guard);contents.removeListener('will-redirect',guard)});
}
async function focusZoomEmail(contents){
 if(!contents||contents.isDestroyed())return false;
 // Execute only on Zoom's own page, never on an identity-provider page.
 if(isZoomURL(contents.getURL())){
  const focused=await contents.executeJavaScript(`(()=>{const inputs=[...document.querySelectorAll('input')];const input=inputs.find(el=>{const rect=el.getBoundingClientRect();return !el.disabled&&rect.width>80&&rect.height>20&&getComputedStyle(el).visibility==='visible'&&(el.type==='email'||/email/i.test(el.name||'')||el.autocomplete==='username')});if(!input)return false;input.scrollIntoView({block:'center'});input.focus();return document.activeElement===input})()`).catch(()=>false);
  if(focused)return true;
 }
 if(contents.isDestroyed())return false;
 await contents.loadURL('https://zoom.us/meeting/login');
 return isZoomURL(contents.getURL());
}
function notifyIdentityUnsupported({electron,parent,guest,url,log=()=>{}}={}){
 if(!isIdentityURL(url))return Promise.resolve(false);
 log('Zoom identity login is unavailable in the embedded browser: '+authPageURL(url));
 return Promise.resolve(electron?.dialog?.showMessageBox?.(parent,{type:'info',title:'Zoom 第三方登录',message:'Google、Apple、Facebook 和微软第三方登录不能在海拓内嵌浏览器中完成。',detail:'请使用 Zoom 官方邮箱登录。原先使用 Google 的账号，可以为同一邮箱添加 Zoom 登录密码；这里不要填写 Google 密码。海拓不会把登录转到系统浏览器，也不会读取或保存你的密码。',buttons:['使用邮箱登录','取消'],defaultId:0,cancelId:1})).then(result=>result?.response===0?focusZoomEmail(guest):false).catch(error=>{log('Zoom identity login notice failed: '+String(error?.message||'identity notice failed'));return false})
}
module.exports.installNavigation=installNavigation;
module.exports.isIdentityURL=isIdentityURL;
module.exports.authPageURL=authPageURL;
module.exports.notifyIdentityUnsupported=notifyIdentityUnsupported;
module.exports.focusZoomEmail=focusZoomEmail;

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
  if(!/^https:\/\//i.test(details.url)||isIdentityURL(details.url)){callback({requestHeaders:details.requestHeaders});return}
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
