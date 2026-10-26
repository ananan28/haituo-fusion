'use strict';
// Execution-level regression tests for audit batch 2 of 1.5.0:
//   TEXT-01 surrogate-safe chunking, TEXT-02 finish_reason=length,
//   TEXT-03 paragraph-preserving join, ROUTE-02 groq routing isolation,
//   ROUTE-03 profile dedup keeps models, CACHE-01 context/model-aware key.
// The real functions are sliced out of the shipped minified bundle and run in a
// vm context, so the tests exercise production code, not re-implementations.
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

function sliceBalanced(startMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  let depth = 0, inString = null, inTemplate = false;
  for (let i = start; i < bundle.length; i += 1) {
    const ch = bundle[i], prev = bundle[i - 1];
    if (inString) { if (ch === inString && prev !== '\\') inString = null; continue; }
    if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return bundle.slice(start, i + 1); }
  }
  throw Error(`unbalanced ${startMarker}`);
}

const splitterCode = sliceFn('function haituoSplitTranslationText', 'function haituoJoinTranslatedChunks');
const joinCode = sliceFn('function haituoJoinTranslatedChunks', 'function haituoNaturalizeFreeTranslation');
const cacheKeyCode = sliceFn('function haituoTranslationCacheKey', 'function haituoSharedChatCacheKey');
const profilesCode = sliceFn('function haituoOpenAIProfiles', 'function haituoPumpRequests');
const compatCode = sliceFn('function haituoProviderEndpointValue', 'function haituoSplitTranslationText');
const xpCode = sliceBalanced('async function Xp(');
const modeCode = sliceBalanced('async function haituoTranslateWithMode');

function makeModeCtx() {
  const ctx = {
    console, JSON, Math, URL, Date, RegExp, Error, String, Number, Array, Object, Promise, Set, Map,
    setTimeout,
    HaituoNetwork: { translationTimeout: () => 1000 },
    haituoExistingChatTranslation: () => null,
    haituoTranslateLongMessage: async () => ({ text: `long` }),
    haituoRememberChatTranslation: () => {},
    haituoFallbackProviders: () => [],
    haituoOpenAIProfiles: () => [],
    cachedHaituoTranslate: async e => ({ text: `local:` + e.provider, provider: e.provider }),
    __poolsCalls: 0,
  };
  ctx.require = mod => String(mod).includes(`translation-pools`)
    ? { run: async () => { ctx.__poolsCalls += 1; return { text: `pools-result`, provider: `pool` }; } }
    : { translationTimeout: () => 1000 };
  vm.createContext(ctx);
  vm.runInContext(compatCode + '\n;\n' + modeCode, ctx);
  return ctx;
}

test('ROUTE-01: explicit provider choice bypasses translation pools (strictProvider)', async () => {
  const ctx = makeModeCtx();
  const result = await vm.runInContext(
    `haituoTranslateWithMode({ translationPools: [{ provider: 'openai' }], deepLApiKey: 'd-key' },
      { provider: 'deepl', strictProvider: true, purpose: 'input', text: 'hi' })`, ctx);
  assert.equal(ctx.__poolsCalls, 0, 'pools must not run when the request names a provider');
  assert.equal(JSON.parse(JSON.stringify(result)).text, 'local:deepl');
});

test('ROUTE-01: requests without an explicit provider still use pools', async () => {
  const ctx = makeModeCtx();
  const result = await vm.runInContext(
    `haituoTranslateWithMode({ translationPools: [{ provider: 'openai' }], deepLApiKey: 'd-key' },
      { provider: 'auto', purpose: 'input', text: 'hi' })`, ctx);
  assert.equal(ctx.__poolsCalls, 1);
  assert.equal(JSON.parse(JSON.stringify(result)).text, 'pools-result');
});

