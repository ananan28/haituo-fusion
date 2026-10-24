'use strict';
const providers=new Set(['openai','deepseek','groq','qwen','glm','openrouter','custom','google-free','google-cloud','deepl','mymemory','libre','microsoft']);
function sanitize(value){if(!value||typeof value!=='object')return undefined;const result={};for(const name of ['primary','backup'])result[name]=(Array.isArray(value[name])?value[name]:[]).filter(p=>p&&providers.has(p.provider)).slice(0,12).map(p=>({provider:p.provider,apiKey:String(p.apiKey||'').trim(),endpoint:String(p.endpoint||'').trim(),model:String(p.model||'').trim(),region:String(p.region||'').trim(),enabled:p.enabled!==false,vision:!!p.vision}));return result}
function requestFor(entry,request){const compatible=['openai','deepseek','groq','qwen','glm','openrouter','custom'].includes(entry.provider);return {...request,provider:compatible?'openai':entry.provider,apiKey:entry.apiKey,googleCloudApiKey:entry.provider==='google-cloud'?entry.apiKey:'',endpoint:entry.endpoint,model:entry.model,region:entry.region,openaiApiProfiles:[],openaiApiKeys:[],translationPools:undefined,__haituoPool:true}}
// Re-translate rotation: the first translation starts at primary 1, each
// subsequent AI re-translate of the same text starts at the next primary
// entry and wraps around, so three configured APIs are actually exercised in
// order. State is per source text + target language and never persisted.
// The cursor is the identity of the model that last succeeded, so removing
// or adding another entry continues after it; only removing the model itself
// falls back to the first enabled entry.
const rotation=new Map(),ROTATION_LIMIT=200;
function rotationEntryKey(entry){return [entry.provider,entry.endpoint,entry.model].join('|')}
function rotationKey(request){return (request.targetLanguage||'')+'\0'+String(request.text||'').slice(0,4000)}
function rotationStart(key,pools,primaryEnabled){
 if(!key||!primaryEnabled.length)return 0;
 const state=rotation.get(key);
 if(!state||!state.last)return 0;
 const enabledIndex=primaryEnabled.findIndex(([,entry])=>rotationEntryKey(entry)===state.last);
 if(enabledIndex>=0)return (enabledIndex+1)%primaryEnabled.length;
 // Last-used entry was paused or removed: start at the next enabled entry
 // after its former position, wrapping around, so pause never skips a model.
 const full=pools.primary||[],lastIndex=full.findIndex(entry=>rotationEntryKey(entry)===state.last);
 if(lastIndex<0)return 0;
 for(let step=1;step<=full.length;step+=1){const candidate=full[(lastIndex+step)%full.length];if(candidate.enabled===false)continue;const found=primaryEnabled.findIndex(([,entry])=>entry===candidate);if(found>=0)return found}
 return 0;
}
function rememberRotation(key,entry){if(!key||!entry)return;rotation.delete(key);rotation.set(key,{last:rotationEntryKey(entry)});if(rotation.size>ROTATION_LIMIT)rotation.delete(rotation.keys().next().value)}
async function run(pools,request,translate,sleep=ms=>new Promise(r=>setTimeout(r,ms))){const errors=[];let primaryProvider=(pools.primary||[])[0]?.provider,lastPrimaryProvider;
 const primary=[],backup=[];
 for(const entry of pools.primary||[])primary.push(['primary',entry]);
 for(const entry of pools.backup||[])backup.push(['backup',entry]);
 const all=[...primary,...backup];
 if(!all.length){const failure=Error('翻译池为空（主翻译和备用翻译均未成功）：请先在设置中添加翻译接口');failure.status=422;throw failure}
 const primaryEnabled=primary.filter(([,entry])=>entry.enabled!==false),backupEnabled=backup.filter(([,entry])=>entry.enabled!==false);
 let enabled;
 // Every entry paused must not brick translation: degrade to the free
 // channel instead of failing, so a paused pool still yields text.
 if(!primaryEnabled.length&&!backupEnabled.length)enabled=[['free-fallback',{provider:'google-free',apiKey:'',endpoint:'',model:'',region:'',enabled:true}]];
 else{
  const key=request.__haituoLine?'':rotationKey(request);
  const start=request.provider==='smart-retranslate'?rotationStart(key,pools,primaryEnabled):0;
  enabled=[...primaryEnabled.slice(start),...primaryEnabled.slice(0,start),...backupEnabled];
 }
 let seen=0;
 for(const pair of enabled){seen++;const[group,entry]=pair;
  if(group==='primary')lastPrimaryProvider=entry.provider;
  const moreRemaining=seen<enabled.length;
  for(let attempt=0;attempt<2;attempt++){
   const startedAt=Date.now();
   try{if(!['google-free','mymemory','libre'].includes(entry.provider)&&!entry.apiKey)throw Error('未填写 API 密钥');const result=await translate(requestFor(entry,request));if(!result?.text?.trim())throw Error('翻译结果为空');
    if(group==='primary'&&!request.__haituoLine)rememberRotation(rotationKey(request),entry)
    return {...result,provider:entry.provider,pool:group,...(group==='backup'?{fallbackFrom:lastPrimaryProvider||primaryProvider,fallbackReason:errors.at(-1)||'主翻译不可用'}:{})}}
   catch(error){if(error&&error.code==='TRANSLATION_BAD_JSON'||/TRANSLATION_BAD_JSON/.test(String(error&&error.message||error)))throw error;errors.push(String(error.message||error));if([400,401,402,403,404,422].includes(error.status)||/未填写|HTTP (400|401|402|403|404|422)\b/.test(String(error.message)))break;
    // Rate limited: another entry can serve the request right away; retrying
    // the same one before Retry-After elapses is guaranteed to fail again.
    if(error.status===429){if(moreRemaining)break;const retryAfterMs=Math.max(0,Number(error.retryAfterMs)||0);if(retryAfterMs>5000)throw error;if(attempt===0)await sleep(Math.max(700,retryAfterMs));continue}
    // Timeout-grade failures burn tens of seconds each; when another entry is
    // still available, fail over immediately instead of retrying in place.
    if(attempt===0&&moreRemaining&&Date.now()-startedAt>=2000)break;
    if(attempt===0)await sleep(500)}
  }
 }
 const failure=Error('主翻译和备用翻译均未成功：'+errors.slice(-3).join('；'));failure.status=422;throw failure;
}
module.exports={sanitize,requestFor,run};
function fromLegacy(cfg){if(cfg&&typeof cfg==='object'&&!Array.isArray(cfg.translationPools)&&cfg.translationPools&&typeof cfg.translationPools==='object')return sanitize(cfg.translationPools);const provider=providers.has(cfg.chatTranslationProvider)?cfg.chatTranslationProvider:'google-free';const defaults={openai:['https://api.openai.com/v1','gpt-4.1-mini'],deepseek:['https://api.deepseek.com/v1','deepseek-flash'],groq:['https://api.groq.com/openai/v1/chat/completions','openai/gpt-oss-120b']};const first={provider,apiKey:provider==='deepseek'?cfg.deepseekApiKey||'':provider==='google-cloud'?cfg.googleCloudApiKey||'':provider==='groq'?cfg.groqApiKey||'':provider==='deepl'?cfg.deepLApiKey||'':cfg.apiKey||'',endpoint:provider==='groq'?defaults.groq[0]:provider==='deepseek'?cfg.deepseekEndpoint||defaults.deepseek[0]:cfg.endpoint||defaults[provider]?.[0]||'',model:provider==='groq'?defaults.groq[1]:provider==='deepseek'?cfg.deepseekModel||defaults.deepseek[1]:cfg.model||defaults[provider]?.[1]||''};const extra=provider==='deepseek'?String(cfg.deepseekApiKeys||'').split(/\r?\n/):provider==='openai'&&Array.isArray(cfg.openaiApiKeys)?cfg.openaiApiKeys:[];return sanitize({primary:[first,...extra.filter(Boolean).map(apiKey=>({...first,apiKey}))],backup:(cfg.openaiApiProfiles||[]).map(p=>({...p,provider:providers.has(p.service)?p.service:'custom'}))})}
module.exports.fromLegacy=fromLegacy;
