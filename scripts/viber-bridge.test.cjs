'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createBridge}=require('../src/app/js/haituo-viber-bridge');
function fixture(options={}){
 const children=[],events=[],saved=[];let box={x:20,y:40,width:1200,height:900};
 function spawn(){const proc=new EventEmitter;proc.stdout=new EventEmitter;proc.stdout.setEncoding=()=>{};proc.stderr=new EventEmitter;proc.stdin=new EventEmitter;proc.stdin.writable=true;proc.commands=[];proc.stdin.write=line=>proc.commands.push(JSON.parse(line));proc.stdin.end=()=>proc.emit('exit',0);proc.kill=()=>{proc.killed=true;proc.emit('exit',1)};children.push(proc);return proc}
 const bridge=createBridge({binary:'/synthetic/helper',platform:'darwin',spawn,exists:()=>true,readAccounts:()=>({}),saveAccounts:value=>saved.push(value),hostBounds:()=>box,onEvent:event=>events.push(event),recognize:async()=>({original:'synthetic OCR'}),...options});
 function send(value,proc=children.at(-1)){proc.stdout.emit('data',JSON.stringify(value)+'\n')}
 return{bridge,children,events,saved,send,setBox(value){box=value}};
}
const image=Buffer.from('synthetic pixels').toString('base64');
function frame(epoch,slot=1){return{type:'frame',epoch,slot,image,width:8,height:8}}
test('Viber frame and state routing rejects stale epoch and wrong account slot',()=>{
 const x=fixture();try{const a=x.bridge.select('viber-a'),b=x.bridge.select('viber-b');x.events.length=0;
 x.send(frame(a.epoch,1));x.send(frame(b.epoch,1));assert.equal(x.events.length,0);
 x.send(frame(b.epoch,2));assert.equal(x.events[0].accountId,'viber-b');
 x.send({type:'state',epoch:b.epoch,slot:0,ready:false,status:'synthetic alignment error'});assert.equal(x.events.at(-1).status,'synthetic alignment error');
 }finally{x.bridge.close()}
});
test('old pane cleanup cannot hide a newer selection or forward its clicks',()=>{
 const x=fixture();try{const a=x.bridge.select('viber-a'),b=x.bridge.select('viber-b');const count=x.children[0].commands.length;x.bridge.hide('viber-a',a.epoch);assert.equal(x.children[0].commands.length,count);
 x.send({type:'state',epoch:b.epoch,slot:2,ready:true});assert.equal(x.bridge.click('viber-a',a.epoch,.5,.5),false);assert.equal(x.bridge.click('viber-b',b.epoch,.5,.5),true);
 assert.throws(()=>x.bridge.click('viber-b',b.epoch,2,.5),/坐标/);
 }finally{x.bridge.close()}
});
test('OCR result is discarded after account selection changes',async()=>{
 let release;const x=fixture({recognize:()=>new Promise(resolve=>{release=resolve})});try{const a=x.bridge.select('viber-a');x.send(frame(a.epoch));x.send({type:'state',epoch:a.epoch,slot:1,ready:true});const pending=x.bridge.ocr('viber-a',a.epoch);x.bridge.select('viber-b');release({original:'old synthetic OCR'});await assert.rejects(pending,/账号已切换/)}finally{x.bridge.close()}
});
test('five reserved account directories never get reassigned after tab removal',()=>{
 const x=fixture();try{for(let i=0;i<5;i++){const selected=x.bridge.select('viber-'+i);x.bridge.hide('viber-'+i,selected.epoch)}assert.throws(()=>x.bridge.select('viber-other'),/五个/);assert.equal(Object.keys(x.saved.at(-1)).length,5)}finally{x.bridge.close()}
});
test('native helper restart ignores old stdout and requires new Ready',()=>{
 const x=fixture();try{const a=x.bridge.select('viber-a'),old=x.children[0];old.emit('exit',1);const b=x.bridge.select('viber-a');x.events.length=0;x.send(frame(b.epoch),old);assert.equal(x.events.length,0);assert.equal(x.bridge.click('viber-a',b.epoch,.1,.1),false);x.send(frame(b.epoch));x.send({type:'state',epoch:b.epoch,slot:1,ready:true});assert.equal(x.bridge.click('viber-a',b.epoch,.1,.1),true)}finally{x.bridge.close()}
});
test('unsupported OS and invalid host geometry cannot reserve accounts or launch helpers',()=>{
 const unsupported=fixture({platform:'win32'});assert.throws(()=>unsupported.bridge.select('viber-a'),/macOS/);assert.equal(unsupported.saved.length,0);unsupported.bridge.close();
 const invalid=fixture();invalid.setBox(null);assert.throws(()=>invalid.bridge.select('viber-a'),/几何/);assert.equal(invalid.children.length,0);invalid.bridge.close();
});
