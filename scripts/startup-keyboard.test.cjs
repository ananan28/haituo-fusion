'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadLayoutMap}=require('../src/app/js/haituo-startup-keyboard');
test('keyboard layout success preserves physical key labels',async()=>{const map=new Map([['KeyA','q']]);assert.equal(await loadLayoutMap({keyboard:{getLayoutMap:async()=>map}}),map)});
test('unavailable keyboard metadata does not prevent chat bootstrap',async()=>{const map=await loadLayoutMap({});assert.equal(map.get('KeyA')||'a','a')});
test('a never-resolving OS keyboard layout promise has a bounded fallback',async()=>{let fallback=0;const start=Date.now();const map=await loadLayoutMap({keyboard:{getLayoutMap:()=>new Promise(()=>{})}},{timeoutMs:15,onFallback:()=>fallback++});assert.equal(map.size,0);assert.equal(fallback,1);assert.ok(Date.now()-start<1000)});
test('keyboard layout rejection and invalid responses both fall back',async()=>{for(const getLayoutMap of [()=>{throw Error('denied')},async()=>{throw Error('denied')},async()=>null])assert.equal((await loadLayoutMap({keyboard:{getLayoutMap}})).size,0)});
