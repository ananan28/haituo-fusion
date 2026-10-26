'use strict';
function conversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function install({document,window,ipc,targetFor,retranslate,keepPosition=(_node,work)=>work(),copyText}){
 // The native WhatsApp conversation is the only conversation UI. No cover,
 // replacement list, loading surface, style mask or alternate-view switch.
 const records=new Map,checked=new Map;let destroyed=false;
 const quote='[data-testid*="quoted" i],[data-testid="quote"],[aria-label*="Quoted" i],[aria-label*="引用"]';
 const textSelector='.selectable-text,[data-testid="selectable-text"],[data-testid="msg-text"],[data-testid="conversation-text"],[data-pre-plain-text] span[dir="auto"]';
 function read(node){
  const id=node?.getAttribute?.('data-id');if(!conversation(id))return null;
  const candidates=[...(node.matches(textSelector)?[node]:[]),...node.querySelectorAll(textSelector)].filter(n=>!n.closest('.haituo-wa-message-translation,.haituo-voice-result,.haituo-wa-translation-error')&&!n.closest(quote));
  const roots=candidates.filter(n=>!candidates.some(p=>p!==n&&p.contains(n)));
  const source=roots.map(n=>{if(!n.querySelector(quote))return(n.innerText||n.textContent||'').trim();const copy=n.cloneNode(true);copy.querySelectorAll(quote).forEach(q=>q.remove());return(copy.textContent||'').trim()}).filter(Boolean).join('\n\n').trim();
  if(!source)return null;return{id,source,roots,node};
 }
 function candidates(root){const set=new Set;if(root?.nodeType===1){const closest=root.closest('[data-id]');if(closest)set.add(closest);if(root.matches('[data-id]'))set.add(root)}for(const node of root?.querySelectorAll?.('[data-id]')||[])set.add(node);return[...set].filter(n=>n.closest('#main')&&!n.closest('.haituo-wa-message-translation'))}
 function mountFor(item){let mount=item.roots.at(-1)?.closest('[data-pre-plain-text]')||item.roots.at(-1)?.parentElement;while(mount&&mount!==item.node&&!item.roots.every(n=>mount.contains(n)))mount=mount.parentElement;return mount&&item.node.contains(mount)?mount:null}
 function render(item){
  if(destroyed||!item.node.isConnected)return;
  const record=records.get(item.id),target=targetFor(item.source),value=record?.source===item.source?record.translations?.[target]?.text:'';
  const existing=item.node.querySelector('.haituo-wa-message-translation');
  if(!value){if(existing?.dataset.haituoOwned==='record'&&(existing.dataset.messageId!==item.id||existing.dataset.source!==item.source||existing.dataset.target!==target))keepPosition(item.node,()=>existing.remove());return;}
  if(existing?.dataset.haituoOwned==='record'&&existing.dataset.source===item.source&&existing.dataset.target===target){const text=existing.querySelector('[data-haituo-saved-text]');if(text&&text.textContent!==value)keepPosition(item.node,()=>{text.textContent=value});return;}
  const mount=mountFor(item);if(!mount)return;
  keepPosition(item.node,()=>{
   existing?.remove();
   const result=document.createElement('div'),text=document.createElement('span'),actions=document.createElement('span');
   result.className='haituo-wa-message-translation';result.dataset.haituoOwned='record';result.dataset.source=item.source;result.dataset.target=target;result.dataset.messageId=item.id;
   Object.assign(result.style,{display:'block',clear:'both',borderTop:'1px solid #8886',marginTop:'6px',paddingTop:'6px',fontSize:'13px',lineHeight:'1.35',whiteSpace:'pre-wrap',overflowWrap:'anywhere',userSelect:'text',overflowAnchor:'none'});
   text.dataset.haituoSavedText='true';text.textContent=value;Object.assign(text.style,{display:'block',whiteSpace:'pre-wrap'});Object.assign(actions.style,{display:'flex',gap:'7px',marginTop:'5px',width:'max-content'});
   for(const [label,title,work] of [['📄','复制原文',()=>copyText?.(item.source,'原文')],['🌐','复制译文',()=>copyText?.(text.textContent,'译文')],['✨','重新直译',async()=>{await retranslate(item.source,item.id);await refresh(item.id)}]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.title=title;Object.assign(button.style,{background:'transparent',border:'0',color:'inherit',cursor:'pointer',padding:'0 3px'});button.onclick=async event=>{event.preventDefault();event.stopPropagation();button.disabled=true;try{await work()}catch(error){showError(error.message,item.id)}finally{button.disabled=false}};actions.append(button);
   }
   result.append(text,actions);mount.append(result);
  });
 }
 function readSaved(items,force=false){
  const groups=new Map;
  for(const item of items){const cached=records.get(item.id);if(!force&&cached?.source===item.source&&cached.translations?.[targetFor(item.source)]?.text)continue;if(!force&&checked.get(item.id)===item.source)continue;const chat=conversation(item.id);if(!groups.has(chat))groups.set(chat,[]);groups.get(chat).push(item);}
  for(const [chat,values] of groups)for(let start=0;start<values.length;start+=100){const batch=values.slice(start,start+100);try{
   const response=ipc.sendSync('haituo:local-chat-read',{chat,ids:batch.map(x=>x.id)});
   if(!response?.ok)continue;for(const record of response.page?.messages||[])if(conversation(record.id)===chat)records.set(record.id,record);for(const item of batch)checked.set(item.id,item.source);
  }catch{/* Storage problems must never hide or replace the native chat. */}}
 }
 function hydrate(root){const items=candidates(root).map(read).filter(Boolean);readSaved(items);for(const item of items)render(item)}
 async function observe(items,elements){
  if(destroyed||!items.length)return;
  const page=await ipc.invoke('haituo:local-chat-observe',items);
  if(destroyed)return;for(const record of page.messages||[])records.set(record.id,record);
  // The returned page is only the last 200; use indexed ID reads for older
  // bubbles currently materialized by WhatsApp's own virtualizer.
  const visible=elements.map(read).filter(Boolean);readSaved(visible,true);for(const item of visible)render(item);
 }
 async function refresh(id){
  if(destroyed||!conversation(id))return;const response=ipc.sendSync('haituo:local-chat-read',{chat:conversation(id),ids:[id]});
  if(!response?.ok)throw Error(response?.error||'无法读取本机译文');
  for(const record of response.page.messages||[])records.set(record.id,record);
  for(const node of document.querySelectorAll('#main [data-id]'))if(node.getAttribute('data-id')===id){const item=read(node);if(item)render(item)}
 }
 function showError(message,id){if(!id)return;for(const node of document.querySelectorAll('#main [data-id]'))if(node.getAttribute('data-id')===id){const item=read(node),mount=item&&mountFor(item);if(!mount)continue;let error=node.querySelector('.haituo-wa-translation-error');if(!error){error=document.createElement('button');error.className='haituo-wa-translation-error';error.type='button';error.onclick=async()=>{try{await retranslate(item.source,id);await refresh(id);error.remove()}catch(next){error.title=next.message}};mount.append(error)}error.textContent='翻译失败 · 点击重试';error.title=String(message||'翻译暂时不可用')}}
 const observer=new window.MutationObserver(events=>{const roots=new Set;for(const event of events){const target=event.target.nodeType===1?event.target:event.target.parentElement;if(target?.closest('.haituo-wa-message-translation,.haituo-wa-translation-error'))continue;if(event.type==='attributes'||event.type==='characterData'||target?.closest('[data-id]'))roots.add(target);for(const node of event.addedNodes||[])if(node.nodeType===1&&!node.matches('.haituo-wa-message-translation,.haituo-wa-translation-error'))roots.add(node);}for(const root of roots)hydrate(root)});
 observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-id']});hydrate(document.querySelector('#main'));
 return{observe,refresh,showError,isActive:()=>!destroyed,isManaged:()=>!destroyed,destroy(){destroyed=true;observer.disconnect();records.clear();checked.clear()}};
}
module.exports={install};
