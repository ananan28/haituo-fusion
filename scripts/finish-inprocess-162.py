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

preload=root/'src/app/bundles/preload/main.js'
payload=preload.read_text(encoding='utf-8')
old='(p === __.Timeline || p === __.Quote) && h.trim() && (p !== __.Timeline || !d) ?'
if old in payload:
 assert payload.count(old)==1
 preload.write_text(payload.replace(old,'(p === __.Timeline || p === __.Quote) && h.trim() ?'),encoding='utf-8')
for name in ['README.md','START-HERE.md']:
 document=root/name
 body=document.read_text(encoding='utf-8')
 if name=='README.md':
  body=body.replace('1.6.1','1.6.2')
  body=body.replace('本轮弱网、行情、语言及徽标修改见 CHANGELOG-1.6.2.md。','本轮消息记录持久化及子 Signal 融合候选功能见 CHANGELOG-1.6.2.md、INPROCESS-1.6.2.md。')
 else:
  body=body.replace('# 海拓 1.4.3 开发工程','# 海拓 1.6.2 开发工程')
 document.write_text(body,encoding='utf-8')
# Route actions that previously addressed a child BrowserWindow to its embedded view.
s=p.read_text(encoding='utf-8')
if 'const haituoEmbeddedRefresh = ' not in s:
 needle='''    if (process.platform === `darwin` && haituoMacRefreshPromises.has(t)) return haituoMacRefreshPromises.get(t);'''
 block='''    const haituoEmbeddedRefresh = process.env.HAITUO_INPROCESS===`1`;
    if(haituoEmbeddedRefresh){
        if(haituoMacRefreshPromises.has(t))return haituoMacRefreshPromises.get(t);
        const operation=(async()=>{const child=Yg.get(t);if(!child)return{ok:!1};if(!await haituoStopEmbeddedProfile(t,child))return{ok:!1};globalThis.caishengBridge?.dispose?.(t);return haituoLaunchSignalProfile(e,t)})();
        haituoMacRefreshPromises.set(t,operation);
        try{return await operation}finally{if(haituoMacRefreshPromises.get(t)===operation)haituoMacRefreshPromises.delete(t)}
    }
'''
 assert s.count(needle)==1;s=s.replace(needle,block+needle)
 needle='''        focus(workspaceId){const view=views.get(workspaceId);if(view?.__haituoVisible)view.webContents.focus();},'''
 assert s.count(needle)==1;s=s.replace(needle,needle+'''
        viewFor(workspaceId){const view=views.get(workspaceId);return view?{webContents:view.webContents,isDestroyed:()=>view.webContents.isDestroyed()}:null;},''')
 needle='''        const child = Yg.get(t.id);
        if (child && !child.killed && child.exitCode === null && child.connected) return caishengRequestChildLabel(child, current);'''
 assert s.count(needle)==1;s=s.replace(needle,'''        if(process.env.HAITUO_INPROCESS===`1`){const view=globalThis.caishengBridge?.viewFor?.(t.id);return view?haituoPromptAccountLabelInPage(view,current):null;}
'''+needle)
 p.write_text(s,encoding='utf-8')
 print('Routed embedded refresh and account-label actions')
