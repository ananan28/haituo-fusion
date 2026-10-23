'use strict';
// Pool pause/resume + all-paused free fallback. Each entry carries an
// `enabled` flag (absent = enabled, so legacy configs are unaffected);
// run() must skip paused entries in order, honour pause in the backup pool
// too, and degrade to the free channel when every entry is paused.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const pools=require('../src/app/js/haituo-translation-pools.js');

const entry=(over={})=>({provider:'openai',apiKey:'sk-x',endpoint:'https://api.example.test/v1',model:'m',region:'',enabled:true,...over});

test('a paused primary is skipped and the next enabled primary is used',async()=>{
  const calls=[];
  const result=await pools.run({primary:[entry({model:'paused-model',enabled:false}),entry({model:'live-model'})],backup:[entry({provider:'deepseek'})]}, {},e=>{calls.push(e.model);return Promise.resolve({text:'ok'})});
  assert.deepEqual(calls,['live-model']);
  assert.equal(result.pool,'primary');
  assert.equal(result.text,'ok');
});

test('all primaries paused falls through to an enabled backup entry',async()=>{
  const calls=[];
  const result=await pools.run({primary:[entry({enabled:false}),entry({model:'also-paused',enabled:false})],backup:[entry({provider:'deepseek',model:'backup-model'})]}, {},e=>{calls.push(e.model);return Promise.resolve({text:'ok'})});
  assert.deepEqual(calls,['backup-model']);
  assert.equal(result.pool,'backup');
  assert.equal(result.fallbackFrom,'openai');
});

test('pause is respected inside the backup pool as well',async()=>{
  const calls=[];
  const result=await pools.run({primary:[entry({enabled:false})],backup:[entry({model:'paused-backup',enabled:false}),entry({provider:'groq',model:'live-backup',apiKey:'g-x'})]}, {},e=>{calls.push(e.model);return Promise.resolve({text:'ok'})});
  assert.deepEqual(calls,['live-backup']);
  assert.equal(result.pool,'backup');
});

test('every entry paused degrades to the free channel instead of failing',async()=>{
  const calls=[];
  const result=await pools.run({primary:[entry({enabled:false})],backup:[entry({provider:'deepseek',enabled:false})]}, {},e=>{calls.push(e.provider);return Promise.resolve({text:'free ok'})});
  assert.deepEqual(calls,['google-free'],'translate must receive the synthetic free entry');
  assert.equal(result.pool,'free-fallback');
  assert.equal(result.provider,'google-free');
  assert.equal(result.text,'free ok');
});

test('an empty pool still fails loudly (fallback only applies to all-paused)',async()=>{
  await assert.rejects(()=>pools.run({primary:[],backup:[]},{},()=>Promise.resolve({text:'x'})),/主翻译和备用翻译均未成功/);
});

test('sanitize persists the paused flag for storage round-trips',()=>{
  const out=pools.sanitize({primary:[entry({enabled:false}),entry()],backup:[entry({provider:'deepl',enabled:false})]});
  assert.equal(out.primary[0].enabled,false);
  assert.equal(out.primary[1].enabled,true);
  assert.equal(out.backup[0].enabled,false);
});
