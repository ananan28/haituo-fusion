'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const qa=process.env.HAITUO_QA_NODE_MODULES||'/tmp/haituo-qa/node_modules',load=name=>require(require.resolve(name,{paths:[qa]}));
const React=load('react'),{createRoot}=load('react-dom/client'),{flushSync}=load('react-dom'),{JSDOM}=load('jsdom'),jsx=load('react/jsx-runtime');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app/bundles/preload/main.js'),'utf8'),start=source.indexOf('function EL({ariaLabel:'),end=source.indexOf('    var DL, XBt,',start);assert.ok(start>=0&&end>start);
test('Signal actual legacy menu component keeps right-click actions and body portal working',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});global.window=dom.window;global.document=dom.window.document;
 const noop=()=>{},context={AL:undefined,DL:React,kL:jsx,XBt:load('react-dom'),OL:{default:(...v)=>v.filter(Boolean).join(' ')},ZBt:{usePopper:()=>({styles:{popper:{}},attributes:{popper:{}}})},YBt:(x,y)=>({getBoundingClientRect:()=>({x,y})}),$Bt:noop,zD:()=>noop,eVt:noop,e_:name=>suffix=>name+suffix,n:{St:()=>''},document:dom.window.document};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);const root=createRoot(document.querySelector('#root'));t.after(()=>{flushSync(()=>root.unmount());dom.window.close()});let action=0;
 flushSync(()=>root.render(React.createElement(context.EL,{ariaLabel:'message actions',i18n:x=>x,portalToRoot:true,menuOptions:[{label:'Reply',onClick:()=>action++}],children:'message'})));
 flushSync(()=>document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:50})));
 const reply=document.querySelector('button[aria-label="Reply"]');assert.ok(reply,'Signal context menu rendered into body portal');flushSync(()=>reply.click());assert.equal(action,1);assert.equal(document.querySelector('button[aria-label="Reply"]'),null);
});
