'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

let nextId = 100;
const createdOptions = [];
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = ++nextId;
    this.destroyed = false;
    this.url = '';
    this.audioMuted = false;
    this.debugger = { isAttached: () => true, attach: () => {}, sendCommand: async () => {} };
    this.session = { webRequest: { onCompleted: handler => { this.completed = handler; } } };
  }
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('destroyed'); } }
  getURL() { return this.url; }
  async loadURL(url) { this.url = url; this.emit('did-finish-load'); }
  reload() {}
  reloadIgnoringCache() {}
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  setAudioMuted(value) { this.audioMuted = value; }
}
class FakeBrowserView {
  constructor(options) {
    createdOptions.push(options);
    this.webContents = new FakeWebContents();
  }
  setBounds() {}
  setAutoResize() {}
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return { BrowserView: FakeBrowserView, shell: { openExternal: async () => {} } };
  if (request === './service-store' && parent?.filename?.endsWith('web-service-runtime.js')) {
    return { servicePartition: id => 'persist:caisheng-account-' + id };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { WebServiceRuntime } = require('../src/web-service-runtime');
Module._load = originalLoad;

function service(id) {
  return {
    id, recipeId: 'telegram', kind: 'web', enabled: true, muted: false,
    name: 'Telegram', url: 'https://web.telegram.org/k/',
    fingerprint: {
      language: 'zh-CN', timezone: 'Asia/Shanghai', width: 1366, height: 768,
      scaleFactor: 1, cpuCores: 8, memoryGB: 8, userAgent: '',
      webglVendor: 'Google Inc.', webglRenderer: 'ANGLE', canvasNoise: true,
      audioNoise: true, webRTCPolicy: 'disable_non_proxied_udp',
      latitude: 31.2, longitude: 121.4
    }
  };
}

test('通用网页服务 N 账号使用不同 persistent partition', async () => {
  createdOptions.length = 0;
  const values = new Map([['account-0001', service('account-0001')], ['account-0002', service('account-0002')]]);
  const store = {
    get: id => values.get(id),
    configureSession: async () => {},
    update: (id, patch) => Object.assign(values.get(id), patch),
    clearAccountCache: async () => {},
    resetAccountSiteData: async () => {},
    purgeAccount: async () => {}
  };
  const runtime = new WebServiceRuntime(store, () => {});
  runtime.setWindow({
    isDestroyed: () => false, getContentSize: () => [1200, 800],
    addBrowserView: view => assert.equal(view.webContents.isDestroyed(), false),
    removeBrowserView: () => {}
  });
  await runtime.open('account-0001');
  await runtime.open('account-0002');
  assert.deepEqual(createdOptions.map(x => x.webPreferences.partition), [
    'persist:caisheng-account-account-0001',
    'persist:caisheng-account-account-0002'
  ]);
});

test('被销毁的子视图会重建，且导航不能越过服务白名单', async () => {
  createdOptions.length = 0;
  const entry = service('account-0003');
  const store = {
    get: () => entry, configureSession: async () => {}, update: (_id, patch) => Object.assign(entry, patch),
    clearAccountCache: async () => {}, resetAccountSiteData: async () => {}, purgeAccount: async () => {}
  };
  const added = [];
  const destroyedAtAdd = [];
  const runtime = new WebServiceRuntime(store, () => {});
  runtime.setWindow({
    isDestroyed: () => false, getContentSize: () => [1200, 800],
    addBrowserView: view => {
      destroyedAtAdd.push(view.webContents.isDestroyed());
      assert.equal(view.webContents.isDestroyed(), false);
      added.push(view);
    },
    removeBrowserView: () => {}
  });
  await runtime.open(entry.id);
  const first = runtime.accounts.get(entry.id).view;
  assert.deepEqual(first.webContents.windowOpenHandler({ url: 'https://evil.example/' }), { action: 'deny' });
  first.webContents.destroy();
  await runtime.open(entry.id);
  const second = runtime.accounts.get(entry.id).view;
  assert.notEqual(first, second);
  assert.equal(first.webContents.isDestroyed(), true);
  assert.equal(second.webContents.isDestroyed(), false);
  assert.equal(destroyedAtAdd.some(Boolean), false);
});
