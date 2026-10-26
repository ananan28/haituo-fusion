'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomBytes}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
function conversation(id){return typeof id==='string'&&id.length<=1024?id.match(/^(?:true|false)_([^_]+@(?:c\.us|s\.whatsapp\.net|g\.us|lid))_/u)?.[1]||null:null}
function openEncrypted({directory,safeStorage}){
 if(!safeStorage?.isEncryptionAvailable())throw Error('系统密钥保护暂不可用，本机双语数据库未打开，请使用官方视图');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'messages.sqlite'),keyFile=path.join(directory,'database-key.bin');let key;
 if(fs.existsSync(keyFile)){key=safeStorage.decryptString(fs.readFileSync(keyFile));}
 else {if(fs.existsSync(file))throw Error('本机双语数据库密钥缺失，原数据库已保留');key=randomBytes(32).toString('hex');const encrypted=safeStorage.encryptString(key);if(safeStorage.decryptString(encrypted)!==key)throw Error('本机双语数据库密钥保护校验失败');fs.writeFileSync(keyFile,encrypted,{flag:'wx',mode:0o600,flush:true});}
 if(!/^[a-f0-9]{64}$/.test(key))throw Error('本机双语数据库密钥格式无效');
 const {Database}=require('@signalapp/sqlcipher');const db=new Database(file,{cacheStatements:true});
 try{db.pragma(`key = "x'${key}'"`);db.pragma('cipher_memory_security = ON');db.prepare('SELECT count(*) AS count FROM sqlite_master').get();db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 3000');return db;}catch(error){db.close();throw Error('本机双语数据库无法解锁，原数据库已保留',{cause:error});}
}
function createStore(options){
 const db=options.database||openEncrypted(options),pending=new Map,revisions=new Map;
 const schema=Number(Object.values(db.prepare('PRAGMA user_version').get())[0]);if(schema>1){db.close();throw Error('本机双语数据库来自更新版本，已停止写入');}
 db.exec(`CREATE TABLE IF NOT EXISTS haituo_local_messages (
 account TEXT NOT NULL, chatId TEXT NOT NULL, messageKey TEXT NOT NULL,
 messageIndex REAL NOT NULL, messageJson TEXT NOT NULL,
 PRIMARY KEY(account,chatId,messageKey));
 CREATE INDEX IF NOT EXISTS haituo_local_messages_chat_order ON haituo_local_messages(account,chatId,messageIndex,messageKey);
 PRAGMA user_version = 1;`);
 function identity(account,chat){if(typeof account!=='string'||!account||account.length>512||!chat||!conversation('false_'+chat+'_validation'))throw Error('本机消息账号或会话无效');return{account:hash(account),chat};}
 const one=db.prepare('SELECT messageIndex,messageJson FROM haituo_local_messages WHERE account=$account AND chatId=$chat AND messageKey=$id');
 const insert=db.prepare(`INSERT INTO haituo_local_messages(account,chatId,messageKey,messageIndex,messageJson) VALUES($account,$chat,$id,$rank,$json) ON CONFLICT(account,chatId,messageKey) DO UPDATE SET messageIndex=excluded.messageIndex,messageJson=excluded.messageJson`);
 const allOrder=db.prepare('SELECT messageKey,messageIndex FROM haituo_local_messages WHERE account=$account AND chatId=$chat ORDER BY messageIndex,messageKey');
 function observe(account,items){
  if(!Array.isArray(items)||!items.length||items.length>100)throw Error('消息批次无效');const chat=conversation(items[0]?.id),scope=identity(account,chat);
  const ids=new Set;for(const item of items){if(conversation(item?.id)!==chat||typeof item.source!=='string'||!item.source.trim()||item.source.length>30000||ids.has(item.id))throw Error('消息批次存在重复、归属错误或原文无效');ids.add(item.id);}
  db.transaction(()=>{
   const ranks=new Map;for(const item of items){const row=one.get({...scope,id:item.id});if(row)ranks.set(item.id,row.messageIndex);}
   let largest=db.prepare('SELECT MAX(messageIndex) AS rank FROM haituo_local_messages WHERE account=$account AND chatId=$chat').get(scope).rank;
   for(let index=0;index<items.length;index++){
    const item=items[index],previous=one.get({...scope,id:item.id});let rank=previous?.messageIndex;
    if(rank===undefined){
     const preceding=items.slice(0,index).reverse().find(x=>ranks.has(x.id));const following=items.slice(index+1).find(x=>ranks.has(x.id));
     if(preceding&&following){const lower=ranks.get(preceding.id),upper=ranks.get(following.id);rank=(lower+upper)/2;if(!(lower<rank&&rank<upper)){
      // A large missing history range can exhaust fractional rank precision.
      // Reindex atomically, preserving JSON/translation data and cursor IDs.
      const rows=allOrder.all(scope),update=db.prepare('UPDATE haituo_local_messages SET messageIndex=$rank WHERE account=$account AND chatId=$chat AND messageKey=$id');
      ranks.clear();rows.forEach((row,index)=>{const value=(index+1)*1024;update.run({...scope,id:row.messageKey,rank:value});ranks.set(row.messageKey,value)});
      largest=rows.length*1024;rank=(ranks.get(preceding.id)+ranks.get(following.id))/2;
     }}
     else if(following)rank=ranks.get(following.id)-1024;
     else if(preceding)rank=ranks.get(preceding.id)+1024;
     else rank=largest===null?1024:largest+1024;
     ranks.set(item.id,rank);largest=largest===null?rank:Math.max(largest,rank);
    }
    const old=previous?JSON.parse(previous.messageJson):null;const metadata=String(item.metadata||'').slice(0,512);
    if(old?.source===item.source&&old.metadata===metadata)continue;
    const record={id:item.id,source:item.source,metadata,outgoing:item.id.startsWith('true_'),translations:old?.source===item.source?old.translations:{},observedAt:old?.observedAt||Date.now()};
    insert.run({...scope,id:item.id,rank,json:JSON.stringify(record)});
   }
  })();return page(account,chat);
 }
 function page(account,chat,{before,limit=200,ids}={}){const scope=identity(account,chat);
  if(ids!==undefined){if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>conversation(id)!==chat))throw Error('消息查询归属无效');return{chat,messages:[...new Set(ids)].map(id=>one.get({...scope,id})).filter(Boolean).map(row=>JSON.parse(row.messageJson)),total:Number(db.prepare('SELECT COUNT(*) AS total FROM haituo_local_messages WHERE account=$account AND chatId=$chat').get(scope).total)};}
  let rank=Number.MAX_VALUE;if(before){const anchor=one.get({...scope,id:before});if(!anchor)throw Error('消息分页位置无效');rank=anchor.messageIndex;}
  const count=db.prepare('SELECT COUNT(*) AS total FROM haituo_local_messages WHERE account=$account AND chatId=$chat').get(scope).total;
  const rows=db.prepare('SELECT messageJson FROM haituo_local_messages WHERE account=$account AND chatId=$chat AND messageIndex<$rank ORDER BY messageIndex DESC,messageKey DESC LIMIT $limit').all({...scope,rank,limit:Math.max(1,Math.min(200,Number(limit)||200))});
  const values=rows.map(row=>JSON.parse(row.messageJson)).reverse();let hasOlder=false;if(values.length){const first=one.get({...scope,id:values[0].id});hasOlder=!!db.prepare('SELECT 1 AS found FROM haituo_local_messages WHERE account=$account AND chatId=$chat AND messageIndex<$rank LIMIT 1').get({...scope,rank:first.messageIndex});}
  return{chat,messages:values,hasOlder,total:Number(count)};
 }
 function get(account,id,source,target){const chat=conversation(id);if(!chat)return null;const row=one.get({...identity(account,chat),id});const message=row?JSON.parse(row.messageJson):null,value=message?.source===source&&message.translations?.[target];return value?.text?{...value,cached:true,localMessageRecord:true}:null;}
 function put(account,id,source,target,result){const scope=identity(account,conversation(id));return db.transaction(()=>{const row=one.get({...scope,id});const message=row?JSON.parse(row.messageJson):null;if(!message||message.source!==source)throw Error('原消息已改变，旧译文未保存');if(typeof target!=='string'||!target||target.length>64||typeof result?.text!=='string'||!result.text.trim()||result.text.length>120000||result.finish_reason==='length'||result.finishReason==='length')throw Error('译文无效，未保存');const value={text:result.text,provider:String(result.provider||'unknown').slice(0,64),updatedAt:Date.now()};message.translations={...message.translations,[target]:value};insert.run({...scope,id,rank:row.messageIndex,json:JSON.stringify(message)});return{...result,localMessageRecord:true};})();}
 async function translate(account,request,work){
  const existing=get(account,request.messageId,request.text,request.targetLanguage);
  if(request.attachmentOnly)return existing||{text:'',notFound:true};
  if(existing&&!request.forceRefresh)return existing;
  const base=JSON.stringify([account,request.messageId,request.text,request.targetLanguage]),key=base+':'+!!request.forceRefresh;
  if(pending.has(key))return pending.get(key);
  const revision=(revisions.get(base)||0)+1;revisions.set(base,revision);
  const task=Promise.resolve().then(work).then(result=>revisions.get(base)===revision?put(account,request.messageId,request.text,request.targetLanguage,result):get(account,request.messageId,request.text,request.targetLanguage)||result);
  pending.set(key,task);
  try{return await task}finally{if(pending.get(key)===task)pending.delete(key);if(!pending.has(base+':true')&&!pending.has(base+':false'))revisions.delete(base);}
 }
 return{observe,page,get,put,translate,close:()=>db.close()};
}
module.exports={conversation,openEncrypted,createStore};
