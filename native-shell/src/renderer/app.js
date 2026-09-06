'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let services = [];
let currentId = '';
let accountEditingId = '';
const state = new Map();

function toast(message, bad = false) {
  const el = $('#toast'); el.textContent = message; el.className = bad ? 'show bad' : 'show';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 2600);
}
function active() { return services.find(x => x.id === currentId); }
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
async function open(service) {
  if (!service.enabled) { toast('该账号已停用，请先在设置中启用', true); return; }
  currentId = service.id; renderServices();
  if (service.kind === 'native') {
    await caisheng.hide();
    const section = document.createElement('section'); section.className = 'signal';
    const head = document.createElement('div'); head.className = 'signalHead';
    const title = document.createElement('b'); title.textContent = service.name;
    const note = document.createElement('span'); note.textContent = service.note || '独立 Signal 账号';
    head.append(title, note);
    const empty = document.createElement('div'); empty.className = 'empty';
    const strong = document.createElement('strong'); strong.textContent = '连接 Signal 账号';
    const p = document.createElement('p'); p.textContent = '正在加载独立 Signal 服务与二维码……';
    empty.append(strong, p); section.append(head, empty); $('#content').replaceChildren(section);
    await caisheng.open(service);
  } else {
    $('#content').replaceChildren();
    try { await caisheng.open(service); } catch (error) { showError(error.message); }
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
    button.onclick = async () => { $('#picker').close(); const service = await caisheng.add(recipe.id); await loadServices(); await open(service); };
    catalog.append(button);
  }
  $('#picker').showModal();
}
async function refresh(mode = 'normal') {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  try { await caisheng.refresh(service.id, mode); toast(mode === 'clear' ? '已清理缓存并刷新' : mode === 'restart' ? '服务已重新启动' : '正在刷新'); }
  catch (error) { toast(error.message, true); }
}
function fillAccount(service) {
  const form = $('#accountForm'), fp = service.fingerprint || {}, proxy = fp.proxy || {};
  for (const key of ['name', 'note', 'color']) if (form.elements[key]) form.elements[key].value = service[key] || '';
  for (const key of ['enabled', 'muted', 'notifications']) form.elements[key].checked = Boolean(service[key]);
  for (const key of ['language', 'timezone', 'width', 'height', 'scaleFactor', 'cpuCores', 'memoryGB', 'userAgent', 'webglVendor', 'webglRenderer', 'latitude', 'longitude']) form.elements[key].value = fp[key] ?? '';
  form.elements.canvasNoise.checked = fp.canvasNoise !== false; form.elements.audioNoise.checked = fp.audioNoise !== false;
  form.elements.webrtc.checked = fp.webRTCPolicy !== 'default';
  form.elements.proxyMode.value = proxy.mode || 'direct'; form.elements.proxyServer.value = proxy.server || '';
  form.elements.proxyUsername.value = proxy.username || ''; form.elements.proxyPassword.value = proxy.password || '';
}
function editAccount() {
  const service = active(); if (!service) return toast('请先选择一个账号', true);
  accountEditingId = service.id; fillAccount(service); $('#accountPane').showModal();
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
  const settings = await caisheng.getSettings(), form = $('#settingsForm');
  for (const [key, value] of Object.entries(settings)) if (form.elements[key]?.type === 'checkbox') form.elements[key].checked = value;
  $('#settingsPane').showModal();
}
$('#add').onclick = picker; $('#addTop').onclick = picker; $('#first').onclick = picker; $('#home').onclick = home;
$('#settings').onclick = openSettings; $('#editCurrent').onclick = editAccount;
$('#refreshCurrent').onclick = () => refresh('normal'); $('#hardRefresh').onclick = () => refresh('hard');
$('#restartCurrent').onclick = () => refresh('restart'); $('#muteCurrent').onclick = () => toggleField('muted');
$('#notifyCurrent').onclick = () => toggleField('notifications'); $('#moveUp').onclick = () => move(-1); $('#moveDown').onclick = () => move(1);
$('#minimize').onclick = caisheng.minimize; $('#maximize').onclick = caisheng.maximize; $('#windowClose').onclick = caisheng.closeWindow;
$('#dataFolder').onclick = caisheng.showDataFolder;
$$('[data-close]').forEach(button => button.onclick = () => $('#' + button.dataset.close).close());
$$('.tab').forEach(button => button.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === button));
  $$('[data-page]').forEach(page => { page.hidden = page.dataset.page !== button.dataset.tab; });
});
$('#accountForm').onsubmit = async event => {
  event.preventDefault();
  await caisheng.update(accountEditingId, accountPatch(event.currentTarget)); $('#accountPane').close();
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
  await caisheng.setSettings(patch); $('#settingsPane').close(); toast('平台设置已保存');
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
loadServices().then(() => caisheng.ready()).catch(error => { showError('平台初始化失败：' + error.message); caisheng.ready(); });
