'use strict';
// Real Chromium renderer / synthetic message data. Never claims a linked-account test.
module.exports=async function verifyResidentNative(installResident,installHooks,keepPosition){
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:12px;top:12px;width:760px;height:540px;z-index:2147483647;border:0';document.body.append(frame);
 const w=frame.contentWindow,d=w.document;d.open();d.write('<!doctype html><style>body{margin:0;font:14px Arial;background:#161717;color:white}header,footer{height:40px}#native{height:420px;overflow:auto}.message-in{height:100px;box-sizing:border-box;padding:8px}</style><main id="main"><header>Native synthetic WhatsApp fixture</header><div id="native"></div><footer><button>Native send</button></footer></main>');d.close();
 const native=d.querySelector('#native'),footer=d.querySelector('footer'),tick=()=>new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve))),assert=(ok,why)=>{if(!ok)throw Error(why)};
 const rawRemove=w.Node.prototype.removeChild;const shadowMap=new WeakMap,attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=Reflect.apply(attach,this,[options]);shadowMap.set(this,root);return root};
 const data=Array.from({length:1000},(_,n)=>({id:'false_123@c.us_'+n,source:'Original '+n,text:'已保存译文 '+n})),bySource=new Map(data.map(row=>[row.source,row]));data[0].source='Long English original message '.repeat(180);bySource.delete('Original 0');bySource.set(data[0].source,data[0]);let calls=0,reads=0,view,alive=true;const frames=[];
 const ipc={async invoke(method,request){if(method==='haituo:wa-cache-flush')return true;if(method==='haituo:wa-cache-warm')return{entries:[],next:null};if(method==='haituo:wa-cache-lookup'){reads++;return request.sources.map(source=>{const row=bySource.get(source);return{source,state:row?'hit':'empty',text:row?.text}})}throw Error('Unexpected IPC '+method)}};
 function show(rows){const fragment=d.createDocumentFragment();for(const row of rows){const node=d.createElement('article');node.className='message-in';node.setAttribute('data-id',row.id);const text=d.createElement('span');text.className='selectable-text';text.textContent=row.source;node.append(text);fragment.append(node)}native.replaceChildren(fragment)}
 function sample(at){if(!alive)return;let bare=0;for(const row of native.querySelectorAll('[data-id]')){const source=row.querySelector('.selectable-text'),slot=row.querySelector('.ht-translation-slot'),known=bySource.has(source.textContent),protectedOriginal=w.getComputedStyle(source).visibility==='hidden',hasTranslation=slot?.dataset.htState==='hit'&&slot?.dataset.translationCacheHit==='true'&&row.dataset.translationCacheHit==='true'&&!!shadowMap.get(slot)?.textContent;if(known&&!hasTranslation&&!protectedOriginal)bare++}frames.push({at,messageCount:native.children.length,bare,translationRequests:calls});w.requestAnimationFrame(sample)}
 try{
  view=installResident({document:d,window:w,ipc,targetFor:()=> 'zh-CN',keepPosition,translate:async()=>{calls++;throw Error('Cached synthetic message made an unexpected API call')},installMainWorld:()=>installHooks({document:d,window:w})});
  w.requestAnimationFrame(sample);show(data.slice(0,40));const first=native.firstElementChild;await tick();assert(native.firstElementChild===first&&d.querySelector('footer')===footer,'Native messages/controls were replaced');assert(shadowMap.get(first.querySelector('.ht-translation-slot')).textContent==='已保存译文 0','New resident renderer did not display saved translation');
  assert(first.textContent===data[0].source,'Translation contaminated native textContent');assert(first.cloneNode(true).textContent===data[0].source,'Translation contaminated native cloned text');
  native.scrollTop=1200;await tick();const before=native.scrollTop;await view.observe();await tick();assert(native.scrollTop===before,'Read-only resident observation moved scroll position');
  for(let start=40;start<1000;start+=40){show(data.slice(start,start+40));await tick();for(const row of native.children)assert(row.querySelector('.ht-translation-slot')?.dataset.htState==='hit','History page missing translation')}
  for(let start=960;start>=0;start-=80){show(data.slice(start,start+40));await tick()}
  // Recycle existing WhatsApp-like rows, strip hosts through both wrapped
  // APIs and raw native calls, and alternate rapid scroll directions.
  // All sources are already cached: no network lookup/retranslation is allowed.
  const readsBeforeRecycle=reads;let recycledRemovals=0;
  show(data.slice(0,40));await tick();const pool=[...native.children];
  for(let cycle=0;cycle<12;cycle++){
   const offset=cycle%2?920:0;
   for(const [index,node] of pool.entries()){
    const row=data[offset+index];node.setAttribute('data-id',row.id);node.querySelector('.selectable-text').textContent=row.source;
    const slot=node.querySelector('.ht-translation-slot');assert(slot?.dataset.htState==='hit','Recycled node missing synchronous cached slot');
    slot.remove();recycledRemovals++;assert(node.querySelector('.ht-translation-slot')?.dataset.translationCacheHit==='true','remove() returned with a missing cached slot');
    const mounted=node.querySelector('.ht-translation-slot');Reflect.apply(rawRemove,mounted.parentNode,[mounted]);
   }
   native.scrollTop=cycle%2?0:native.scrollHeight;native.dispatchEvent(new w.Event('scroll',{bubbles:true}));native.dispatchEvent(new w.WheelEvent('wheel',{deltaY:cycle%2?-10000:10000,bubbles:true}));
   await tick();for(const node of pool)assert(node.querySelector('.ht-translation-slot')?.dataset.translationCacheHit==='true','Rapid scroll lost cached host');
  }
  for(const node of pool){node.replaceChildren(...[...node.childNodes].map(child=>child.cloneNode(true)));const slot=node.querySelector('.ht-translation-slot');assert(node.querySelectorAll('.ht-translation-slot').length===1&&!!shadowMap.get(slot)?.textContent,'Cloned shell replaced live closed-shadow translation')}
  native.dispatchEvent(new w.Event('scrollend',{bubbles:true}));await new Promise(resolve=>w.setTimeout(resolve,140));await tick();
  for(const node of pool)assert(node.dataset.translationCacheHit==='true'&&node.querySelectorAll('.ht-translation-slot').length===1,'Settled scroll lost or duplicated cached slot');
  assert(reads===readsBeforeRecycle,'Recycling a cached message requested another lookup');
  assert(calls===0,'Cache hit triggered a translation request');assert(frames.length>0&&frames.every(frame=>frame.bare===0),'Cached message had an unprotected bare frame');
  assert(d.querySelector('#native')===native&&d.querySelector('footer')===footer,'Native UI identity changed');
  return{scope:'REAL_CHROMIUM_SYNTHETIC_DATA_ONLY',realAccount:'UNTESTED',records:1000,reads,recycledRemovals,cacheLookupsDuringRecycle:reads-readsBeforeRecycle,translationRequests:calls,nativeInterface:true,retainedScroll:true,copyDOMClean:true,sampledFrames:frames.length,bareFrames:0,frames};
 }finally{alive=false;view?.destroy();frame.remove()}
};
