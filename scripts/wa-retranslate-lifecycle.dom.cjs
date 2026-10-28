'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.HAITUO_QA_NODE_MODULES||'/tmp/haituo-qa/node_modules']}));
test('AI retranslation ignores late result and late error after chat switch or DOM recycling',async t=>{
 const dom=new JSDOM('<body></body>',{pretendToBeVisual:true,runScripts:'outside-only'});t.after(()=>dom.window.close());global.document=dom.window.document;
 const source=fs.readFileSync('src/app/js/caisheng-webview-preload.js','utf8'),a=source.indexOf('function haituoInstallMessageScanner('),b=source.indexOf("if (document.readyState === 'loading')",a),scanner=source.slice(a,b);
 const factory=vm.runInThisContext('(function(deps){with(deps){'+scanner+';haituoInstallMessageScanner();}})');
 await require('./wa-rollback-fixture.cjs')(scanner,factory,async({deps,rows,d,observers})=>{
  // Freeze observers to inspect the original detached/recycled nodes directly.
  for(const observer of observers)observer.disconnect();
  let toasts=0;deps.toast=()=>{toasts++};
  for(const mode of ['chat','row','detached','error']){
   const row=rows[['chat','row','detached','error'].indexOf(mode)],button=row.querySelector('[aria-label="AI 重译"]'),text=row.querySelector('.haituo-wa-message-translation > span');
   const previous=text.textContent;let resolve,reject;
   deps.translateMessage=()=>new Promise((yes,no)=>{resolve=yes;reject=no});
   const pending=button.onclick({preventDefault(){},stopPropagation(){},currentTarget:button});
   assert.equal(button.disabled,true);
   if(mode==='row')row.dataset.id='synthetic-recycled';
   else if(mode==='detached')row.remove();
   else d.querySelector('header').textContent='synthetic chat '+mode;
   if(mode==='error')reject(Error('synthetic old failure'));else resolve('late synthetic translation');
   await pending;
   assert.equal(text.textContent,previous,mode+' overwrote old translation');
   assert.equal(button.disabled,false);
   // Restore header so the next original row is a current request before its await.
   d.querySelector('header').textContent='Observer rollback';
  }
  assert.equal(toasts,0,'retired request surfaced an error in the new chat');
  const current=rows[4],button=current.querySelector('[aria-label="AI 重译"]');
  deps.translateMessage=async()=> 'current synthetic translation';
  await button.onclick({preventDefault(){},stopPropagation(){},currentTarget:button});
  assert.equal(current.querySelector('.haituo-wa-message-translation > span').textContent,'current synthetic translation');
 });
});
