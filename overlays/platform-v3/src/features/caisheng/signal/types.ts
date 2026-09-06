export type SignalAccountStatus = 'stopped' | 'starting' | 'linking' | 'ready' | 'error';
export type SignalAccount = { id:string; label:string; status:SignalAccountStatus; phoneNumber?:string; deviceName?:string; lastError?:string };
export type SignalConversation = { id:string; title:string; avatarVersion?:string; lastMessage?:string; lastMessageAt?:number; unreadCount:number; isGroup:boolean };
export type SignalAttachment = { id:string; fileName?:string; contentType?:string; size?:number; kind?:'image'|'video'|'audio'|'voice'|'file'; localPath?:string };
export type SignalQuote = { authorId:string; sentAt:number; body?:string; attachments?:Array<Pick<SignalAttachment,'contentType'|'fileName'>> };
export type SignalReaction = { emoji:string; authorId:string; targetSentAt:number; removed?:boolean };
export type SignalMessage = { id:string; conversationId:string; senderId:string; senderName?:string; body:string; sentAt:number; receivedAt?:number; direction:'incoming'|'outgoing'; status?:'sending'|'sent'|'delivered'|'read'|'failed'; attachments?:SignalAttachment[]; quote?:SignalQuote; reactions?:SignalReaction[]; editedAt?:number; deletedAt?:number };
export type SignalOutgoingAttachment = { fileName:string; contentType:string; bytesBase64:string; voiceNote?:boolean };
export type SignalLinkState = { accountId:string; state:'waiting'|'linked'|'expired'|'failed'; uri?:string; expiresAt?:number; error?:string };
export type SignalRuntimeEvent = | {type:'account';account:SignalAccount}|{type:'link';link:SignalLinkState}|{type:'conversation';accountId:string;conversation:SignalConversation}|{type:'message';accountId:string;message:SignalMessage}|{type:'avatar';accountId:string;conversationId:string;version:string};
type Target = { accountId:string; conversationId:string };
export type SignalRequestMap = {
 start:{accountId:string}; stop:{accountId:string}; beginLink:{accountId:string;deviceName:string}; listConversations:{accountId:string;cursor?:string;limit?:number}; listMessages:Target&{before?:number;limit?:number};
 sendMessage:Target&{body:string;attachments?:SignalOutgoingAttachment[];quote?:SignalQuote}; sendAttachment:Target&{attachment:{path:string;name:string;type:string;caption?:string;voiceNote?:boolean}}; editMessage:Target&{targetTimestamp:number;body:string}; reactMessage:Target&{targetTimestamp:number;emoji:string;remove?:boolean}; deleteMessage:Target&{targetTimestamp:number};
 getAttachment:Target&{attachmentId:string;fileName?:string;contentType?:string}; cleanupAttachments:{accountId:string;olderThan?:number;maxBytes?:number}; markRead:Target&{through:number}; getAvatar:Target;
};
export type SignalResponseMap = { start:SignalAccount;stop:undefined;beginLink:SignalLinkState;listConversations:{items:SignalConversation[];cursor?:string};listMessages:{items:SignalMessage[];cursor?:string};sendMessage:SignalMessage;sendAttachment:SignalMessage;editMessage:SignalMessage;reactMessage:undefined;deleteMessage:undefined;getAttachment:SignalAttachment&{bytesBase64:string};cleanupAttachments:{deleted:number;freedBytes:number};markRead:undefined;getAvatar:{contentType:string;bytesBase64:string;version?:string}|undefined };
export type SignalMethod=keyof SignalRequestMap;
