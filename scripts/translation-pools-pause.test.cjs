'use strict';
// Pool pause/resume + all-paused free fallback. Each entry carries an
// `enabled` flag (absent = enabled, so legacy configs are unaffected);
// run() must skip paused entries in order, honour pause in the backup pool
// too, and degrade to the free channel when every entry is paused.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const pools=require('../src/app/js/haituo-translation-pools.js');
const preload=fs.readFileSync(path.join(__dirname,'..','src','app','bundles','preload','main.js'),'utf8');

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
  await assert.rejects(()=>pools.run({primary:[],backup:[]},{},()=>Promise.resolve({text:'x'})),error=>error.status===422&&/翻译池为空/.test(error.message)&&/主翻译和备用翻译均未成功/.test(error.message)&&/添加翻译接口/.test(error.message));
});

test('sanitize persists the paused flag for storage round-trips',()=>{
  const out=pools.sanitize({primary:[entry({enabled:false}),entry()],backup:[entry({provider:'deepl',enabled:false})]});
  assert.equal(out.primary[0].enabled,false);
  assert.equal(out.primary[1].enabled,true);
  assert.equal(out.backup[0].enabled,false);
});

test('pool save selects the first enabled service and never a paused one',()=>{
  const start=preload.indexOf('function haituoActivePoolProvider');
  const end=preload.indexOf('let haituoPoolSaveQueue',start);
  assert.ok(start>=0&&end>start,'haituoActivePoolProvider must exist');
  const ctx={};vm.createContext(ctx);vm.runInContext(preload.slice(start,end),ctx);
  assert.equal(ctx.haituoActivePoolProvider({primary:[{provider:'google-cloud',enabled:false},{provider:'deepseek',enabled:true}]}),'deepseek','a paused first entry must not become the selected service');
  assert.equal(ctx.haituoActivePoolProvider({primary:[{provider:'openai',enabled:false}]}),undefined,'all paused must leave the previous selection untouched');
  assert.equal(ctx.haituoActivePoolProvider({primary:[]}),undefined);
  assert.equal(ctx.haituoActivePoolProvider(undefined),undefined);
  assert.match(preload,/haituoActivePoolProvider\(changed\)/u);
  assert.match(preload,/activePrimary \? \{ chatTranslationProvider: activePrimary, inputTranslationProvider: activePrimary \}/u);
  assert.doesNotMatch(preload,/chatTranslationProvider:changed\.primary\[0\]/u);
});

test('pool saves carry the config version and reapply the edit after another window wins',async()=>{
  const start=preload.indexOf('function haituoActivePoolProvider');
  const end=preload.indexOf('function haituoCheckedConfigSet',start);
  assert.ok(start>=0&&end>start,'the pool save helper must exist');
  const reads=[
    {__v:5,translationPools:{primary:[{provider:'openai',enabled:true}],backup:[]}},
    {__v:6,translationPools:{primary:[{provider:'openai',enabled:true},{provider:'deepseek',enabled:true}],backup:[]}},
  ];
  const patches=[];let attempts=0;
  const ctx={
    window:{SignalContext:{caishengGetTranslationConfig:async()=>reads[Math.min(attempts,reads.length-1)]}},
    haituoCheckedConfigSet:async patch=>{patches.push(JSON.parse(JSON.stringify(patch)));attempts+=1;if(attempts===1)throw Error('设置已被其他窗口更新，请重试');return {ok:true}},
  };
  vm.createContext(ctx);vm.runInContext(preload.slice(start,end),ctx);
  const result=await ctx.haituoSavePoolChange('translation',{},current=>({...current,primary:[...current.primary,{provider:'glm',enabled:true}]}));
  assert.equal(result.ok,true);
  assert.equal(patches.length,2,'a stale write is retried exactly once');
  assert.equal(patches[0].__v,5);
  assert.equal(patches[1].__v,6,'the retry must be based on the newer version');
  assert.equal(patches[1].translationPools.primary.length,3,'the retry must apply this edit to the fresh pool');
  assert.equal(patches[1].chatTranslationProvider,'openai');
  assert.equal(patches[1].inputTranslationProvider,'openai');
});
