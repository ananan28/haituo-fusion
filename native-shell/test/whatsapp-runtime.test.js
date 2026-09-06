'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const load = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return { BrowserView: class BrowserView {}, shell: { openExternal: async () => {} } };
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
    id,
    fingerprint: {
      language: 'zh-CN', timezone: 'Asia/Shanghai', width: 1366, height: 768,
      scaleFactor: 1, cpuCores: 8, memoryGB: 8, userAgent: '',
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
