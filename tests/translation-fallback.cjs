const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const Module = require('node:module');
const originalLoad = Module._load; const originalFetch = global.fetch; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caisheng-fallback-'));
Module._load = function(name, ...args) { if (name === 'electron') return { app: { getPath: () => dir } }; return originalLoad.call(this, name, ...args); };
(async () => {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ translateToken: '', defaultSourceLanguage: 'auto', defaultTargetLanguage: 'zh' }));
  const calls = [];
  global.fetch = async url => { calls.push(String(url)); return new Response(JSON.stringify([[['你好', 'hello']]])); };
  const { translateText } = require('../dist-electron/translation');
  const result = await translateText({ text: 'hello' });
  assert.equal(result.translatedText, '你好'); assert.equal(result.provider, 'google');
  assert.equal(calls.length, 1); assert.ok(calls[0].startsWith('https://translate.googleapis.com/'));
  console.log('PASS: token-free main-process Google fallback.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); });
