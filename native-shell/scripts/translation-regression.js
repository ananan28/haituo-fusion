'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caisheng-translation-'));
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return {
    app: { getPath: () => root },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
  };
  return originalLoad.call(this, request, parent, isMain);
};
let calls = [];
global.fetch = async url => {
  calls.push(String(url));
  if (String(url).includes('translate.googleapis.com') && String(url).includes('fallback')) throw new Error('primary down');
  return { ok: true, json: async () => [[[String(url).includes('google.cn') ? '备用成功' : 'hello']]] };
};
const t = require('../src/translation');
(async () => {
  assert.equal(t.hasChinese('你好'), true);
  assert.equal(t.hasChinese('hello'), false);
  assert.equal(t.validateOutgoing({ accountId:'a', conversationId:'c', text:'你好' }).allowed, false);
  assert.equal(t.validateOutgoing({ accountId:'a', conversationId:'c', text:'hello' }).allowed, true);
  const empty = await t.translate({ accountId:'a', conversationId:'c', text:'   ' });
  assert.equal(empty.skipped, true); assert.equal(calls.length, 0);
  const translated = await t.translate({ accountId:'a', conversationId:'c', text:'你好' });
  assert.equal(translated.translatedText, 'hello'); assert.equal(translated.target, 'en');
  const cached = await t.translate({ accountId:'a', conversationId:'c', text:'你好' });
  assert.equal(cached.cached, true); assert.equal(calls.length, 1);
  const fallback = await t.translate({ accountId:'a', conversationId:'c', text:'fallback' });
  assert.equal(fallback.provider, 'google-cn'); assert.equal(fallback.translatedText, '备用成功');
  t.updateAccount('a', { blockChinese:false, target:'ja' });
  assert.equal(t.getScope('a','c').blockChinese, false); assert.equal(t.getScope('a','c').target, 'ja');
  t.updateScope('a','c',{ blockChinese:true, spaceTranslate:false });
  assert.equal(t.getScope('a','c').blockChinese, true); assert.equal(t.getScope('a','c').spaceTranslate, false);
  t.updateSettings({ apiKey:'secret' }); assert.equal(t.publicSettings().hasApiKey, true);
  assert.equal(fs.existsSync(path.join(root,'translation-cache.json')), true);
  t.clearCache(); assert.equal(fs.existsSync(path.join(root,'translation-cache.json')), false);
  console.log('translation tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
