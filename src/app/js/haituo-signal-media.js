'use strict';
// A partition has its own protocol registry. Serve account files in the backend
// that owns their keys, with pull-based IPC (never buffer an entire video).
const {randomUUID}=require('node:crypto');
const CHANNEL='haituo-signal-media-v1';
const SCHEMES=new Set(['attachment','asset','emoji']);
function createRegistry(){
 const handlers=new Map();
 return {handlers,handle(protocol,scheme,handler){if(!SCHEMES.has(scheme))throw Error('Unsupported media scheme');const result=protocol.handle(scheme,handler);handlers.set(scheme,handler);return result;}};
}
function serve(endpoint,handlers){
 const streams=new Map();
 const send=message=>new Promise((resolve,reject)=>{if(!endpoint.connected)return reject(Error('Backend disconnected'));endpoint.send({type:CHANNEL,...message},error=>error?reject(error):resolve());});
 const close=id=>{const state=streams.get(id);streams.delete(id);state?.abort.abort();state?.reader?.cancel().catch(()=>{});};
 const listener=async message=>{
  if(message?.type!==CHANNEL||message.side!=='request'||typeof message.id!=='string')return;
  const {id,op}=message;
  try{
   if(op==='cancel'){close(id);return;}
   if(op==='open'){
    if(streams.has(id)||streams.size>=128)throw Error('Media request limit');
    const url=new URL(message.url),scheme=url.protocol.slice(0,-1),handler=handlers.get(scheme);
    if(!SCHEMES.has(scheme)||!handler||!['GET','HEAD'].includes(message.method))throw Error('Invalid media request');
    const state={abort:new AbortController(),reader:null};streams.set(id,state);
    const response=await handler(new Request(url,{method:message.method,headers:message.headers,signal:state.abort.signal}));
    if(streams.get(id)!==state){await response.body?.cancel();return;}
    state.reader=response.body?.getReader();state.remainder=null;
    await send({side:'response',id,op:'headers',status:response.status,headers:[...response.headers]});
   }else if(op==='pull'){
    const state=streams.get(id);if(!state||state.reading)throw Error('Invalid media stream');state.reading=true;
    let value=state.remainder,done=false;
    if(!value){const result=state.reader?await state.reader.read():{done:true};value=result.value;done=result.done;}
    if(streams.get(id)!==state)return;
    if(done){streams.delete(id);await send({side:'response',id,op:'end'});return;}
    // Bound every IPC frame even when the underlying reader returns a huge buffer.
    const chunk=value.subarray(0,65536);state.remainder=value.length>chunk.length?value.subarray(chunk.length):null;
    state.reading=false;await send({side:'response',id,op:'chunk',data:Buffer.from(chunk)});
   }
  }catch{close(id);await send({side:'response',id,op:'error'}).catch(()=>{});}
 };
 endpoint.on('message',listener);endpoint.once('disconnect',()=>{for(const id of streams.keys())close(id)});
 return {close(){endpoint.removeListener('message',listener);for(const id of streams.keys())close(id)}};
}
function install(session,child){
 const requests=new Map();let disposed=false;
 function send(message){if(disposed||!child.connected)throw Error('Media backend unavailable');child.send({type:CHANNEL,side:'request',...message},error=>{if(error)fail(message.id)});}
 function finish(id){const state=requests.get(id);if(!state)return;clearTimeout(state.timer);state.signal?.removeEventListener('abort',state.abort);requests.delete(id);return state;}
 function fail(id){const state=finish(id);if(!state)return;const error=Error('Signal media unavailable');state.reject(error);state.pullReject?.(error);state.controller?.error(error);}
 function arm(id){const state=requests.get(id);clearTimeout(state.timer);state.timer=setTimeout(()=>{try{send({id,op:'cancel'})}catch{}fail(id)},30000);state.timer.unref?.();}
 const listener=message=>{
  if(message?.type!==CHANNEL||message.side!=='response')return;
  const state=requests.get(message.id);if(!state)return;
  clearTimeout(state.timer);
  if(message.op==='headers'){
   const noBody=state.method==='HEAD'||[204,205,304].includes(message.status);
   if(noBody){finish(message.id);try{send({id:message.id,op:'cancel'})}catch{}state.resolve(new Response(null,{status:message.status,headers:message.headers}));return;}
   const body=new ReadableStream({start(controller){state.controller=controller},pull(){return new Promise((resolve,reject)=>{state.pullResolve=resolve;state.pullReject=reject;arm(message.id);try{send({id:message.id,op:'pull'})}catch{fail(message.id)}})},cancel(){finish(message.id);try{send({id:message.id,op:'cancel'})}catch{}}},{highWaterMark:0});
   state.resolve(new Response(body,{status:message.status,headers:message.headers}));
  }else if(message.op==='chunk'){
   state.controller.enqueue(new Uint8Array(message.data));const done=state.pullResolve;state.pullResolve=null;state.pullReject=null;done?.();
  }else if(message.op==='end'){
   finish(message.id);state.controller.close();state.pullResolve?.();
  }else if(message.op==='error')fail(message.id);
 };
 child.on('message',listener);
 const unavailable=()=>{for(const id of requests.keys())fail(id)};
 child.on('exit',unavailable);child.on('disconnect',unavailable);
 for(const scheme of SCHEMES)session.protocol.handle(scheme,request=>new Promise((resolve,reject)=>{
  if(disposed||request.signal?.aborted)return reject(Error('Media request cancelled'));
  const id=randomUUID(),state={resolve,reject,method:request.method,signal:request.signal};
  state.abort=()=>{try{send({id,op:'cancel'})}catch{}fail(id)};requests.set(id,state);request.signal?.addEventListener('abort',state.abort,{once:true});arm(id);
  try{send({id,op:'open',url:request.url,method:request.method,headers:[...request.headers]})}catch{fail(id)}
 }));
 return {dispose(){if(disposed)return;for(const id of requests.keys()){try{send({id,op:'cancel'})}catch{}fail(id)}disposed=true;child.removeListener('message',listener);child.removeListener('exit',unavailable);child.removeListener('disconnect',unavailable);for(const scheme of SCHEMES)session.protocol.unhandle(scheme);}};
}
module.exports={createRegistry,serve,install};
