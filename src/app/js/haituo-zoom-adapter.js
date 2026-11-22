'use strict';
// Pure DOM adapter: deliberately no Electron/Node API or credentials on window.
function installZoom(document,bridge){
 const win=document.defaultView,owned='[data-haituo-zoom-owned]',jobs=new Map(),memo=new Map(),statesInitial=new WeakMap();
 let config=null,receivedConfig=null,localCaption=true,captionFailure=null,epoch=0,disposed=false,running=0,scheduled,captionTimer,queue=[],states=statesInitial;
 const messageSelector='[data-message-id],[data-testid="message-item"],.chat-message__container';
 const listSelector='[role="log"],[data-testid="message-list"],.chat-message-list';
 const bodySelector='[data-testid="message-body"],.chat-message__text,.message-text';
 const captionSelector='[data-testid="closed-caption-text"],.closed-caption--text,.caption-window__content';
 const panel=document.createElement('section');panel.dataset.haituoZoomOwned='panel';
 Object.assign(panel.style,{position:'fixed',right:'14px',bottom:'14px',zIndex:'2147483000',maxWidth:'360px',padding:'10px',borderRadius:'10px',background:'#172332',color:'#fff',font:'13px system-ui',boxShadow:'0 3px 15px #0005'});
 try{localCaption=win.localStorage.getItem('haituo.zoom.caption-translation')!=='false'}catch{}
 const title=document.createElement('strong'),status=document.createElement('div'),output=document.createElement('div'),manual=document.createElement('button');
 title.textContent='海拓 · Zoom 自动翻译';status.textContent='正在读取翻译设置…';manual.textContent='翻译选中文字';
 const captionLabel=document.createElement('label'),captionToggle=document.createElement('input');captionToggle.type='checkbox';captionToggle.checked=localCaption;captionLabel.append(captionToggle,document.createTextNode('会议字幕翻译'));captionToggle.onchange=()=>{localCaption=captionToggle.checked;try{win.localStorage.setItem('haituo.zoom.caption-translation',String(localCaption))}catch{}if(receivedConfig)setConfig(receivedConfig)};
 const retry=document.createElement('button');retry.textContent='重试失败';retry.dataset.haituoZoomRetry='true';retry.onclick=()=>{captionFailure=null;for(const node of document.querySelectorAll(messageSelector))if(states.get(node)?.failed)states.delete(node);scan()};
 output.style.whiteSpace='pre-wrap';panel.append(title,status,captionLabel,manual,retry,output);(document.body||document.documentElement).append(panel);
 const text=node=>{const copy=node.cloneNode(true);copy.querySelectorAll(owned).forEach(n=>n.remove());return String(copy.innerText||copy.textContent||'').trim()};
 const chinese=value=>/\p{Script=Han}/u.test(value),target=value=>chinese(value)?config?.targetLanguage||'en':'zh-CN';
 const direction=node=>!!node.closest('[data-direction="outgoing"],.message-out,.chat-message--outgoing,[data-is-self="true"]');
 const group=node=>!!node.closest('[data-chat-type="group"],.group-chat');
 const enabled=node=>!!config&&(!group(node)||config.groupBackTranslationEnabled!==false)&&(direction(node)?config.backTranslationEnabled!==false:group(node)?config.groupBackTranslationEnabled!==false:config.autoTranslateIncoming!==false);
 const key=(source,lang,purpose='chat')=>JSON.stringify([source,lang,purpose,purpose==='input'?config?.inputTranslationProvider||config?.provider:config?.chatTranslationProvider||config?.provider||'google-free']);
 function remember(id,value){memo.delete(id);memo.set(id,value);while(memo.size>500)memo.delete(memo.keys().next().value)}
 function translate(source,lang,purpose='chat'){
  const id=key(source,lang,purpose);if(memo.has(id))return Promise.resolve(memo.get(id));if(jobs.has(id))return jobs.get(id);
  const task=new Promise((resolve,reject)=>{queue.push({source,lang,purpose,id,resolve,reject,epoch});pump()});jobs.set(id,task);task.finally(()=>{if(jobs.get(id)===task)jobs.delete(id);schedule()}).catch(()=>{});return task;
 }
 function pump(){
  while(!disposed&&running<2&&queue.length){
   const item=queue.shift();if(item.epoch!==epoch){item.resolve(null);continue}running++;
   Promise.resolve().then(()=>item.epoch!==epoch?null:bridge.translate({text:item.source,targetLanguage:item.lang,purpose:item.purpose,provider:item.purpose==='input'?config.inputTranslationProvider||config.provider:config.chatTranslationProvider||config.provider,localMessageRecord:false})).then(result=>{
    if(!result&&item.epoch!==epoch){item.resolve(null);return}if(!result?.text?.trim())throw Error('未返回有效译文');remember(item.id,result.text.trim());item.resolve(result.text.trim());
   }).catch(item.reject).finally(()=>{running--;pump();schedule()});
  }
 }
 function append(node,source,result,version){
  if(disposed||version!==epoch||!enabled(node)||!node.isConnected||!result)return;
  const body=node.querySelector(bodySelector);if(!body||text(body)!==source)return;
  let state=states.get(node);if(state?.source===source&&state.result===result&&state.slot?.isConnected)return;
  node.querySelectorAll('[data-haituo-zoom-owned="translation"]').forEach(n=>n.remove());
  const slot=document.createElement('div');slot.dataset.haituoZoomOwned='translation';slot.textContent=result;Object.assign(slot.style,{borderTop:'1px solid #8885',paddingTop:'5px',marginTop:'5px',whiteSpace:'pre-wrap',fontSize:'13px'});
  body.after(slot);states.set(node,{source,result,slot});
 }
 function scan(){
  if(disposed||!config||document.hidden)return;
  let count=0,disabledCount=0,failedCount=0;
  for(const node of document.querySelectorAll(messageSelector)){
   if(!node.closest(listSelector)||node.closest(owned)||node.closest('form'))continue;
   const rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0||rect.bottom<0||rect.top>win.innerHeight)continue;
   if(!enabled(node)){disabledCount++;node.querySelectorAll('[data-haituo-zoom-owned="translation"]').forEach(n=>n.remove());continue}
   const body=node.querySelector(bodySelector);if(!body)continue;const source=text(body);if(!source||source.length>30000)continue;count++;
   const lang=target(source),id=key(source,lang),state=states.get(node);
   if(state?.source===source&&state.failed===id){failedCount++;continue}
   if(state?.source===source&&state.lang===lang&&state.slot?.isConnected)continue;
   if(memo.has(id)){append(node,source,memo.get(id),epoch);const s=states.get(node);if(s)s.lang=lang;continue}
   if(state?.source===source&&state.pending===id&&jobs.has(id))continue;
   if(jobs.size>=200)break;
   const version=epoch;states.set(node,{source,pending:id});
   translate(source,lang).then(result=>{append(node,source,result,version);const s=states.get(node);if(s)s.lang=lang}).catch(error=>{if(version===epoch){if(states.get(node)?.source===source)states.set(node,{source,failed:id,error:String(error.message).slice(0,110)});status.textContent='翻译失败：'+String(error.message).slice(0,110)}});
  }
  status.textContent=failedCount?'有 '+failedCount+' 条翻译失败，请检查 API 或点重试':count?'自动翻译已启用 · 已识别 '+count+' 条消息':disabledCount?'当前消息回译已关闭':'等待可识别的聊天消息';
  clearTimeout(captionTimer);captionTimer=win.setTimeout(scanCaptions,700);
 }
 async function scanCaptions(){
  if(!config||config.zoomCaptionTranslationEnabled===false)return;
  const caption=document.querySelector(captionSelector);if(!caption){document.querySelectorAll('[data-haituo-zoom-owned="caption"]').forEach(n=>n.remove());return}if(caption.closest(owned))return;
  const source=text(caption);if(!source||source.length>2000)return;const captionKey=key(source,target(source));if(captionFailure===captionKey)return;const version=epoch;
  try{const translated=await translate(source,target(source));if(disposed||version!==epoch||config.zoomCaptionTranslationEnabled===false||!caption.isConnected||text(caption)!==source)return;
   let slot=caption.nextElementSibling;if(slot?.dataset.haituoZoomOwned!=='caption'){slot=document.createElement('div');slot.dataset.haituoZoomOwned='caption';caption.after(slot)}if(slot.textContent!==translated)slot.textContent=translated||'';
  }catch(error){if(version===epoch){captionFailure=captionKey;status.textContent='字幕翻译失败：'+error.message}}
 }
 const schedule=()=>{clearTimeout(scheduled);scheduled=win.setTimeout(scan,80)};
 const observer=new win.MutationObserver(records=>{
  const relevant=records.some(r=>{const target=r.target.nodeType===1?r.target:r.target.parentElement;if(target?.closest(owned))return false;
   return target?.closest(listSelector)||target?.closest(captionSelector)||[...r.addedNodes].some(node=>node.nodeType===1&&(node.matches(listSelector+','+captionSelector)||node.querySelector(listSelector+','+captionSelector)));
  });if(relevant)schedule();
 });
 observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 async function setConfig(value){
  if(!value||typeof value!=='object')return;
  receivedConfig={...receivedConfig,...value};value={...receivedConfig,zoomCaptionTranslationEnabled:localCaption&&receivedConfig.zoomCaptionTranslationEnabled!==false};captionToggle.checked=value.zoomCaptionTranslationEnabled;
  const signature=v=>JSON.stringify([v.autoTranslateIncoming!==false,v.backTranslationEnabled!==false,v.groupBackTranslationEnabled!==false,v.zoomCaptionTranslationEnabled!==false,v.blockChineseOutgoing!==false,v.targetLanguage||'en',v.chatTranslationProvider||v.provider||'google-free',v.inputTranslationProvider||v.provider||'google-free']);
  if(config&&signature(config)===signature(value)){config={...value};return}config={...value};epoch++;states=new WeakMap();captionFailure=null;
  for(const item of queue)item.resolve(null);queue=[];
  output.textContent='';document.querySelectorAll('[data-haituo-zoom-owned="translation"],[data-haituo-zoom-owned="caption"]').forEach(n=>n.remove());
  scan();
 }
 manual.onclick=async()=>{const source=String(win.getSelection()?.toString()||'').trim();if(!source){status.textContent='先选中要翻译的文字';return}if(!config)return;const version=epoch;try{const result=await translate(source,target(source));if(version===epoch)output.textContent=source+'\n'+result}catch(error){status.textContent=error.message}};
 const composerSelector='[contenteditable="true"][role="textbox"],[contenteditable="true"].tiptap,textarea[data-testid="chat-input"],textarea[placeholder*="message" i]';
 let composingInput=false;
 const outgoing=async event=>{
  const input=event.target.closest?.(composerSelector);
  if(!input||!config||event.key!=='Enter'||event.shiftKey||event.isComposing||config.blockChineseOutgoing===false)return;
  const source=String(input.value??input.innerText??input.textContent??'').trim();if(!chinese(source))return;
  event.preventDefault();event.stopImmediatePropagation();if(composingInput)return;composingInput=true;const version=epoch;status.textContent='正在翻译输入，完成后再按回车发送…';
  try{
   const result=await translate(source,config.targetLanguage||'en','input');
   if(disposed||version!==epoch||!input.isConnected||String(input.value??input.innerText??input.textContent??'').trim()!==source)return;
   if(input.tagName==='TEXTAREA'){const setter=Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype,'value').set;setter.call(input,result)}
   else{input.focus();const range=document.createRange();range.selectNodeContents(input);const selection=win.getSelection();selection.removeAllRanges();selection.addRange(range);if(!document.execCommand?.('insertText',false,result))throw Error('Zoom 输入框未接受填入；为避免误发送，已停止')}
   input.dispatchEvent(new win.Event('input',{bubbles:true}));if(String(input.value??input.innerText??input.textContent??'').trim()!==result.trim())throw Error('Zoom 未保留填入译文，请在输入框中重试');status.textContent='已填入译文，请确认后再发送';
   if(config.backTranslationEnabled!==false){const back=await translate(result,'zh-CN','chat');if(version===epoch&&config.backTranslationEnabled!==false)output.textContent='发送译文：'+result+'\n回译：'+back}
  }catch(error){if(version===epoch)status.textContent='发送翻译失败：'+error.message}
  finally{composingInput=false}
 };
 document.addEventListener('keydown',outgoing,true);
 const clickSend=event=>{
  const button=event.target.closest?.('[data-testid="chat-send"],[data-testid="send-button"],button[aria-label="Send"],button[aria-label="发送"]');
  if(!button)return;const pane=button.closest('[data-testid="chat-compose"],.chat-input-container,.chat-compose');
  const input=pane?.querySelector(composerSelector);if(!input)return;
  outgoing({target:input,key:'Enter',preventDefault:()=>event.preventDefault(),stopImmediatePropagation:()=>event.stopImmediatePropagation()});
 };
 document.addEventListener('click',clickSend,true);

 const gesture=event=>{if(event.isTrusted)bridge.gesture?.()};
 document.addEventListener('pointerdown',gesture,true);document.addEventListener('keydown',gesture,true);
 document.addEventListener('scrollend',schedule,true);document.addEventListener('visibilitychange',schedule);
 const unsubscribe=bridge.onConfig?.(setConfig);
 bridge.getConfig().then(setConfig).catch(error=>{status.textContent='翻译设置读取失败：'+error.message});
 return{scan,setConfig,status,dispose(){disposed=true;epoch++;observer.disconnect();clearTimeout(scheduled);clearTimeout(captionTimer);unsubscribe?.();document.removeEventListener('pointerdown',gesture,true);document.removeEventListener('keydown',gesture,true);document.removeEventListener('keydown',outgoing,true);document.removeEventListener('click',clickSend,true);document.removeEventListener('scrollend',schedule,true);document.removeEventListener('visibilitychange',schedule);queue.forEach(item=>item.resolve(null));queue=[];panel.remove()},selectors:{messageSelector,listSelector,bodySelector,captionSelector}};
}
if(typeof module!=='undefined')module.exports={installZoom};
