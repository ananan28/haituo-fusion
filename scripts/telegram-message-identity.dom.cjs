'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require(path.join(process.env.HAITUO_QA_NODE_MODULES,'jsdom'));
const source=fs.readFileSync(path.join(__dirname,'../src/app/js/caisheng-webview-preload.js'),'utf8');
function boot(html,hash='#peer-one',telegram=true){
 const dom=new JSDOM(html,{url:'https://web.telegram.org/k/'+hash});
 const ctx=vm.createContext({document:dom.window.document,location:dom.window.location,isTelegram:()=>telegram});
 vm.runInContext(source.slice(source.indexOf('function haituoTelegramConversationScope('),source.indexOf('// 1.6.4 observer reattach mode.')),ctx);
 return {dom,ctx,document:dom.window.document};
}
test('same message number in two Telegram peers has distinct attachment identity',()=>{
 const x=boot('<div class="bubbles" data-peer-id="synthetic-a"><div data-mid="12"><span>synthetic text</span></div></div>');
 const row=x.document.querySelector('[data-mid]'),a=x.ctx.haituoWebMessageId(row);
 x.document.querySelector('.bubbles').dataset.peerId='synthetic-b';
 assert.notEqual(x.ctx.haituoWebMessageId(row),a);x.dom.window.close();
});
test('route fallback changes identity and nested text resolves its message row',()=>{
 const x=boot('<div data-message-id="9"><span id="text">synthetic</span></div>');
 const row=x.document.querySelector('#text'),a=x.ctx.haituoWebMessageId(row);
 assert(a);x.dom.window.location.hash='peer-two';assert.notEqual(x.ctx.haituoWebMessageId(row),a);x.dom.window.close();
});
test('late result cannot mark recycled Telegram row done after peer switch',()=>{
 const x=boot('<div class="bubbles" data-peer-id="synthetic-a"><div data-mid="12">synthetic</div></div>');
 const row=x.document.querySelector('[data-mid]');row.dataset.haituoTranslationSource='synthetic';row.dataset.haituoTranslationTarget='zh-CN';
 const item={e:row,n:'synthetic',target:'zh-CN',messageId:x.ctx.haituoWebMessageId(row),conversation:x.ctx.haituoTelegramConversationScope()};
 assert.equal(x.ctx.haituoCurrentWebMessage(item),true);
 x.document.querySelector('.bubbles').dataset.peerId='synthetic-b';
 assert.equal(x.ctx.haituoCurrentWebMessage(item),false);x.dom.window.close();
});
test('unknown Telegram peer cannot create durable message identity; WhatsApp identity is retained',()=>{
 const x=boot('<div data-mid="7" data-id="wa-synthetic">text</div>','');
 assert.equal(x.ctx.haituoWebMessageId(x.document.querySelector('div')),undefined);x.dom.window.close();
 const wa=boot('<div data-id="wa-synthetic"><span>text</span></div>','',false);
 assert.equal(wa.ctx.haituoWebMessageId(wa.document.querySelector('span')),'wa-synthetic');wa.dom.window.close();
});
