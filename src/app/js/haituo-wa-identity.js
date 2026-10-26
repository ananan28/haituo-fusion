'use strict';
// Conversation identity and message identity are distinct in current WhatsApp Web.
// This module is also embedded verbatim into the sandboxed isolated preload.
function legacyChat(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_\s]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function shortMessageId(id){return typeof id==='string'&&/^[a-f0-9]{8,128}$/iu.test(id)}
function normalizeChat(value,allowPhone=false){if(typeof value!=='string'||value.length>1024)return null;const text=value.replace(/[\u200e\u200f\u202a-\u202e]/gu,'').trim(),legacy=legacyChat(text);if(legacy)return legacy;
 if(/^[A-Za-z0-9.-]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid)$/u.test(text))return text;
 if(allowPhone&&/^(?:\+?[0-9][0-9 ()-]{4,30}[0-9])$/u.test(text)){const digits=text.replace(/\D/gu,'');if(digits.length>=7&&digits.length<=15)return digits+'@c.us'}return null;
}
function requestChat(messageId,context){const intrinsic=legacyChat(messageId),explicit=normalizeChat(context);if(intrinsic){if(context!==undefined&&context!==null&&explicit!==intrinsic)throw Error('WhatsApp 消息与会话归属不一致');return intrinsic}if(shortMessageId(messageId)&&explicit)return explicit;throw Error('WhatsApp 短消息缺少有效会话归属')}
function conversationContext(document,messageId,node){const intrinsic=legacyChat(messageId);if(intrinsic)return intrinsic;if(messageId!==undefined&&!shortMessageId(messageId))return null;
 const main=node?.closest?.('#main')||document.querySelector('#main');if(!main||node&&!main.contains(node))return null;
 const attrs=['cid','data-chat-id','data-conversation-id','data-chat-jid','data-jid','data-peer-id'];
 const fromNode=element=>{if(!element)return null;for(const attr of attrs){const id=normalizeChat(element.getAttribute(attr),true);if(id)return id}return null};
 const direct=fromNode(main);if(direct)return direct;
 const header=main.querySelector('header');if(!header)return null;
 const headerNodes=[header,...header.querySelectorAll(attrs.map(a=>'['+a+']').join(','))];const headerIds=new Set(headerNodes.map(fromNode).filter(Boolean));if(headerIds.size===1)return [...headerIds][0];if(headerIds.size>1)return null;
 // Phone labels identify a chat; ordinary display names do not. Never use a
 // contact name alone as a database key or retain the previous chat as fallback.
 const labels=[...header.querySelectorAll('[title],[aria-label]')].flatMap(n=>[n.getAttribute('title'),n.getAttribute('aria-label')]).filter(Boolean);
 labels.push(...String(header.innerText||header.textContent||'').split(/\n/u));
 const phones=new Set(labels.filter(s=>/^\s*\+/u.test(s)).map(s=>normalizeChat(s,true)).filter(Boolean));if(phones.size===1)return [...phones][0];if(phones.size>1)return null;
 // Selected conversation data is useful only if its label matches this header.
 // A sidebar selection changing ahead of the header must not reuse another chat.
 const clean=s=>String(s||'').trim().replace(/\s+/gu,' ');
 const headerLabels=new Set(labels.map(clean).filter(Boolean)),selected=[];
 for(const row of document.querySelectorAll('#pane-side [aria-selected="true"]')){const names=[...row.querySelectorAll('[title]')].map(n=>clean(n.getAttribute('title')));if(!names.some(n=>headerLabels.has(n)))continue;for(const n of [row,...row.querySelectorAll(attrs.map(a=>'['+a+']').join(','))]){const room=fromNode(n)||normalizeChat(n.getAttribute('data-id'));if(room)selected.push(room)}}
 const rooms=new Set(selected);return rooms.size===1?[...rooms][0]:null;
}
function messageOutgoing(node,id){if(typeof id==='string'&&/^(?:true|false)_/u.test(id))return id.startsWith('true_');return !!node?.closest?.('.message-out,[data-from-me="true"],[data-message-direction="outgoing"],[data-direction="out"]')}
module.exports={legacyChat,shortMessageId,normalizeChat,requestChat,conversationContext,messageOutgoing};
