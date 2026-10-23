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
    translationPools:{primary:[{apiKey:SECRET,endpoint:'https://p.test/v1',model:'pm'}],backup:[{apiKey:'',endpoint:'',model:''}]},
    screenshotApiPool:[{apiKey:SECRET,endpoint:'https://s.test/v1',model:'sm'}],
    targetLanguage:'en',chatFontSize:17,chatTranslationProvider:'openai'
  });
  // P1-04/05: sentinels embed a stable dotted path — index identity, so a
  // save can put the exact stored secret back without ever matching by value.
  for(const field of ['apiKey','groqApiKey','deepLApiKey','kepplApiKey','deepseekApiKey','deepseekApiKeys','googleCloudApiKey','screenshotApiKey','openaiVoiceApiKey'])
    assert.equal(redacted[field],SENTINEL+':'+field,field+' must be redacted with its stable path');
  assert.equal(redacted.apiKey.includes(SECRET),false);
  assert.deepEqual(redacted.openaiApiKeys,[SENTINEL+':openaiApiKeys.0','']);
  assert.equal(redacted.openaiApiProfiles[0].apiKey,SENTINEL+':openaiApiProfiles.0','profile key must be redacted with its stable path');
  assert.equal(redacted.openaiApiProfiles[0].endpoint,'https://api.example.test/v1','profile endpoint is not a secret');
  assert.equal(redacted.openaiApiProfiles[0].model,'m1','profile model is not a secret');
  assert.equal(redacted.translationPools.primary[0].apiKey,SENTINEL+':translationPools.primary.0','P1-04 pool key must be redacted');
  assert.equal(redacted.translationPools.primary[0].endpoint,'https://p.test/v1');
  assert.equal(redacted.translationPools.backup[0].apiKey,'','empty pool key stays empty, no sentinel');
  assert.equal(redacted.screenshotApiPool[0].apiKey,SENTINEL+':screenshotApiPool.0','P1-04 screenshot pool key must be redacted');
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
    assert.equal(frame.payload.apiKey,SENTINEL+':apiKey');
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

test('redacted profiles restore their own stored key by position, never a neighbour’s',()=>{
  const stored={openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'},{apiKey:'key-2',endpoint:'https://b.test/v1',model:'m2'}]};
  const {ctx,warns}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiProfiles:[
    {apiKey:SENTINEL+':openaiApiProfiles.0',endpoint:'https://a.test/v1',model:'m1'},
    {apiKey:SENTINEL+':openaiApiProfiles.1',endpoint:'https://b.test/v1',model:'m2'}
  ]});
  const home=JSON.parse(JSON.stringify(clean.openaiApiProfiles));
  assert.deepEqual(home,[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'},{apiKey:'key-2',endpoint:'https://b.test/v1',model:'m2'}]);
  assert.equal(warns.length,0);
});

test('P1-06: two different redacted keys are never merged into one',()=>{
  const stored={openaiApiKeys:['key-AAAA','key-BBBB']};
  const {ctx}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiKeys:[SENTINEL+':openaiApiKeys.0',SENTINEL+':openaiApiKeys.1']});
  assert.deepEqual(JSON.parse(JSON.stringify(clean.openaiApiKeys)),['key-AAAA','key-BBBB'],'each position restores its own stored secret');
});

