'use strict';
// Regression tests for STORE-03: API keys must never reach renderer storage.
// The main process (src/app/bundles/main.js) redacts every config broadcast
// and get-config response to a sentinel, and resolves a bounced sentinel back
// to the stored secret on saves/translate requests — so renderer localStorage
// can only ever hold the sentinel, never a plaintext key.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
const start=code.indexOf('const HaituoRedactedSecret');
const end=code.indexOf('\nfunction haituoRecordTranslationStatus',start);
assert.ok(start>=0&&end>start,'redaction slice found');
const slice=code.slice(start,end);

const SENTINEL='__HAITUO_REDACTED__';
const SECRET='sk-live-abcdef1234567890';

function makeCtx({stored={},sent=[]}){
  const warns=[];
  const sentFrames=[];
  const ctx={
    Buffer,console,JSON,
    p:{webContents:{getAllWebContents:()=>sent.map((send,i)=>({isDestroyed:()=>false,send:(channel,payload)=>sentFrames.push({i,channel,payload})}))}},
    X:{info(){},warn(...a){warns.push(a.join(' '))},error(){}},
  };
  ctx.$p=()=>stored;
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  return {ctx,warns,sentFrames};
}

test('redaction replaces every secret field but keeps ordinary settings',()=>{
  const {ctx}=makeCtx({});
  const redacted=ctx.haituoRedactTranslationConfig({
    apiKey:SECRET,groqApiKey:'g-'+SECRET,deepLApiKey:'d-'+SECRET,kepplApiKey:'k-'+SECRET,
    deepseekApiKey:'ds-'+SECRET,deepseekApiKeys:'dss-'+SECRET,googleCloudApiKey:'gc-'+SECRET,
    screenshotApiKey:'sh-'+SECRET,openaiVoiceApiKey:'v-'+SECRET,
    openaiApiKeys:[SECRET,''],
    openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://api.example.test/v1',model:'m1'},{apiKey:'',endpoint:'',model:''}],
    targetLanguage:'en',chatFontSize:17,chatTranslationProvider:'openai'
  });
  for(const field of ['apiKey','groqApiKey','deepLApiKey','kepplApiKey','deepseekApiKey','deepseekApiKeys','googleCloudApiKey','screenshotApiKey','openaiVoiceApiKey'])
    assert.equal(redacted[field],SENTINEL,field+' must be redacted');
  assert.equal(redacted.apiKey.includes(SECRET),false);
  assert.deepEqual(redacted.openaiApiKeys,[SENTINEL,'']);
  assert.equal(redacted.openaiApiProfiles[0].apiKey,SENTINEL,'profile key must be redacted');
  assert.equal(redacted.openaiApiProfiles[0].endpoint,'https://api.example.test/v1','profile endpoint is not a secret');
  assert.equal(redacted.openaiApiProfiles[0].model,'m1','profile model is not a secret');
  assert.equal(redacted.targetLanguage,'en','ordinary settings pass through');
  assert.equal(redacted.chatFontSize,17);
  assert.equal(redacted.chatTranslationProvider,'openai');
});

test('broadcast to renderers carries only the sentinel for secrets',()=>{
  const {ctx,sentFrames}=makeCtx({sent:[{},{}]});
  ctx.haituoBroadcastTranslationConfig({apiKey:SECRET,targetLanguage:'de'});
  assert.equal(sentFrames.length,2,'one frame per webContents');
  for(const frame of sentFrames){
    assert.equal(frame.channel,'caisheng:translation-config-changed');
    assert.equal(frame.payload.apiKey,SENTINEL);
    assert.equal(frame.payload.targetLanguage,'de');
  }
});

test('a save bouncing the sentinel keeps the stored secret',()=>{
  const stored={apiKey:SECRET,groqApiKey:'stored-groq',openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://api.example.test/v1',model:'m1'}]};
  const {ctx}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({apiKey:SENTINEL,groqApiKey:SENTINEL,targetLanguage:'fr'});
  assert.equal(clean.apiKey,SECRET,'sentinel scalar resolves to the stored key');
  assert.equal(clean.groqApiKey,'stored-groq');
  assert.equal(clean.targetLanguage,'fr','ordinary patch fields pass through');
});

test('redacted profiles inherit the stored key while endpoint+model match',()=>{
  const stored={openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'},{apiKey:'key-2',endpoint:'https://b.test/v1',model:'m2'}]};
  const {ctx,warns}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiProfiles:[
    {apiKey:SENTINEL,endpoint:'https://a.test/v1',model:'m1'},
    {apiKey:SENTINEL,endpoint:'https://b.test/v1',model:'m2'}
  ]});
  const home=JSON.parse(JSON.stringify(clean.openaiApiProfiles));
  assert.deepEqual(home,[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'},{apiKey:'key-2',endpoint:'https://b.test/v1',model:'m2'}]);
  assert.equal(warns.length,0);
});

test('a profile moved without retyping its key is dropped, never poisoned',()=>{
  const stored={openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'}]};
  const {ctx,warns}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiProfiles:[{apiKey:SENTINEL,endpoint:'https://new.test/v1',model:'m9'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(clean.openaiApiProfiles)),[],'unmatched redacted profile must not be stored with the sentinel as its key');
  assert.ok(warns.some(w=>/re-enter the key/.test(w)),'the drop must be loud');
  for(const w of warns)assert.ok(!w.includes(SECRET),'logs must never leak the key: '+w);
});

test('legacy openaiApiKeys entries round-tripped as the sentinel are filtered',()=>{
  const stored={openaiApiKeys:[SECRET,'key-2']};
  const {ctx}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiKeys:[SENTINEL,'fresh-real-key']});
  assert.deepEqual(JSON.parse(JSON.stringify(clean.openaiApiKeys)),['fresh-real-key']);
});

test('non-object payloads pass through untouched',()=>{
  const {ctx}=makeCtx({});
  assert.equal(ctx.haituoRedactTranslationConfig(null),null);
  assert.equal(ctx.haituoUnredactConfigPatch(undefined),undefined);
});
