'use strict';
// Regression tests for the 1.5.3 settings-ownership fix.
// translation-settings.json is shared by the main process and every child
// profile, but on Windows safeStorage derives its key from the per-userData
// Local State file, so a child write re-encrypts it under a key the main
// process can never read. The result was a permanently undecryptable file,
// 16k+ refused writes, and pool saves that silently reset (only 2 primary /
// 1 backup entries ever stuck). The main process must be the only reader and
// writer; children run on the unredacted IPC snapshot.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const bundle=fs.readFileSync(path.join(__dirname,'..','src','app','bundles','main.js'),'utf8');
const preloadBundle=fs.readFileSync(path.join(__dirname,'..','src','app','bundles','preload','main.js'),'utf8');

function sliceBalancedFrom(source,marker){
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,`missing ${marker}`);
  let depth=0,inString=null,inTemplate=false;
  for(let i=start;i<source.length;i+=1){
    const ch=source[i],prev=source[i-1];
    if(inString){if(ch===inString&&prev!=='\\')inString=null;continue}
    if(inTemplate){if(ch==='`'&&prev!=='\\')inTemplate=false;continue}
    if(ch==='"'||ch==="'"){inString=ch;continue}
    if(ch==='`'){inTemplate=true;continue}
    if(ch==='{')depth+=1;
    if(ch==='}'){depth-=1;if(depth===0)return source.slice(start,i+1)}
  }
  throw Error(`unbalanced ${marker}`);
}
function sliceBalanced(marker){return sliceBalancedFrom(bundle,marker)}

const childConfigCode=sliceBalanced('function haituoChildTranslationConfig');
const pCode=sliceBalanced('function $p');
const emCode=sliceBalanced('function em');
const publishCode=sliceBalanced('function haituoPublishGlobalSettings');

function makeCtx({profile='haituo-child',ready=true,zp={provider:'google-free'}}={}){
  const writes=[],sent=[];
  let reads=0;
  const ctx={
    console,JSON,Math,Date,RegExp,Error,String,Number,Array,Object,Boolean,Promise,Map,Set,
    $u:profile,
    Zp:zp,
    HaituoConfigVersion:0,
    haituoProtectedRead:()=>{reads+=1;throw Error('child must not read the shared settings file')},
    haituoProtectedWrite:(file,value)=>{writes.push({file,value});return true},
    haituoAppReady:()=>ready,
    Qp:'/cfg/translation-settings.json',
    Yg:new Map([['signal-child',{connected:true,killed:false,exitCode:null}]]),
    caishengSendChild:(child,payload)=>{sent.push(payload);return true},
    haituoRedactTranslationConfig:cfg=>({...cfg,apiKey:'__HAITUO_REDACTED__:apiKey'}),
    X:{warn(){},info(){},error(){}},
  };
  ctx.__writes=writes;
  ctx.__sent=sent;
  ctx.__reads=()=>reads;
  vm.createContext(ctx);
  vm.runInContext([childConfigCode,pCode,emCode,publishCode].join('\n'),ctx);
  return ctx;
}

test('child $p() returns the main-pushed snapshot, including real pool keys, without touching the file',()=>{
  const ctx=makeCtx({zp:{
    provider:'deepseek',targetLanguage:'fr',
    translationPools:{primary:[{provider:'openai',apiKey:'sk-real-primary',model:'m1'}],backup:[{provider:'groq',apiKey:'gsk-real-backup'}]}
  }});
  const cfg=vm.runInContext('$p()',ctx);
  assert.equal(ctx.__reads(),0,'child must never read translation-settings.json');
  assert.equal(cfg.provider,'deepseek');
  assert.equal(cfg.targetLanguage,'fr','ordinary settings pass through');
  assert.equal(cfg.translationPools.primary[0].apiKey,'sk-real-primary','real keys arrive over IPC, not the file');
  assert.equal(cfg.translationPools.backup[0].apiKey,'gsk-real-backup');
  assert.equal(cfg.chatTranslationProvider,'google-free','unset defaults still apply');
});

test('child em() never writes the shared settings file',()=>{
  const ctx=makeCtx({profile:'haituo-child'});
  vm.runInContext(`em({provider:'deepl',__v:1})`,ctx);
  assert.equal(ctx.__writes.length,0,'a child write is what poisons the shared file');
});

