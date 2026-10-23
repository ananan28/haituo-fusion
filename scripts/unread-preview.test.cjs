'use strict';
// Regression tests for the 1.5.3 "all unread messages on hover" preview.
// WhatsApp/Telegram chat rows expose only the last message snippet, so the
// preload accumulates every snippet change per chat while the app runs. A
// hover shows all recorded messages that the unread badge accounts for and
// states how many older ones remain, WITHOUT clicking or focusing the row —
// opening a chat would send a read receipt.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','src','app','js','caisheng-webview-preload.js'),'utf8');
const start=source.indexOf('function haituoInstallChatHoverPreview');
const end=source.indexOf('// HAITUO_CHAT_PREVIEW_END',start);
assert.ok(start>=0&&end>start,'hover preview slice found');
const slice=source.slice(start,end);

function element(tag='div'){
  const node={
    tagName:String(tag).toUpperCase(),className:'',style:{},children:[],isConnected:true,attrs:{},listeners:{},_text:'',
    setAttribute(key,value){this.attrs[key]=String(value)},
    getAttribute(key){return this.attrs[key]??null},
    hasAttribute(key){return key in this.attrs},
    removeAttribute(key){delete this.attrs[key]},
    append(...kids){for(const kid of kids){kid.parentNode=this;this.children.push(kid)}},
    remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this)},
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
    contains(other){return other===this||this.children.some(child=>child.contains?.(other))},
    querySelector(){return null},querySelectorAll(){return []},
    getBoundingClientRect(){return {left:0,top:0,right:220,bottom:20,width:220,height:20}},
    closest(){return null},
    click(){throw Error('the preview must never click a chat row (read receipt risk)')},
    focus(){throw Error('the preview must never focus a chat row (read receipt risk)')},
  };
  Object.defineProperty(node,'innerText',{get(){return this._text},set(value){this._text=String(value)}});
  Object.defineProperty(node,'textContent',{get(){return this._text},set(value){this._text=String(value)}});
  return node;
}

function makeRow({id='chat-alice',name='Alice',snippet='hello',unread=0}){
  const row=element('div');row.attrs['data-id']=id;
  if(unread>0)row.attrs['aria-label']=`${unread} unread messages`;
  const heading=element('span');heading.textContent=name;heading.setAttribute('title',name);
  const secondary=element('div');const text=element('span');text.textContent=snippet;
  secondary.querySelector=selector=>String(selector).includes('span[title]')||String(selector).includes('dir="auto"')?text:null;
  row.querySelector=selector=>{
    const value=String(selector);
    if(value.includes('cell-frame-title'))return heading;
    if(value.includes('cell-frame-secondary'))return secondary;
    return null;
  };
  row.querySelectorAll=()=>[];
  row.closest=()=>row;
  row.setText=(next,count)=>{text.textContent=next;if(count>0)row.attrs['aria-label']=`${count} unread messages`;else delete row.attrs['aria-label']};
  row.textNode=text;
  return row;
}

function walk(node,visit){visit(node);for(const child of node.children||[])walk(child,visit)}

function boot(initialStorage={}){
  const listeners={},observers=[],translated=[];
  class MutationObserver{constructor(callback){this.callback=callback;observers.push(this)}observe(){}disconnect(){}}
  const body=element('body'),documentElement=element('html'),list=element('div');
  const rows=[];
  list.querySelectorAll=()=>rows;
  const documentStub={
    hidden:false,body,documentElement,
    querySelector:selector=>String(selector).includes('pane-side')?list:null,
    querySelectorAll:()=>[],
    createElement:tag=>element(tag),
    addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn)},
  };
  const storage=initialStorage;
  const windowStub={
    innerWidth:1280,innerHeight:800,MutationObserver,
    addEventListener(){},
    sessionStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value}},
  };
  const translate=text=>{translated.push(text);return Promise.resolve({text:'译:'+text})};
  const ctx={console,Promise,JSON,Error,String,Number,Math,Array,Object,Map,Set,RegExp,Date,
    document:documentStub,window:windowStub,translate,isTelegram:()=>false,
    setTimeout:fn=>{fn();return 0},clearTimeout(){},
  };
  vm.createContext(ctx);
  vm.runInContext(slice+'\n__preview = haituoInstallChatHoverPreview({document, window, translate, delayMs: 0});',ctx);
  const flush=async()=>{for(let i=0;i<30;i+=1)await new Promise(resolve=>setImmediate(resolve))};
  const scan=()=>{for(const observer of observers.slice(0,2))observer.callback()};
  const hover=async row=>{for(const fn of listeners.pointerover||[])fn({target:{closest:()=>row}});await flush()};
  const leave=()=>{for(const fn of listeners.pointerout||[])fn({relatedTarget:null})};
  const popup=()=>body.children.find(child=>child.tagName==='SECTION');
  const textsOf=className=>{const out=[];if(popup())walk(popup(),node=>{if(node.className===className)out.push(node.textContent)});return out};
  return {rows,scan,hover,leave,popup,textsOf,translated,flush,storage};
}