function makeCtx(extra = {}) {
  const calls = [];
  const ctx = {
    console,
    JSON,
    Math,
    URL,
    Date,
    RegExp,
    Error,
    SyntaxError,
    String,
    Number,
    Array,
    Object,
    Promise,
    setTimeout,
    require: mod => String(mod).includes(`haituo-network`)
      ? { translationTimeout: () => 1000, requestJSON: async () => ({ choices: [{ finish_reason: `stop`, message: { content: `net` } }] }) }
      : { translateGoogle: async () => `google-result` },
    HaituoNetwork: { translationTimeout: () => 1000 },
    loadHaituoTranslationCache: () => ({}),
    saveHaituoTranslationCache: () => {},
    haituoNaturalizeFreeTranslation: (_s, _l, t) => t,
  };
  vm.createContext(ctx);
  vm.runInContext([splitterCode, joinCode, cacheKeyCode, profilesCode, compatCode, xpCode].join('\n;\n'), ctx);
  ctx.__setYp = fn => { ctx.Yp = fn; };
  ctx.__calls = calls;
  return ctx;
}

test('TEXT-01: chunk boundaries never split an emoji surrogate pair', () => {
  const ctx = makeCtx();
  const text = 'a'.repeat(9) + '\u{1F600}' + 'b'.repeat(9) + '\n\n' + 'c'.repeat(30);
  for (const size of [8, 9, 10, 11, 12, 15]) {
    const chunks = vm.runInContext(`haituoSplitTranslationText(${JSON.stringify(text)}, ${size})`, ctx);
    assert.ok(chunks.length >= 2, `size ${size} should chunk`);
    for (const chunk of chunks) {
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk.text),
        `lone surrogate in chunk at size ${size}: ${JSON.stringify(chunk.text)}`);
    }
    // gaps + texts reconstruct the source exactly
    const out = chunks.map((c, i) => c.text + (i < chunks.length - 1 ? c.gap : '')).join('');
    assert.equal(out, text.trim(), `reconstruction at size ${size}`);
  }
});

test('TEXT-03: join preserves blank-line paragraphs and single spaces', () => {
  const ctx = makeCtx();
  const joined = vm.runInContext(
    `haituoJoinTranslatedChunks([{text:'第一段',gap:' '},{text:'第二段',gap:'\\n\\n'},{text:'third',gap:''}])`, ctx);
  assert.equal(joined, '第一段 第二段\n\nthird');
});

test('TEXT-02: finish_reason=length is rejected, stop is accepted', async () => {
  const ctx = makeCtx();
  ctx.__setYp(async () => ({ choices: [{ finish_reason: 'length', message: { content: '被截断的译文' } }] }));
  await assert.rejects(
    () => vm.runInContext(`Xp({ text: 'hello', provider: 'openai', apiKey: 'k' })`, ctx),
    /finish_reason=length/u);

  ctx.__setYp(async () => ({ choices: [{ finish_reason: 'stop', message: { content: '完整译文' } }] }));
  const ok = await vm.runInContext(`Xp({ text: 'hello', provider: 'openai', apiKey: 'k' })`, ctx);
  assert.equal(JSON.parse(JSON.stringify(ok)).text, '完整译文');
});

test('POOL-04: a dead pool falls through to the selected provider', async () => {
  const ctx = makeModeCtx();
  let poolCalls = 0;
  ctx.require = mod => String(mod).includes(`translation-pools`)
    ? { run: async () => { poolCalls += 1; throw new Error(`主翻译和备用翻译均未成功：HTTP 402`); } }
    : { translationTimeout: () => 1000 };
  const result = await vm.runInContext(
    `haituoTranslateWithMode({ translationPools: [{ provider: 'deepseek', apiKey: 'bad' }], provider: 'google-cloud', apiKey: 'k', googleCloudApiKey: 'g' },
      { provider: 'google-cloud', purpose: 'chat', text: 'hi', targetLanguage: 'en' })`, ctx);
  assert.equal(poolCalls, 1, 'the pool is attempted first');
  assert.equal(JSON.parse(JSON.stringify(result)).text, 'local:google-cloud', 'the selected provider still serves the request');
  assert.equal(JSON.parse(JSON.stringify(result)).provider, 'google-cloud');
});

