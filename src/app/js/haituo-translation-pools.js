'use strict';
const providers=new Set(['openai','deepseek','groq','qwen','glm','openrouter','custom','google-free','google-cloud','deepl','mymemory','libre','microsoft']);
function sanitize(value){if(!value||typeof value!=='object')return undefined;const result={};for(const name of ['primary','backup'])result[name]=(Array.isArray(value[name])?value[name]:[]).filter(p=>p&&providers.has(p.provider)).slice(0,12).map(p=>({provider:p.provider,apiKey:String(p.apiKey||'').trim(),endpoint:String(p.endpoint||'').trim(),model:String(p.model||'').trim(),region:String(p.region||'').trim(),enabled:p.enabled!==false,vision:!!p.vision}));return result}
function requestFor(entry,request){const compatible=['openai','deepseek','groq','qwen','glm','openrouter','custom'].includes(entry.provider);return {...request,provider:compatible?'openai':entry.provider,apiKey:entry.apiKey,googleCloudApiKey:entry.provider==='google-cloud'?entry.apiKey:'',endpoint:entry.endpoint,model:entry.model,region:entry.region,openaiApiProfiles:[],openaiApiKeys:[],translationPools:undefined,__haituoPool:true}}
async function run(pools,request,translate,sleep=ms=>new Promise(r=>setTimeout(r,ms))){const errors=[];let primaryProvider=(pools.primary||[])[0]?.provider;
 const all=[];
 for(const group of ['primary','backup'])for(const entry of pools[group]||[])all.push([group,entry]);
 let enabled=all.filter(([,entry])=>entry.enabled!==false);
 // Every entry paused must not brick translation: degrade to the free
 // channel instead of failing, so a paused pool still yields text.
 if(!enabled.length&&all.length)enabled=[['free-fallback',{provider:'google-free',apiKey:'',endpoint:'',model:'',region:'',enabled:true}]];
 let seen=0;
 for(const [group,entry] of enabled){seen++;
  const moreRemaining=seen<enabled.length;
  for(let attempt=0;attempt<2;attempt++){
   const startedAt=Date.now();
   try{if(!['google-free','mymemory','libre'].includes(entry.provider)&&!entry.apiKey)throw Error('未填写 API 密钥');const result=await translate(requestFor(entry,request));if(!result?.text?.trim())throw Error('翻译结果为空');return {...result,provider:entry.provider,pool:group,...(group==='backup'?{fallbackFrom:primaryProvider,fallbackReason:errors.at(-1)||'主翻译不可用'}:{})}}
   catch(error){if(error&&error.code==='TRANSLATION_BAD_JSON'||/TRANSLATION_BAD_JSON/.test(String(error&&error.message||error)))throw error;errors.push(String(error.message||error));if([400,401,402,403,404,422].includes(error.status)||/未填写|HTTP (400|401|402|403|404|422)\b/.test(String(error.message)))break;
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
