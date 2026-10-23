'use strict';
// Regression tests for MEDIA-01: the WhatsApp/Telegram webview session used
// to deny every permission except notifications, so voice recording (an
// audio-only getUserMedia right after the user clicks record) always failed.
// The handler must approve audio-only media requests that follow a recent
// user gesture and keep video / gestureless probes denied.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
const start=code.indexOf('function haituoMediaPermissionHandler');
const end=code.indexOf('Z.webContents.on(`will-attach-webview`',start);
assert.ok(start>=0&&end>start,'media permission handler slice found');
const slice=code.slice(start,end);

const ctx={console,Date,Number};
vm.createContext(ctx);
vm.runInContext(slice,ctx);
const handler=ctx.haituoMediaPermissionHandler;
assert.equal(typeof handler,'function');

function ask(webContents,permission,details){
  let answer;
  handler(webContents,permission,value=>{answer=value},details);
  return answer;
}

test('notifications stay approved',()=>{
  assert.equal(ask({},'notifications'),true);
  assert.equal(ask({haituoLastGestureAt:Date.now()},'notifications'),true);
});

test('audio-only media after a recent gesture is approved',()=>{
  const webContents={haituoLastGestureAt:Date.now()-2000};
  assert.equal(ask(webContents,'media',{mediaTypes:['audio']}),true);
});

test('media without a gesture is denied',()=>{
  assert.equal(ask({},'media',{mediaTypes:['audio']}),false,'no gesture at all');
  assert.equal(ask({haituoLastGestureAt:Date.now()-60000},'media',{mediaTypes:['audio']}),false,'stale gesture outside the 8s window');
});

test('video (or audio+video) is always denied',()=>{
  const webContents={haituoLastGestureAt:Date.now()};
  assert.equal(ask(webContents,'media',{mediaTypes:['video']}),false);
  assert.equal(ask(webContents,'media',{mediaTypes:['audio','video']}),false);
});

test('unknown permissions stay denied',()=>{
  assert.equal(ask({haituoLastGestureAt:Date.now()},'geolocation'),false);
  assert.equal(ask({haituoLastGestureAt:Date.now()},'midiSysex'),false);
});
