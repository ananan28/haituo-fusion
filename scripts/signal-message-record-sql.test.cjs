'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const root=require('node:path').resolve(__dirname,'../src/app');
require('node:test').test('Signal actual cleaner and SQL writer retain local translations with the original body',()=>{
const sql=fs.readFileSync(root+'/bundles/workers/sql.js','utf8'),preload=fs.readFileSync(root+'/bundles/preload/main.js','utf8');
const start=sql.indexOf('function zc('),end=sql.indexOf('function Bc(',start);assert.ok(start>=0&&end>start);
const columns=['id','body','conversationId','expirationStartTimestamp','expireTimer','hasAttachments','hasFileAttachments','hasVisualMediaAttachments','hasUnreadPollVotes','isChangeCreatedByUs','isErased','isViewOnce','mentionsMe','received_at','received_at_ms','schemaVersion','serverGuid','sent_at','source','sourceServiceId','sourceDevice','storyId','type','timestamp','readStatus','seenStatus','serverTimestamp','unidentifiedDeliveryReceived','json'];
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE messages ('+columns.map(name=>name==='id'?'id TEXT PRIMARY KEY':name).join(',')+')');
const context={console,Date,Map,ArrayBuffer,t:{Kt:columns,Wt:columns,Ri:assert.ok,un:JSON.stringify,Si:ArrayBuffer.isView},i:{nt:{Unread:0},w:{NotApplicable:0}},a:{Tr:value=>!!value?.[Symbol.iterator]},br:()=>true,xr:console,B:console};vm.createContext(context);
const a=preload.indexOf('function _r('),b=preload.indexOf('    var ',a);vm.runInContext(preload.slice(a,b),context);vm.runInContext(sql.slice(start,end),context);
const message={id:'local-fixture',conversationId:'fixture-chat',body:'Original message',received_at:1,sent_at:1,readStatus:1,type:'incoming',haituoLocalTranslations:{version:1,entries:{'zh-CN':{source:'Original message',text:'原文下的译文',provider:'fixture',updatedAt:1}}}};
const cleaned=context._r(message).cleaned;context.zc(db,cleaned,{alreadyInTransaction:true,forceSave:true,ourAci:'fixture',_testOnlyAvoidNormalizingAttachments:true});
let row=db.prepare('SELECT body,json FROM messages WHERE id=?').get('local-fixture');assert.equal(row.body,'Original message');assert.equal(JSON.parse(row.json).haituoLocalTranslations.entries['zh-CN'].text,'原文下的译文');
cleaned.haituoLocalTranslations.entries['zh-CN'].text='重新翻译';context.zc(db,cleaned,{alreadyInTransaction:true,forceSave:false,ourAci:'fixture',_testOnlyAvoidNormalizingAttachments:true});row=db.prepare('SELECT body,json FROM messages WHERE id=?').get('local-fixture');assert.equal(row.body,'Original message');assert.equal(JSON.parse(row.json).haituoLocalTranslations.entries['zh-CN'].text,'重新翻译');db.close();
});