test('main em() defers pre-ready writes and persists once after ready',()=>{
  const ctx=makeCtx({profile:'signal-main',ready:false});
  vm.runInContext(`em({provider:'deepl'})`,ctx);
  assert.equal(ctx.__writes.length,0,'safeStorage is unusable before app ready');
  ctx.haituoAppReady=()=>true;
  vm.runInContext(`em({provider:'deepl',__v:7})`,ctx);
  assert.equal(ctx.__writes.length,1,'main persists after ready');
  assert.equal(ctx.__writes[0].value.provider,'deepl');
  assert.equal(ctx.__writes[0].file,'/cfg/translation-settings.json');
});

test('publish sends the unredacted config to child main processes',()=>{
  const ctx=makeCtx({profile:'signal-main'});
  const config={apiKey:'sk-real-secret',translationPools:{primary:[{apiKey:'sk-real-pool'}]},__v:9};
  vm.runInContext(`haituoPublishGlobalSettings(${JSON.stringify(config)})`,ctx);
  assert.equal(ctx.__sent.length,1);
  assert.equal(ctx.__sent[0].type,'haituo-global-settings-update');
  assert.equal(ctx.__sent[0].config.apiKey,'sk-real-secret','child main needs the real key; renderers still get the redacted broadcast');
  assert.equal(ctx.__sent[0].config.translationPools.primary[0].apiKey,'sk-real-pool');
});

test('child pending writes no longer accumulate because em() is a no-op there',()=>{
  const ctx=makeCtx({profile:'haituo-child'});
  for(let i=0;i<20;i+=1)vm.runInContext(`em({pool:${i}})`,ctx);
  assert.equal(ctx.__writes.length,0);
});

test('1.5.7: a refused write in a child window is reported back as a failure',()=>{
  const code=sliceBalancedFrom(bundle,'if (Yg.get(t) === r && e?.type === `haituo-global-settings-request`)');
  function run(applied){
    const acks=[],r={};
    const ctx={
      Error,String,Yg:new Map([['p',r]]),t:'p',r,
      HaituoConfigVersion:10,
      e:{type:'haituo-global-settings-request',requestId:'req-1',config:{provider:'deepl'}},
      $p:()=>({provider:'google-free'}),
      haituoApplyTranslationConfig:()=>applied,
      caishengSendChild:(child,payload)=>acks.push(payload),
    };
    vm.createContext(ctx);vm.runInContext(`(function(){${code}})()`,ctx);return acks;
  }
  const refused=run({ok:false,error:'设置文件当前无法写入（可能损坏、被占用或加密不可用）'});
  assert.equal(refused.length,1);
  assert.equal(refused[0].ok,false,'the child window must not show 已保存');
  assert.match(refused[0].error,/无法写入/u);
  const saved=run({ok:true});
  assert.equal(saved[0].ok,true,'a real save still acknowledges success');
});

test('1.5.7: renderer turns a refused write into a rejection so no caller claims success',async()=>{
  const checkedSetCode=sliceBalancedFrom(preloadBundle,'function haituoCheckedConfigSet');
  let reply={ok:false,error:'设置文件当前无法写入（可能损坏、被占用或加密不可用）'};
  const ctx={console,Promise,Error,window:{SignalContext:{caishengSetTranslationConfig:()=>reply}}};
  vm.createContext(ctx);
  vm.runInContext(checkedSetCode,ctx);
  await assert.rejects(()=>ctx.haituoCheckedConfigSet({a:1}),/无法写入/u,'the UI must surface the failure');
  reply={ok:true};
  const ok=await ctx.haituoCheckedConfigSet({a:1});
  assert.equal(ok.ok,true,'a real success still resolves');
  reply=undefined;
  assert.equal(await ctx.haituoCheckedConfigSet({a:1}),undefined,'a legacy handler without a return value stays compatible');
});

test('a save loop accumulates three primary and two backup entries with keys intact',()=>{
  const pools=require('../src/app/js/haituo-translation-pools.js');
  let stored=pools.fromLegacy({chatTranslationProvider:'google-free'});
  const add=(group,apiKey)=>{stored=pools.sanitize({...stored,[group]:[...stored[group],{provider:'openai',apiKey,endpoint:'https://api.example.test/v1',model:'m1'}]})};
  add('primary','sk-p2');add('primary','sk-p3');add('backup','sk-b1');add('backup','sk-b2');
  assert.deepEqual(stored.primary.map(p=>p.apiKey),['','sk-p2','sk-p3'],'third primary entry must stick');
  assert.deepEqual(stored.backup.map(p=>p.apiKey),['sk-b1','sk-b2'],'second backup entry must stick');
  assert.equal(pools.sanitize(stored).primary.length,3,'a reload must not drop entries');
  assert.equal(pools.sanitize(stored).backup.length,2,'a reload must not drop backup entries');
});
