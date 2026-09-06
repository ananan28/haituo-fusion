'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

let nextWebContentsId = 10;
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = ++nextWebContentsId;
    this.destroyed = false;
    this.url = '';
    this.debugCommands = [];
    this.debugger = {
      isAttached: () => true,
      attach: () => {},
      sendCommand: async command => { this.debugCommands.push(command); }
    };
    this.session = {
      webRequest: { onCompleted: handler => { this.completedHandler = handler; } }
    };
  }
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } }
  getURL() { return this.url; }
  async loadURL(url) { this.url = url; this.emit('did-finish-load'); }
  reload() {}
  reloadIgnoringCache() {}
  setWindowOpenHandler() {}
}
class FakeBrowserView {
  constructor() { this.webContents = new FakeWebContents(); }
  setBounds() {}
  setAutoResize() {}
}

const load = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return { BrowserView: FakeBrowserView, shell: { openExternal: async () => {} } };
  }
  if (request === './service-store' && parent?.filename?.endsWith('whatsapp-runtime.js')) {
    return { servicePartition: id => 'persist:caisheng-account-' + id };
  }
  return load.call(this, request, parent, isMain);
};
const { chineseNetworkError, isAllowedWhatsAppURL, publicProfile, WhatsAppRuntime } = require('../src/whatsapp-runtime');
Module._load = load;

function service(id) {
  return {
    id, recipeId: 'whatsapp', kind: 'web', enabled: true, url: 'https://web.whatsapp.com/',
    fingerprint: {
      language: 'zh-CN', timezone: 'Asia/Shanghai', width: 1366, height: 768,
      scaleFactor: 1, cpuCores: 8, memoryGB: 8, userAgent: '不应写入网络请求',
      webglVendor: '测试厂商', webglRenderer: '测试渲染器', canvasNoise: true,
      audioNoise: true, webRTCPolicy: 'disable_non_proxied_udp', latitude: 31.2, longitude: 121.4
    }
  };
}

test('只允许 WhatsApp HTTPS 主站留在内嵌内容区', () => {
  assert.equal(isAllowedWhatsAppURL('https://web.whatsapp.com/'), true);
  assert.equal(isAllowedWhatsAppURL('https://sub.whatsapp.com/path'), true);
  assert.equal(isAllowedWhatsAppURL('http://web.whatsapp.com/'), false);
  assert.equal(isAllowedWhatsAppURL('https://whatsapp.com.evil.example/'), false);
  assert.equal(isAllowedWhatsAppURL('not-a-url'), false);
});

test('网络错误全部转换为中文提示', () => {
  assert.match(chineseNetworkError(-105), /域名解析失败/);
  assert.match(chineseNetworkError(-109), /代理服务器/);
  assert.match(chineseNetworkError(-999, 'boom'), /页面加载失败/);
});

test('账号指纹由各自账号 ID 稳定派生且不包含代理密码', () => {
  const first = publicProfile(service('account-0001'));
  const again = publicProfile(service('account-0001'));
  assert.deepEqual(first, again);
  assert.equal(Object.hasOwn(first, 'proxy'), false);
  assert.equal(first.language, 'zh-CN');
});

test('WebContents 只能解析到自身账号', () => {
  const services = new Map([['account-0001', service('account-0001')], ['account-0002', service('account-0002')]]);
  const runtime = new WhatsAppRuntime({ get: id => services.get(id) }, () => {});
  runtime.accounts.set('account-0001', { view: { webContents: { id: 11 } } });
  runtime.accounts.set('account-0002', { view: { webContents: { id: 22 } } });
  assert.equal(runtime.accountForWebContents({ id: 22 }).id, 'account-0002');
  assert.equal(runtime.accountForWebContents({ id: 33 }), null);
});

test('WhatsApp 指纹不会覆盖 UA 或 Client Hints', async () => {
  const entry = service('account-0003');
  const runtime = new WhatsAppRuntime({ get: () => entry }, () => {});
  const view = new FakeBrowserView();
  await runtime.applyDevToolsProfile({ view }, entry);
  assert.equal(view.webContents.debugCommands.includes('Network.setUserAgentOverride'), false);
  const storeSource = fs.readFileSync(path.join(__dirname, '../src/service-store.js'), 'utf8');
  assert.equal(storeSource.includes('onBeforeSendHeaders'), false);
});

test('4xx 后干净重试创建新视图，绝不添加已销毁视图', async () => {
  const entry = service('account-0004');
  let resetCount = 0;
  const store = {
    get: () => entry,
    configureSession: async () => {},
    update: () => {},
    resetAccountSiteData: async () => { resetCount += 1; },
    clearAccountCache: async () => {},
    purgeAccount: async () => {}
  };
  const runtime = new WhatsAppRuntime(store, () => {});
  const added = [];
  const destroyedAtAdd = [];
  runtime.setWindow({
    isDestroyed: () => false,
    getContentSize: () => [1200, 800],
    addBrowserView: view => {
      const destroyed = view.webContents.isDestroyed();
      destroyedAtAdd.push(destroyed);
      assert.equal(destroyed, false, '不得添加已销毁的子视图');
      added.push(view);
    },
    removeBrowserView: () => {}
  });
  await runtime.open(entry.id);
  const first = runtime.accounts.get(entry.id).view;
  first.webContents.completedHandler({
    webContentsId: first.webContents.id,
    resourceType: 'mainFrame',
    statusCode: 400,
    url: 'https://web.whatsapp.com/'
  });
  await Promise.all([runtime.refresh(entry.id, 'clean'), runtime.open(entry.id)]);
  const second = runtime.accounts.get(entry.id).view;
  assert.notEqual(second, first);
  assert.equal(first.webContents.isDestroyed(), true);
  assert.equal(second.webContents.isDestroyed(), false);
  assert.equal(resetCount, 1);
  assert.equal(destroyedAtAdd.some(Boolean), false);
});
