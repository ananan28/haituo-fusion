'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

test('翻译线路、缓存、账号/会话策略和中文拦截', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caisheng-translation-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => root },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = originalLoad; delete require.cache[require.resolve('../src/translation')]; });
  const calls = [];
  const oldFetch = global.fetch;
  global.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes('translate.googleapis.com') && String(url).includes('fallback')) throw new Error('primary down');
    return { ok:true, json:async () => [[[String(url).includes('google.cn') ? '备用成功' : 'hello']]] };
  };
  t.after(() => { global.fetch = oldFetch; });
  const translation = require('../src/translation');
  assert.equal(translation.hasChinese('你好'), true);
  assert.equal(translation.hasChinese('hello'), false);
  assert.equal(translation.validateOutgoing({ accountId:'a', conversationId:'c', text:'你好' }).allowed, false);
  assert.equal(translation.validateOutgoing({ accountId:'a', conversationId:'c', text:'hello' }).allowed, true);
  const empty = await translation.translate({ accountId:'a', conversationId:'c', text:'   ' });
  assert.equal(empty.skipped, true); assert.equal(calls.length, 0);
  const translated = await translation.translate({ accountId:'a', conversationId:'c', text:'你好' });
  assert.equal(translated.translatedText, 'hello'); assert.equal(translated.target, 'en');
  const cached = await translation.translate({ accountId:'a', conversationId:'c', text:'你好' });
  assert.equal(cached.cached, true); assert.equal(calls.length, 1);
  const fallback = await translation.translate({ accountId:'a', conversationId:'c', text:'fallback' });
  assert.equal(fallback.provider, 'google-cn'); assert.equal(fallback.translatedText, '备用成功');
  translation.updateAccount('a', { blockChinese:false, target:'ja' });
  assert.equal(translation.getScope('a','c').blockChinese, false); assert.equal(translation.getScope('a','c').target, 'ja');
  translation.updateScope('a','c',{ blockChinese:true, spaceTranslate:false });
  assert.equal(translation.getScope('a','c').blockChinese, true); assert.equal(translation.getScope('a','c').spaceTranslate, false);
  translation.updateSettings({ apiKey:'secret' }); assert.equal(translation.publicSettings().hasApiKey, true);
  assert.equal(fs.existsSync(path.join(root,'translation-cache.json')), true);
  translation.clearCache(); assert.equal(fs.existsSync(path.join(root,'translation-cache.json')), false);
});
