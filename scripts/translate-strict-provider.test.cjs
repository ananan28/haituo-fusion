'use strict';
// P0-03 execution-level regression: strictProvider must only bypass the
// translation pools for an explicit input-translation provider choice.
// Chat translation, back-translation (purpose 'chat' + smart-retranslate)
// and connection tests must stay pool-managed so backup keys actually get
// used. Real handler code is sliced out of the shipped minified bundle and
// run in a vm context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');

function sliceFn(startMarker, endMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = bundle.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end ${endMarker} after ${startMarker}`);
  return bundle.slice(start, end);
}

const handlerCode = sliceFn('p.ipcMain.handle(`caisheng:translate`', 'p.ipcMain.removeHandler(`caisheng:webview-translate`)');
const webviewHandlerCode = sliceFn('p.ipcMain.handle(`caisheng:webview-translate`', 'p.ipcMain.removeHandler(`caisheng:webview-replace-text`)');

function makeCtx(storedConfig = {}) {
  const handled = {};
  const calls = [];
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Promise, setTimeout, clearTimeout, Map, Set,
    Jp: () => {},
    Zp: { __v: 1, nativeTheme: 'dark' },
    $p: () => storedConfig,
    haituoUnredactConfigPatch: patch => patch,
    haituoTranslateWithMode: (...args) => { calls.push(args); return Promise.resolve({ text: 'ok', provider: 'stub' }); },
    haituoRememberChatTranslation: () => {},
    HaituoWorkspaceBySession: {get:()=>'test-workspace'},
    haituoExistingChatTranslation:()=>null,
    haituoRecordTranslationStatus: () => {},
    haituoTranslationCacheKey: () => 'k',
    HaituoNetwork: { retryTranslation: fn => fn() },
    haituoLongMessageComplete: () => true,
    haituoTranslationNumberWarning: () => false,
    p: { ipcMain: { handle: (channel, fn) => { handled[channel] = fn; } } },
  };
  ctx.__handled = handled;
  ctx.__calls = calls;
  vm.createContext(ctx);
  // The slices keep the trailing comma of the original call chain
  // (handle(...), removeHandler(...)) — terminate them as statements.
  vm.runInContext(handlerCode.replace(/,\s*$/, ';') + '\n' + webviewHandlerCode.replace(/,\s*$/, ';'), ctx);
  return ctx;
}

const stored = {
  translationPools: { primary: [{ apiKey: '', endpoint: 'https://a.example/v1', model: 'm1' }], backup: [{ apiKey: '', endpoint: 'https://b.example/v1', model: 'm2' }] },
  inputTranslationProvider: 'google-free',
  chatTranslationProvider: 'google-free',
};

function strictProviderOf(call) {
  const carrier = call.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg) && (`strictProvider` in arg || (arg.request && typeof arg.request === 'object' && `strictProvider` in arg.request)));
  assert.ok(carrier, `no request-like arg in call: ${JSON.stringify(call).slice(0, 200)}`);
  return `strictProvider` in carrier ? carrier.strictProvider : carrier.request.strictProvider;
}

function providerOf(call) {
  const carrier = call.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg) && (`provider` in arg || (arg.request && typeof arg.request === `object` && `provider` in arg.request)));
  if (!carrier) return undefined;
  const value = `provider` in carrier ? carrier.provider : carrier.request.provider;
  return typeof value === 'string' ? value : undefined;
}

function routedProviderOf(call) {
  const request = call[1];
  assert.ok(request && typeof request === 'object', `missing request arg in ${JSON.stringify(call).slice(0, 200)}`);
  return typeof request.provider === 'string' ? request.provider : undefined;
}

async function dispatch(ctx, channel, payload) {
  const handler = ctx.__handled[channel];
  assert.ok(handler, `handler ${channel} registered`);
  if (channel === 'caisheng:webview-translate') {
    // Signature: (event, text, targetLanguage, options).
    await handler({ senderFrame: { url: 'https://web.whatsapp.com/' }, sender:{session:{}} }, payload.text, payload.targetLanguage, payload);
    return;
  }
  await handler({ senderFrame: { url: 'https://web.whatsapp.com/' }, sender:{session:{}} }, payload);
}

test('P0-03: chat translation with explicit provider stays pool-managed (strictProvider false)', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'deepl', purpose: 'chat', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(ctx.__calls.length, 1, 'one translate call');
  assert.equal(strictProviderOf(ctx.__calls[0]), false, 'chat must enter the pool path even with an explicit provider');
});

test('P0-03: back-translation (smart-retranslate, purpose chat) stays pool-managed', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'smart-retranslate', purpose: 'chat', text: 'hi', targetLanguage: 'en', forceRefresh: true });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
});

test('input translation with a configured pool is unified with chat (strictProvider false)', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'deepl', purpose: 'input', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false, 'chat, input and retranslate share the same ordered pool');
});

test('AI retranslate with a configured pool is pool-managed (main then backup)', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'smart-retranslate', purpose: 'input', text: 'hi', targetLanguage: 'en', forceRefresh: true });
  assert.equal(strictProviderOf(ctx.__calls[0]), false, 'retranslate must reach the pool instead of the legacy provider list');
  assert.equal(providerOf(ctx.__calls[0]), 'smart-retranslate');
});

test('legacy setup without a pool keeps the strict input provider bypass', async () => {
  const ctx = makeCtx({ inputTranslationProvider: 'google-free', chatTranslationProvider: 'google-free' });
  await dispatch(ctx, 'caisheng:translate', { provider: 'deepl', purpose: 'input', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), true, 'no pool means the explicit choice stays authoritative');
});

test('P0-03: input translation with auto routes to the configured input provider, no strict', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'auto', purpose: 'input', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
  assert.equal(providerOf(ctx.__calls[0]), 'google-free', 'auto+input falls back to inputTranslationProvider');
  assert.equal(routedProviderOf(ctx.__calls[0]), 'google-free', 'the resolved service must reach the routing request, not only the config');
});

test('1.5.9: a provider-less chat request routes the configured chat service on the request', async () => {
  const ctx = makeCtx({ chatTranslationProvider: 'google-cloud', inputTranslationProvider: 'deepl', googleCloudApiKey: 'g' });
  await dispatch(ctx, 'caisheng:translate', { purpose: 'chat', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
  assert.equal(routedProviderOf(ctx.__calls[0]), 'google-cloud', 'routing must not fall back to free when the configured chat service is unavailable by omission');
});

test('1.5.9: webview input with auto and no pool routes the input service and stays non-strict', async () => {
  const ctx = makeCtx({ chatTranslationProvider: 'google-cloud', inputTranslationProvider: 'deepl', googleCloudApiKey: 'g', deepLApiKey: 'd' });
  await dispatch(ctx, 'caisheng:webview-translate', { purpose: 'input', provider: 'auto', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
  assert.equal(routedProviderOf(ctx.__calls[0]), 'deepl', 'auto + input uses inputTranslationProvider for both config and routing');
});

test('P0-03: connection test purpose never bypasses pools', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { provider: 'openai', purpose: 'test', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false, 'test connections must be pool-managed too');
});

test('P0-03: chat with no provider routes to chatTranslationProvider, pool-managed', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:translate', { purpose: 'chat', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
  assert.equal(providerOf(ctx.__calls[0]), 'google-free');
});

test('P0-03: webview-translate defaults to chat semantics (no purpose) → pool-managed', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:webview-translate', { provider: 'deepl', text: 'hi', targetLanguage: 'zh-CN' });
  assert.ok(ctx.__calls.length >= 1, 'webview translate dispatched');
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
});

test('webview-translate with purpose input + configured pool uses the shared pool', async () => {
  const ctx = makeCtx(stored);
  await dispatch(ctx, 'caisheng:webview-translate', { purpose: 'input', provider: 'deepl', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), false);
});

test('webview-translate without a pool keeps the legacy strict input bypass', async () => {
  const ctx = makeCtx({ chatTranslationProvider: 'google-free' });
  await dispatch(ctx, 'caisheng:webview-translate', { purpose: 'input', provider: 'deepl', text: 'hi', targetLanguage: 'zh-CN' });
  assert.equal(strictProviderOf(ctx.__calls[0]), true);
});

test('DeepL request preserves the other provider keys and pool in child session config', async () => {
  const config={__v:7,apiKey:'other-key',googleCloudApiKey:'cloud-key',deepLApiKey:'deepl-key',translationPools:{primary:[{provider:'google-cloud',apiKey:'pool-cloud-key'}],backup:[]}};
  const ctx=makeCtx(config);ctx.Zp={...config};
  await dispatch(ctx,'caisheng:translate',{provider:'deepl',purpose:'input',text:'你好',targetLanguage:'en',apiKey:'deepl-key'});
  assert.equal(ctx.Zp.googleCloudApiKey,'cloud-key');
  assert.equal(ctx.Zp.translationPools.primary[0].apiKey,'pool-cloud-key');
  assert.equal(ctx.Zp.__v,7);
  assert.equal(ctx.Zp.apiKey,'other-key');
  assert.equal(ctx.Zp.deepLApiKey,'deepl-key');
  ctx.$p=()=>ctx.Zp;
  await dispatch(ctx,'caisheng:translate',{provider:'google-cloud',purpose:'input',text:'下一句',targetLanguage:'en'});
  assert.equal(ctx.__calls.at(-1)[0].googleCloudApiKey,'cloud-key');
  assert.equal(ctx.__calls.at(-1)[0].translationPools.primary[0].apiKey,'pool-cloud-key');
});
