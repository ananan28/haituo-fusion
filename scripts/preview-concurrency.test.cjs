'use strict';
// Executes the real Signal chat-preview script (scripts/haituo-signal-chat-preview.js)
// against a minimal DOM to prove that a stuck earlier translation can never
// block a newer hover, and that a translation-config change invalidates the
// preview cache. The packaged copy in bundles/preload/main.js is verified by
// the preload marker test to stay declaration-only, keeping the vm completion
// value intact.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../scripts/haituo-signal-chat-preview.js','utf8');
const body=source.split('/* HAITUO_SIGNAL_CHAT_PREVIEW_START */')[1].split('/* HAITUO_SIGNAL_CHAT_PREVIEW_END */')[0];
assert.ok(body.includes(';(function(){')&&body.trimEnd().endsWith('})();'),'preview IIFE found');

function element(){
  const el={
    style:{},children:[],isConnected:true,
    setAttribute(){},addEventListener(){},remove(){this.isConnected=false},
    append(...kids){this.children.push(...kids)},
    contains(){return false},
    querySelector(){return null},
    getBoundingClientRect(){return {right:200,left:0,top:0,bottom:20,height:20,width:200}},
  };
  Object.defineProperty(el,'textContent',{set(v){this._text=String(v)},get(){return this._text}});
  return el;
}
function rowFor(text){
  return {
    isConnected:true,
    getBoundingClientRect(){return {right:200,left:0,top:0,bottom:20,height:20,width:200}},
    contains(){return false},
    querySelector(sel){
      if (String(sel).includes('__message__text')) return {innerText:text};
      return null;
    },
  };
}

async function flush(times=8){for(let i=0;i<times;i++)await new Promise(r=>setImmediate(r));}

function boot({translate}){
  const handlers={};
  const bridgeCalls=[];
  const configListeners=[];
  let currentConfig={chatTranslationProvider:'google-free',translationMode:'normal',translationPools:{}};
  const documentStub={
    hidden:false,body:element(),documentElement:element(),
    addEventListener(type,fn){(handlers[type]??=[]).push(fn)},
    createElement(){return element()},
  };
  const windowStub={
    innerWidth:1280,innerHeight:800,
    addEventListener(){},
    SignalContext:{
      caishengTranslate:request=>{bridgeCalls.push(request.text);return translate(request.text)},
      caishengGetTranslationConfig:()=>Promise.resolve(currentConfig),
      caishengOnTranslationConfig:fn=>{configListeners.push(fn);return()=>{}},
    },
  };
  class MutationObserverStub{observe(){}disconnect(){}}
  const ctx={
    console,Promise,JSON,Error,String,Map,RegExp,
    window:windowStub,document:documentStub,
    MutationObserver:MutationObserverStub,
    setTimeout:fn=>{fn();return 0},clearTimeout(){},
  };
  vm.createContext(ctx);
  vm.runInContext(body,ctx);
  const hover=row=>{
    const event={target:{closest:()=>row}};
    for(const fn of handlers.pointerover||[]) fn(event);
  };
  const changeConfig=cfg=>{currentConfig={...currentConfig,...cfg};for(const fn of configListeners) fn(currentConfig)};
  return {hover,changeConfig,bridgeCalls,windowStub,documentStub};
}

test('a stuck earlier request never blocks hovering another message',async()=>{
  const translate=text=>text==='AAAA'
    ?new Promise(()=>{})            // first request never settles
    :Promise.resolve({text:'译文B'});
  const {hover,bridgeCalls}=boot({translate});
  hover(rowFor('AAAA'));
  await flush();
  assert.deepEqual(bridgeCalls,['AAAA']);
  const started=Date.now();
  hover(rowFor('BBBB'));
  await flush();
  assert.ok(bridgeCalls.includes('BBBB'),'the second hover must reach the bridge without waiting for the first');
  assert.ok(Date.now()-started<1000,'must not wait for the stuck request');
});

test('a translation-config change invalidates cached previews',async()=>{
  const translate=text=>Promise.resolve({text:'译文:'+text});
  const {hover,changeConfig,bridgeCalls}=boot({translate});
  hover(rowFor('BBBB'));
  await flush();
  assert.deepEqual(bridgeCalls,['BBBB'],'first hover translates');
  hover(rowFor('CCCC'));
  await flush();
  assert.deepEqual(bridgeCalls,['BBBB','CCCC']);
  // Same text again: served from cache, no new bridge call.
  hover(rowFor('BBBB'));
  await flush();
  assert.equal(bridgeCalls.length,2,'repeat hover of the same text must be cached');
  // Provider switch: the cached translation must not be shown anymore.
  changeConfig({chatTranslationProvider:'deepl'});
  await flush();
  hover(rowFor('BBBB'));
  await flush();
  assert.equal(bridgeCalls.length,3,'config change must invalidate the preview cache');
  assert.equal(bridgeCalls[2],'BBBB');
});
