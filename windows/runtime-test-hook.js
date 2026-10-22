
if (process.platform === 'win32' && process.env.HAITUO_WINDOWS_RUNTIME === '1') {
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const snap="(()=>{const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';return {loading:[...document.querySelectorAll('.app-loading-screen')].some(visible),installed:[...document.querySelectorAll('[class*=\"InstallScreen\"],.inbox')].some(visible),text:document.body?.innerText?.slice(-1800)}})()";
 if($u!=='signal-main')process.on('message',async event=>{
  if(event?.type!=='windows-runtime-state'||!Z||Z.isDestroyed())return;
  try{process.send?.({type:'windows-runtime-result',requestId:event.requestId,visible:Z.isVisible(),page:await Z.webContents.executeJavaScript(snap)})}catch(error){process.send?.({type:'windows-runtime-result',requestId:event.requestId,error:String(error.stack||error)})}
 });
 else p.app.whenReady().then(async()=>{
  const output=process.env.HAITUO_WINDOWS_REPORT,report={ok:false,stages:[]};
  const save=()=>require('fs').writeFileSync(output,JSON.stringify(report,null,2));
  const check=(condition,message)=>{if(!condition)throw Error(message)};
  const selectMain=async()=>{await Z.webContents.executeJavaScript("document.querySelector('button[data-caisheng-tab-workspace=\"signal-main\"]')?.click()")};
  const mainReady=async(timeout=45000)=>{const end=Date.now()+timeout;let page;while(Date.now()<end){if(Z&&!Z.isDestroyed()){try{await selectMain();page=await Z.webContents.executeJavaScript(snap);if(page.installed&&!page.loading)return page}catch{}}await wait(250)}throw Error('Main Signal stayed loading: '+JSON.stringify(page))};
  const reload=async()=>{const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Navigation timeout')),15000);Z.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve()})});await p.ipcMain._invokeHandlers.get('caisheng:refresh-signal-profile')({},'signal-main');await loaded};
  const state=id=>new Promise((resolve,reject)=>{const child=Yg.get(id),requestId=id+Date.now();const timer=setTimeout(()=>{child.removeListener('message',listen);reject(Error('Child state timeout'))},5000);function listen(value){if(value?.type!=='windows-runtime-result'||value.requestId!==requestId)return;clearTimeout(timer);child.removeListener('message',listen);resolve(value)}child.on('message',listen);caishengSendChild(child,{type:'windows-runtime-state',requestId})});
  const childReady=async(id)=>{const end=Date.now()+45000;let value;while(Date.now()<end){if(Xg.has(id)){value=await state(id);if(value.page?.installed&&!value.page.loading&&value.visible)return value}await wait(500)}throw Error('Child stayed loading: '+JSON.stringify(value))};
  const activate=async id=>{await Z.webContents.executeJavaScript("document.querySelector('button[data-caisheng-tab-workspace="+JSON.stringify(id)+"]')?.click()")};
  const addChild=async()=>{const before=new Set(Yg.keys());await Z.webContents.executeJavaScript("document.querySelector('.CaishengPlatformShell__add').click()");await wait(500);await Z.webContents.executeJavaScript("[...document.querySelectorAll('.CaishengPlatformShell__picker button')].find(b=>b.textContent.includes('Signal'))?.click()");const end=Date.now()+45000;let id;while(!(id=[...Yg.keys()].find(x=>!before.has(x)))&&Date.now()<end)await wait(200);check(id,'Add-account UI did not launch');return id};
  try{
   report.stages.push({stage:'initial-main',page:await mainReady()});save();
   report.stages.push({stage:"main-refresh-started"});save();
   await reload();report.stages.push({stage:"main-refresh-navigation-complete"});save();
   if(process.env.HAITUO_WINDOWS_BASELINE==='1'){
    try{report.stages.push({stage:'reload-without-window-show',page:await mainReady(12000)});report.reproduced=false}catch(error){report.reproduced=true;report.stages.push({stage:'reload-stuck',error:String(error)})}
    Z.hide();await wait(300);Z.show();
    report.stages.push({stage:'window-show-recovers',page:await mainReady()});report.ok=true;save();return;
   }
   report.stages.push({stage:'main-refresh',page:await mainReady()});save();
   Z.minimize();await wait(500);Z.restore();report.stages.push({stage:'main-restored',page:await mainReady()});save();
   const ids=[];
   for(let i=0;i<2;i++){const id=await addChild();ids.push(id);report.stages.push({stage:'child-created',id,state:await childReady(id)});save()}
   for(const id of [ids[0],ids[1],ids[0]]){await activate(id);await wait(500);report.stages.push({stage:'account-selected',id,state:await childReady(id)});save()}
   await p.ipcMain._invokeHandlers.get('caisheng:refresh-signal-profile')({},ids[0]);await wait(2500);
   report.stages.push({stage:'child-refreshed',id:ids[0],state:await childReady(ids[0])});save();
   await activate('signal-main');report.stages.push({stage:'main-after-multi-account',page:await mainReady()});report.ok=true;
  }catch(error){report.error=String(error.stack||error)}
  finally{save();for(const child of Yg.values())caishengTerminateSignalChild(child);p.app.exit(report.ok?0:1)}
 });
}