test('POOL-05: when the pool and every fallback fail, the pool reason is included', async () => {
  const ctx = makeModeCtx();
  ctx.require = mod => String(mod).includes(`translation-pools`)
    ? { run: async () => { throw new Error(`主翻译和备用翻译均未成功：HTTP 402`); } }
    : { translationTimeout: () => 1000 };
  ctx.cachedHaituoTranslate = async () => { throw new Error(`selected provider failed`); };
  await assert.rejects(
    () => vm.runInContext(
      `haituoTranslateWithMode({ translationPools: [{ provider: 'deepseek', apiKey: 'bad' }], provider: 'google-cloud', googleCloudApiKey: 'g' },
        { provider: 'google-cloud', purpose: 'chat', text: 'hi', targetLanguage: 'en' })`, ctx),
    error => /翻译池：主翻译和备用翻译均未成功：HTTP 402/u.test(error.message)
      && /selected provider failed/u.test(error.message));
});

test('POOL-06: AI re-translate falls back to the selected provider after the pool dies', async () => {
  const ctx = makeModeCtx();
  let poolCalls = 0;
  ctx.require = mod => String(mod).includes(`translation-pools`)
    ? { run: async () => { poolCalls += 1; throw new Error(`主翻译和备用翻译均未成功：HTTP 402`); } }
    : { translationTimeout: () => 1000 };
  const result = await vm.runInContext(
    `haituoTranslateWithMode({ translationPools: [{ provider: 'deepseek', apiKey: 'bad' }], chatTranslationProvider: 'google-cloud', inputTranslationProvider: 'google-cloud', googleCloudApiKey: 'g' },
      { provider: 'smart-retranslate', purpose: 'chat', text: 'hi', targetLanguage: 'en', forceRefresh: true })`, ctx);
  assert.equal(poolCalls, 1, 'the pool is attempted first');
  assert.equal(JSON.parse(JSON.stringify(result)).text, 'local:google-cloud', 'the selected service must still work after a dead pool');
  assert.equal(JSON.parse(JSON.stringify(result)).provider, 'google-cloud');
});

test('POOL-07: AI re-translate uses a configured DeepSeek key even when it is not the selected service', async () => {
  const ctx = makeModeCtx();
  ctx.require = mod => String(mod).includes(`translation-pools`)
    ? { run: async () => { throw new Error(`主翻译和备用翻译均未成功：HTTP 402`); } }
    : { translationTimeout: () => 1000 };
  ctx.cachedHaituoTranslate = async e => {
    if ([`google-free`, `mymemory`].includes(e.provider)) throw new Error(`free blocked`);
    return { text: `local:` + e.provider, provider: e.provider };
  };
  const result = await vm.runInContext(
    `haituoTranslateWithMode({ translationPools: [{ provider: 'deepseek', apiKey: 'bad' }], chatTranslationProvider: 'google-free', deepseekApiKey: 'd-key' },
      { provider: 'smart-retranslate', purpose: 'chat', text: 'hi', targetLanguage: 'en', forceRefresh: true })`, ctx);
  assert.equal(JSON.parse(JSON.stringify(result)).text, 'local:deepseek', 'configured paid services join the fallback list');
});

test('ROUTE-02: groq ignores generic endpoint/model and uses groq defaults', async () => {
  const ctx = makeCtx();
  let seen = null;
  ctx.__setYp(async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }; });
  await vm.runInContext(`Xp({ text: 'hello', provider: 'groq', apiKey: 'g-key', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' })`, ctx);
  assert.equal(seen.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen.body.model, 'openai/gpt-oss-120b');
});

test('ROUTE-02: groq honors dedicated groqEndpoint/groqModel overrides', async () => {
  const ctx = makeCtx();
  let seen = null;
  ctx.__setYp(async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }; });
  await vm.runInContext(`Xp({ text: 'hello', provider: 'groq', apiKey: 'g-key', groqEndpoint: 'https://grok.example.com/v1', groqModel: 'llama-x' })`, ctx);
  assert.equal(seen.url, 'https://grok.example.com/v1/chat/completions');
  assert.equal(seen.body.model, 'llama-x');
});

test('ROUTE-03: profiles with same endpoint+key but different model are both kept', () => {
  const ctx = makeCtx();
  const profiles = vm.runInContext(`haituoOpenAIProfiles({ openaiApiProfiles: [
    { apiKey: 'k', endpoint: 'https://api.example.com/v1', model: 'm1' },
    { apiKey: 'k', endpoint: 'https://api.example.com/v1', model: 'm2' }
  ] })`, ctx);
  assert.equal(JSON.parse(JSON.stringify(profiles)).length, 2);
});

