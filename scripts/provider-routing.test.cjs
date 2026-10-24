'use strict';
// 1.5.8 execution-level regressions for provider routing:
//   - Qwen/GLM with an empty address must never fall back to api.openai.com.
//   - Qwen/GLM must not run through the OpenAI backup-profile chain.
//   - MyMemory quota warnings must surface as failures, not as translations.
//   - Microsoft region survives load/save, and provider fields stay reachable.
//   - Credential/cleanup IPC only accepts app frames; webview navigation is locked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'src', 'app', 'bundles', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'app', 'bundles', 'preload', 'main.js'), 'utf8');
const webviewPreload = fs.readFileSync(path.join(root, 'src', 'app', 'js', 'caisheng-webview-preload.js'), 'utf8');

function sliceFn(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

const routingCode = sliceFn(bundle, 'function haituoProviderEndpointValue', 'function haituoCompatibleEndpoint');
const appFrameCode = sliceFn(bundle, 'function haituoIsAppFrame', 'function Jp(');

function routingContext() {
  const ctx = { Error };
  vm.createContext(ctx);
  vm.runInContext(routingCode, ctx);
  return ctx;
}

test('1.5.8: Qwen and GLM keep their own endpoint and model defaults', () => {
  const ctx = routingContext();
  assert.equal(vm.runInContext(`haituoProviderDefault('qwen','endpoint')`, ctx), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(vm.runInContext(`haituoProviderDefault('qwen','model')`, ctx), 'qwen-plus');
  assert.equal(vm.runInContext(`haituoProviderDefault('glm','endpoint')`, ctx), 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(vm.runInContext(`haituoProviderDefault('glm','model')`, ctx), 'glm-4.5');
  assert.equal(vm.runInContext(`haituoProviderDefault('openai','endpoint')`, ctx), 'https://api.openai.com/v1');
  assert.equal(vm.runInContext(`haituoProviderDefault('deepseek','model')`, ctx), 'deepseek-flash');
  assert.equal(vm.runInContext(`haituoProviderDefault('groq','endpoint')`, ctx), 'https://api.groq.com/openai/v1');
  assert.equal(vm.runInContext(`haituoProviderDefault('unknown','endpoint')`, ctx), 'https://api.openai.com/v1');
  assert.match(bundle, /haituoProviderDefault\(r, `endpoint`\)/u);
  assert.match(bundle, /haituoProviderDefault\(r, `model`\)/u);
});

test('1.5.8: a leftover OpenAI address never receives a Qwen/GLM key', () => {
  const ctx = routingContext();
  assert.equal(vm.runInContext(`haituoProviderEndpointValue('qwen','https://api.openai.com/v1')`, ctx), '');
  assert.equal(vm.runInContext(`haituoProviderEndpointValue('glm','https://api.openai.com')`, ctx), '');
  assert.equal(vm.runInContext(`haituoProviderEndpointValue('qwen','https://dashscope.aliyuncs.com/compatible-mode/v1')`, ctx), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(vm.runInContext(`haituoProviderEndpointValue('openai','https://api.openai.com/v1')`, ctx), 'https://api.openai.com/v1');
  assert.match(bundle, /haituoProviderEndpointValue\(provider, route\.endpoint\)/u);
});

test('1.5.8: only OpenAI and DeepSeek use the OpenAI backup-profile chain', () => {
  assert.match(bundle, /\[`openai`,`deepseek`\]\.includes\(provider\) && haituoOpenAIProfiles\(route\)\.length/u);
  assert.doesNotMatch(bundle, /\[`openai`,`deepseek`,`qwen`,`glm`\]\.includes\(provider\)/u);
});

test('1.5.8: MyMemory quota and invalid-pair responses fail instead of showing warnings', () => {
  const ctx = routingContext();
  const translate = payload => vm.runInContext(`haituoMyMemoryText(${JSON.stringify(payload)})`, ctx);
  assert.equal(translate({ responseStatus: 200, responseData: { translatedText: ' 你好 ' } }), '你好');
  assert.equal(translate({ responseData: { translatedText: 'hello' } }), 'hello');
  assert.throws(
    () => translate({ responseStatus: 429, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }),
    /额度|请求被拒绝/u
  );
  assert.throws(
    () => translate({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }),
    /额度|请求被拒绝/u
  );
  assert.throws(
    () => translate({ responseStatus: 403, responseDetails: 'INVALID LANGUAGE PAIR' }),
    /额度|请求被拒绝|错误状态/u
  );
  assert.throws(() => translate({ responseStatus: 500 }), /错误状态 500/u);
  assert.match(bundle, /haituoMyMemoryText\(await Yp\(r\.href, \{\}, a\)\)/u);
});

test('Microsoft region is preserved across load, save and renderer sync', () => {
  assert.match(preload, /region: e\.microsoftRegion \|\| e\.region/u, 'save must keep a loaded region');
  assert.match(preload, /microsoftRegion: e\.microsoftRegion \?\? e\.region \?\? Pve\.microsoftRegion/u, 'initial load must map region');
  assert.match(preload, /let t = \{ \.\.\.e, openAIModel: e\.model \?\? Pve\.openAIModel, compatibleEndpoint: e\.endpoint \?\? Pve\.compatibleEndpoint, microsoftRegion: e\.microsoftRegion \?\? e\.region \?\? Pve\.microsoftRegion \}/u, 'config pushes must map region');
  assert.match(preload, /\[ a\.inputTranslationProvider, a\.chatTranslationProvider \]\.includes\(`microsoft`\)/u, 'the Microsoft region field must actually render');
  assert.match(preload, /\[ a\.inputTranslationProvider, a\.chatTranslationProvider \]\.some\(value => \[ `qwen`, `glm`, `deepseek` \]\.includes\(value\)\)/u, 'the compatible address field must actually render');
});

test('credential and cleanup IPC reject webview frames', () => {
  const ctx = { Error, URL };
  vm.createContext(ctx);
  vm.runInContext(appFrameCode, ctx);
  assert.equal(vm.runInContext(`haituoIsAppFrame('file:///opt/Haituo/resources/app.asar/renderer/index.html')`, ctx), true);
  assert.equal(vm.runInContext(`haituoIsAppFrame('http://localhost:1234/index.html')`, ctx), true);
  assert.equal(vm.runInContext(`haituoIsAppFrame('https://web.whatsapp.com/')`, ctx), false);
  assert.equal(vm.runInContext(`haituoIsAppFrame('https://web.telegram.org/a/')`, ctx), false);
  assert.equal(vm.runInContext(`haituoIsAppFrame('not a url')`, ctx), false);
  assert.match(bundle, /caisheng:login[\s\S]{0,260}haituoIsAppFrame\(e\.senderFrame\?\.url \?\? e\.sender\?\.getURL\?\.\(\) \?\? ``\)/u);
  assert.match(bundle, /caisheng:clear-workspace-data[\s\S]{0,260}haituoIsAppFrame\(e\.senderFrame\?\.url \?\? e\.sender\?\.getURL\?\.\(\) \?\? ``\)/u);
});

test('webview gestures must be trusted and foreign navigation leaves the app', () => {
  assert.match(webviewPreload, /const haituoReportGesture = event => \{ if \(!event\?\.isTrusted\) return;/u);
  assert.match(bundle, /guest\.on\(`will-navigate`, \(event, url\) => \{/u);
  assert.match(bundle, /host === `web\.whatsapp\.com` \|\| host === `web\.telegram\.org` \|\| host\.endsWith\(`\.whatsapp\.com`\) \|\| host\.endsWith\(`\.telegram\.org`\)/u);
  assert.match(bundle, /blocked webview navigation[\s\S]{0,120}q_\(url\)/u);
});
