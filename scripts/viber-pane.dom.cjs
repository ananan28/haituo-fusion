'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const modules=process.env.HAITUO_QA_NODE_MODULES;
const {JSDOM}=require(require.resolve('jsdom',{paths:[modules]})),React=require(require.resolve('react',{paths:[modules]})),{createRoot}=require(require.resolve('react-dom/client',{paths:[modules]}));
const {act}=React,{createPane}=require('../src/app/js/haituo-viber-pane');
test('Viber pane clears images on account changes and ignores delayed OCR/translation',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});const previous={window:global.window,document:global.document,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT};global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const listeners=new Set,commands=[];let epoch=0;
 const api={onEvent(fn){listeners.add(fn);return()=>listeners.delete(fn)},command(type,payload){commands.push({type,...payload});if(type==='select')return Promise.resolve({epoch:++epoch});return Promise.resolve({original:'synthetic OCR'})},config:async()=>({chatTranslationProvider:'google-free'}),translate:async()=>({text:'synthetic translation'})};
 const Pane=createPane(React,api),root=createRoot(dom.window.document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());dom.window.close();Object.assign(global,previous)});
 const render=id=>root.render(React.createElement(Pane,{account:{id},active:true}));
 await act(async()=>render('viber-a'));const a=epoch;
 await act(async()=>{for(const listener of listeners){listener({accountId:'viber-a',epoch:a,type:'frame',image:'data:image/png;base64,AA=='});listener({accountId:'viber-a',epoch:a,type:'state',ready:true,status:'synthetic ready'})}});
 assert(dom.window.document.querySelector('img'));
 await act(async()=>render('viber-b'));
 assert.equal(dom.window.document.querySelector('img'),null);
 await act(async()=>{for(const listener of listeners)listener({accountId:'viber-a',epoch:a,type:'frame',image:'data:image/png;base64,AA=='})});
 assert.equal(dom.window.document.querySelector('img'),null);
 assert(commands.some(x=>x.type==='hide'&&x.id==='viber-a'&&x.epoch===a));
 async function ready(id){await act(async()=>{for(const listener of listeners){listener({accountId:id,epoch,type:'frame',image:'data:image/png;base64,AA=='});listener({accountId:id,epoch,type:'state',ready:true,status:'synthetic ready'})}})}
 function button(label){return [...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===label)}
 let releaseOCR;const originalCommand=api.command;
 api.command=(type,payload)=>type==='ocr'?new Promise(resolve=>{releaseOCR=resolve}):originalCommand(type,payload);
 await ready('viber-b');await act(async()=>button('识别当前画面文字').click());
 await act(async()=>render('viber-a'));await act(async()=>releaseOCR({original:'late old OCR'}));
 assert.equal(dom.window.document.querySelector('textarea[aria-label="Viber 翻译原文"]').value,'');
 api.command=originalCommand;await ready('viber-a');await act(async()=>button('识别当前画面文字').click());
 assert.equal(dom.window.document.querySelector('textarea[aria-label="Viber 翻译原文"]').value,'synthetic OCR');
 let releaseTranslation;api.translate=()=>new Promise(resolve=>{releaseTranslation=resolve});
 await act(async()=>button('翻译').click());assert(releaseTranslation);
 await act(async()=>render('viber-b'));await act(async()=>releaseTranslation({text:'late old translation'}));
 assert.equal(dom.window.document.querySelector('textarea[aria-label="Viber 译文"]').value,'');
});