test('CACHE-01: cache key changes with model and with context', () => {
  const ctx = makeCtx();
  const keyOf = e => vm.runInContext(`haituoTranslationCacheKey(${JSON.stringify(e)})`, ctx);
  const base = { provider: 'openai', targetLanguage: 'zh-CN', text: '同样的一段话' };
  assert.notEqual(keyOf(base), keyOf({ ...base, model: 'gpt-4.1-mini' }), 'model must be in key');
  assert.notEqual(keyOf(base), keyOf({ ...base, context: ' Earlier chat context ' }), 'context must be in key');
  assert.equal(keyOf(base), keyOf({ ...base }), 'same inputs → same key');
});

test('customer chat and forced retranslation share the direct-translation policy on every AI route',async()=>{
 const ctx=makeCtx(),sent=[];ctx.__setYp(async(_url,init)=>{sent.push(JSON.parse(init.body));return{choices:[{finish_reason:'stop',message:{content:'忠实译文'}}]}});
 for(const provider of ['openai','deepseek','groq','qwen','glm'])for(const purpose of ['chat','input','backtranslation','voice','screenshot',undefined])for(const forceRefresh of [false,true]){
  const result=await vm.runInContext(`Xp(${JSON.stringify({text:'ATM I am NOT sure rn 😂',purpose,targetLanguage:'zh-CN',provider,apiKey:'fixture',forceRefresh})})`,ctx);assert.equal(result.text,'忠实译文');
 }
 assert.equal(sent.length,60);for(const body of sent){const prompt=body.messages[0].content;assert.match(prompt,/directly and faithfully/);assert.match(prompt,/otherwise retain the original abbreviation without guessing/);assert.match(prompt,/Do not embellish/);assert.doesNotMatch(prompt,/write natural conversational American English/);assert.equal(body.temperature,.1);assert.ok(body.messages[1].content.endsWith('ATM I am NOT sure rn 😂'));}
});
test('free customer-chat results are never changed by contractions or greeting rewrites',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(sliceFn('function haituoNaturalizeFreeTranslation(', 'async function Xp('),ctx);
 for(const purpose of ['chat','input','backtranslation','voice','screenshot',undefined])for(const lang of ['en','zh-CN','fr'])for(const text of ['I am not sure.','How are you doing today?','It is another day.','ATM rn','you are happy','  Keep these spaces.  '])assert.equal(ctx.haituoNaturalizeFreeTranslation('今天过得怎么样',lang,text,purpose),text);
});
test('new translation requests cannot reuse the old colloquial API/shared-chat cache namespace',()=>{
 const ctx=makeCtx();const key=vm.runInContext(`haituoTranslationCacheKey({text:'hello',purpose:'chat'})`,ctx);assert.ok(key.includes('literal-chat-v1'));assert.ok(!key.includes('free-ai-chat-v6'));
 assert.match(bundle,/literal-chat-message-v1/);
});

test('WhatsApp and Signal outgoing output helpers preserve provider text exactly',()=>{
 for(const [file,name,next] of [['src/app/js/caisheng-webview-preload.js','polishOutgoingEnglish','async function translateMessage('],['src/app/bundles/preload/main.js','HaituoPolishOutgoingEnglish','function haituoProviderConfigured(']]){
  const source=fs.readFileSync(file,'utf8'),start=source.indexOf('function '+name+'('),end=source.indexOf(next,start),ctx={};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  for(const original of ['又是美好的一天','今天怎么样'])for(const value of ['It is another day.','I am not sure. I will not go.','How are you doing today?','  Keep spaces  '])assert.equal(ctx[name](original,value),value);
 }
});
test('all translation UI prompts and screenshot AI policy use faithful output',()=>{
 for(const file of ['src/app/js/caisheng-webview-preload.js','src/app/bundles/preload/main.js'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/自然口语|口语化|生成自然|AI 润色/);
 const source=fs.readFileSync('src/app/js/haituo-screenshot.js','utf8');assert.match(source,/translate directly and faithfully/);
});
