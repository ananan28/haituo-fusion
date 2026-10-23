'use strict';
// Regression tests for VOICE-01..04.
// VOICE-01: the transcription endpoint must be HTTPS, except plaintext HTTP
// on a loopback host (local whisper servers) — never a remote http:// URL
// carrying the Authorization header and audio in cleartext.
// VOICE-02/03/04: the voice blob hook captures audio-MIME blobs only, resets
// its queue per capture session, and bounds the queue with a TTL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');

const start=code.indexOf('function haituoIsLoopbackHost');
const end=code.indexOf('function haituoBroadcastTranslationConfig',start);
assert.ok(start>=0&&end>start,'voice helper slice found');
const ctx={URL,String,Date,console};
vm.createContext(ctx);
vm.runInContext(code.slice(start,end),ctx);

test('https endpoints are accepted and normalized',()=>{
  assert.equal(ctx.haituoValidateVoiceEndpoint('https://api.openai.com/v1'),'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(ctx.haituoValidateVoiceEndpoint('https://api.openai.com/v1/audio/transcriptions'),'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(ctx.haituoValidateVoiceEndpoint('https://api.openai.com/v1/chat/completions/'),'https://api.openai.com/v1/audio/transcriptions');
});

test('plaintext http is rejected for remote hosts',()=>{
  for(const url of ['http://api.openai.com/v1','http://whisper.example.com:8080/v1','http://192.168.1.20/v1','http://[::ffff:7f00:1]/v1']){
    assert.throws(()=>ctx.haituoValidateVoiceEndpoint(url),/仅支持 HTTPS/u,url);
  }
});

test('plaintext http is accepted only on loopback',()=>{
  assert.equal(ctx.haituoValidateVoiceEndpoint('http://localhost:8080/v1'),'http://localhost:8080/v1/audio/transcriptions');
  assert.equal(ctx.haituoValidateVoiceEndpoint('http://127.0.0.1:8080'),'http://127.0.0.1:8080/audio/transcriptions');
  assert.equal(ctx.haituoValidateVoiceEndpoint('http://127.3.4.5/v1'),'http://127.3.4.5/v1/audio/transcriptions');
  assert.equal(ctx.haituoValidateVoiceEndpoint('http://[::1]:9000/v1'),'http://[::1]:9000/v1/audio/transcriptions');
  assert.equal(ctx.haituoIsLoopbackHost('LOCALHOST'),true,'case-insensitive');
  assert.equal(ctx.haituoIsLoopbackHost('127.0.0.1'),true);
  assert.equal(ctx.haituoIsLoopbackHost('127.255.255.254'),true);
  assert.equal(ctx.haituoIsLoopbackHost('::1'),true);
  assert.equal(ctx.haituoIsLoopbackHost('126.0.0.1'),false);
  assert.equal(ctx.haituoIsLoopbackHost('1278.0.0.1'),false);
  assert.equal(ctx.haituoIsLoopbackHost('localhost.evil.com'),false);
});

test('userinfo, query and fragment are rejected on any scheme',()=>{
  assert.throws(()=>ctx.haituoValidateVoiceEndpoint('https://user:pass@api.openai.com/v1'),/仅支持 HTTPS/u);
  assert.throws(()=>ctx.haituoValidateVoiceEndpoint('https://api.openai.com/v1?key=1'),/仅支持 HTTPS/u);
  assert.throws(()=>ctx.haituoValidateVoiceEndpoint('https://api.openai.com/v1#frag'),/仅支持 HTTPS/u);
  assert.throws(()=>ctx.haituoValidateVoiceEndpoint('ftp://api.openai.com/v1'),/仅支持 HTTPS/u);
});

// The blob hook ships to the page as a string; execute the real string in a
// vm page harness so the exact production code runs (VOICE-02/03/04).
const hookStart=code.indexOf('(()=>{try{window.__haituoVoiceCaptureActive=!0;window.__haituoVoiceBlobs=[];');
assert.ok(hookStart>=0,'blob hook script found');
let hookEnd=hookStart, depth=0;
for(let i=hookStart;i<code.length;i+=1){
  const ch=code[i];
  if(ch==='('||ch==='{'||ch==='[')depth+=1;
  if(ch===')'||ch==='}'||ch==']')depth-=1;
  if(depth===0){hookEnd=i+1;break}
}
const hookScript=code.slice(hookStart,hookEnd)+(code.slice(hookEnd,hookEnd+2)==='()'?'()':'');

function makePage(){
  const store={};
  class Blob{constructor(parts=[],opts={}){this.type=opts.type||'';this.size=opts.size??parts.reduce((n,p)=>n+String(p).length,0)}}
  class FileReader{
    readAsDataURL(blob){this.result=`data:${blob.type||'application/octet-stream'};base64,AAAA`;this.onload&&this.onload()}
  }
  const URL={createObjectURL:()=>'blob:mock'};
  const window={};
  const page={Blob,FileReader,URL,window,String,Date,JSON};
  vm.createContext(page);
  vm.runInContext(`const native=URL.createObjectURL.bind(URL);`+hookScript.replace('URL.createObjectURL=function','window.hookedCreateObjectURL=function'),page);
  return page;
}

test('blob hook captures audio blobs only (VOICE-02)',()=>{
  const page=makePage();
  vm.runInContext(`window.hookedCreateObjectURL(new Blob())`,page);
  vm.runInContext(`window.hookedCreateObjectURL(new Blob(['x'.repeat(999)],{type:'image/png'}))`,page);
  vm.runInContext(`window.hookedCreateObjectURL(new Blob(['x'.repeat(999)],{type:'audio/ogg'}))`,page);
  vm.runInContext(`window.hookedCreateObjectURL(new Blob([1],{type:'audio/ogg'}))`,page);
  const list=vm.runInContext(`window.__haituoVoiceBlobs`,page);
  assert.equal(list.length,1,'only the large audio blob is captured');
  assert.equal(list[0].mimeType,'audio/ogg');
});

test('re-running the hook resets the stale queue (VOICE-03)',()=>{
  const page=makePage();
  vm.runInContext(`window.hookedCreateObjectURL(new Blob(['x'.repeat(999)],{type:'audio/ogg'}))`,page);
  assert.equal(vm.runInContext(`window.__haituoVoiceBlobs.length`,page),1);
  // Second capture session re-executes the hook script with the guard present:
  // the early return keeps the ORIGINAL hook installed but must still reset the queue.
  vm.runInContext(`const native2=URL.createObjectURL.bind(URL);`+hookScript.replace('URL.createObjectURL=function','window.hooked2=function'),page);
  assert.equal(vm.runInContext(`window.__haituoVoiceBlobs.length`,page),0,'queue cleared even though the hook stays installed');
  assert.equal(vm.runInContext(`typeof window.hooked2`,page),'undefined','guard prevents reinstalling the hook');
  vm.runInContext(`window.hookedCreateObjectURL(new Blob(['x'.repeat(999)],{type:'audio/webm'}))`,page);
  assert.equal(vm.runInContext(`window.__haituoVoiceBlobs.length`,page),1,'original hook keeps working for the new session');
});

test('the queue is bounded to 6 entries (VOICE-04)',()=>{
  const page=makePage();
  vm.runInContext(`for(let i=0;i<20;i+=1)window.hookedCreateObjectURL(new Blob(['x'.repeat(999)],{type:'audio/ogg'}))`,page);
  assert.equal(vm.runInContext(`window.__haituoVoiceBlobs.length`,page),6);
  assert.equal(vm.runInContext(`window.__haituoVoiceBlobs[0].dataUrl`,page).includes('AAAA'),true);
});
