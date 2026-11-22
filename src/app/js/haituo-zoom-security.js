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
// Zoom's own login buttons hand off to these identity providers. Their popups
// post the credential back to the Zoom page, so they stay inside Haituo.
const IDENTITY_HOSTS=new Set([`accounts.google.com`,`accounts.youtube.com`,`oauth2.googleapis.com`,`id.apple.com`,`appleid.apple.com`,`login.microsoftonline.com`,`login.microsoft.com`,`login.live.com`,`facebook.com`,`www.facebook.com`,`m.facebook.com`]);
// Zoom enterprise SSO leaves zoom.us for a customer identity provider and
// returns; only that bounded hop may navigate the pane off Zoom.
const AUTH_HOP_MS=12e4;
function isIdentityURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&IDENTITY_HOSTS.has(u.hostname.toLowerCase())}catch{return false}}
function installNavigation(contents,{openExternal,log=()=>{}}){
 let hopUntil=0;
 const guard=(event,url)=>{
  if(isZoomURL(url)){if(hopUntil){log('Zoom returned to Zoom from the identity hop')}hopUntil=0;return}
  if(isIdentityURL(url)){hopUntil=Date.now()+AUTH_HOP_MS;log('Zoom identity hand-off kept in Haituo: '+url);return}
  if(Date.now()<hopUntil&&/^https:/i.test(url)){log('Zoom SSO hop kept in Haituo: '+url);return}
  event.preventDefault();
  if(/^https?:/i.test(url)&&Date.now()-Number(contents.haituoLastGestureAt||0)<8000){log('Zoom link sent to system browser: '+url);Promise.resolve().then(()=>openExternal(url)).catch(error=>log('Zoom external link failed: '+String(error.message)));}
 };
 contents.on('will-navigate',guard);contents.on('will-redirect',guard);
 contents.on('did-create-window',child=>{child.haituoLastGestureAt=Date.now();installNavigation(child,{openExternal,log})});
 contents.once('destroyed',()=>{contents.removeListener('will-navigate',guard);contents.removeListener('will-redirect',guard)});
}
module.exports.installNavigation=installNavigation;
module.exports.isIdentityURL=isIdentityURL;

function browserUserAgent(chrome=process.versions.chrome,platform=process.platform){
 if(!/^\d+(?:\.\d+){1,3}$/.test(String(chrome)))throw Error('Invalid Chromium runtime version');
 const os=platform==='win32'?'Windows NT 10.0; Win64; x64':platform==='darwin'?'Macintosh; Intel Mac OS X 10_15_7':'X11; Linux x86_64';
 return 'Mozilla/5.0 ('+os+') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+chrome+' Safari/537.36';
}
module.exports.browserUserAgent=browserUserAgent;
