'use strict';
const installed=new WeakMap();
function canCopyImage(params){
 if(params.mediaType!=='image'||!params.hasImageContents||params.selectionText?.trim())return false;
 try{const url=new URL(params.srcURL);return url.protocol==='attachment:'&&url.searchParams.get('disposition')!=='temporary'}catch{return false}
}
function install({electron:e,contents,getWindow,labels={},log=()=>{}}){
 if(installed.has(contents))return installed.get(contents);
 const label=(key,fallback)=>labels[key]||fallback;
 const safe=action=>async()=>{if(contents.isDestroyed())return;try{await action()}catch(error){log('Signal context menu action failed: '+String(error?.message||error).slice(0,200))}};
 const handler=(event,params)=>{
  if(contents.isDestroyed())return;const owner=getWindow?.();if(!owner||owner.isDestroyed())return;
  const flags=params.editFlags||{},items=[];
  const command=(key,text,method)=>items.push({label:label(key,text),click:safe(()=>contents[method]())});
  if(params.isEditable&&params.misspelledWord){
   const suggestions=params.dictionarySuggestions||[];
   if(suggestions.length)items.push(...suggestions.map(word=>({label:word,click:safe(()=>contents.replaceMisspelling(word))})));
   else items.push({label:label('noSuggestions','没有拼写建议'),enabled:false});
   items.push({type:'separator'});
  }
  if(params.isEditable){if(flags.canUndo)command('undo','撤销','undo');if(flags.canRedo)command('redo','重做','redo');if(flags.canUndo||flags.canRedo)items.push({type:'separator'});if(flags.canCut)command('cut','剪切','cut')}
  const image=canCopyImage(params);
  if(image)items.push({label:label('copyImage','复制图片'),click:safe(()=>contents.copyImageAt(params.x,params.y))});
  if(flags.canCopy)command('copy','复制','copy');
  if(params.linkURL)items.push({label:label('copyLink','复制链接'),click:safe(()=>e.clipboard.writeText(params.linkURL))});
  if(params.isEditable&&flags.canPaste&&!image){command('paste','粘贴','paste');if(flags.canEditRichly||params.formControlType==='none')command('pastePlain','粘贴为纯文本','pasteAndMatchStyle')}
  if(params.isEditable&&flags.canSelectAll)command('selectAll','全选','selectAll');
  while(items.at(-1)?.type==='separator')items.pop();if(!items.length)return;
  try{event.preventDefault?.();const menu=e.Menu.buildFromTemplate(items);menu.popup({window:owner});}catch(error){log('Signal context menu failed: '+String(error?.message||error).slice(0,200))}
 };
 contents.on('context-menu',handler);
 const dispose=()=>{contents.removeListener('context-menu',handler);installed.delete(contents)};
 contents.once('destroyed',dispose);installed.set(contents,dispose);return dispose;
}
module.exports={install,canCopyImage};
