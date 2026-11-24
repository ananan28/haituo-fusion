'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-first-send-')),file=path.join(dir,'renderer.js');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
fs.copyFileSync('src/app/bundles/preload/main.js',file);
cp.execFileSync(process.platform==='win32'?'python':'python3',['scripts/stage_signal_first_send.py',file]);
const source=fs.readFileSync(file,'utf8');
function fromBundle(name,next,context){const a=source.indexOf('async function '+name+'('),b=source.indexOf(next,a);assert(a>=0&&b>a);return vm.runInNewContext('('+source.slice(a,b).trim()+')',context)}
const tick=()=>new Promise(r=>setImmediate(r));
function gate(){let release;const promise=new Promise(r=>release=r);return {promise,release}}
test('phone lookup cannot open a new conversation until both its first save and contact merge finish',async()=>{
 const save=gate(),merge=gate(),states=[];
 const lookup=fromBundle('e6n','async function t6n',{uW(){},ILt:async()=>({entries:new Map([['number',{aci:'test'}]]),transformedE164s:new Map()}),window:{ConversationController:{maybeMergeContacts:()=>({conversation:{id:'current',initialPromise:save.promise},mergePromises:[merge.promise]})}}});
 const pending=lookup({type:'e164',e164:'number',setIsFetchingUUID:(_,v)=>states.push(v)});await tick();merge.release();await tick();assert.deepEqual(states,[true]);save.release();assert.equal(await pending,'current');assert.deepEqual(states,[true,false]);
});
test('username lookup does not persist the username over a pending first insert',async()=>{
 const first=gate(),events=[];
 const contact={id:'id',initialPromise:first.promise,updateUsername:async()=>events.push('updated')};
 const lookup=fromBundle('e6n','async function t6n',{t:{Ri:assert.ok},t6n:async()=>({aci:'new',username:'test'}),window:{ConversationController:{get:()=>null,lookupOrCreate:()=>contact}}});
 const pending=lookup({type:'username',username:'test',setIsFetchingUUID:()=>{}});await tick();assert.deepEqual(events,[]);first.release();assert.equal(await pending,'id');assert.deepEqual(events,['updated']);
});
function send(status,destinations=[],sent=[],opts={}){
 const saved=gate(),errors=[],wire=[],log={info(){},warn(){},error(){}},conversation={id:'peer',attributes:{type:'private'},get:k=>k==='type'?'private':null,getExpireTimerVersion:()=>1,queueJob:(_,f)=>f()};
 const f={attributes:{},get:k=>k==='conversationId'?'peer':null};
 const context={lj:async({toThrow})=>{throw toThrow},Fp:async()=>f,window:{ConversationController:{get:()=>conversation}},Wt:()=>false,Yr:()=>true,LA:()=>8,Swt:()=>8,Wwt:()=>({allRecipientServiceIds:destinations,recipientServiceIdsWithoutMe:destinations,sentRecipientServiceIds:sent,untrustedServiceIds:[]}),Kt:()=>true,qt:()=>false,QN:()=>({peer:{status}}),Zh:{Pending:'Pending'},_j:()=>[!opts.blocked,opts.blocked?{error:Error('Contact is blocked')}:undefined],nP:async value=>{errors.push(value.errors[0].message);await saved.promise},Gwt:async()=>({}),Wp:async()=>({}),Kp:p=>p,Iwt:(_,{promise})=>promise,Qwt:()=>true,y:{ContentHint:{Resendable:1}}};
 const fn=fromBundle('Uwt','function Wwt',context);
 const done=fn(conversation,{isFinalAttempt:false,messaging:{sendMessageToServiceId:async({serviceId})=>wire.push(serviceId)},shouldContinue:true,timeRemaining:1e4,log},{messageId:'msg'});
 return {saved,errors,wire,done};
}
test('unresolved pending direct message waits for failure persistence, without sending or duplicating',async()=>{
 for(const blocked of [false,true]){
  const x=send('Pending',[],[],{blocked});let finished=false;x.done.then(()=>finished=true);await tick();
  assert.deepEqual(x.errors,[blocked?'Contact is blocked':'No valid recipients']);assert.deepEqual(x.wire,[]);assert.equal(finished,false);
  x.saved.release();await x.done;assert.equal(finished,true);
 }
});
test('an already sent message is not failed or sent again; a valid pending destination is submitted once',async()=>{
 const old=send('Sent',[],['peer']);await old.done;assert.deepEqual(old.errors,[]);assert.deepEqual(old.wire,[]);
 const valid=send('Pending',['peer']);await valid.done;assert.deepEqual(valid.errors,[]);assert.deepEqual(valid.wire,['peer']);
});
test('a failed first insert on a known username returns no conversation and clears the busy indicator',async()=>{
 const busy=[],toasts=[];
 const lookup=fromBundle('e6n','async function t6n',{n6n:{error(){}},t:{Aa:()=>''},U:{FailedToFetchUsername:'failed'},window:{ConversationController:{get:()=>({id:'not-saved',getServiceId:()=>true,get initialPromise(){return Promise.reject(Error('write failed'))}})},reduxActions:{toast:{showToast:({toastType})=>toasts.push(toastType)}}}});
 assert.equal(await lookup({type:'username',username:'test',setIsFetchingUUID:(_,v)=>busy.push(v)}),undefined);assert.deepEqual(busy,[true,false]);assert.deepEqual(toasts,['failed']);
});
