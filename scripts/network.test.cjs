const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {translationTimeout,normalizeBadge,requestJSON,resolveSignalProxy,installWebRecovery}=require('../src/app/js/haituo-network.js');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
test('weak-network deadlines increase for long messages with bounded maximums',()=>{
  assert.equal(translationTimeout('openai','hello',10000),55000);
  assert.equal(translationTimeout('google-free','hello',4500),22000);
  assert.equal(translationTimeout('openai','a'.repeat(30000)),120000);
  assert.equal(translationTimeout('google-free','a'.repeat(30000)),45000);
});
test('translation transport uses the Chromium/system proxy stack',async()=>{
  let calls=0;const ctx={p:{session:{fromPartition:partition=>{assert.equal(partition,'haituo-service-network');return{fetch:async()=>{calls++;return 'ok'}}}}}};vm.createContext(ctx);
  const start=code.indexOf('async function haituoTranslationFetch'),end=code.indexOf('\nasync function Yp',start);
  vm.runInContext(code.slice(start,end),ctx);assert.equal(await ctx.haituoTranslationFetch('https://fixture.test'),'ok');assert.equal(calls,1);
});
test('one connection failure retries once and succeeds',async()=>{
  let calls=0,waits=[];const result=await requestJSON(async()=>{if(++calls===1)throw new TypeError('fetch failed');return new Response('{"text":"译文"}')},'https://fixture.test',{},100,async ms=>waits.push(ms));
  assert.equal(result.text,'译文');assert.equal(calls,2);assert.equal(waits.length,1);
});
test('deadline includes a stalled response body and retry remains bounded',async()=>{
  let calls=0;await assert.rejects(requestJSON(async(_url,{signal})=>{calls++;return{ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}},'https://fixture.test',{},5,async()=>{}),/超时，已重试一次/);assert.equal(calls,2);
});
test('401 and 429 do not retry or leak credential contents',async()=>{
  for(const status of [401,429]){let calls=0;await assert.rejects(requestJSON(async()=>{calls++;return new Response('{}',{status})},'https://fixture.test/v1/chat/completions',{headers:{Authorization:'Bearer SECRET'}},100,async()=>{}),error=>error.status===status&&!error.message.includes('SECRET'));assert.equal(calls,1);}
});
test('temporary 503 retries once; invalid JSON does not trigger duplicate billing',async()=>{
  let calls=0;await requestJSON(async()=>++calls===1?new Response('{}',{status:503}):new Response('{}'),'https://fixture.test',{},100,async()=>{});assert.equal(calls,2);
  calls=0;await assert.rejects(requestJSON(async()=>{calls++;return new Response('invalid')},'https://fixture.test',{},100,async()=>{}),SyntaxError);assert.equal(calls,1);
});
test('Signal respects explicit proxy then the first system/PAC route',async()=>{
  assert.equal(await resolveSignalProxy({resolveProxy:async()=>{throw Error('not expected')}},'https://chat.signal.org','http://explicit:9000'),'http://explicit:9000');
  assert.equal(await resolveSignalProxy({resolveProxy:async()=> 'PROXY localhost:7890; DIRECT'},'https://chat.signal.org'),'http://localhost:7890');
  assert.equal(await resolveSignalProxy({resolveProxy:async()=> 'DIRECT; PROXY localhost:7890'},'https://chat.signal.org'),undefined);
});
test('web login retries only top-level transient failures, keeps cache, and stops after 10',()=>{
  const contents=new EventEmitter();let reloads=0,timers=[],cancelled=new Set(),logs=[];contents.reload=()=>reloads++;contents.isDestroyed=()=>false;
  installWebRecovery(contents,{setTimeout(fn,delay){timers.push({fn,delay});return timers.length},clearTimeout(id){cancelled.add(id)}},message=>logs.push(message));
  contents.emit('did-fail-load',{},-105,'DNS','https://web.whatsapp.com',false);assert.equal(timers.length,0);
  contents.emit('did-fail-load',{},-202,'certificate','https://web.whatsapp.com',true);assert.equal(timers.length,0);
  for(let i=0;i<12;i++){contents.emit('did-start-loading');contents.emit('did-fail-load',{},-105,'DNS','https://web.whatsapp.com',true);contents.emit('did-finish-load');if(timers[i])timers[i].fn();}
  assert.equal(reloads,10);assert.deepEqual(timers.map(t=>t.delay),[5000,15000,30000,60000,120000,180000,240000,240000,240000,240000]);
  // Cap holds: further failures without an intervening successful load add nothing.
  contents.emit('did-start-loading');contents.emit('did-fail-load',{},-105,'DNS','https://web.whatsapp.com',true);contents.emit('did-finish-load');assert.equal(timers.length,10);
  // Once WhatsApp/Telegram has actually rendered, a later navigation failure
  // keeps the current page instead of throwing the chat back to its loading screen.
  contents.emit('did-start-loading');contents.emit('did-finish-load');contents.emit('did-fail-load',{},-105,'DNS','https://web.whatsapp.com',true);
  assert.equal(timers.length,10,'a rendered page is never auto-reloaded by a later navigation failure');
  assert.ok(logs.some(message=>/keeping the current page/.test(message)),'the skipped reload is logged');
  // A renderer crash clears the rendered state, so recovery arms again.
  contents.emit('render-process-gone');
  contents.emit('did-start-loading');contents.emit('did-fail-load',{},-105,'DNS','https://web.whatsapp.com',true);
  assert.equal(timers.length,11);assert.equal(timers[10].delay,5000);contents.emit('destroyed');assert.ok(cancelled.has(11));
});
test('web recovery also serves telegram hosts',()=>{
  const contents=new EventEmitter();let timers=[];contents.reload=()=>{};contents.isDestroyed=()=>false;
  installWebRecovery(contents,{setTimeout(fn,delay){timers.push({fn,delay});return timers.length},clearTimeout(){}});
  contents.emit('did-start-loading');contents.emit('did-fail-load',{},-105,'DNS','https://web.telegram.org/k/',true);
  assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);
});
test('badge supports default, Unicode, blank hiding, bounded size and literal markup',()=>{
  assert.equal(normalizeBadge(), 'SVIP');assert.equal(normalizeBadge(''), '');assert.equal(normalizeBadge('团队\nVIP'), '团队VIP');assert.equal(normalizeBadge('<b>VIP</b>'), '<b>VIP</b>');assert.equal([...normalizeBadge('😀'.repeat(30))].length,24);
});
test('long-message retry reuses successfully completed chunks',async()=>{
  const cache={},calls=[];let fail=true;
  const ctx={HaituoNetwork:{translationTimeout},haituoTranslationCacheKey:e=>e.text,loadHaituoTranslationCache:()=>cache,saveHaituoTranslationCache(){},haituoNaturalizeFreeTranslation:(_s,_t,out)=>out,
    Yp:async(_url,init)=>{const text=JSON.parse(init.body).messages.at(-1).content.split('Message to translate:\n').at(-1);calls.push(text);if(text.startsWith('B')&&fail)throw Error('network');return{choices:[{message:{content:'translated '+text[0]}}]}}};
  vm.createContext(ctx);
  let a=code.indexOf('function haituoSplitTranslationText('),b=code.indexOf('\nfunction haituoNaturalizeFreeTranslation',a);vm.runInContext(code.slice(a,b),ctx);
  a=code.indexOf('async function Xp(');b=code.indexOf('\nlet Zp',a);vm.runInContext(code.slice(a,b),ctx);
  // Xp's provider prompt places the source as the last user message.
  const req={text:'A'.repeat(1800)+'B'.repeat(1800)+'C'.repeat(20),provider:'openai',apiKey:'fixture',targetLanguage:'fr'};
  ctx.haituoCompatibleEndpoint=()=> 'https://fixture.test/v1/chat/completions';
  await assert.rejects(ctx.Xp(req),/network/);fail=false;const result=await ctx.Xp(req);
  assert.ok(result.text);assert.equal(calls.filter(t=>t.startsWith('A')).length,1);assert.equal(calls.filter(t=>t.startsWith('B')).length,2);assert.equal(calls.filter(t=>t.startsWith('C')).length,1);
});
test('market UI, IPC and remote endpoints are removed',()=>{
  const renderer=fs.readFileSync(__dirname+'/../src/app/bundles/preload/main.js','utf8');
  for(const source of [code,renderer])assert.doesNotMatch(source,/HaituoMarketTicker|haituoGetMarketTicker|caisheng:get-market-ticker|api\.coingecko|gold-api\.com|haituoLondonGold/);
});
test('all four target language selectors include the same 20 codes',()=>{
  const renderer=fs.readFileSync(__dirname+'/../src/app/bundles/preload/main.js','utf8'),web=fs.readFileSync(__dirname+'/../src/app/js/caisheng-webview-preload.js','utf8');
  const expected=['zh-CN','en','ja','ko','es','fr','de','it','pt','ru','ar','th','vi','id','ms','hi','tr','nl','pl','uk'];
  const native=code.match(/name="targetLanguage">(.*?)<\/select>/s)[1];assert.deepEqual([...native.matchAll(/value="([^"]+)"/g)].map(m=>m[1]),expected);
  for(const factory of ['u6','O9']){const list=renderer.match(new RegExp('children: \\[ \\(0, '+factory+'\\.jsx\\)\\(`option`, \\{ value: `zh-CN`[^\\n]+'))[0];assert.deepEqual([...list.matchAll(/value: `([^`]+)`/g)].map(m=>m[1]),expected);}
  const list=web.match(/for \(const \[e, t\] of (\[\[.*?\]\])\)/)[1];assert.deepEqual(JSON.parse(list).map(row=>row[0]),expected);
});

test('WhatsApp settings refresh preserves every selectable target language',async()=>{
  const web=fs.readFileSync(__dirname+'/../src/app/js/caisheng-webview-preload.js','utf8');
  const start=web.indexOf('async function refreshSettings()'),end=web.indexOf('\nasync function saveSettings',start);
  for(const target of ['zh-CN','en','ja','ko','es','fr','de','it','pt','ru','ar','th','vi','id','ms','hi','tr','nl','pl','uk']){
    const ctx={settings:{targetLanguage:'en'},ipcRenderer:{invoke:async()=>({targetLanguage:target})},haituoPendingValues:()=>({}),applyChatColor(){},applyTranslatorTheme(){},haituoSyncOutgoingControls(){}};
    vm.createContext(ctx);vm.runInContext(web.slice(start,end),ctx);await ctx.refreshSettings();assert.equal(ctx.settings.targetLanguage,target);
  }
});

test('hover preview never calls chat navigation, focus, or read receipt APIs',()=>{
  const web=fs.readFileSync(__dirname+'/../src/app/js/caisheng-webview-preload.js','utf8');
  const source=web.slice(web.indexOf('// HAITUO_CHAT_PREVIEW_START'),web.indexOf('// HAITUO_CHAT_PREVIEW_END'));
  assert.doesNotMatch(source,/\.click\(|\.focus\(|sendRead|markRead|markAsRead|loadURL|location\s*=/);
  assert.ok(source.includes('delayMs = 650'));assert.ok(source.includes('pending.size'));assert.ok(source.includes('cache.size>128'));
});
