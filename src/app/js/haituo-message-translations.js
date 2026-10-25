'use strict';
// Durable message attachments, deliberately separate from the disposable API cache.
// Paths contain hashes only. Account identity is supplied by the main process.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
function address(identity, request) {
    if (!identity || !['signal','whatsapp','telegram'].includes(identity.platform) || typeof identity.account !== 'string' || !identity.account || identity.account.length > 512) throw Error('Invalid message account');
    if (typeof identity.messageId !== 'string' || !identity.messageId.trim() || identity.messageId.length > 1024) throw Error('Invalid message ID');
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 30000) throw Error('Invalid message source');
    const target = String(request.targetLanguage || 'zh-CN');
    if (target.length > 64) throw Error('Invalid message target');
    const account = hash(JSON.stringify([identity.platform,identity.account]));
    const message = hash(identity.messageId);
    const key = hash(JSON.stringify([identity.messageId,request.text.trim(),target]));
    return {account, bucket:message.slice(0,2), key};
}
function createStore({directory, read, write, residentLimit = 16}) {
    const resident = new Map(), pending = new Map(), revisions = new Map();
    function shard(a) {
        const file = path.join(directory,a.account,a.bucket+'.json');
        let value = resident.get(file);
        if (!value) {
            value = read(file,null);
            if (value === null) {
                if (fs.existsSync(file)) throw Error('消息译文记录暂时无法读取，原文件已保留');
                value = {version:1,entries:{}};
            }
            if (value.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) throw Error('消息译文记录格式无效，原文件已保留');
        }
        resident.delete(file); resident.set(file,value);
        while (resident.size > residentLimit) resident.delete(resident.keys().next().value);
        return {file,value};
    }
    function get(identity,request) {
        const a=address(identity,request), {value}=shard(a), item=value.entries[a.key];
        if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
        return {text:item.text,provider:item.provider,cached:true,attached:true};
    }
    function put(identity,request,result) {
        if (!result || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 120000 || result.finish_reason === 'length' || result.finishReason === 'length') throw Error('译文为空、不完整或需要核对，未保存常驻记录');
        const a=address(identity,request), {file,value}=shard(a);
        const item={text:result.text,provider:String(result.provider||'unknown').slice(0,64),updatedAt:Date.now()};
        const next={version:1,entries:{...value.entries,[a.key]:item}};
        if (write(file,next) !== true) throw Error('常驻译文保存失败，请检查本机存储权限');
        resident.set(file,next);
        return {...result,attached:true};
    }
    async function translate(identity,request,work) {
        // Even force-refresh keeps the previous successful attachment on failure.
        const stored=get(identity,request);
        if (request.attachmentOnly) return stored || {text:'',notFound:true};
        if (stored && !request.forceRefresh) return stored;
        const a=address(identity,request), key=a.account+':'+a.key+':'+!!request.forceRefresh;
        if (pending.has(key)) return pending.get(key);
        const revision=(revisions.get(a.account+":"+a.key)||0)+1;
        revisions.set(a.account+":"+a.key,revision);
        const operation=Promise.resolve().then(work).then(result=>{
            if(revisions.get(a.account+":"+a.key)!==revision) return get(identity,request) || put(identity,request,result);
            return put(identity,request,result);
        });
        pending.set(key,operation);
        try { return await operation; } finally {
            if (pending.get(key)===operation) pending.delete(key);
            const base=a.account+":"+a.key;
            if(!pending.has(base+":true")&&!pending.has(base+":false")) revisions.delete(base);
        }
    }
    return {get,put,translate};
}
module.exports={address,createStore};
