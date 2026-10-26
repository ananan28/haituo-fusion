'use strict';
module.exports=async function verifyPersistentLayout(install){
 const iframe=document.createElement('iframe');Object.assign(iframe.style,{position:'fixed',left:'10px',top:'10px',width:'720px',height:'520px',zIndex:'2147483647',border:'0'});
 const loaded=new Promise(resolve=>iframe.onload=resolve);iframe.srcdoc='<!doctype html><style>body{margin:0;font:14px Arial}#main{height:500px}header,footer{height:50px}#native{height:400px;overflow-y:auto}#native>div{height:35px}</style><main id="main"><header><span title="Contact A">Contact A</span></header><div id="native"></div><footer>Composer</footer></main>';document.body.append(iframe);await loaded;
 const w=iframe.contentWindow,d=w.document,tick=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r))),assert=(value,message)=>{if(!value)throw Error(message)};
 let view;
 try{
  const record=(chat,i)=>({id:'false_'+chat+'_'+i,source:'Original '+i,translations:{'zh-CN':{text:'已保存译文 '+i}},metadata:'10:00'});
  const all=Array.from({length:600},(_,i)=>record('123@c.us',i)),other=[record('999@c.us',1)];let reads=0;
  const native=(chat,title)=>{d.querySelector('header span').setAttribute('title',title);d.querySelector('#native').innerHTML='<div data-id="false_'+chat+'_599">Original 599</div>';return d.querySelector('#native [data-id]')};
  let item=native('123@c.us','Contact A');
  const ipc={invoke:async(method,input,options)=>{reads++;await tick();const chat=typeof input==='string'?input:input[0].id.split('_')[1],items=chat==='123@c.us'?all:other;let end=items.length;if(options?.before)end=items.findIndex(r=>r.id===options.before);const messages=options?.ids?items.filter(r=>options.ids.includes(r.id)):items.slice(Math.max(0,end-200),end);return{chat,messages,total:items.length,hasOlder:!options?.ids&&end>200}}};
  view=install({document:d,window:w,ipc,targetFor:()=> 'zh-CN',retranslate:async()=>{throw Error('Unexpected network translation')}});
  const first=view.observe([{id:item.dataset.id,source:item.textContent}],[item]);
  assert(w.getComputedStyle(item).opacity==='0','Native original flashed during storage read');assert(item.innerText==='Original 599','Load mask prevented native message text from being read');await first;await tick();
  const original=d.querySelector('article'),translation=original.querySelector('.haituo-local-message-translation'),list=original.parentElement;
  assert(original.textContent.includes('已保存译文 400'),'Initial original and saved translation were not mounted together');assert(list.clientHeight>100&&list.scrollHeight>list.clientHeight,'Fixture did not create real scrolling geometry');
  list.scrollTop=2400;await tick();const savedTop=list.scrollTop;
  // Recycle official nodes while leaving the local message object untouched.
  item=native('123@c.us','Contact A');await tick();assert(d.querySelector('article')===original,'Native recycling remounted a local message');assert(list.scrollTop===savedTop,'Native recycling changed local scroll position');
  item=native('999@c.us','Contact B');await view.observe([{id:item.dataset.id,source:item.textContent}],[item]);await tick();assert(!original.isConnected,'Old conversation leaked into the new one');
  item=native('123@c.us','Contact A');const back=view.observe([{id:item.dataset.id,source:item.textContent,metadata:'return'}],[item]);assert(d.querySelector('article')===original,'Cached conversation was not reused before IPC');assert(list.scrollTop===savedTop,'Returning to a chat lost scroll position');await back;await tick();assert(list.scrollTop===savedTop,'DB refresh moved the restored conversation');
  // At the top, loading older records must preserve the first visible message.
  list.scrollTop=0;list.dispatchEvent(new w.Event('scroll'));for(let i=0;i<20&&d.querySelectorAll('article').length<400;i++)await tick();await tick();
  assert(d.querySelectorAll('article').length===400,'Older page did not load');assert(original.isConnected&&original.querySelector('.haituo-local-message-translation')===translation,'Older paging recreated a saved translation');
  assert(Math.abs(original.getBoundingClientRect().top-list.getBoundingClientRect().top)<40,'Older paging moved the visible anchor');
  all[200].translations['zh-CN'].text='后台完成的旧消息译文';const older=d.querySelector('article'),oldTranslation=older.querySelector('.haituo-local-message-translation');await view.refresh(all[200].id);assert(oldTranslation.textContent==='后台完成的旧消息译文','Targeted refresh missed older history');assert(d.querySelectorAll('.haituo-wa-message-translation').length===0,'Legacy translation attachment was used');
  view.destroy();view=null;
  // Simulated renderer restart: retained disk records are supplied together,
  // and neither translation generation nor original-DOM patching is needed.
  view=install({document:d,window:w,ipc,targetFor:()=> 'zh-CN',retranslate:async()=>{throw Error('Unexpected network translation')}});await view.observe([{id:item.dataset.id,source:item.textContent}],[item]);await tick();assert(d.querySelector('article .haituo-local-message-translation').textContent==='已保存译文 400','Reload lost saved bilingual record');
  return{records:600,reads,realScrollHeight:list.scrollHeight,retainedNodes:true,retainedScroll:true,olderAnchor:true,offlineReload:true};
 }finally{view?.destroy();iframe.remove()}
};
