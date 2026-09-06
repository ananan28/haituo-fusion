'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let services = [];
let currentId = '';
let accountEditingId = '';
const signalUi = new Map();
const state = new Map();
const translatedMessages = new Map();
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
let composing = false;
let translating = false;

function toast(message, bad = false) {
  const el = $('#toast'); el.textContent = message; el.className = bad ? 'show bad' : 'show';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 2600);
}
function active() { return services.find(x => x.id === currentId); }
async function translationScope(service, conversationId) {
  return caisheng.translation.getScope(service.id, conversationId || '当前会话');
}
async function translateValue(service, conversationId, text) {
  const scope = await translationScope(service, conversationId);
  return caisheng.translation.translate({
    accountId: service.id, conversationId: conversationId || '当前会话', text,
    target: HAN.test(text) ? (scope.target || scope.defaultTarget || 'en') : 'zh-CN'
  });
}
function friendlyError(error, fallback = '操作失败，请稍后重试') {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return fallback;
  return raw.replace(/^Error:\s*/i, '').replace(/ERR_[A-Z_]+/g, '网络连接异常');
}
function makeLoading(text = '正在加载服务…') {
  const section = document.createElement('section'); section.className = 'loading-page';
  const spinner = document.createElement('div'); spinner.className = 'spinner';
  const title = document.createElement('strong'); title.textContent = text;
  const hint = document.createElement('p'); hint.textContent = '若网络较慢，请稍候或使用右侧刷新按钮。';
  section.append(spinner, title, hint); return section;
}
function makeIcon(service) {
  const icon = document.createElement('i');
  icon.style.background = service.color; icon.textContent = (service.name || '?').trim().charAt(0).toUpperCase();
  return icon;
}
function home() {
  currentId = ''; caisheng.hide(); renderServices();
  $('#content').replaceChildren(makeWelcome());
}
function makeWelcome() {
  const section = document.createElement('section'); section.className = 'welcome';
  const mark = document.createElement('div'); mark.className = 'mark'; mark.textContent = '财';
  const h = document.createElement('h1'); h.textContent = '财盛聚合聊天';
  const p = document.createElement('p'); p.textContent = services.length ? '从左侧选择一个通信账号' : '集中管理多个完全独立的通信账号';
  const button = document.createElement('button'); button.textContent = services.length ? '添加更多服务' : '添加第一个服务'; button.onclick = picker;
  section.append(mark, h, p, button); return section;
}
async function loadServices() { services = await caisheng.services(); renderServices(); }
function renderServices() {
  const nav = $('#services'), quick = $('#quickAccounts'); nav.replaceChildren(); quick.replaceChildren();
  for (const service of services) {
    const button = document.createElement('button'); button.className = 'service' + (currentId === service.id ? ' active' : '') + (service.enabled ? '' : ' disabled');
    button.append(makeIcon(service));
    const copy = document.createElement('span'), strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = service.name; small.textContent = service.note || (service.enabled ? (state.get(service.id)?.loading ? '正在加载…' : service.recipeId) : '已停用');
    copy.append(strong, small); button.append(copy);
    if (service.unread) { const badge = document.createElement('em'); badge.textContent = service.unread > 99 ? '99+' : String(service.unread); button.append(badge); }
    button.onclick = () => open(service);
    button.oncontextmenu = event => { event.preventDefault(); currentId = service.id; renderServices(); $('#menuTitle').textContent = service.name; $('#serviceMenu').showModal(); };
    nav.append(button);
    const q = document.createElement('button'); q.className = currentId === service.id ? 'active' : ''; q.title = service.name + (service.note ? ' · ' + service.note : ''); q.append(makeIcon(service)); q.onclick = () => open(service); quick.append(q);
  }
}
function signalStateFor(id){ if(!signalUi.has(id)) signalUi.set(id,{conversation:'',conversations:[],messages:[],status:'未连接'}); return signalUi.get(id); }
function signalMessageNode(m,service){
  const row=document.createElement('article'); row.className='signalMessage'; row.dataset.id=m.id;
  const who=document.createElement('b'); who.textContent=m.sender||'消息';
  const text=document.createElement('p'); text.textContent=m.text||((m.attachments||[]).length?'[附件]':'');
  row.append(who,text);
  const translationKey=service.id+':'+m.conversationId+':'+m.id;
  const known=translatedMessages.get(translationKey);
  if(known){const translated=document.createElement('p');translated.className='translatedText';translated.textContent='译文：'+known;text.after(translated)}
  for(const a of m.attachments||[]){const el=document.createElement(a.contentType?.startsWith('image/')?'img':a.contentType?.startsWith('video/')?'video':a.contentType?.startsWith('audio/')?'audio':'a');if(el.tagName==='A'){el.textContent=a.filename||'下载附件';el.href='#'}else{el.controls=true;el.src=a.localPath||a.path||''}row.append(el)}
  const tools=document.createElement('div'); tools.className='messageTools';
  for(const [label,fn] of [['翻译',async()=>{const result=await translateValue(service,m.conversationId,m.text||'');translatedMessages.set(translationKey,result.translatedText);const scope=await translationScope(service,m.conversationId);if(scope.showOriginal===false)text.hidden=true;const translated=document.createElement('p');translated.className='translatedText';translated.textContent='译文：'+result.translatedText;text.after(translated)}],['回复',()=>{signalStateFor(service.id).quote={timestamp:m.timestamp,author:m.sender,text:m.text};toast('已引用该消息')}],['回应',async()=>{await caisheng.signal.reaction(service.id,signalStateFor(service.id).conversation,'👍',{timestamp:m.timestamp,author:m.sender},false)}],['编辑',async()=>{const x=prompt('编辑消息',m.text||'');if(x!=null)await caisheng.signal.edit(service.id,signalStateFor(service.id).conversation,m.timestamp,x)}],['撤回',async()=>{if(confirm('确定撤回这条消息吗？'))await caisheng.signal.delete(service.id,signalStateFor(service.id).conversation,m.timestamp)}]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>fn().catch(e=>toast(e.message,true));tools.append(b)}
  row.append(tools);return row;
}
async function renderSignal(service){
  const model=signalStateFor(service.id), section=document.createElement('section');section.className='signalWorkspace';
  const side=document.createElement('div');side.className='signalConversations';
  const head=document.createElement('div');head.className='signalAccountHead';const accountName=document.createElement('b'),accountState=document.createElement('span');accountName.textContent=service.name;accountState.textContent=model.status;head.append(accountName,accountState);
  const actions=document.createElement('div');
  const link=document.createElement('button');link.textContent='扫码连接';link.onclick=async()=>{try{const x=await caisheng.signal.link(service.id);const box=document.createElement('div');box.className='signalLink';const title=document.createElement('b');title.textContent='请用 Signal 手机端扫描';const uri=document.createElement('textarea');uri.readOnly=true;uri.value=x.uri;const copy=document.createElement('button');copy.textContent='复制连接码';copy.onclick=()=>navigator.clipboard.writeText(x.uri);box.append(title,uri,copy);$('#content').replaceChildren(box);toast('二维码连接信息已生成')}catch(e){toast(e.message,true)}};
  const reconnect=document.createElement('button');reconnect.textContent='重新连接';reconnect.onclick=()=>caisheng.signal.reconnect(service.id).then(()=>renderSignal(service)).catch(e=>toast(e.message,true));actions.append(link,reconnect);side.append(head,actions);
  const list=document.createElement('div');list.className='conversationList';side.append(list);
  const chat=document.createElement('div');chat.className='signalChat';const messages=document.createElement('div');messages.className='signalMessages';chat.append(messages);
  const composer=document.createElement('form');composer.className='signalComposer';
  const input=document.createElement('textarea');input.placeholder='输入消息，按空格可翻译';
  const preview=document.createElement('div');preview.className='translationPreview';
  const options=document.createElement('div');options.className='composerOptions';
  const target=document.createElement('select');target.title='当前会话目标语言';
  for(const [value,label] of [['en','英语'],['zh-CN','简体中文'],['ja','日语'],['ko','韩语'],['es','西班牙语'],['fr','法语'],['de','德语'],['ru','俄语']]){const option=document.createElement('option');option.value=value;option.textContent=label;target.append(option)}
  const space=document.createElement('label'),spaceCheck=document.createElement('input');spaceCheck.type='checkbox';space.append(spaceCheck,document.createTextNode(' 空格翻译'));
  const block=document.createElement('label'),blockCheck=document.createElement('input');blockCheck.type='checkbox';block.append(blockCheck,document.createTextNode(' 禁止发送中文'));
  const undo=document.createElement('button');undo.type='button';undo.textContent='撤销翻译';undo.disabled=true;
  const translate=document.createElement('button');translate.type='button';translate.textContent='翻译输入';
  options.append(target,space,block,undo,translate);
  const file=document.createElement('input');file.type='file';file.multiple=true;file.accept='image/*,video/*,audio/*,*/*';
  const send=document.createElement('button');send.textContent='发送';composer.append(input,preview,options,file,send);chat.append(composer);section.append(side,chat);$('#content').replaceChildren(section);
  let originalDraft='';
  const updateConversationSettings=async()=>{if(!model.conversation)return;await caisheng.translation.updateScope(service.id,model.conversation,{target:target.value,spaceTranslate:spaceCheck.checked,blockChinese:blockCheck.checked})};
  target.onchange=updateConversationSettings;spaceCheck.onchange=updateConversationSettings;blockCheck.onchange=updateConversationSettings;
  const translateDraft=async()=>{if(translating||!input.value.trim())return;translating=true;originalDraft=input.value;translate.disabled=true;try{const result=await translateValue(service,model.conversation,input.value);input.value=result.translatedText;preview.textContent='原文：'+originalDraft;undo.disabled=false;toast('翻译完成')}catch(error){toast(error.message||'翻译失败，已保留原文',true)}finally{translating=false;translate.disabled=false}};
  translate.onclick=translateDraft;undo.onclick=()=>{if(!originalDraft)return;input.value=originalDraft;originalDraft='';preview.textContent='';undo.disabled=true;input.focus()};
  input.addEventListener('compositionstart',()=>{composing=true});input.addEventListener('compositionend',()=>{composing=false});
  input.addEventListener('keydown',async event=>{if(event.code!=='Space'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||composing||translating||!input.value.trim())return;const scope=await translationScope(service,model.conversation);if(!scope.spaceTranslate)return;event.preventDefault();await translateDraft();if(scope.autoSend)composer.requestSubmit()});
  try{const st=await caisheng.signal.state(service.id);model.status=st.status||'未连接';head.children[1].textContent=model.status;if(st.status!=='未连接'&&st.status!=='等待扫码'){await caisheng.signal.start(service.id);model.conversations=await caisheng.signal.conversations(service.id)}}
  catch(e){model.status='连接错误';head.children[1].textContent='连接错误：'+e.message}
  const choose=async conv=>{model.conversation=conv.id;model.messages=await caisheng.signal.history(service.id,conv.id,500);const scope=await translationScope(service,conv.id);target.value=scope.target||scope.defaultTarget||'en';spaceCheck.checked=Boolean(scope.spaceTranslate);blockCheck.checked=Boolean(scope.blockChinese);messages.replaceChildren(...model.messages.map(m=>signalMessageNode(m,service)));messages.scrollTop=messages.scrollHeight;if(scope.autoTranslateIncoming){for(const m of model.messages.filter(x=>x.text)){const key=service.id+':'+m.conversationId+':'+m.id;if(!translatedMessages.has(key)){translateValue(service,m.conversationId,m.text).then(result=>{translatedMessages.set(key,result.translatedText);if(currentId===service.id&&model.conversation===conv.id)choose(conv)}).catch(()=>{})}}}};
  for(const conv of model.conversations){const b=document.createElement('button');const av=document.createElement('i');av.textContent=(conv.name||'?')[0];const n=document.createElement('span');n.textContent=conv.name||conv.id;b.append(av,n);b.onclick=()=>choose(conv).catch(e=>toast(e.message,true));list.append(b)}
  composer.onsubmit=async e=>{e.preventDefault();if(!model.conversation)return toast('请先选择会话',true);const text=input.value,files=[...file.files].map(x=>x.path).filter(Boolean);if(!text.trim()&&!files.length)return;try{const check=await caisheng.translation.validate({accountId:service.id,conversationId:model.conversation,text,quote:model.quote});if(!check.allowed)return toast(check.message,true);await caisheng.signal.send(service.id,model.conversation,text,files,model.quote);input.value='';file.value='';model.quote=null;originalDraft='';preview.textContent='';undo.disabled=true;toast('消息已发送')}catch(err){toast('发送失败：'+err.message,true)}};
}

async function open(service) {
  if (!service.enabled) { toast('该账号已停用，请先在设置中启用', true); return; }
  currentId = service.id; renderServices();
  if (service.kind === 'native') {
    await caisheng.hide();
    await caisheng.open(service);
    await renderSignal(service);
  } else {
    $('#content').replaceChildren(makeLoading('正在打开 ' + service.name + '…'));
    try { await caisheng.open(service); } catch (error) { showError(friendlyError(error)); }
  }
}
function showError(message) {
  caisheng.hide();
  const section = document.createElement('section'); section.className = 'error-page';
  const h = document.createElement('h2'); h.textContent = '服务暂时无法打开';
  const p = document.createElement('p'); p.textContent = message || '请检查网络或代理设置后重试。';
  const b = document.createElement('button'); b.textContent = '重新加载'; b.onclick = () => refresh('restart');
  section.append(h, p, b); $('#content').replaceChildren(section);
}
async function picker() {
  const catalog = $('#catalog'); catalog.replaceChildren();
  for (const recipe of await caisheng.catalog()) {
    const button = document.createElement('button'), icon = document.createElement('i');
    icon.style.background = recipe.color; icon.textContent = recipe.name.charAt(0);
    button.append(icon, document.createTextNode(recipe.name));
    button.onclick = async () => {
      button.disabled = true;
      try { $('#picker').close(); const service = await caisheng.add(recipe.id); await loadServices(); await open(service); }
      catch (error) { showError('添加服务失败：' + friendlyError(error)); }
      finally { button.disabled = false; }
    };
    catalog.append(button);
  }
  $('#picker').showModal();
}
async function refresh(mode = 'normal') {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  try { await caisheng.refresh(service.id, mode); toast(mode === 'clear' ? '已清理缓存并刷新' : mode === 'restart' ? '服务已重新启动' : '正在刷新'); }
  catch (error) { toast(error.message, true); }
}
async function fillAccount(service) {
  const form = $('#accountForm'), fp = service.fingerprint || {}, proxy = fp.proxy || {};
  const translation = await translationScope(service, '');
  for (const key of ['name', 'note', 'color']) if (form.elements[key]) form.elements[key].value = service[key] || '';
  for (const key of ['enabled', 'muted', 'notifications']) form.elements[key].checked = Boolean(service[key]);
  for (const key of ['language', 'timezone', 'width', 'height', 'scaleFactor', 'cpuCores', 'memoryGB', 'userAgent', 'webglVendor', 'webglRenderer', 'latitude', 'longitude']) form.elements[key].value = fp[key] ?? '';
  form.elements.canvasNoise.checked = fp.canvasNoise !== false; form.elements.audioNoise.checked = fp.audioNoise !== false;
  form.elements.webrtc.checked = fp.webRTCPolicy !== 'default';
  form.elements.proxyMode.value = proxy.mode || 'direct'; form.elements.proxyServer.value = proxy.server || '';
  form.elements.proxyUsername.value = proxy.username || ''; form.elements.proxyPassword.value = proxy.password || '';
  form.elements.accountSpaceTranslate.checked = Boolean(translation.spaceTranslate);
  form.elements.accountBlockChinese.checked = Boolean(translation.blockChinese);
  form.elements.accountAutoTranslateIncoming.checked = Boolean(translation.autoTranslateIncoming);
  form.elements.accountAutoSend.checked = Boolean(translation.autoSend);
  form.elements.accountTarget.value = translation.target || translation.defaultTarget || 'en';
}
async function editAccount() {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  accountEditingId = service.id; await fillAccount(service); $('#accountPane').showModal();
}
function accountPatch(form) {
  const e = form.elements;
  return {
    name: e.name.value, note: e.note.value, color: e.color.value,
    enabled: e.enabled.checked, muted: e.muted.checked, notifications: e.notifications.checked,
    fingerprint: {
      language: e.language.value, timezone: e.timezone.value, width: Number(e.width.value), height: Number(e.height.value),
      scaleFactor: Number(e.scaleFactor.value), cpuCores: Number(e.cpuCores.value), memoryGB: Number(e.memoryGB.value),
      userAgent: e.userAgent.value, webglVendor: e.webglVendor.value, webglRenderer: e.webglRenderer.value,
      latitude: Number(e.latitude.value), longitude: Number(e.longitude.value), canvasNoise: e.canvasNoise.checked,
      audioNoise: e.audioNoise.checked, webRTCPolicy: e.webrtc.checked ? 'disable_non_proxied_udp' : 'default',
      proxy: { mode: e.proxyMode.value, server: e.proxyServer.value, username: e.proxyUsername.value, password: e.proxyPassword.value }
    }
  };
}
async function move(direction) {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  services = await caisheng.move(service.id, direction); renderServices();
}
async function toggleField(field) {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  await caisheng.update(service.id, { [field]: !service[field] }); await loadServices();
  toast(field === 'muted' ? (!service[field] ? '已静音' : '已取消静音') : (!service[field] ? '已开启通知' : '已关闭通知'));
}
async function openSettings() {
  await caisheng.hide();
  const settings = await caisheng.getSettings(), translation = await caisheng.translation.getSettings(), form = $('#settingsForm');
  for (const [key, value] of Object.entries(settings)) if (form.elements[key]?.type === 'checkbox') form.elements[key].checked = value;
  form.elements.translationProvider.value=translation.provider||'google';
  form.elements.translationFallback.value=translation.fallbackProvider||'google-cn';
  form.elements.translationTarget.value=translation.defaultTarget||'en';
  form.elements.libreUrl.value=translation.libreUrl||'';form.elements.openaiUrl.value=translation.openaiUrl||'';form.elements.openaiModel.value=translation.openaiModel||'';
  form.elements.apiKey.value='';$('#apiKeyState').textContent=translation.hasApiKey?'API 密钥已安全保存':'尚未设置 API 密钥';
  form.elements.translationEnabled.checked=translation.enabled!==false;form.elements.spaceTranslate.checked=Boolean(translation.spaceTranslate);
  form.elements.blockChinese.checked=Boolean(translation.blockChinese);form.elements.showOriginal.checked=translation.showOriginal!==false;form.elements.autoSend.checked=Boolean(translation.autoSend);
  $('#settingsPane').showModal();
}
$('#add').onclick = picker; $('#addTop').onclick = picker; $('#first').onclick = picker; $('#home').onclick = home;
$('#settings').onclick = openSettings; $('#editCurrent').onclick = editAccount;
$('#refreshCurrent').onclick = () => refresh('normal'); $('#hardRefresh').onclick = () => refresh('hard');
$('#restartCurrent').onclick = () => refresh('restart'); $('#muteCurrent').onclick = () => toggleField('muted');
$('#notifyCurrent').onclick = () => toggleField('notifications'); $('#moveUp').onclick = () => move(-1); $('#moveDown').onclick = () => move(1);
$('#minimize').onclick = caisheng.minimize; $('#maximize').onclick = caisheng.maximize; $('#windowClose').onclick = caisheng.closeWindow;
$('#dataFolder').onclick = caisheng.showDataFolder;
$('#clearTranslationCache').onclick = () => caisheng.translation.clearCache().then(()=>toast('翻译缓存已清空')).catch(error=>toast(error.message,true));
$$('[data-close]').forEach(button => button.onclick = () => $('#' + button.dataset.close).close());
$$('.tab').forEach(button => button.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === button));
  $$('[data-page]').forEach(page => { page.hidden = page.dataset.page !== button.dataset.tab; });
});
$('#accountForm').onsubmit = async event => {
  event.preventDefault();
  await caisheng.update(accountEditingId, accountPatch(event.currentTarget));
  await caisheng.translation.updateAccount(accountEditingId, {
    target:event.currentTarget.elements.accountTarget.value,
    spaceTranslate:event.currentTarget.elements.accountSpaceTranslate.checked,
    blockChinese:event.currentTarget.elements.accountBlockChinese.checked,
    autoTranslateIncoming:event.currentTarget.elements.accountAutoTranslateIncoming.checked,
    autoSend:event.currentTarget.elements.accountAutoSend.checked
  });
  $('#accountPane').close();
  await loadServices(); const service = active(); if (service?.kind === 'web') await refresh('restart'); toast('账号设置已保存');
};
$('#deleteAccount').onclick = async () => {
  const service = services.find(x => x.id === accountEditingId); if (!service) return;
  if (!confirm('确定删除“' + service.name + '”吗？该账号的登录数据不会与其他账号混合。')) return;
  await caisheng.remove(service.id); $('#accountPane').close(); currentId = ''; await loadServices(); home(); toast('账号已删除');
};
$('#testProxy').onclick = async () => {
  await caisheng.update(accountEditingId, accountPatch($('#accountForm')));
  const result = await caisheng.testProxy(accountEditingId);
  toast(result.ok ? '代理连接成功（状态 ' + result.status + '）' : result.error, !result.ok);
};
$('#settingsForm').onsubmit = async event => {
  event.preventDefault(); const patch = {};
  for (const name of ['startAtLogin', 'minimizeToTray', 'closeToTray', 'defaultMute', 'defaultNotifications']) patch[name] = event.currentTarget.elements[name].checked;
  await caisheng.setSettings(patch);
  const e=event.currentTarget.elements, translationPatch={
    enabled:e.translationEnabled.checked,provider:e.translationProvider.value,fallbackProvider:e.translationFallback.value,
    defaultTarget:e.translationTarget.value,libreUrl:e.libreUrl.value.trim(),openaiUrl:e.openaiUrl.value.trim(),openaiModel:e.openaiModel.value.trim(),
    spaceTranslate:e.spaceTranslate.checked,blockChinese:e.blockChinese.checked,showOriginal:e.showOriginal.checked,autoSend:e.autoSend.checked
  };
  if(e.apiKey.value)translationPatch.apiKey=e.apiKey.value;
  await caisheng.translation.updateSettings(translationPatch); e.apiKey.value='';
  $('#settingsPane').close(); toast('平台与翻译设置已保存');
};
$$('#serviceMenu [data-action]').forEach(button => button.onclick = async () => {
  const action = button.dataset.action; $('#serviceMenu').close();
  if (action === 'edit') return editAccount();
  if (['refresh', 'hard', 'clear', 'restart'].includes(action)) return refresh(action === 'refresh' ? 'normal' : action);
  if (action === 'toggle') { const service = active(); await caisheng.update(service.id, { enabled: !service.enabled }); await loadServices(); }
});
window.addEventListener('keydown', event => {
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'r') { event.preventDefault(); refresh('normal'); }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'r') { event.preventDefault(); refresh('hard'); }
});
caisheng.onServiceState(update => {
  state.set(update.id, update); renderServices();
  if (update.id === currentId && update.error) showError(update.error);
});
window.addEventListener('unhandledrejection', event => { event.preventDefault(); toast(friendlyError(event.reason), true); });
window.addEventListener('error', event => { toast('界面运行异常，请尝试刷新当前服务', true); console.error(event.error || event.message); });
loadServices().then(() => caisheng.ready()).catch(error => { showError('平台初始化失败：' + friendlyError(error)); caisheng.ready(); });

caisheng.signal.onState(update=>{const m=signalStateFor(update.id);m.status=update.status;if(update.id===currentId){const s=active();if(s)renderSignal(s)}});
caisheng.signal.onMessage(message=>{const m=signalStateFor(message.accountId);m.messages.push(message);if(message.accountId===currentId&&message.conversationId===m.conversation){const s=active();if(s)renderSignal(s)}});
