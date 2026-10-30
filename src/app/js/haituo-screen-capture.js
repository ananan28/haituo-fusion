'use strict';
const path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
function captureError(code,message){return Object.assign(Error(message),{code})}
const permissionMessage='请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制（或屏幕录制）”中允许海拓，然后完全退出海拓（Cmd+Q）并重新打开。';
async function captureMac(e,display,{run=promisify(execFile)}={}){
 const status=e.systemPreferences?.getMediaAccessStatus?.('screen');
 if(status==='denied'||status==='restricted')throw captureError('SCREEN_PERMISSION_REQUIRED',permissionMessage);
 const width=Math.round(display.bounds.width*display.scaleFactor),height=Math.round(display.bounds.height*display.scaleFactor);
 if(!Number.isSafeInteger(Number(display.id))||width<1||height<1||width*height>40e6)throw captureError('INVALID_CAPTURE_REQUEST','当前屏幕尺寸无效或过大，请降低分辨率后重试。');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'haituo-capture-'));
 try{
  const file=path.join(folder,'screen.png'),binary=path.join(__dirname,'../native/haituo-screen-capture').replace(/app\.asar([/\\])/,'app.asar.unpacked$1');
  let response;
  try{const result=await run(binary,[String(display.id),String(width),String(height),file],{timeout:25000,maxBuffer:65536,encoding:'utf8',windowsHide:true});response=JSON.parse(result.stdout.trim())}
  catch(error){let code;try{code=JSON.parse(String(error.stdout||'').trim()).code}catch{}if(code==='SCREEN_PERMISSION_REQUIRED')throw captureError(code,permissionMessage);if(code==='DISPLAY_NOT_FOUND')throw captureError(code,'当前显示器已断开或变化，请把鼠标移回有效屏幕后重试。');throw captureError('SCREEN_CAPTURE_FAILED','系统取屏失败，请确认屏幕录制权限已允许，退出海拓后重新打开；仍失败时请重试。');}
  if(response?.ok!==true||Number(response.displayId)!==Number(display.id))throw captureError('DISPLAY_NOT_FOUND','截图显示器不匹配，请重新选择屏幕。');
  const image=e.nativeImage.createFromBuffer(await fs.readFile(file));
  if(image.isEmpty())throw captureError('SCREEN_CAPTURE_FAILED','系统返回了空白截图，请重新授权屏幕录制后重试。');
  return image;
 }finally{await fs.rm(folder,{recursive:true,force:true})}
}
async function reportCaptureError(e,error,mode){
 const message=error?.code==='SCREEN_PERMISSION_REQUIRED'?permissionMessage:String(error?.message||error||'截图失败').slice(0,500),title=mode==='capture'?'截图暂不可用':'截图翻译暂不可用';
 try{
  if(error?.code==='SCREEN_PERMISSION_REQUIRED'&&typeof e.dialog?.showMessageBox==='function'){
   const result=await e.dialog.showMessageBox({type:'info',title,message:'需要允许屏幕录制',detail:message,buttons:['打开系统设置','稍后'],defaultId:0,cancelId:1,noLink:true});
   if(result.response===0)await e.shell?.openExternal?.('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }else e.dialog?.showErrorBox?.(title,message);
 }catch{} // Error reporting must never become an unhandled rejection itself.
 return{ok:false,code:error?.code||'SCREEN_CAPTURE_FAILED',message};
}
module.exports={captureMac,reportCaptureError,permissionMessage};
