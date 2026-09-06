'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ServiceStore } = require('./service-store');
const { SignalRuntime } = require('./signal-runtime');
const { WhatsAppRuntime } = require('./whatsapp-runtime');
const translation = require('./translation');

app.setName('财盛聚合聊天');
app.setPath('userData', path.join(app.getPath('appData'), '财盛聚合聊天'));

const CATALOG = Object.freeze([
  { id: 'signal', name: 'Signal', kind: 'native', color: '#3a76f0' },
  { id: 'whatsapp', name: 'WhatsApp', kind: 'web', url: 'https://web.whatsapp.com/', color: '#13a45a' }
]);
const smoke = process.argv.includes('--smoke-test') || process.env.CAISHENG_SMOKE_TEST === '1';
const smokeFile = process.env.CAISHENG_SMOKE_FILE || '';
function smokeLog(message) {
  if (!smokeFile) return;
  try { fs.appendFileSync(smokeFile + '.log', new Date().toISOString() + ' ' + message + '\n', 'utf8'); } catch {}
}
let win;
let tray;
let store;
let currentId = '';
let quitting = false;
let signal;
let whatsapp;
let stopping = false;

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
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function hideViews() {
  whatsapp?.hide();
}
function registerIpc() {
  ipcMain.handle('translation:settings:get', () => translation.publicSettings());
  ipcMain.handle('translation:settings:update', (_e, patch) => translation.updateSettings(patch || {}));
  ipcMain.handle('translation:account:update', (_e, accountId, patch) => translation.updateAccount(String(accountId || ''), patch || {}));
  ipcMain.handle('translation:scope:get', (_e, accountId, conversationId) => translation.getScope(String(accountId || ''), String(conversationId || '')));
  ipcMain.handle('translation:scope:update', (_e, accountId, conversationId, patch) => translation.updateScope(String(accountId || ''), String(conversationId || ''), patch || {}));
  ipcMain.handle('translation:translate', (_e, request) => translation.translate(request || {}));
  ipcMain.handle('translation:validate', (_e, payload) => translation.validateOutgoing(payload || {}));
  ipcMain.handle('translation:cache:clear', () => translation.clearCache());
  ipcMain.handle('signal:state', (_e,id) => signal.state(id));
  ipcMain.handle('signal:link', (_e,id) => signal.link(id));
  ipcMain.handle('signal:start', (_e,id) => signal.start(id));
  ipcMain.handle('signal:conversations', (_e,id) => signal.conversations(id));
  ipcMain.handle('signal:history', (_e,id,conversationId,limit) => signal.history(id,conversationId,limit));
  ipcMain.handle('signal:send', async (_e,id,to,text,files,quote) => {
    const check = translation.validateOutgoing({ accountId:id, conversationId:to, text, quote });
    if (!check.allowed) throw new Error(check.message);
    return signal.send(id,to,text,files,quote);
  });
  ipcMain.handle('signal:reaction', (_e,id,to,emoji,target,remove) => signal.react(id,to,emoji,target,remove));
  ipcMain.handle('signal:edit', (_e,id,to,timestamp,text) => {
    const check = translation.validateOutgoing({ accountId:id, conversationId:to, editedText:text });
    if (!check.allowed) throw new Error(check.message);
    return signal.edit(id,to,timestamp,text);
  });
  ipcMain.handle('signal:delete', (_e,id,to,timestamp) => signal.remove(id,to,timestamp));
  ipcMain.handle('signal:reconnect', (_e,id) => signal.reconnect(id));
  ipcMain.handle('signal:stop', (_e,id) => signal.stop(id));
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
    const service = store.get(id);
    if (!service) return false;
    if (service.recipeId === 'whatsapp') await whatsapp.destroy(id, true);
    if (service.recipeId === 'signal') await signal?.removeAccount(id);
    if (currentId === id) currentId = '';
    return store.remove(id);
  });
  ipcMain.handle('services:open', async (_event, target) => {
    const id = typeof target === 'string' ? target : target?.id;
    const service = store.get(id);
    if (!service) throw new Error('服务账号不存在');
    if (service.recipeId === 'whatsapp') {
      currentId = id;
      return whatsapp.open(id);
    }
    hideViews(); currentId = id; return true;
  });
  ipcMain.handle('services:refresh', async (_event, id, mode = 'normal') => {
    const service = store.get(id); if (!service) throw new Error('服务账号不存在');
    if (service.recipeId === 'signal') {
      const result = await signal.reconnect(id);
      send('signal:refresh', { id, mode });
      return result;
    }
    return whatsapp.refresh(id, mode);
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
  smokeLog('APP_READY');
  store = new ServiceStore(app.getPath('userData'));
  whatsapp = new WhatsAppRuntime(store, payload => send('service:state', payload));
  if (!smoke) {
    signal = new SignalRuntime(app.getPath('userData'), process.resourcesPath);
    signal.on('state', payload => send('signal:state', payload));
    signal.on('message', payload => send('signal:message', payload));
    signal.on('log', payload => console.warn('[Signal]', payload.id, payload.message));
    signal.restoreAll().catch(error => console.error('恢复 Signal 账号失败：', error));
  }
  registerIpc();
  const state = readWindowState();
  win = new BrowserWindow({
    ...state, minWidth: 980, minHeight: 640, frame: false, show: false,
    title: '财盛聚合聊天', backgroundColor: '#f4f6fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.setMenu(null);
  whatsapp.setWindow(win);
  const rendererFile = path.join(__dirname, 'renderer', 'index.html');
  if (smoke) {
    const hardTimeout = setTimeout(() => { smokeLog('MAIN_TIMEOUT'); process.exit(2); }, 30000);
    win.webContents.once('did-fail-load', (_event, code, description) => {
      console.error('CAISHENG_RENDERER_FAILED', code, description);
      smokeLog('RENDERER_FAILED ' + code + ' ' + description);
      process.exit(3);
    });
    win.loadFile(rendererFile).then(async () => {
      const healthy = await win.webContents.executeJavaScript(
        "Boolean(window.caisheng && document.querySelector('#content') && document.querySelector('#services'))",
        true
      ).catch(() => false);
      clearTimeout(hardTimeout);
      console.log(healthy ? 'CAISHENG_RENDERER_READY' : 'CAISHENG_RENDERER_INVALID');
      if (healthy && smokeFile) {
        fs.mkdirSync(path.dirname(smokeFile), { recursive: true });
        fs.writeFileSync(smokeFile, 'OK', 'utf8');
        smokeLog('RENDERER_READY');
      } else if (!healthy) {
        smokeLog('RENDERER_INVALID');
      }
      setTimeout(() => process.exit(healthy ? 0 : 4), 250);
    }).catch(error => {
      clearTimeout(hardTimeout);
      console.error('CAISHENG_RENDERER_LOAD_REJECTED', error);
      smokeLog('LOAD_REJECTED ' + String(error));
      process.exit(3);
    });
  } else {
    win.loadFile(rendererFile);
  }
  win.once('ready-to-show', () => { if (!smoke) win.show(); });
  win.on('resize', () => whatsapp.resizeAll());
  win.on('move', saveWindowState); win.on('resize', saveWindowState);
  win.on('close', event => {
    saveWindowState();
    if (!quitting && store.platformSettings().closeToTray && !smoke) { event.preventDefault(); win.hide(); }
  });
  if (state.maximized) win.maximize();
  if (!smoke) makeTray();
});
app.on('before-quit', event => {
  quitting = true;
  saveWindowState();
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  Promise.all([
    signal ? signal.stopAll() : Promise.resolve(),
    whatsapp ? whatsapp.stopAll() : Promise.resolve()
  ]).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
app.on('activate', () => win?.show());
app.on('login', (event, webContents, _details, authInfo, callback) => {
  if (!authInfo?.isProxy) return;
  const account = whatsapp?.accountForWebContents(webContents);
  const proxy = account?.service?.fingerprint?.proxy;
  if (proxy?.username) {
    event.preventDefault();
    callback(proxy.username, proxy.password || '');
  }
});
