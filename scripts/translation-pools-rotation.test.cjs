'use strict';
// Re-translate rotation: the first translation of a message starts at primary
// 1; each AI re-translate starts at the next enabled primary (2, 3, then back
// to 1). Pausing a model must hand the next attempt to the following enabled
// entry immediately, without skipping it or falling back to the top.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const pools=require('../src/app/js/haituo-translation-pools.js');

const NO_SLEEP=()=>Promise.resolve();
let sequence=0;
const uniqueText=label=>`${label} #${++sequence}`;
const entry=model=>({provider:'openai',apiKey:`sk-${model}`,endpoint:`https://${model}.test/v1`,model,region:'',enabled:true});
const config=(...models)=>({primary:models.map(model=>typeof model==='string'?entry(model):model),backup:[]});

function recorder(calls){
  return async request=>{
    calls.push(request.model);
    return {text:`translated ${request.model}`};
  };
}

test('first translation uses primary 1, then each re-translate cycles 2, 3, 1',async()=>{
  const text=uniqueText('rotation'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  await run('smart-retranslate');
  await run('smart-retranslate');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m3','m1'],'re-translate must walk the configured primary order and wrap');
});

test('pausing the model used last hands the next re-translate to the following enabled entry',async()=>{
  const text=uniqueText('pause-used'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary[0].enabled=false;
  await run('smart-retranslate');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m3'],'pausing m1 must start at m2 and continue to m3');
});

test('pausing the upcoming model skips it immediately instead of skipping past its successor',async()=>{
  const text=uniqueText('pause-next'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary[1].enabled=false;
  await run('smart-retranslate');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m3','m1'],'m2 is paused, so the next enabled entries are m3 then m1');
});

test('resuming a paused model does not restart or scramble the rotation',async()=>{
  const text=uniqueText('resume'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary[0].enabled=false;
  await run('smart-retranslate');
  cfg.primary[0].enabled=true;
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m3'],'after m2 the next entry is m3 regardless of m1 being resumed');
});

test('an empty-key entry is skipped without consuming the rotation slot',async()=>{
  const text=uniqueText('empty-key'), calls=[], cfg=config({...entry('m1'),apiKey:''},'m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m2','m3'],'the empty entry must not be called and m2 is the first successful slot');
});

test('a hard failure moves to the next entry and rotation continues after the one that succeeded',async()=>{
  const text=uniqueText('hard-fail'), calls=[], cfg=config('m1','m2','m3');
  const translate=async request=>{
    calls.push(request.model);
    if(request.model==='m1'){const error=Error('HTTP 402（余额不足）');error.status=402;throw error}
    return {text:`translated ${request.model}`};
  };
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m3'],'m1 fails, m2 serves the first translation, m3 serves the re-translate');
});

test('a normal translation always starts at primary 1 even after rotation advanced',async()=>{
  const text=uniqueText('normal-reset'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  await run('smart-retranslate');
  await run('google-free');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m1','m2'],'only AI re-translate rotates; a fresh translation starts at primary 1');
});

test('long-message line segments never rotate or pollute the message rotation',async()=>{
  const text=uniqueText('long-lines'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=(provider,line)=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(line?{__haituoLine:true}:{}),...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('smart-retranslate',true);
  await run('smart-retranslate',true);
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m1','m1'],'line segments stay on the first entry and do not advance the message rotation');
});

test('editing an unrelated entry keeps the cursor after the last success',async()=>{
  const text=uniqueText('edited-other'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary[2].endpoint='https://edited.test/v1';
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2'],'editing m3 must not send the next re-translate back to m1');
});

test('editing the model that just succeeded restarts at the first enabled entry',async()=>{
  const text=uniqueText('edited-last'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary[0].model='m1x';
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m1x'],'the old identity is gone, so the edited first entry serves the retranslate');
});

test('deleting an upcoming entry continues after the last success',async()=>{
  const text=uniqueText('deleted-next'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary.splice(1,1);
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m3'],'deleting m2 must not repeat m1; the next enabled entry is m3');
});

test('deleting the model that just succeeded starts at the first enabled entry',async()=>{
  const text=uniqueText('deleted-last'), calls=[], cfg=config('m1','m2','m3'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary.shift();
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2'],'the cursor identity is gone, so the first enabled entry serves the retranslate');
});

test('adding an entry keeps the cursor and reaches the new entry on the next lap',async()=>{
  const text=uniqueText('added'), calls=[], cfg=config('m1','m2'), translate=recorder(calls);
  const run=provider=>pools.run(cfg,{text,targetLanguage:'en',provider,purpose:'chat',...(provider==='smart-retranslate'?{forceRefresh:true}:{})},translate,NO_SLEEP);
  await run('google-free');
  cfg.primary.push(entry('m3'));
  await run('smart-retranslate');
  await run('smart-retranslate');
  assert.deepEqual(calls,['m1','m2','m3'],'a new entry must not reset the cursor or be skipped forever');
});
