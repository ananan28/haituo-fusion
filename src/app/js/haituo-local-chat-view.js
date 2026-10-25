'use strict';
function conversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function install({document,window,ipc,targetFor,retranslate}){
 let chat=null,nativeRoot=null,sequence=0,official=false,loading=false,older=false,total=0,lastHeader='',expectedDifferent=false,navigationHeader='',navStarted=0,observedSignature='';
 const records=new Map;let ordered=[];
 const root=document.createElement('section');root.id='haituo-local-bilingual-chat';root.setAttribute('aria-label','海拓本机双语聊天记录');
 Object.assign(root.style,{position:'fixed',zIndex:'1000',display:'none',boxSizing:'border-box',background:'var(--conversation-panel-background,#efeae2)',color:'var(--primary,#111b21)',overflow:'hidden',flexDirection:'column'});
 const bar=document.createElement('div'),toggle=document.createElement('button'),label=document.createElement('span'),list=document.createElement('div'),status=document.createElement('div');
 Object.assign(bar.style,{display:'flex',alignItems:'center',gap:'12px',padding:'7px 12px',background:'var(--panel-header-background,#f0f2f5)',flexShrink:'0',pointerEvents:'auto'});
 label.textContent='本机双语记录';toggle.type='button';toggle.textContent='图片、语音等操作：官方视图';
 Object.assign(list.style,{flex:'1',overflowY:'auto',padding:'10px 16px',minHeight:'0',overflowAnchor:'none'});
 Object.assign(status.style,{fontSize:'12px',padding:'5px 12px',background:'var(--panel-header-background,#f0f2f5)',flexShrink:'0'});
 bar.append(label,toggle);root.append(bar,list,status);document.body.append(root);
 const nodes=new Map;
 function restore(){if(nativeRoot){nativeRoot.style.visibility= nativeRoot.dataset.haituoOriginalVisibility||'';delete nativeRoot.dataset.haituoOriginalVisibility;} }
 function position(){if(!nativeRoot?.isConnected||!chat){restore();root.style.display='none';return;}const r=nativeRoot.getBoundingClientRect();Object.assign(root.style,{display:'flex',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',background:official?'transparent':'var(--conversation-panel-background,#efeae2)',pointerEvents:official?'none':'auto'});list.style.display=official?'none':'block';status.style.display=official?'none':'block';if(!official){if(!('haituoOriginalVisibility' in nativeRoot.dataset))nativeRoot.dataset.haituoOriginalVisibility=nativeRoot.style.visibility;nativeRoot.style.visibility='hidden';}else restore();}
 function setOfficial(value){official=value;toggle.textContent=official?'返回本机双语记录':'图片、语音等操作：官方视图';position();}
 toggle.onclick=()=>setOfficial(!official);
 function render(){const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<=32;const anchor=[...list.children].find(x=>x.getBoundingClientRect().bottom>list.getBoundingClientRect().top);const anchorTop=anchor?.getBoundingClientRect().top;const oldTop=list.scrollTop;
  for(const id of ordered){const record=records.get(id);if(!record)continue;const target=targetFor(record.source),translation=record.translations?.[target]?.text||'';let node=nodes.get(id);if(!node){node=document.createElement('article');node.dataset.messageId=id;Object.assign(node.style,{padding:'9px 12px',borderRadius:'8px',margin:'8px 0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:'85%',width:'fit-content',background:record.outgoing?'var(--outgoing-background,#d9fdd3)':'var(--incoming-background,#fff)',marginLeft:record.outgoing?'auto':'0'});nodes.set(id,node)}
   const signature=JSON.stringify([record.source,translation,record.metadata]);if(node.__signature!==signature){const source=document.createElement('div');source.textContent=record.source;const result=document.createElement('div');result.className='haituo-local-message-translation';result.textContent=translation||'等待翻译';Object.assign(result.style,{borderTop:'1px solid currentColor',marginTop:'7px',paddingTop:'7px',opacity:translation?'1':'.6'});const meta=document.createElement('small');meta.textContent=record.metadata||'';const retry=document.createElement('button');retry.type='button';retry.textContent=translation?'重译':'翻译/重试';retry.onclick=async()=>{retry.disabled=true;try{await retranslate(record.source,record.id);await refresh();}catch(error){status.textContent=error.message;}finally{retry.disabled=false}};node.replaceChildren(source,result,meta,retry);node.__signature=signature;}
  }
  // Both source and saved translation already belong to each constructed node
  // before it is mounted. Never mount an original then request an attachment.
  let previous=null;for(const id of ordered){const node=nodes.get(id);if(!node)continue;if(previous?previous.nextSibling!==node:list.firstChild!==node)list.insertBefore(node,previous?previous.nextSibling:list.firstChild);previous=node;}
  if(atBottom)list.scrollTop=Math.max(0,list.scrollHeight-list.clientHeight);else if(anchor?.isConnected)list.scrollTop=oldTop+anchor.getBoundingClientRect().top-anchorTop;
  status.textContent=`已保存 ${total} 条本机记录；仅包含本机已加载的文字消息。图片、语音请切换官方视图。`;
 }
 function apply(page,prepend=false){if(page.chat!==chat)return;const ids=page.messages.map(x=>x.id);for(const value of page.messages)records.set(value.id,value);ordered=prepend?[...ids,...ordered.filter(id=>!ids.includes(id))]:[...ordered.filter(id=>!ids.includes(id)),...ids];older=page.hasOlder;total=page.total;render();position();}
 async function observe(items,elements){if(!items.length)return;const next=conversation(items[0].id);if(!next||items.some(x=>conversation(x.id)!==next))return;
  const header=document.querySelector('#main header')?.textContent||'';if(lastHeader&&header!==lastHeader){expectedDifferent=!!chat;navigationHeader=lastHeader;navStarted=Date.now();restore();root.style.display='none';}lastHeader=header;
  if(expectedDifferent&&next===chat){if(header===navigationHeader&&Date.now()-navStarted>1200)expectedDifferent=false;else return;}
  if(next!==chat){expectedDifferent=false;sequence++;restore();chat=next;observedSignature='';ordered=[];records.clear();nodes.clear();list.replaceChildren();official=false;}
  const token=sequence;
  const candidate=elements.find(x=>conversation(x.getAttribute('data-id')||x.closest('[data-id]')?.getAttribute('data-id'))===chat);
  if(candidate){for(let p=candidate.parentElement;p&&p.id!=='main';p=p.parentElement){const css=window.getComputedStyle(p);if(/^(auto|scroll)$/.test(css.overflowY)&&p.clientHeight>0){if(nativeRoot!==p){restore();nativeRoot=p;}break;}}}
  const signature=JSON.stringify(items);if(signature===observedSignature){position();return;}
  try{const page=await ipc.invoke('haituo:local-chat-observe',items);if(token===sequence){observedSignature=signature;apply(page);}}catch(error){if(token===sequence){setOfficial(true);status.textContent=error.message;}throw error;}
 }
 async function refresh(){if(!chat)return;const token=sequence;const page=await ipc.invoke('haituo:local-chat-page',chat);if(token===sequence)apply(page);}
 list.addEventListener('scroll',async()=>{if(list.scrollTop>60||loading||!chat)return;loading=true;const token=sequence;try{if(older){const page=await ipc.invoke('haituo:local-chat-page',chat,{before:ordered[0],limit:200});if(token===sequence)apply(page,true);}else if(nativeRoot){nativeRoot.scrollTop=Math.max(0,nativeRoot.scrollTop-nativeRoot.clientHeight);}}catch(error){status.textContent=error.message;}finally{loading=false;}});
 const resize=window.ResizeObserver?new window.ResizeObserver(position):{observe(){},disconnect(){}};resize.observe(document.documentElement);window.addEventListener('resize',position);
 // Hide stale conversation immediately on navigation; message IDs, not display
 // names, decide which local conversation may subsequently be shown.
 document.addEventListener('pointerdown',event=>{if(event.target.closest?.('#pane-side,[data-testid="chat-list"]')){restore();root.style.display='none';expectedDifferent=!!chat;navigationHeader=lastHeader;navStarted=Date.now();}},true);
 return{observe,refresh,setOfficial,showError:message=>{status.textContent=message},isActive:()=>!!chat&&!!nativeRoot,destroy(){sequence++;restore();resize.disconnect();root.remove();window.removeEventListener('resize',position);}};
}
module.exports={install};
