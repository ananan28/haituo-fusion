const {test}=require('node:test'),assert=require('node:assert/strict');
const {cropRect,parseResult,endpoint}=require('../src/app/js/haituo-screenshot');
const {retryTranslation}=require('../src/app/js/haituo-network');
test('Retina region uses pixel scaling, bounds and rejects invalid input',()=>{assert.deepEqual(cropRect({x:10,y:20,width:100,height:40},{width:800,height:600},{width:1600,height:1200}),{x:20,y:40,width:200,height:80});assert.throws(()=>cropRect({x:NaN,y:0,width:20,height:20},{width:800,height:600},{width:1600,height:1200}));assert.throws(()=>cropRect({x:1,y:1,width:1,height:1},{width:800,height:600},{width:1600,height:1200}));});
test('image result rejects incomplete output and preserves numbers and line breaks',()=>{const result={original:'A 123\nB',translation:'甲 123\n乙'};assert.deepEqual(parseResult({choices:[{message:{content:JSON.stringify(result)}}]}),result);assert.throws(()=>parseResult({choices:[{finish_reason:'length',message:{content:'{}'}}]}),/未完成/);assert.throws(()=>parseResult({choices:[{message:{content:'{"original":"text"}'}}]}),/完整/);});
test('image endpoint accepts full completion URL without duplicating path',()=>{assert.equal(endpoint('https://api.example.test/v1/chat/completions/'),'https://api.example.test/v1/chat/completions');assert.throws(()=>endpoint('file:///a'));});
test('translation succeeds on sixth attempt with five retries, no send operation',async()=>{let calls=0;const progress=[];assert.equal(await retryTranslation(()=>{if(++calls<6)throw Error('timeout');return '译文'},async()=>{},n=>progress.push(n)),'译文');assert.equal(calls,6);assert.deepEqual(progress,[1,2,3,4,5]);});
test('retries stop after five and permanent authentication errors fail immediately',async()=>{let calls=0;await assert.rejects(retryTranslation(()=>{calls++;throw Error('timeout')},async()=>{}),/重试 5 次/);assert.equal(calls,6);calls=0;await assert.rejects(retryTranslation(()=>{calls++;const e=Error('HTTP 401');e.status=401;throw e},async()=>{}));assert.equal(calls,1);});
const fs=require('node:fs'),vm=require('node:vm');
const main=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
function routingContext(cached){const ctx={haituoExistingChatTranslation:()=>null,haituoRememberChatTranslation(){},HaituoNetwork:{translationTimeout:()=>100},cachedHaituoTranslate:cached,setTimeout:resolve=>{resolve();return 1}};vm.createContext(ctx);let a=main.indexOf('function haituoOpenAIProfiles('),b=main.indexOf('\nfunction haituoPumpRequests',a);vm.runInContext(main.slice(a,b),ctx);a=main.indexOf('function haituoProviderEndpointValue(');b=main.indexOf('const HaituoNetwork = require',a);vm.runInContext(main.slice(a,b),ctx);a=main.indexOf('async function haituoTranslateWithMode(');b=main.indexOf('\nasync function cachedHaituoTranslate',a);vm.runInContext(main.slice(a,b),ctx);return ctx;}
test('OpenAI fails twice then switches to arbitrary compatible model with its own credentials',async()=>{const calls=[],ctx=routingContext(async req=>{calls.push({key:req.apiKey,url:req.endpoint,model:req.model});if(req.apiKey==='first')throw Error('timeout');return{text:'译文'}});const result=await ctx.haituoTranslateWithMode({apiKey:'first',endpoint:'https://first.test/v1',model:'first-model',openaiApiProfiles:[{apiKey:'second',endpoint:'https://second.test/v1',model:'custom-any-model'}]},{provider:'openai',purpose:'input',text:'hello',strictProvider:true});assert.equal(result.text,'译文');assert.deepEqual(calls.map(c=>c.key),['first','first','second']);assert.equal(calls[2].model,'custom-any-model');assert.equal(calls[2].url,'https://second.test/v1');});
test('DeepSeek uses independent API config without borrowing OpenAI model',async()=>{let actual;const ctx=routingContext(async req=>{actual=req;return{text:'译文'}});await ctx.haituoTranslateWithMode({apiKey:'openai-key',endpoint:'https://openai.test',model:'openai-model',deepseekApiKey:'deepseek-key',deepseekModel:'custom-deepseek'},{provider:'deepseek',purpose:'chat',text:'hi',strictProvider:true});assert.equal(actual.apiKey,'deepseek-key');assert.equal(actual.endpoint,'https://api.deepseek.com/v1');assert.equal(actual.model,'custom-deepseek');});
test('shared settings have identical multi-entry primary/backup services and automatic presets',async()=>{
 const renderer=fs.readFileSync(__dirname+'/../src/app/bundles/preload/main.js','utf8'),a=renderer.indexOf('    function haituoActivePoolProvider('),b=renderer.indexOf('    function haituoProviderOptionLabel(',a);
 let cfg={translationPools:{primary:[{provider:'openai',apiKey:'old',endpoint:'https://api.openai.com/v1',model:'gpt-4.1-mini'}],backup:[{provider:'deepseek',apiKey:'backup',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash'}]}};
 const updates=[],ctx={document:{activeElement:null},window:{SignalContext:{OS:{platform:'win32'},caishengGetTranslationConfig:async()=>cfg,caishengShortcutRecording:async()=>{},caishengSetTranslationConfig:async delta=>{updates.push(delta);cfg={...cfg,...delta}}}},alert:()=>{}};vm.createContext(ctx);vm.runInContext(renderer.slice(a,b),ctx);
 const F={jsx:(tag,props,key)=>({tag,...props,key}),jsxs:(tag,props,key)=>({tag,...props,key})},nodes=[];function walk(n){if(!n||typeof n!=='object')return;nodes.push(n);for(const c of [].concat(n.children||[]))walk(c)}
 walk(ctx.haituoPoolControls(F,cfg));walk(ctx.haituoAdvancedSettingsControls(F,cfg));
 const primary=nodes.find(n=>n['aria-label']==='主翻译服务商'),backup=nodes.find(n=>n['aria-label']==='备用翻译服务商');assert.deepEqual(primary.children.map(c=>c.value),backup.children.map(c=>c.value));
 primary.onChange({target:{value:'deepseek'}});await vm.runInContext('haituoPoolSaveQueue',ctx);assert.equal(cfg.translationPools.primary[0].endpoint,'https://api.deepseek.com/v1');assert.equal(cfg.translationPools.primary[0].model,'deepseek-flash');assert.equal(cfg.translationPools.primary[0].apiKey,'');assert.equal(cfg.translationPools.backup[0].apiKey,'backup');
 for(const field of ['screenshotShortcut','screenshotCopyShortcut'])assert.ok(nodes.some(n=>n['data-haituo-setting']===field),field);
 assert.ok(nodes.some(n=>n.children==='＋ 添加免费 Google 截图翻译（无需 API）'));assert.equal(nodes.filter(n=>n.type==='checkbox').filter(n=>n.checked===true).length,0);
 const field=nodes.find(n=>n['data-haituo-setting']==='screenshotCopyShortcut'),el={dataset:{},isConnected:true,value:'',blur(){}};ctx.document.activeElement=el;await field.onFocus({currentTarget:el});await field.onKeyDown({currentTarget:el,key:'t',ctrlKey:true,altKey:true,preventDefault(){},stopPropagation(){}});assert.equal(updates.at(-1).screenshotCopyShortcut,'Control+Alt+T');assert.equal(field.readOnly,true);
});
test('screenshot UI uses a separate session from Signal protocol interception',()=>{const source=fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.js','utf8');assert.match(source,/partition:'haituo-screenshot-ui'/);assert.match(main,/actual-screenshot-ui-session/);});

test('screenshot reuses configured vision routes and rejects text-only dedicated DeepSeek model',()=>{const {profilesForConfig}=require('../src/app/js/haituo-screenshot');assert.equal(profilesForConfig({apiKey:'configured'} )[0].model,'gpt-4.1-mini');assert.equal(profilesForConfig({deepseekApiKey:'configured'})[0].model,'deepseek-flash');assert.equal(profilesForConfig({deepseekApiKey:'configured',deepseekModel:'deepseek-v4-pro'}).length,0);assert.equal(profilesForConfig({}).length,0);});

test('Google official uses independent key in header, text body and entity decoding',async()=>{
 const {translateGoogle}=require('../src/app/js/haituo-google');let call;
 const result=await translateGoogle(async(...args)=>{call=args;return {data:{translations:[{translatedText:'你好 &amp; &#x31;'}]}}},{text:'Hello & 1',provider:'google-cloud',apiKey:'google-only'});
 assert.equal(result,'你好 & 1');assert.equal(call[0],'https://translation.googleapis.com/language/translate/v2');assert.equal(call[1].headers['X-Goog-Api-Key'],'google-only');assert.deepEqual(JSON.parse(call[1].body),{q:'Hello & 1',target:'zh-CN',format:'text'});
 await assert.rejects(translateGoogle(()=>{throw Error('must not call')},{text:'x',provider:'google-cloud'}),/专用/);
});
test('Google free needs no key, joins segments and chunks without breaking surrogate pairs',async()=>{
 const {translateGoogle}=require('../src/app/js/haituo-google');const calls=[];
 const output=await translateGoogle(async(url,init)=>{calls.push(new URL(url));assert.deepEqual(init,{});return [[['译',null],['文',null]]]},{text:'😀'.repeat(1001),provider:'google-free'});
 assert.equal(output,'译文译文');assert.equal(calls.length,2);assert.equal([...calls[0].searchParams.get('q')].length,1000);assert.equal(calls[1].searchParams.get('q'),'😀');assert.ok(!calls[0].searchParams.has('key'));
});
test('screenshot defaults to bilingual and retains in-place translation mode',()=>{
 const html=fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.html','utf8');const script=html.match(/<script>([\s\S]*)<\/script>/)[1];new vm.Script(script);
 assert.match(script,/function render\(mode='compare'\)/);assert.match(script,/source.textContent=block.original;target.textContent=block.translation/);
 assert.match(script,/layer\.style\.background='transparent'/);assert.match(script,/background:result\.background\|\|'#fff'/);assert.doesNotMatch(html,/grid-template-columns:1fr 1fr/);
 assert.match(html,/\.compare\{[^}]*background:transparent/);assert.match(html,/\.pair\{[^}]*background:rgba\(17,24,32,\.92\)/);assert.match(html,/\.pair\.fallback\{[^}]*bottom:16px/);
 assert.match(html,/#translation\.flow\{[^}]*bottom:16px/);assert.doesNotMatch(html,/#translation\.flow\{[^}]*background:#ffffff/i);
 assert.doesNotMatch(fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.js','utf8'),/function showResult|resultWindow/);
});

test('Google Cloud cannot borrow an unrelated AI key',()=>{assert.match(main,/apiKey:e.googleCloudApiKey\|\|''/);const source=fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.js','utf8');assert.doesNotMatch(source,/googleCloudApiKey\|\|cfg.apiKey/);assert.match(source,/安装包内系统 OCR 自检失败/)});

test('Google paid screenshot batches blocks with exact pairing and duplicate reuse',async()=>{const {translateGoogleBlocks}=require('../src/app/js/haituo-google');let calls=0;const blocks=[{original:'First',x:0},{original:'Second',x:1},{original:'First',x:2}];const output=await translateGoogleBlocks(async(url,init)=>{calls++;assert.deepEqual(JSON.parse(init.body).q,['First','Second']);return {data:{translations:[{translatedText:'第一条'},{translatedText:'第二条'}]}}},blocks,{provider:'google-cloud',apiKey:'fixture'});assert.equal(calls,1);assert.deepEqual(output.map(b=>b.translation),['第一条','第二条','第一条']);assert.deepEqual(output.map(b=>b.x),[0,1,2]);});

test('primary pool exhausts before backup; next request returns to primary and normal success never calls backup',async()=>{const {run}=require('../src/app/js/haituo-translation-pools');const pools={primary:[{provider:'openai',apiKey:'p1'},{provider:'openai',apiKey:'p2'}],backup:[{provider:'deepseek',apiKey:'b1',endpoint:'https://api.deepseek.com/v1',model:'deepseek-flash'}]};const calls=[];let healthy=false;const work=async req=>{calls.push(req.apiKey);if(!healthy&&req.apiKey!=='b1')throw Error('timeout');return {text:'ok'}};assert.equal((await run(pools,{text:'first'},work,async()=>{})).pool,'backup');assert.deepEqual(calls,['p1','p1','p2','p2','b1']);healthy=true;calls.length=0;assert.equal((await run(pools,{text:'next'},work,async()=>{})).pool,'primary');assert.deepEqual(calls,['p1']);});
test('native capture mode is separate from translation and validates PNG before writing clipboard',()=>{const source=fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.js','utf8'),html=fs.readFileSync(__dirname+'/../src/app/js/haituo-screenshot.html','utf8');assert.match(source,/captureOnly=options.mode==='capture'/);assert.match(source,/await require\('\.\/haituo-clipboard'\).writeImage\(e,png\)/);assert.match(source,/event.sender!==overlay.webContents/);assert.match(html,/if\(captureOnly\).*setTool\('move'\)/);assert.match(html,/context.drawImage\(editor/);assert.match(html,/commands.pop\(\)/);});

test('Electron 44 clipboard writes and reads actual PNG blobs asynchronously',async()=>{const {writeImage,readImage}=require('../src/app/js/haituo-clipboard');const bytes=Buffer.from('fixture png');let stored;class Item{constructor(data){this.data=data;this.types=Object.keys(data)}async getType(type){return this.data[type]}}const e={ClipboardItem:Item,clipboard:{write:async items=>{stored=items},read:async()=>stored},nativeImage:{createFromBuffer:buffer=>({buffer})}};await writeImage(e,{toPNG:()=>bytes});assert.equal(stored[0].types[0],'image/png');assert.deepEqual((await readImage(e)).buffer,bytes);});

test('empty screenshot pool remains usable for free OCR translation without a key',()=>{
 const {screenshotRoutes}=require('../src/app/js/haituo-screenshot');
 assert.equal(screenshotRoutes({})[0].provider,'google-free');assert.equal(screenshotRoutes({screenshotApiPool:[]})[0].provider,'google-free');
 assert.equal(screenshotRoutes({screenshotApiPool:[{provider:'openai',apiKey:'own'}]})[0].apiKey,'own');
 assert.equal(screenshotRoutes({screenshotApiPool:[{provider:'openai',enabled:false}]})[0].provider,'google-free','all paused must degrade to free instead of bricking the shortcut');
 assert.equal(screenshotRoutes({screenshotApiPool:[{provider:'openai',enabled:false},{provider:'google-cloud',apiKey:'g'}]})[0].provider,'google-cloud','paused entries are skipped');
});
test('both shortcuts default off, enable independently and restore only enabled registrations',()=>{
 const {EventEmitter}=require('node:events'),{createController}=require('../src/app/js/haituo-screenshot'),registered=new Map();
 const electron={ipcMain:{handle(){},on(){}},app:new EventEmitter(),globalShortcut:{register(k,f){registered.set(k,f);return true},unregister(k){registered.delete(k)}}};
 const c=createController({electron,getConfig:()=>({})});c.configure({});assert.equal(registered.size,0);
 c.configure({screenshotCopyEnabled:true});assert.deepEqual([...registered.keys()],['CommandOrControl+Alt+S']);c.pauseShortcut();assert.equal(registered.size,0);c.resumeShortcut();assert.equal(registered.size,1);
 c.configure({screenshotEnabled:true,screenshotCopyEnabled:false});assert.deepEqual([...registered.keys()],['CommandOrControl+Alt+O']);c.configure({});assert.equal(registered.size,0);
});
test('ordinary capture uses full cursor monitor without activating or cropping Haituo',async()=>{
 const {EventEmitter}=require('node:events'),{createController}=require('../src/app/js/haituo-screenshot');let windowOptions,sent,shown=0;
 class Window extends EventEmitter{constructor(o){super();windowOptions=o;this.webContents={setWindowOpenHandler(){},on(){},send(...v){sent=v}}}setVisibleOnAllWorkspaces(){}async loadFile(){}isDestroyed(){return false}showInactive(){shown++}}
 const electron={BrowserWindow:Window,app:new EventEmitter(),ipcMain:{handle(){},on(){}},screen:{getCursorScreenPoint:()=>({x:2000,y:50}),getDisplayNearestPoint(p){assert.equal(p.x,2000);return{id:2,bounds:{x:1920,y:0,width:2560,height:1440},scaleFactor:2}}},desktopCapturer:{async getSources(){return[{display_id:'2',thumbnail:{isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,full-screen',crop(){throw Error('must not crop')}}}]}},globalShortcut:{}};
 const controller=createController({electron,platform:'win32',getConfig:()=>({}),getAppWindow(){throw Error('must not focus Haituo')},requestJSON(){throw Error('capture must not translate')}});
 await controller.start({mode:'capture'});assert.equal(windowOptions.x,1920);assert.equal(windowOptions.width,2560);assert.equal(windowOptions.height,1440);assert.equal(windowOptions.focusable,true);assert.equal(shown,1);assert.equal(sent[1].mode,'capture');assert.equal(sent[1].image,'data:image/png;base64,full-screen');
});
test('translate overlay never activates Haituo and escapes globally instead',async()=>{
 const {EventEmitter}=require('node:events'),{createController}=require('../src/app/js/haituo-screenshot');let windowOptions,shown=0,focused=0,shortcuts=[];
 class Window extends EventEmitter{constructor(o){super();windowOptions=o;this.webContents={setWindowOpenHandler(){},on(){},send(){}}}setVisibleOnAllWorkspaces(){}async loadFile(){}isDestroyed(){return false}showInactive(){shown++}show(){throw Error('must not show actively')}focus(){focused++}}
 const electron={BrowserWindow:Window,app:new EventEmitter(),ipcMain:{handle(){},on(){}},screen:{getCursorScreenPoint:()=>({x:10,y:10}),getDisplayNearestPoint:()=>({id:1,bounds:{x:0,y:0,width:1280,height:800},scaleFactor:2})},desktopCapturer:{async getSources(){return[{display_id:'1',thumbnail:{isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,full'}}]}},globalShortcut:{register(k){shortcuts.push(k);return true},unregister(k){shortcuts=shortcuts.filter(v=>v!==k)}}};
 const controller=createController({electron,platform:'win32',getConfig:()=>({screenshotApiPool:[{provider:'google-free'}]}),getAppWindow(){throw Error('must not focus Haituo')},requestJSON(){throw Error('translate overlay must not capture itself')}});
 await controller.start();assert.equal(windowOptions.focusable,false);assert.equal(shown,1);assert.equal(focused,0);assert.deepEqual(shortcuts,['Escape']);
});
test('four input/back-translation options collapse together and Save is last',()=>{
 const renderer=fs.readFileSync(__dirname+'/../src/app/bundles/preload/main.js','utf8'),a=renderer.indexOf('    function haituoGroupedSettings('),b=renderer.indexOf('    let haituoPoolSaveQueue=',a),ctx={};vm.createContext(ctx);vm.runInContext(renderer.slice(a,b),ctx);
 const F={jsx:(tag,props)=>({type:tag,props}),jsxs:(tag,props)=>({type:tag,props})},labels=['隐藏输入框翻译工具栏','接收回译','发送回译','群组回译'],save=F.jsx('button',{children:'保存设置'});
 const tree=ctx.haituoGroupedSettings(F,{children:[save,...labels.map(label=>F.jsx('label',{children:label})),F.jsx('button',{children:'测试连接'}),F.jsx('label',{children:'气泡颜色'})]});
 const children=tree.props.children,drawer=children.find(n=>n?.props?.['data-haituo-settings-group']==='backtranslation');assert.ok(drawer);assert.equal(drawer.props.open,undefined);assert.deepEqual(Array.from(drawer.props.children.slice(1),n=>n.props.children),labels);assert.equal(children.at(-1),save);
});
