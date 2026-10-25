'use strict';
const focus=new WeakMap();
function install(contents,entryURL,openExternal){
 const canonical=value=>{try{const url=new URL(value);url.hash='';return url.href}catch{return null}};
 const allowed=canonical(entryURL);
 function external(value){try{const url=new URL(value);if(['https:','http:','mailto:','tel:'].includes(url.protocol))Promise.resolve(openExternal(value)).catch(()=>{});}catch{}}
 function navigate(event,value){const url=typeof value==='string'?value:event.url;if(!allowed||canonical(url)!==allowed){event.preventDefault();external(url)}}
 contents.on('will-navigate',navigate);contents.on('will-redirect',navigate);
 contents.on('will-attach-webview',event=>event.preventDefault());
 contents.setWindowOpenHandler(({url})=>{external(url);return{action:'deny'}});
}
function publishFocus(contents,active){if(!contents||contents.isDestroyed())return;active=!!active;if(focus.get(contents)===active)return;focus.set(contents,active);contents.send('haituo-child-push:set-window-focus',{args:[active]});}
function resetFocus(contents){focus.delete(contents)}
module.exports={install,publishFocus,resetFocus};