test('all snippets accumulated while running are shown when the badge says three',async()=>{
  const app=boot();
  const row=makeRow({snippet:'m1',unread:3});app.rows.push(row);
  app.scan();await app.flush();
  row.setText('m2',3);app.scan();await app.flush();
  row.setText('m3',3);app.scan();await app.flush();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['m1','m2','m3'],'all three unread messages must be listed');
  assert.deepEqual(app.textsOf('haituo-chat-preview-translation'),['译:m1','译:m2','译:m3'],'every message must be translated');
  assert.deepEqual(app.translated,['m1','m2','m3']);
  assert.equal((popup=>{let note='';walk(popup,node=>{if(String(node.textContent).includes('更早的未读消息'))note=node.textContent});return note})(app.popup()),'','no missing-message note when all three were observed');
});

test('older unread messages that were never observed are reported honestly, never faked',async()=>{
  const app=boot();
  const row=makeRow({snippet:'only-last',unread:3});app.rows.push(row);
  app.scan();await app.flush();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['only-last'],'the DOM only exposes the last snippet before observation');
  const notes=[];walk(app.popup(),node=>{if(String(node.textContent).includes('还有 2 条更早的未读消息'))notes.push(node.textContent)});
  assert.equal(notes.length,1,'the popup must state that two older messages need the conversation');
  assert.ok(notes[0].includes('不会自动打开会话'),'and promise no read receipt');
});

test('hovering never clicks or focuses a row',async()=>{
  const app=boot();
  const row=makeRow({snippet:'m1',unread:1});app.rows.push(row);
  app.scan();await app.flush();
  await app.hover(row);
  assert.equal(app.textsOf('haituo-chat-preview-translation').length,1);
  // row.click / row.focus throw if called; reaching here proves neither ran.
});

test('repeated identical messages stay separate unread entries',async()=>{
  const app=boot();
  const row=makeRow({snippet:'OK',unread:3});app.rows.push(row);
  app.scan();await app.flush();
  row.setText('hello',3);app.scan();await app.flush();
  row.setText('OK',3);app.scan();await app.flush();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['OK','hello','OK'],'three messages must not be deduplicated by text');
});

test('Chinese unread labels are counted and a read chat previews only its last message',async()=>{
  const app=boot();
  const row=makeRow({snippet:'a1',unread:3});row.attrs['aria-label']='3 条未读消息';app.rows.push(row);
  app.scan();await app.flush();
  row.setText('a2',3);row.attrs['aria-label']='3 条未读消息';app.scan();await app.flush();
  row.setText('a3',3);row.attrs['aria-label']='3 条未读消息';app.scan();await app.flush();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['a1','a2','a3'],'Chinese badges must yield all three unread messages');
  row.setText('a3',0);app.scan();await app.flush();
  app.leave();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['a3'],'a read chat must show only its latest message');
});

test('reading the chat (badge cleared) resets accumulated snippets',async()=>{
  const app=boot();
  const row=makeRow({snippet:'old1',unread:1});app.rows.push(row);
  app.scan();await app.flush();
  row.setText('old1',0);app.scan();await app.flush();
  row.setText('new1',3);app.scan();await app.flush();
  await app.hover(row);
  assert.deepEqual(app.textsOf('haituo-chat-preview-source'),['new1'],'messages from before the badge reset must not reappear');
  const notes=[];walk(app.popup(),node=>{if(String(node.textContent).includes('还有 2 条更早的未读消息'))notes.push(node.textContent)});
  assert.equal(notes.length,1,'the remaining two unread messages are reported as unobservable');
});

test('sessionStorage keeps observed snippets across a renderer reload',async()=>{
  const first=boot();
  const row=makeRow({snippet:'r1',unread:2});first.rows.push(row);
  first.scan();await first.flush();
  row.setText('r2',2);first.scan();await first.flush();
  assert.ok(first.storage['haituo-unread-preview-v1'],'observed snippets must be written to sessionStorage');

  const second=boot(first.storage);
  const reloaded=makeRow({snippet:'r2',unread:2});second.rows.push(reloaded);
  second.scan();await second.flush();
  await second.hover(reloaded);
  assert.deepEqual(second.textsOf('haituo-chat-preview-source'),['r1','r2'],'a reload must not lose the accumulated messages');
});
