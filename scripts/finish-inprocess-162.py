from pathlib import Path
root=Path(__file__).resolve().parent.parent
p=root/'src/app/bundles/main.js';s=p.read_text(encoding='utf-8')
if 'const haituoInprocessStops = new Map' not in s:
 needle='let HaituoLocalChats;'
 replacement='''const haituoInprocessStops = new Map;
function haituoStopEmbeddedProfile(id,child){
    if(haituoInprocessStops.has(id))return haituoInprocessStops.get(id);
    if(!child || child.exitCode!==null || child.killed || !child.connected)return Promise.resolve(!0);
    const operation=new Promise(resolve=>{
        let timer;
        const finish=()=>{clearTimeout(timer);resolve(!0)};
        child.once(`exit`,finish);
        timer=setTimeout(()=>{X.warn(`Embedded Signal graceful shutdown timed out (${id}); terminating backend`);child.removeListener(`exit`,finish);caishengTerminateSignalChild(child);resolve(!1)},6000);
        caishengSendChild(child,{type:`haituo-bridge-stop`});
    });
    haituoInprocessStops.set(id,operation);
    operation.finally(()=>{if(haituoInprocessStops.get(id)===operation)haituoInprocessStops.delete(id)});
    return operation;
}
let haituoEmbeddedQuitPending=!1,haituoEmbeddedQuitReady=!1;
function haituoInstallEmbeddedQuitGate(){
process.env.HAITUO_INPROCESS===`1` && p.app.on(`before-quit`,event=>{
    if($u!==`signal-main` || haituoEmbeddedQuitReady || !Yg.size)return;
    event.preventDefault();if(haituoEmbeddedQuitPending)return;
    haituoEmbeddedQuitPending=!0;
    Promise.all([...Yg].map(([id,child])=>haituoStopEmbeddedProfile(id,child))).finally(()=>{haituoEmbeddedQuitReady=!0;p.app.quit()});
});
}
let HaituoLocalChats;'''
 assert s.count(needle)==1;s=s.replace(needle,replacement)
 needle='''    if (process.env.HAITUO_INPROCESS === `1` && e.type === `haituo-bridge-invoke`) {'''
 assert s.count(needle)==1;s=s.replace(needle,'''    if(process.env.HAITUO_INPROCESS===`1` && e.type===`haituo-bridge-stop`){caishengParentHeartbeat=Date.now();p.app.quit();return;}
'''+needle)
 old='''p.ipcMain.handle(`caisheng:stop-signal-profile`, (e, t) => {'''
 assert s.count(old)==1;s=s.replace(old,'''p.ipcMain.handle(`caisheng:stop-signal-profile`, async (e, t) => {''')
 needle='''    let n = Yg.get(t);
    globalThis.caishengBridge?.dispose?.(t);'''
 assert s.count(needle)==1;s=s.replace(needle,'''    let n = Yg.get(t);
    if(process.env.HAITUO_INPROCESS===`1`){const graceful=await haituoStopEmbeddedProfile(t,n);globalThis.caishengBridge?.dispose?.(t);return graceful;}
    globalThis.caishengBridge?.dispose?.(t);''')
 # Per-WebContents CSS keys keep sibling views' appearance state independent.
 s=s.replace('let haituoNativeSignalCssKey;','const haituoNativeSignalCssKeys = new WeakMap;')
 s=s.replace('''        if (haituoNativeSignalCssKey) await win.webContents.removeInsertedCSS(haituoNativeSignalCssKey);
        haituoNativeSignalCssKey = await win.webContents.insertCSS(css);''','''        const oldKey=haituoNativeSignalCssKeys.get(win.webContents);
        if (oldKey) await win.webContents.removeInsertedCSS(oldKey);
        haituoNativeSignalCssKeys.set(win.webContents,await win.webContents.insertCSS(css));''')
 needle='''            const wasVisible=view.__haituoVisible;view.__haituoVisible=visible;view.setVisible(visible);'''
 assert s.count(needle)==1;s=s.replace(needle,'''            const appearance=$p(),signature=JSON.stringify([appearance.nativeTheme,appearance.chatFontSize,appearance.chatTextColor,appearance.incomingBubbleColor,appearance.outgoingBubbleColor]);
            if(view.__haituoAppearance!==signature && view.webContents.getURL().includes(`background.html`)){view.__haituoAppearance=signature;haituoApplyNativeSignalAppearance({webContents:view.webContents,isDestroyed:()=>view.webContents.isDestroyed()},appearance);}
'''+needle)
 s=s.replace('''view.__haituoVisible=!1;globalThis.caishengBridge?.syncVisibility''','''view.__haituoVisible=!1;view.__haituoAppearance=null;globalThis.caishengBridge?.syncVisibility''')
 s=s.replace('    const views = new Map, sender = new Map, pending = new Map, configs=new Map, syncData=new Map;', '    haituoInstallEmbeddedQuitGate();\n    const views = new Map, sender = new Map, pending = new Map, configs=new Map, syncData=new Map;')
 # Optional launcher argument activates the same gate; normal launch stays unchanged.
 needle='const haituoInprocessBackend = '
 assert s.count(needle)==1;s=s.replace(needle,'process.argv.includes(`--haituo-inprocess`) && (process.env.HAITUO_INPROCESS=`1`);\n'+needle)
 p.write_text(s,encoding='utf-8')
 print('Integrated graceful profile shutdown and per-view appearance')
else:print('Final inprocess safety integration already present')
