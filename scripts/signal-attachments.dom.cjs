'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const qa=process.env.HAITUO_QA_NODE_MODULES||'/tmp/haituo-qa/node_modules';
const load=name=>require(require.resolve(name,{paths:[qa]}));
const {JSDOM}=load('jsdom'),React=load('react'),{createRoot}=load('react-dom/client'),{flushSync}=load('react-dom'),jsx=load('react/jsx-runtime');
const bundle=fs.readFileSync(path.join(__dirname,'../src/app/bundles/preload/main.js'),'utf8');const a=bundle.indexOf('    function Ive({text:'),b=bundle.indexOf('    var w_, T_, Lve',a);assert.ok(a>=0&&b>a);
const records=require('../src/app/js/haituo-signal-message-record.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function setup(t,translate){const dom=new JSDOM('<div class="module-message" id="root"></div>',{pretendToBeVisual:true});global.window=dom.window;global.document=dom.window.document;const messages=new Map;const cache={getById:id=>{if(!messages.has(id)){const attributes={id};messages.set(id,{attributes,get:key=>attributes[key],set:patch=>Object.assign(attributes,patch)})}return messages.get(id)},saveMessage:async()=>{}};const context={require:name=>{assert.equal(name,'../../js/haituo-signal-message-record.js');return records},Error,w_:React,T_:jsx,window:{MessageCache:cache,SignalContext:{caishengTranslate:translate}},document:dom.window.document,navigator:{clipboard:{writeText:async()=>{}}},x_:()=>({autoTranslateIncoming:true,groupBackTranslationEnabled:true,chatTranslationProvider:'fixture'}),HaituoIncomingTarget:()=> 'zh-CN',HaituoFormatMessageParagraphs:(_s,result)=>result,haituoQueueSignalTranslation:(_ref,fn)=>fn()};vm.createContext(context);vm.runInContext(bundle.slice(a,b),context);const host=dom.window.document.querySelector('#root'),root=createRoot(host);t.after(async()=>{flushSync(()=>root.unmount());await wait(10);dom.window.close()});return{host,root,render:props=>flushSync(()=>root.render(React.createElement(context.Ive,props))),context}}
test('Signal actual React component automatically attaches translation below source area',async t=>{let request;const ui=setup(t,async r=>{request=r;return{text:'你好'}});ui.render({text:'Hello',messageId:'signal-one'});await wait(45);assert.equal(request.messageId,'signal-one');assert.equal(ui.host.querySelector('.CaishengMessageTranslation__result')?.textContent,'你好');assert.equal(ui.host.querySelector('.CaishengMessageTranslation').style.display,'block');assert.ok(!ui.host.textContent.includes('隐藏翻译'))});
test('Signal recycled component never displays result from a previous message',async t=>{let release;const ui=setup(t,r=>r.messageId==='first'?new Promise(resolve=>release=resolve):Promise.resolve({text:'第二条译文'}));ui.render({text:'same text',messageId:'first'});await wait(25);ui.render({text:'same text',messageId:'second'});await wait(25);release({text:'第一条旧译文'});await wait(30);assert.equal(ui.host.querySelector('.CaishengMessageTranslation__result')?.textContent,'第二条译文');assert.ok(!ui.host.textContent.includes('第一条旧译文'))});
test('Signal quote does not duplicate a full message attachment',async t=>{let calls=0;const ui=setup(t,async()=>{calls++;return{text:'fixture'}});ui.render({text:'Hello',messageId:'one',quoted:true});await wait(20);assert.equal(calls,0);assert.equal(ui.host.querySelector('.CaishengMessageTranslation'),null)});
test('Signal failed retranslate leaves successful bilingual text visible',async t=>{let calls=0;const ui=setup(t,async()=>{if(calls++)throw Error('offline');return{text:'保留译文'}});ui.render({text:'Hello',messageId:'one'});await wait(30);const button=ui.host.querySelector('button');button.dispatchEvent(new ui.host.ownerDocument.defaultView.MouseEvent('click',{bubbles:true}));await wait(30);assert.equal(ui.host.querySelector('.CaishengMessageTranslation__result')?.textContent,'保留译文');assert.equal(ui.host.querySelector('.CaishengMessageTranslation__error')?.textContent,'offline')});

test('Signal translated message remount includes translation in first React commit with zero IPC calls',async t=>{
 let calls=0;const ui=setup(t,async()=>{calls++;return{text:'消息内译文'}});
 ui.render({text:'Hello',messageId:'durable'});await wait(40);
 const saved=JSON.parse(JSON.stringify(ui.context.window.MessageCache.getById('durable').attributes));
 assert.equal(saved.haituoLocalTranslations.entries['zh-CN'].text,'消息内译文');
 ui.render({text:'Other',messageId:'other'});await wait(20);
 // Simulate a restart/model reload from the persisted message JSON and no network.
 const model=ui.context.window.MessageCache.getById('durable');model.set(saved);
 ui.context.window.SignalContext.caishengTranslate=()=>{throw Error('IPC must not run for stored message')};
 const before=calls;ui.render({text:'Hello',messageId:'durable'});
 assert.equal(ui.host.querySelector('.CaishengMessageTranslation__result')?.textContent,'消息内译文');
 await wait(30);assert.equal(calls,before);assert.equal(ui.host.querySelector('.CaishengMessageTranslation__error'),null);
});

test('Signal actual long-message body includes saved bilingual text on its first collapsed render',async t=>{
 let calls=0;const ui=setup(t,async()=>{calls++;throw Error('stored message must not use IPC')});
 const full='Hello '.repeat(200);ui.context.window.MessageCache.getById('long').set({haituoLocalTranslations:{version:1,entries:{'zh-CN':{source:full,text:'完整长消息译文'}}}});
 Object.assign(ui.context,{D_:jsx,__:{Timeline:'Timeline',Quote:'Quote'},Rve:()=>null,Ys:()=>true,gve:props=>React.createElement('span',{className:'original'},props.messageText)});
 const ea=bundle.indexOf('    function E_('),eb=bundle.indexOf('    var D_, zve',ea);assert.ok(ea>=0&&eb>ea);vm.runInContext(bundle.slice(ea,eb),ui.context);
 flushSync(()=>ui.root.render(React.createElement(ui.context.E_,{haituoMessageId:'long',text:full.slice(0,800),originalText:full,renderLocation:'Timeline',i18n:k=>k,onIncreaseTextLength:()=>{}})));
 assert.ok(ui.host.querySelector('.original').textContent.startsWith('Hello'));
 assert.equal(ui.host.querySelector('.CaishengMessageTranslation__result')?.textContent,'完整长消息译文');
 await wait(20);assert.equal(calls,0);
});
