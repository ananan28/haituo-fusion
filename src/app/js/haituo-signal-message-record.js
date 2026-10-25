'use strict';
// Local-only Signal message attributes. The normal SQL message serializer stores
// this field inside the same encrypted message JSON as body, not in the API cache.
const field = 'haituoLocalTranslations';
const queues = new WeakMap();
const controllers = new WeakMap();
function read(cache, id, source, target) {
    const model = cache?.getById(id);
    if (!model || model.get('deletedForEveryone') || model.get('isErased')) return null;
    const record = model.get(field);
    const value = record?.version === 1 && record.entries?.[target];
    return value && value.source === source && typeof value.text === 'string' && value.text.trim()
        ? {text:value.text,provider:value.provider,localMessageRecord:true} : null;
}
async function save(cache, id, source, target, result) {
    if(typeof id!=='string'||!id)throw Error('原消息标识无效，译文未写入消息记录');
    let model = cache?.getById(id);
    if(!model && cache?.haituoGetOrLoadById) model=await cache.haituoGetOrLoadById(id);
    if (!model) throw Error('原消息已移除或无法读取，译文未写入消息记录');
    if (typeof source !== 'string' || !source.trim() || typeof target !== 'string' || !target || target.length > 64 || !result?.text?.trim() || result.text.length > 120000) throw Error('消息译文无效，未写入消息记录');
    // Serialize writes for a message, including failures, so targets cannot replace
    // one another and a rejected write never poisons later retries.
    const operation = (queues.get(model) || Promise.resolve()).catch(()=>{}).then(async()=>{
        if (cache.getById(id) !== model || model.get('deletedForEveryone') || model.get('isErased')) throw Error('原消息已移除，停止保存译文');
        const body = model.get('body');
        if (typeof body === 'string' && body !== source && !(body.length && model.get('bodyAttachment') && source.startsWith(body))) throw Error('原消息已编辑，停止保存旧译文');
        const previous = model.get(field);
        const entries = previous?.version === 1 ? previous.entries : {};
        const next = {version:1,entries:{...entries,[target]:{source,text:result.text,provider:String(result.provider||'unknown').slice(0,64),updatedAt:Date.now()}}};
        model.set({[field]:next});
        try { await cache.saveMessage(model); }
        catch(error) { if(model.get(field) === next) model.set({[field]:previous}); throw error; }
        return {text:result.text,provider:result.provider,localMessageRecord:true};
    });
    queues.set(model,operation);
    try { return await operation; }
    finally { if(queues.get(model)===operation) queues.delete(model); }
}
async function translate(cache,id,source,target,force,work) {
    const existing=read(cache,id,source,target);if(existing&&!force)return existing;
    let controller=controllers.get(cache);if(!controller){controller={pending:new Map,revisions:new Map};controllers.set(cache,controller);}
    const {pending,revisions}=controller,base=JSON.stringify([id,source,target]),key=base+':'+!!force;
    if(!force&&pending.has(base+':true'))return pending.get(base+':true');
    if(pending.has(key))return pending.get(key);
    const revision=(revisions.get(base)||0)+1;revisions.set(base,revision);
    let task;task=Promise.resolve().then(work).then(async result=>{
        if(result?.notFound && !result?.text)return result;
        if(revisions.get(base)!==revision){const newer=pending.get(base+':true');if(newer&&newer!==task)await newer.catch(()=>{});return read(cache,id,source,target)||save(cache,id,source,target,result);}
        return save(cache,id,source,target,result);
    });
    pending.set(key,task);
    try{return await task}finally{if(pending.get(key)===task)pending.delete(key);if(!pending.has(base+':true')&&!pending.has(base+':false'))revisions.delete(base);}
}
module.exports = {field,read,save,translate};