test('a profile edited (moved) without retyping its key keeps the stored key — dropped only when nothing was stored there',()=>{
  const stored={openaiApiProfiles:[{apiKey:SECRET,endpoint:'https://a.test/v1',model:'m1'}]};
  const {ctx,warns}=makeCtx({stored});
  const moved=ctx.haituoUnredactConfigPatch({openaiApiProfiles:[{apiKey:SENTINEL+':openaiApiProfiles.0',endpoint:'https://new.test/v1',model:'m9'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(moved.openaiApiProfiles)),[{apiKey:SECRET,endpoint:'https://new.test/v1',model:'m9'}],'P1-06: positional restore must not drop or poison a moved profile');
  const orphan=ctx.haituoUnredactConfigPatch({openaiApiProfiles:[{apiKey:SENTINEL+':openaiApiProfiles.7',endpoint:'https://x.test/v1',model:'mx'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(orphan.openaiApiProfiles)),[],'a sentinel whose stored original does not exist must be dropped, never stored as the sentinel');
  assert.ok(warns.some(w=>/re-enter the key/.test(w)),'the drop must be loud');
  for(const w of warns)assert.ok(!w.includes(SECRET),'logs must never leak the key: '+w);
});

test('openaiApiKeys entries bounced as sentinels restore positionally; real edits win',()=>{
  const stored={openaiApiKeys:[SECRET,'key-2']};
  const {ctx}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({openaiApiKeys:[SENTINEL+':openaiApiKeys.0','fresh-real-key']});
  assert.deepEqual(JSON.parse(JSON.stringify(clean.openaiApiKeys)),[SECRET,'fresh-real-key'],'P1-05: a bounced sentinel must not wipe the stored key');
});

test('P1-04 regression: pausing one pool model keeps every stored pool key',()=>{
  const stored={translationPools:{primary:[
    {provider:'google-cloud',apiKey:'key-google-cloud',endpoint:'https://translation.googleapis.com/language/translate/v2',model:''},
    {provider:'deepseek',apiKey:'key-deepseek',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash'},
    {provider:'openai',apiKey:'key-openai',endpoint:'https://api.openai.com/v1',model:'gpt-4.1-mini'}
  ],backup:[]}};
  const {ctx,warns}=makeCtx({stored});
  const bounced=JSON.parse(JSON.stringify(ctx.haituoRedactTranslationConfig(JSON.parse(JSON.stringify(stored)))));
  bounced.translationPools.primary[0].enabled=false;
  const clean=ctx.haituoUnredactConfigPatch({translationPools:bounced.translationPools});
  assert.deepEqual(JSON.parse(JSON.stringify(clean.translationPools.primary.map(entry=>entry.apiKey))),['key-google-cloud','key-deepseek','key-openai'],'pause must not clear untouched keys');
  assert.equal(clean.translationPools.primary[0].enabled,false,'the pause flag itself still lands');
  assert.equal(warns.length,0,'nothing was dropped');
});

test('P1-04 regression: entering each pool key, then pausing the first model, keeps all three keys',()=>{
  const stored={translationPools:{primary:[
    {provider:'google-cloud',apiKey:'',endpoint:'https://translation.googleapis.com/language/translate/v2',model:''},
    {provider:'deepseek',apiKey:'',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash'},
    {provider:'openai',apiKey:'',endpoint:'https://api.openai.com/v1',model:'gpt-4.1-mini'}
  ],backup:[]}};
  const {ctx,warns}=makeCtx({stored});
  const savePools=mutate=>{
    const bounced=JSON.parse(JSON.stringify(ctx.haituoRedactTranslationConfig(JSON.parse(JSON.stringify(stored)))));
    mutate(bounced.translationPools);
    stored.translationPools=ctx.haituoUnredactConfigPatch({translationPools:bounced.translationPools}).translationPools;
  };
  savePools(pools=>{pools.primary[0].apiKey='sk-live-one';});
  savePools(pools=>{pools.primary[1].apiKey='sk-live-two';});
  savePools(pools=>{pools.primary[2].apiKey='sk-live-three';});
  savePools(pools=>{pools.primary[0].enabled=false;});
  assert.deepEqual(JSON.parse(JSON.stringify(stored.translationPools.primary.map(entry=>entry.apiKey))),['sk-live-one','sk-live-two','sk-live-three'],'no save may wipe a key entered by an earlier save');
  assert.equal(stored.translationPools.primary[0].enabled,false,'the paused entry is flagged');
  assert.ok(!('enabled' in stored.translationPools.primary[1])&&!('enabled' in stored.translationPools.primary[2]),'untouched entries are not rewritten as paused');
  assert.equal(warns.length,0,'no key was dropped during the whole flow');
});

test('P1-04 regression: pool sentinels written with an explicit apiKey path also resolve',()=>{
  const stored={translationPools:{primary:[{provider:'deepseek',apiKey:SECRET}]}};
  const {ctx}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({translationPools:{primary:[{apiKey:SENTINEL+':translationPools.primary.0.apiKey'}]}});
  assert.equal(clean.translationPools.primary[0].apiKey,SECRET,'both sentinel shapes restore the stored key');
});

test('a pool sentinel whose stored original is missing still clears loudly',()=>{
  const {ctx,warns}=makeCtx({stored:{translationPools:{primary:[]}}});
  const clean=ctx.haituoUnredactConfigPatch({translationPools:{primary:[{provider:'openai',apiKey:SENTINEL+':translationPools.primary.3'}]}});
  assert.equal(clean.translationPools.primary[0].apiKey,'','no sentinel may be persisted, and no neighbour key may be borrowed');
  assert.ok(warns.some(w=>/clearing a redacted translationPools/.test(w)),'the drop must stay loud');
});

test('a pool key field edited inside the masked placeholder keeps the stored key',()=>{
  const stored={translationPools:{primary:[{provider:'deepseek',apiKey:SECRET}]}};
  const {ctx,warns}=makeCtx({stored});
  const mangled=SENTINEL+':translationPools.primary.0sk-live-appended';
  const clean=ctx.haituoUnredactConfigPatch({translationPools:{primary:[{provider:'deepseek',apiKey:mangled}]}});
  assert.equal(clean.translationPools.primary[0].apiKey,SECRET,'an unresolvable path must recover the same position, never wipe it');
  assert.equal(warns.length,0);
});

test('a misplaced sentinel never borrows a neighbour key',()=>{
  const stored={translationPools:{primary:[{provider:'openai',apiKey:'key-first'},{provider:'deepseek',apiKey:''}]}};
  const {ctx,warns}=makeCtx({stored});
  const clean=ctx.haituoUnredactConfigPatch({translationPools:{primary:[
    {provider:'openai',apiKey:SENTINEL+':translationPools.primary.1'},
    {provider:'deepseek',apiKey:SENTINEL+':translationPools.primary.1'}
  ]}});
  assert.equal(clean.translationPools.primary[0].apiKey,'','a valid path to an empty slot stays empty rather than borrowing the neighbour');
  assert.equal(clean.translationPools.primary[1].apiKey,'');
  assert.ok(warns.some(w=>/clearing a redacted translationPools/.test(w)));
});

test('non-object payloads pass through untouched',()=>{
  const {ctx}=makeCtx({});
  assert.equal(ctx.haituoRedactTranslationConfig(null),null);
  assert.equal(ctx.haituoUnredactConfigPatch(undefined),undefined);
});
