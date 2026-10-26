'use strict';
// Runs in the page main world. No IPC, account IDs, source cache or credentials.
function installHooks({document,window}){
 if(window.__haituoWACreationHooks){document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));return;}window.__haituoWACreationHooks=true;
 let busy=false;const roots=new Set,own='.ht-translation-slot';
 function visit(value){if(!value||!value.nodeType)return;const element=value.nodeType===1?value:value.parentElement;if(element?.closest(own))return;const items=new Set;if(element?.closest('[data-id]'))items.add(element.closest('[data-id]'));if(element?.matches('[data-id]'))items.add(element);for(const node of value.querySelectorAll?.('[data-id]')||[])items.add(node);for(const node of items)if(node.isConnected&&!node.closest(own))document.dispatchEvent(new window.CustomEvent('haituo:wa-render-node',{detail:node}));}
 function reconcile(values){if(busy)return;busy=true;try{for(const value of values)visit(value);for(const reference of roots){const root=reference.deref();if(!root)roots.delete(reference);else if(root.host.isConnected)visit(root)}}finally{busy=false}}
 function wrap(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.value)return;Object.defineProperty(proto,key,{...descriptor,value:function(...args){const fragmentNodes=args.flatMap(value=>value?.nodeType===11?[...value.childNodes]:[]);const parent=this.parentNode;const result=Reflect.apply(descriptor.value,this,args);if((key==='setAttribute'||key==='removeAttribute')&&/^(?:data-translation-cache-hit|data-haituo-translation-.+|data-ht-.+)$/.test(String(args[0])))return result;reconcile([this,parent,...args,...fragmentNodes]);return result}})}
 function setter(proto,key){const descriptor=Object.getOwnPropertyDescriptor(proto,key);if(!descriptor?.set)return;Object.defineProperty(proto,key,{...descriptor,set(value){Reflect.apply(descriptor.set,this,[value]);reconcile([this,this.parentNode])}})}
 for(const name of ['appendChild','insertBefore','replaceChild','removeChild'])wrap(window.Node.prototype,name);
 for(const proto of [window.Element.prototype,window.Document.prototype,window.DocumentFragment.prototype])for(const name of ['append','prepend','replaceChildren'])wrap(proto,name);
 for(const proto of [window.Element.prototype,window.CharacterData.prototype])for(const name of ['before','after','replaceWith','remove'])wrap(proto,name);
 for(const name of ['insertAdjacentHTML','setAttribute','removeAttribute'])wrap(window.Element.prototype,name);
 wrap(window.Range.prototype,'insertNode');
 for(const name of ['textContent','nodeValue'])setter(window.Node.prototype,name);
 setter(window.CharacterData.prototype,'data');for(const name of ['innerHTML','outerHTML','className'])setter(window.Element.prototype,name);setter(window.ShadowRoot.prototype,'innerHTML');
 const attach=Object.getOwnPropertyDescriptor(window.Element.prototype,'attachShadow');Object.defineProperty(window.Element.prototype,'attachShadow',{...attach,value:function(options){const root=Reflect.apply(attach.value,this,[options]);if(!this.closest(own))roots.add(new WeakRef(root));return root}});
 const observer=new window.MutationObserver(events=>{const values=[];for(const event of events){if(event.target.nodeType===1&&event.target.closest(own))continue;values.push(event.target,...event.addedNodes||[])}reconcile(values)});
 observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-id','data-pre-plain-text','data-mid','data-timestamp','cid','class']});
 document.dispatchEvent(new window.CustomEvent('haituo:wa-hooks-ready'));reconcile([document]);
}
module.exports={installHooks};
