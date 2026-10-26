'use strict';
function conversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function install({document,window,ipc,targetFor,retranslate}){
 const sessions=new Map,hiddenRoots=new Map;
 let current=null,nativeRoot=null,waiting=false,lastHeader='',previousChat=null,navigationAt=0,destroyed=false;
 const root=document.createElement('section');root.id='haituo-local-bilingual-chat';root.setAttribute('aria-label','海拓本机双语聊天记录');
 Object.assign(root.style,{position:'fixed',zIndex:'1000',display:'none',boxSizing:'border-box',background:'var(--conversation-panel-background,#efeae2)',color:'var(--primary,#111b21)',overflow:'hidden',flexDirection:'column'});
 const bar=document.createElement('div'),toggle=document.createElement('button'),label=document.createElement('span'),status=document.createElement('div');
 Object.assign(bar.style,{display:'flex',alignItems:'center',gap:'12px',padding:'7px 12px',background:'var(--panel-header-background,#f0f2f5)',flexShrink:'0',pointerEvents:'auto'});
 label.textContent='本机双语记录';toggle.type='button';toggle.textContent='图片、语音等操作：官方视图';
 Object.assign(status.style,{fontSize:'12px',padding:'5px 12px',background:'var(--panel-header-background,#f0f2f5)',flexShrink:'0'});
 const privacy=document.createElement('style');privacy.textContent='#main [data-id^="false_"],#main [data-id^="true_"]{visibility:hidden!important}';
 // Until a complete local page is available, never reveal an original-only
 // WhatsApp frame. This stylesheet also covers replacement native DOM roots.
 (document.head||document.documentElement).append(privacy);
 bar.append(label,toggle);root.append(bar,status);document.body.append(root);
 function state(chat){if(!sessions.has(chat)){
  const list=document.createElement('div');Object.assign(list.style,{flex:'1',overflowY:'auto',padding:'10px 16px',minHeight:'0',overflowAnchor:'none'});
  const value={chat,list,records:new Map,nodes:new Map,ordered:[],older:false,total:0,ready:false,official:false,scrollTop:0,signature:'',serial:Promise.resolve(),loading:false,error:''};
  list.addEventListener('scroll',()=>{value.scrollTop=list.scrollTop;if(current===value&&!waiting&&list.scrollTop<=60)loadOlder(value)});
  sessions.set(chat,value);
 }return sessions.get(chat)}
 function hideNative(node){if(!node)return;if(!hiddenRoots.has(node))hiddenRoots.set(node,node.style.visibility);node.style.visibility='hidden'}
 function restoreNative(){for(const [node,visibility] of hiddenRoots)node.style.visibility=visibility;hiddenRoots.clear()}
 function bounds(){
  if(nativeRoot?.isConnected)return nativeRoot.getBoundingClientRect();
  const main=document.querySelector('#main');if(!main)return null;const r=main.getBoundingClientRect(),header=main.querySelector('header')?.getBoundingClientRect(),footer=main.querySelector('footer')?.getBoundingClientRect();
  const top=header?.bottom>r.top?header.bottom:r.top,bottom=footer?.top>top?Math.min(footer.top,r.bottom):r.bottom;return{left:r.left,top,width:r.width,height:Math.max(0,bottom-top)};
 }
 function position(){
  if(destroyed)return;const r=bounds();if(!r||r.width<=0||r.height<=0){root.style.display='none';return;}
  const official=!!current?.official&&!waiting;privacy.disabled=official;
  if(official)restoreNative();else hideNative(nativeRoot);
  Object.assign(root.style,{display:'flex',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',background:official?'transparent':'var(--conversation-panel-background,#efeae2)',pointerEvents:official?'none':'auto'});
  toggle.textContent=official?'返回本机双语记录':'图片、语音等操作：官方视图';
  if(current)current.list.style.display=!official&&!waiting&&current.ready?'block':'none';
  status.style.display=official&&!current?.error?'none':'block';
  status.textContent=current?.error||(waiting||!current?.ready?'正在读取本机双语记录…':`已保存 ${current.total} 条本机记录；图片、语音请切换官方视图。`);
 }
 function activate(value){
  if(current!==value){if(current){if(current.list.style.display!=='none')current.scrollTop=current.list.scrollTop;current.list.remove()}current=value;root.insertBefore(value.list,status);position();value.list.scrollTop=value.scrollTop;}
  position();
 }
 function setOfficial(value){if(current)current.official=!!value;else if(value){restoreNative();privacy.disabled=true;root.style.display='none';return;}position()}
 toggle.onclick=()=>setOfficial(!current?.official);
 function anchorOf(value){const list=value.list,rect=list.getBoundingClientRect();return{bottom:list.scrollHeight-list.scrollTop-list.clientHeight<=32,top:list.scrollTop,node:[...list.children].find(n=>n.getBoundingClientRect().bottom>rect.top)}}
 function updateNode(value,record){
  const target=targetFor(record.source),translation=record.translations?.[target]?.text||'';let node=value.nodes.get(record.id);
  if(!node){
   node=document.createElement('article');node.dataset.messageId=record.id;
   Object.assign(node.style,{padding:'9px 12px',borderRadius:'8px',margin:'8px 0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:'85%',width:'fit-content',background:record.outgoing?'var(--outgoing-background,#d9fdd3)':'var(--incoming-background,#fff)',marginLeft:record.outgoing?'auto':'0'});
   const source=document.createElement('div'),result=document.createElement('div'),meta=document.createElement('small'),retry=document.createElement('button');
   result.className='haituo-local-message-translation';Object.assign(result.style,{borderTop:'1px solid currentColor',marginTop:'7px',paddingTop:'7px'});
   retry.type='button';retry.onclick=async()=>{retry.disabled=true;try{const latest=value.records.get(record.id);await retranslate(latest.source,record.id);await refresh(record.id)}catch(error){value.error=error.message;position()}finally{retry.disabled=false}};
   node.append(source,result,meta,retry);node.__parts={source,result,meta,retry};value.nodes.set(record.id,node);
  }
  const {source,result,meta,retry}=node.__parts;
  if(source.textContent!==record.source)source.textContent=record.source;
  if(result.textContent!==(translation||'等待翻译'))result.textContent=translation||'等待翻译';
  result.style.opacity=translation?'1':'.6';meta.textContent=record.metadata||'';retry.textContent=translation?'重译':'翻译/重试';
  return node;
 }
 function apply(value,page,{prepend=false,targeted=false}={}){
  if(destroyed||page.chat!==value.chat)return;
  const anchor=anchorOf(value),anchorTop=anchor.node?.getBoundingClientRect().top,first=!value.ready;
  for(const record of page.messages)value.records.set(record.id,record);
  // Existing nodes and ordering remain owned by their chat. A page refresh
  // updates text in place, never clears or remounts the conversation.
  const ids=page.messages.map(r=>r.id);
  for(let i=0;i<ids.length;i++)if(!value.ordered.includes(ids[i])){
   const following=ids.slice(i+1).find(id=>value.ordered.includes(id));
   const preceding=ids.slice(0,i).reverse().find(id=>value.ordered.includes(id));
   if(following)value.ordered.splice(value.ordered.indexOf(following),0,ids[i]);
   else if(preceding)value.ordered.splice(value.ordered.indexOf(preceding)+1,0,ids[i]);
   else if(prepend)value.ordered.unshift(ids[i]);else value.ordered.push(ids[i]);
  }
  for(const id of ids)updateNode(value,value.records.get(id));
  let previous=null;for(const id of value.ordered){const node=value.nodes.get(id);if(!node)continue;if(previous?previous.nextSibling!==node:value.list.firstChild!==node)value.list.insertBefore(node,previous?previous.nextSibling:value.list.firstChild);previous=node;}
  if(!targeted){if(first||prepend)value.older=page.hasOlder;value.total=page.total;}value.ready=true;value.error='';
  if(current===value&&!waiting){position();if(first||anchor.bottom)value.list.scrollTop=Math.max(0,value.list.scrollHeight-value.list.clientHeight);else if(anchor.node?.isConnected)value.list.scrollTop=anchor.top+anchor.node.getBoundingClientRect().top-anchorTop;else value.list.scrollTop=anchor.top;value.scrollTop=value.list.scrollTop;}
 }
 function enqueue(value,work){const task=value.serial.catch(()=>{}).then(work);value.serial=task;return task}
 function header(){const node=document.querySelector('#main header');return node?.querySelector('[data-testid=conversation-info-header-chat-title]')?.textContent||node?.querySelector('[title]')?.getAttribute('title')||''}
 function selectRoot(elements,chat){
  const candidate=elements.find(n=>conversation(n.getAttribute('data-id')||n.closest('[data-id]')?.getAttribute('data-id'))===chat);
  if(candidate)for(let node=candidate.parentElement;node&&node.id!=='main';node=node.parentElement){if(/^(auto|scroll)$/.test(window.getComputedStyle(node).overflowY)&&node.clientHeight>0){if(nativeRoot!==node){if(nativeRoot)resize.unobserve?.(nativeRoot);nativeRoot=node;resize.observe(node)}break;}}
 }
 async function observe(items,elements){
  if(destroyed||!items.length)return;const chat=conversation(items[0].id);if(!chat||items.some(item=>conversation(item.id)!==chat))return;
  const title=header();
  if(!waiting&&lastHeader&&title!==lastHeader&&chat===current?.chat){if(current?.list.style.display!=='none')current.scrollTop=current.list.scrollTop;waiting=true;previousChat=chat;navigationAt=Date.now();position();return;}
  if(waiting&&chat===previousChat){if(title!==lastHeader||Date.now()-navigationAt<1200){position();return;}}
  waiting=false;lastHeader=title;previousChat=null;const value=state(chat);selectRoot(elements,chat);activate(value);
  const signature=JSON.stringify([items,items.map(item=>targetFor(item.source))]);
  if(signature===value.signature){position();return;}
  return enqueue(value,async()=>{try{const page=await ipc.invoke('haituo:local-chat-observe',items);if(destroyed)return;value.signature=signature;apply(value,page)}catch(error){value.error=error.message;if(current===value){value.official=true;position()}throw error}});
 }
 async function refresh(messageId){
  const chat=messageId?conversation(messageId):current?.chat,value=sessions.get(chat);if(!value||destroyed)return;
  return enqueue(value,async()=>{const options=messageId?{ids:[messageId]}:undefined;const page=await ipc.invoke('haituo:local-chat-page',chat,options);apply(value,page,{targeted:!!messageId})});
 }
 async function loadOlder(value){
  if(value.loading||!value.ready)return;value.loading=true;
  try{if(value.older){await enqueue(value,async()=>{const page=await ipc.invoke('haituo:local-chat-page',value.chat,{before:value.ordered[0],limit:200});apply(value,page,{prepend:true})})}else if(nativeRoot&&current===value){nativeRoot.scrollTop=Math.max(0,nativeRoot.scrollTop-nativeRoot.clientHeight)}}catch(error){value.error=error.message;position()}finally{value.loading=false}
 }
 const resize=window.ResizeObserver?new window.ResizeObserver(position):{observe(){},disconnect(){}};resize.observe(document.documentElement);window.addEventListener('resize',position);
 function navigate(event){if(!event.target.closest?.('#pane-side,[data-testid="chat-list"]'))return;previousChat=current?.chat;navigationAt=Date.now();waiting=true;if(current){current.scrollTop=current.list.scrollTop;current.list.style.display='none';current.official=false;}position()}
 document.addEventListener('pointerdown',navigate,true);
 // Cover first load and keyboard navigation in the same mutation microtask,
 // before the browser paints newly created native original-only messages.
 const observer=window.MutationObserver?new window.MutationObserver(events=>{if(events.every(e=>root.contains(e.target)||e.target===root||e.target===privacy))return;const title=header();if(current&&!waiting&&lastHeader&&title!==lastHeader){if(current.list.style.display!=='none')current.scrollTop=current.list.scrollTop;previousChat=current.chat;waiting=true;navigationAt=Date.now();}position()}):null;
 observer?.observe(document.documentElement,{childList:true,subtree:true,characterData:true});position();
 return{observe,refresh,setOfficial,showError:message=>{if(current)current.error=message;position()},isActive:()=>!!current&&current.ready&&!waiting&&!current.official,isManaged:()=>true,destroy(){destroyed=true;restoreNative();resize.disconnect();observer?.disconnect();privacy.remove();root.remove();document.removeEventListener('pointerdown',navigate,true);window.removeEventListener('resize',position);sessions.clear()}};
}
module.exports={install};
