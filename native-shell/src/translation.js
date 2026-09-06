const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  enabled: true, provider: 'google', fallbackProvider: 'google-cn',
  libreUrl: '', openaiUrl: '', openaiModel: '',
  spaceTranslate: true, autoSend: false, blockChinese: true,
  showOriginal: true, defaultTarget: 'en'
};
const inflight = new Map();
const cache = new Map();
const dataFile = () => path.join(app.getPath('userData'), 'translation-settings.json');
const cacheFile = () => path.join(app.getPath('userData'), 'translation-cache.json');
const cacheKey = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hasChinese = text => /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(String(text || ''));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readFile() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return {}; }
}
function writeFile(value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile());
}
function loadCache() {
  if (cache.size) return;
  try {
    const rows = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (Array.isArray(rows)) for (const [key, value] of rows.slice(-1000)) cache.set(key, value);
  } catch {}
}
function persistCache() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const tmp = cacheFile() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...cache].slice(-1000)), 'utf8');
  fs.renameSync(tmp, cacheFile());
}
function encrypt(secret) {
  if (!secret) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用');
  return safeStorage.encryptString(secret).toString('base64');
}
function decrypt(secret) {
  if (!secret) return '';
  try { return safeStorage.decryptString(Buffer.from(secret, 'base64')); } catch { return ''; }
}
function publicSettings(raw = readFile()) {
  const { apiKeyEncrypted, ...rest } = raw;
  return { ...DEFAULTS, ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}
function getScope(raw, accountId, conversationId) {
  const account = raw.accounts?.[accountId] || {};
  const conversation = account.conversations?.[conversationId] || {};
  return { ...DEFAULTS, ...raw, ...account, ...conversation, apiKeyEncrypted: undefined,
    hasApiKey: Boolean(raw.apiKeyEncrypted) };
}
function updateSettings(patch) {
  const raw = readFile();
  const next = { ...raw, ...patch };
  delete next.hasApiKey;
  if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
    if (patch.apiKey) next.apiKeyEncrypted = encrypt(String(patch.apiKey));
    else delete next.apiKeyEncrypted;
    delete next.apiKey;
  }
  writeFile(next);
  return publicSettings(next);
}
function updateScope(accountId, conversationId, patch) {
  if (!accountId || !conversationId) throw new Error('缺少账号或会话标识');
  const raw = readFile(), accounts = { ...(raw.accounts || {}) };
  const account = { ...(accounts[accountId] || {}) };
  const conversations = { ...(account.conversations || {}) };
  conversations[conversationId] = { ...(conversations[conversationId] || {}), ...patch };
  account.conversations = conversations; accounts[accountId] = account; raw.accounts = accounts;
  writeFile(raw);
  return getScope(raw, accountId, conversationId);
}
function updateAccount(accountId, patch) {
  if (!accountId) throw new Error('缺少账号标识');
  const raw = readFile(), accounts = { ...(raw.accounts || {}) };
  const previous = accounts[accountId] || {};
  accounts[accountId] = { ...previous, ...patch, conversations: previous.conversations || {} };
  raw.accounts = accounts;
  writeFile(raw);
  return getScope(raw, accountId, '');
}
async function json(url, options, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error('翻译服务返回 ' + response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function google(text, source, target, domain = 'translate.googleapis.com') {
  const params = new URLSearchParams({ client: 'gtx', sl: source || 'auto', tl: target, dt: 't', q: text });
  const value = await json('https://' + domain + '/translate_a/single?' + params);
  const translated = Array.isArray(value?.[0]) ? value[0].map(row => row?.[0] || '').join('') : '';
  if (!translated) throw new Error('Google 翻译未返回结果');
  return translated;
}
async function libre(text, source, target, settings) {
  if (!settings.libreUrl) throw new Error('未配置备用翻译地址');
  const value = await json(settings.libreUrl.replace(/\/$/, '') + '/translate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: text, source: source || 'auto', target, format: 'text' })
  });
  if (!value.translatedText) throw new Error('LibreTranslate 未返回结果');
  return value.translatedText;
}
async function openai(text, source, target, settings, raw) {
  const key = decrypt(raw.apiKeyEncrypted);
  if (!settings.openaiUrl || !settings.openaiModel || !key) throw new Error('AI 翻译配置不完整');
  const value = await json(settings.openaiUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: settings.openaiModel, temperature: 0,
      messages: [{ role: 'system', content: 'Translate faithfully to ' + target + '. Return translation only.' },
        { role: 'user', content: text }] })
  }, 30000);
  const translated = value?.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('AI 翻译未返回结果');
  return translated;
}
async function runProvider(provider, text, source, target, settings, raw) {
  if (provider === 'google') return google(text, source, target);
  if (provider === 'google-cn') return google(text, source, target, 'translate.google.cn');
  if (provider === 'libre') return libre(text, source, target, settings);
  if (provider === 'openai') return openai(text, source, target, settings, raw);
  throw new Error('未知翻译服务');
}
async function translate(request) {
  const text = String(request?.text || '');
  if (!text.trim()) return { skipped: true, text, translatedText: text, provider: null };
  loadCache();
  const raw = readFile();
  const settings = getScope(raw, String(request.accountId || 'global'), String(request.conversationId || 'global'));
  if (!settings.enabled) throw new Error('翻译功能已关闭');
  const target = request.target || settings.target || settings.defaultTarget || (hasChinese(text) ? 'en' : 'zh-CN');
  const source = request.source || 'auto';
  const key = cacheKey({ text, source, target, provider: settings.provider, fallback: settings.fallbackProvider });
  if (cache.has(key)) return { ...cache.get(key), cached: true };
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    let lastError;
    const providers = [...new Set([settings.provider, settings.fallbackProvider].filter(Boolean))];
    for (const provider of providers) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const translatedText = await runProvider(provider, text, source, target, settings, raw);
          const result = { text, translatedText, source, target, provider, cached: false };
          cache.set(key, result); if (cache.size > 1000) cache.delete(cache.keys().next().value);
          persistCache();
          return result;
        } catch (error) { lastError = error; if (attempt < 2) await sleep(400 * (2 ** attempt)); }
      }
    }
    throw new Error('翻译失败：' + (lastError?.message || '网络不可用'));
  })();
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}
function validateOutgoing(payload) {
  const raw = readFile();
  const settings = getScope(raw, String(payload.accountId || 'global'), String(payload.conversationId || 'global'));
  const quote = typeof payload.quote === 'string' ? payload.quote : payload.quote?.text;
  const values = [payload.text, quote, payload.caption, payload.editedText].filter(Boolean);
  if (settings.blockChinese && values.some(hasChinese)) {
    return { allowed: false, message: '检测到中文，请先翻译后再发送' };
  }
  return { allowed: true };
}
function clearCache() {
  cache.clear();
  try { fs.rmSync(cacheFile(), { force: true }); } catch {}
  return true;
}
module.exports = { publicSettings, getScope: (a,c) => getScope(readFile(),a,c), updateSettings, updateAccount, updateScope, translate, validateOutgoing, clearCache, hasChinese };
