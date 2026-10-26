'use strict';
// Conversation identity and message identity are distinct in current WhatsApp Web.
// This module is also embedded verbatim into the sandboxed isolated preload.
function legacyChat(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_\s]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function shortMessageId(id){return typeof id==='string'&&/^[a-f0-9]{8,128}$/iu.test(id)}
function normalizeChat(value,allowPhone=false){if(typeof value!=='string'||value.length>1024)return null;const text=value.replace(/[\u200e\u200f\u202a-\u202e]/gu,'').trim(),legacy=legacyChat(text);if(legacy)return legacy;
 if(text.startsWith('header:')&&text.length>7&&text.length<=519&&!/[\u0000-\u001f\u007f]/u.test(text))return text;
 if(/^[A-Za-z0-9.-]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid)$/u.test(text))return text;
 if(allowPhone&&/^(?:\+?[0-9][0-9 ()-]{4,30}[0-9])$/u.test(text)){const digits=text.replace(/\D/gu,'');if(digits.length>=7&&digits.length<=15)return digits+'@c.us'}return null;
}
function requestChat(messageId,context){const intrinsic=legacyChat(messageId),explicit=normalizeChat(context);if(intrinsic){if(context!==undefined&&context!==null&&explicit!==intrinsic)throw Error('WhatsApp 消息与会话归属不一致');return intrinsic}if(shortMessageId(messageId)&&explicit)return explicit;throw Error('WhatsApp 短消息缺少有效会话归属')}
function conversationContext(document,messageId,node){const intrinsic=legacyChat(messageId);if(intrinsic)return intrinsic;if(messageId!==undefined&&!shortMessageId(messageId))return null;
 const main=node?.closest?.('#main')||document.querySelector('#main');if(!main||node&&!main.contains(node))return null;
 const header=main.querySelector('[data-testid="conversation-header"],header');if(!header)return null;
 const label=String(header.innerText||header.textContent||'').replace(/[\u200e\u200f\u202a-\u202e]/gu,'').trim();if(!label||label.length>512||/[\u0000-\u001f\u007f]/u.test(label))return null;
 const phone=normalizeChat(label,true);return phone||normalizeChat('header:'+label);
}
function messageOutgoing(node,id){if(typeof id==='string'&&/^(?:true|false)_/u.test(id))return id.startsWith('true_');return !!node?.closest?.('.message-out,[data-from-me="true"],[data-message-direction="outgoing"],[data-direction="out"]')}
module.exports={legacyChat,shortMessageId,normalizeChat,requestChat,conversationContext,messageOutgoing};
