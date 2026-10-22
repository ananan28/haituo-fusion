from pathlib import Path
import json
app=Path('macos/staging/app')
p=app/'bundles/main.js'
s=p.read_text(encoding='utf-8')
anchor='    Z.on(\x60show\x60, b), Z.webContents.on(\x60devtools-reload-page\x60, () => {'
assert s.count(anchor)==1
s=s.replace(anchor,'''    Z.on(\x60show\x60, b), Z.on(\x60restore\x60, b),
    Z.webContents.on(\x60dom-ready\x60, () => {
        if (Z && !Z.isDestroyed() && Z.isVisible() && !Z.isMinimized()) b();
    }), Z.webContents.on(\x60devtools-reload-page\x60, () => {''',1)
anchor='p.ipcMain.handle(\x60database-ready\x60, async () => {'
assert s.count(anchor)==1
s=s.replace(anchor,'''p.ipcMain.handle(\x60haituo:is-window-visible\x60, event => {
    const win = p.BrowserWindow.fromWebContents(event.sender);
    return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}), p.ipcMain.handle(\x60database-ready\x60, async () => {''',1)
p.write_text(s,encoding='utf-8')
p=app/'bundles/preload/main.js'
s=p.read_text(encoding='utf-8')
anchor='    async function hvn() {\n        await wvn;\n    }'
assert s.count(anchor)==1
s=s.replace(anchor,'''    async function hvn() {
        // A reload can miss the original show notification while the window remains visible.
        if (await u.ipcRenderer.invoke(\x60haituo:is-window-visible\x60)) return;
        await wvn;
    }''',1)
p.write_text(s,encoding='utf-8')
p=app/'package.json'
pkg=json.loads(p.read_text(encoding='utf-8'))
assert pkg['signalProtocolVersion']=='8.29.0-alpha.1'
pkg['version']=json.loads(Path('project.json').read_text(encoding='utf-8'))['versions']['windows']
p.write_text(json.dumps(pkg,ensure_ascii=False,indent=2),encoding='utf-8')
print('Repaired window visibility handshake and startup replay for Windows release build')
