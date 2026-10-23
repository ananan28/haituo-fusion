'use strict';
// VOICE-05: the page-side capture hook used to convert every audio blob to a
// data URL for the whole page lifetime, keeping up to 12 entries of up to
// 100MB. It now only records while a capture is active, caps total retained
// data, and is cleared when the capture ends.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');

function extract(startNeedle,closeNeedle){
  const at=code.indexOf(startNeedle);
  assert.ok(at>=0,'hook source found: '+startNeedle);
  const open=code.lastIndexOf('executeJavaScript(`',at);
  assert.ok(open>=0,'executeJavaScript call found for '+startNeedle);
  const bodyStart=open+'executeJavaScript(`'.length;
  const close=code.indexOf(closeNeedle,at);
  assert.ok(close>bodyStart,'closing call found for '+startNeedle);
  return code.slice(bodyStart,close);
}

const installScript=extract('window.__haituoVoiceBlobHook=!0','`, !0).catch');
const cleanupScript=extract('window.__haituoVoiceCaptureActive=!1','`, !0)');

function makePage(){
  const win={};
  const nativeCalls=[];
  let nextId=0;
  const URL={
    createObjectURL(blob){nativeCalls.push(blob);return 'blob:native-'+(++nextId)},
    revokeObjectURL(){},
  };
  class Blob{
    constructor(size,type,dataUrlLength=1200){this.size=size;this.type=type;this.dataUrlLength=dataUrlLength}
  }
  class FileReader{
    readAsDataURL(blob){
      const prefix='data:'+(blob.type||'application/octet-stream')+';base64,';
      this.result=prefix+'A'.repeat(Math.max(0,(blob.dataUrlLength||1200)-prefix.length));
      this.onload?.();
    }
  }
  const ctx=vm.createContext({window:win,URL,Blob,FileReader,String,Date,Number});
  return {win,URL,...{run:script=>vm.runInContext(script,ctx)},nativeCalls,Blob,ctx};
}

function audio(page,length=1200,size=8192,type='audio/ogg'){
  return new page.Blob(size,type,length);
}

test('the hook records only while a capture is active and stops after cleanup',()=>{
  const page=makePage();
  page.run(installScript);
  assert.equal(page.win.__haituoVoiceCaptureActive,true,'capture start arms the hook');
  page.URL.createObjectURL(audio(page));
  assert.equal(page.win.__haituoVoiceBlobs.length,1,'active capture records an audio data URL');
  page.run(cleanupScript);
  assert.equal(page.win.__haituoVoiceCaptureActive,false);
  assert.equal(page.win.__haituoVoiceBlobs.length,0,'finished capture releases retained audio');
  assert.equal(page.win.__haituoVoiceBlobBytes,0);
  page.URL.createObjectURL(audio(page));
  assert.equal(page.win.__haituoVoiceBlobs.length,0,'background audio is no longer converted while idle');
  page.run(installScript);
  assert.equal(page.win.__haituoVoiceCaptureActive,true,'a later capture re-arms the already-installed hook');
  page.URL.createObjectURL(audio(page));
  assert.equal(page.win.__haituoVoiceBlobs.length,1);
  assert.equal(page.nativeCalls.length,3,'createObjectURL is always passthrough');
});

test('the hook ignores non-audio and oversized blobs and bounds retention',()=>{
  const page=makePage();
  page.run(installScript);
  page.URL.createObjectURL(new page.Blob(8192,'video/mp4'));
  page.URL.createObjectURL(new page.Blob(104857601,'audio/ogg'));
  page.URL.createObjectURL(new page.Blob(64,'audio/ogg'));
  assert.equal(page.win.__haituoVoiceBlobs.length,0,'only plausible voice blobs are recorded');
  for(let i=0;i<9;i++)page.URL.createObjectURL(audio(page,1200));
  assert.ok(page.win.__haituoVoiceBlobs.length<=6,'retained entries are capped');
  const before=page.win.__haituoVoiceBlobs.length;
  page.URL.createObjectURL(audio(page,27*1024*1024));
  assert.equal(page.win.__haituoVoiceBlobs.length,before,'the total retained bytes are capped');
});
