'use strict';

const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ServiceStore, servicePartition } = require('./service-store');

app.setName('财盛聚合聊天');
app.setPath('userData', path.join(app.getPath('appData'), '财盛聚合聊天'));

const CATALOG = Object.freeze([
  { id: 'signal', name: 'Signal', kind: 'native', color: '#3a76f0' },
  { id: 'whatsapp', name: 'WhatsApp', kind: 'web', url: 'https://web.whatsapp.com/', color: '#13a45a' }
]);
const smoke = process.argv.includes('--smoke-test');
const views = new Map();
let win;
let tray;
let store;
let currentId = '';
let quitting = false;

function windowStateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }
function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    return { width: Math.max(980, Number(s.width) || 1360), height: Math.max(640, Number(s.height) || 850), x: s.x, y: s.y, maximized: Boolean(s.maximized) };
  } catch { return { width: 1360, height: 850 }; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(windowStateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }), 'utf8');
}
function hideViews() {
  if (!win || win.isDestroyed()) return;
  for (const view of views.values()) {
    try { win.removeBrowserView(view); } catch {}
  }
}
function viewBounds(view) {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  view.setBounds({ x: 218, y: 58, width: Math.max(0, width - 274), height: Math.max(0, height - 58) });
  view.setAutoResize({ width: true, height: true });
}
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function injectFingerprint(view, service) {
  const fp = service.fingerprint;
  const script = `(() => {
    const define=(obj,key,value)=>{try{Object.defineProperty(obj,key,{get:()=>value,configurable:true})}catch{}};
    define(navigator,'language',${JSON.stringify(fp.language)});
    define(navigator,'languages',[${JSON.stringify(fp.language)}]);
    define(navigator,'hardwareConcurrency',${Number(fp.cpuCores)});
    define(navigator,'deviceMemory',${Number(fp.memoryGB)});
    define(screen,'width',${Number(fp.width)}); define(screen,'height',${Number(fp.height)});
    define(screen,'availWidth',${Number(fp.width)}); define(screen,'availHeight',${Number(fp.height)});
    const old=WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter=function(p){
      if(p===37445)return ${JSON.stringify(fp.webglVendor)};
      if(p===37446)return ${JSON.stringify(fp.webglRenderer)};
      return old.call(this,p);
    };
  })();`;
  view.webContents.on('dom-ready', () => view.webContents.executeJavaScript(script, true).catch(() => {}));
}
function attachViewEvents(view, service) {
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => send('service:state', { id: service.id, loading: true, error: '' }));
  wc.on('did-stop-loading', () => send('service:state', { id: service.id, loading: false, error: '' }));
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) send('service:state', { id: service.id, loading: false, error: '页面加载失败：' + description, url });
  });
  wc.on('render-process-gone', (_e, details) => {
    service.crashed = true;
    send('service:state', { id: service.id, loading: false, error: '服务进程异常，正在恢复……' });
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.reload();
    }, 1500);
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault(); wc.reload();
    }
  });
  injectFingerprint(view, service);
}
async function openWeb(id) {
  const service = store.get(id);
  if (!service) throw new Error('服务账号不存在');
  if (!service.enabled) throw new Error('该服务已停用，请先启用');
  hideViews(); currentId = id;
  let view = views.get(id);
  if (!view || view.webContents.isDestroyed()) {
    await store.configureSession(service);
    view = new BrowserView({ webPreferences: {
      partition: servicePartition(id), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, spellcheck: false
    } });
    views.set(id, view);
    attachViewEvents(view, service);
    await view.webContents.loadURL(service.url);
  }
  win.addBrowserView(view); viewBounds(view);
  store.update(id, { unread: 0 });
  return true;
}
async function destroyView(id) {
  const view = views.get(id);
  if (!view) return;
  try { win.removeBrowserView(view); } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.destroy();
  views.delete(id);
}
function registerIpc() {
  ipcMain.handle('catalog:list', () => CATALOG);
  ipcMain.handle('services:list', () => store.list());
  ipcMain.handle('services:add', (_event, recipeId) => {
    const recipe = CATALOG.find(x => x.id === recipeId);
    if (!recipe) throw new Error('未知服务');
    return store.add(recipe);
  });
  ipcMain.handle('services:update', (_event, id, patch) => store.update(id, patch));
  ipcMain.handle('services:move', (_event, id, direction) => store.move(id, direction));
  ipcMain.handle('services:remove', async (_event, id) => {
    await destroyView(id); if (currentId === id) currentId = '';
    return store.remove(id);
  });
  ipcMain.handle('services:open', async (_event, service) => service.kind === 'web' ? openWeb(service.id) : (hideViews(), currentId = service.id, true));
  ipcMain.handle('services:refresh', async (_event, id, mode = 'normal') => {
    const service = store.get(id); if (!service) throw new Error('服务账号不存在');
    if (service.kind === 'native') { send('signal:refresh', { id, mode }); return true; }
    let view = views.get(id);
    if (mode === 'restart') { await destroyView(id); return openWeb(id); }
    if (mode === 'clear') { await store.clearAccount(id); if (view) view.webContents.reloadIgnoringCache(); return true; }
    if (!view) return openWeb(id);
    mode === 'hard' ? view.webContents.reloadIgnoringCache() : view.webContents.reload();
    return true;
  });
  ipcMain.handle('services:test-proxy', async (_event, id) => {
    const service = store.get(id); if (!service) throw new Error('服务账号不存在');
    const ses = await store.configureSession(service);
    if (!ses) throw new Error('此服务不使用网页代理');
    try {
      const response = await ses.fetch('https://web.whatsapp.com/', { method: 'HEAD' });
      return { ok: response.ok || response.status < 500, status: response.status };
    } catch (error) { return { ok: false, error: '代理连接失败：' + error.message }; }
  });
  ipcMain.handle('settings:get', () => store.platformSettings());
  ipcMain.handle('settings:set', (_event, patch) => {
    const settings = store.platformSettings(patch);
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, path: process.execPath });
    return settings;
  });
  ipcMain.handle('view:hide', () => { hideViews(); currentId = ''; });
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:show-data', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('renderer:ready', () => {
    if (smoke) { console.log('CAISHENG_RENDERER_READY'); app.exit(0); }
  });
}
function makeTray() {
  const image = nativeImage.createFromPath(process.execPath);
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('财盛聚合聊天');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开财盛聚合聊天', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => win.show());
}
app.whenReady().then(() => {
  store = new ServiceStore(app.getPath('userData'));
  registerIpc();
  const state = readWindowState();
  win = new BrowserWindow({
    ...state, minWidth: 980, minHeight: 640, frame: false, show: false,
    title: '财盛聚合聊天', backgroundColor: '#f4f6fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('resize', () => { for (const v of win.getBrowserViews()) viewBounds(v); });
  win.on('move', saveWindowState); win.on('resize', saveWindowState);
  win.on('close', event => {
    saveWindowState();
    if (!quitting && store.platformSettings().closeToTray && !smoke) { event.preventDefault(); win.hide(); }
  });
  if (state.maximized) win.maximize();
  makeTray();
  if (smoke) setTimeout(() => app.exit(2), 15000);
});
app.on('before-quit', () => { quitting = true; saveWindowState(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
app.on('activate', () => win?.show());
app.on('login', (event, webContents, _details, _authInfo, callback) => {
  const service = [...views.entries()].find(([, view]) => view.webContents.id === webContents.id);
  if (!service) return;
  const fp = store.get(service[0])?.fingerprint;
  if (fp?.proxy?.username) { event.preventDefault(); callback(fp.proxy.username, fp.proxy.password); }
});
