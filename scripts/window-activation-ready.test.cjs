'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {replayOnRendererReady}=require('../src/app/js/haituo-window-activation');
function fixture(){const webContents=new EventEmitter();webContents.isDestroyed=()=>false;return{webContents,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false}}
test('shown-before-preload window replays activation after renderer is ready',()=>{let count=0;const w=fixture();replayOnRendererReady(w,()=>count++);w.webContents.emit('dom-ready');assert.equal(count,1)});
test('hidden or minimized account never receives synthetic visibility activation',()=>{for(const kind of ['hidden','minimized','destroyed']){let count=0;const w=fixture();if(kind==='hidden')w.isVisible=()=>false;if(kind==='minimized')w.isMinimized=()=>true;if(kind==='destroyed')w.isDestroyed=()=>true;replayOnRendererReady(w,()=>count++);w.webContents.emit('dom-ready');assert.equal(count,0,kind)}});
test('reload replays readiness and disposal removes the hook',()=>{let count=0;const w=fixture(),dispose=replayOnRendererReady(w,()=>count++);w.webContents.emit('dom-ready');w.webContents.emit('dom-ready');assert.equal(count,2);dispose();w.webContents.emit('dom-ready');assert.equal(count,2)});
