'use strict';
// Local-only Signal message attributes. The normal SQL message serializer stores
// this field inside the same encrypted message JSON as body, not in the API cache.
const field = 'haituoLocalTranslations';
const queues = new WeakMap();
function read(cache, id, source, target) {
    const model = cache?.getById(id);
    if (!model || model.get('deletedForEveryone') || model.get('isErased')) return null;
    const record = model.get(field);
    const value = record?.version === 1 && record.entries?.[target];
    return value && value.source === source && typeof value.text === 'string' && value.text.trim()
        ? {text:value.text,provider:value.provider,localMessageRecord:true} : null;
}
async function save(cache, id, source, target, result) {
    const model = cache?.getById(id);
    if (!model || !id) throw Error('原消息尚未载入，译文未写入消息记录');
    if (typeof source !== 'string' || !source.trim() || typeof target !== 'string' || !target || target.length > 64 || !result?.text?.trim() || result.text.length > 120000) throw Error('消息译文无效，未写入消息记录');
    // Serialize writes for a message, including failures, so targets cannot replace
    // one another and a rejected write never poisons later retries.
    const operation = (queues.get(model) || Promise.resolve()).catch(()=>{}).then(async()=>{
        if (cache.getById(id) !== model || model.get('deletedForEveryone') || model.get('isErased')) throw Error('原消息已移除，停止保存译文');
        const body = model.get('body');
        if (typeof body === 'string' && body !== source) throw Error('原消息已编辑，停止保存旧译文');
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
module.exports = {field,read,save};
