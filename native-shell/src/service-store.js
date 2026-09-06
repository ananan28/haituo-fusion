'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session } = require('electron');

const DEFAULT_FINGERPRINT = Object.freeze({
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  width: 1366,
  height: 768,
  scaleFactor: 1,
  cpuCores: 8,
  memoryGB: 8,
  userAgent: '',
  webglVendor: 'Google Inc. (Intel)',
  webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics, D3D11)',
  canvasNoise: true,
  audioNoise: true,
  webRTCPolicy: 'disable_non_proxied_udp',
  latitude: 31.2304,
  longitude: 121.4737,
  proxy: { mode: 'direct', server: '', username: '', password: '' }
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeText(value, max = 120) { return String(value ?? '').trim().slice(0, max); }
function safeId(value) { return /^[a-zA-Z0-9_-]{8,80}$/.test(String(value || '')); }
function servicePartition(id) {
  if (!safeId(id)) throw new Error('账号标识无效');
  return 'persist:caisheng-account-' + id;
}
function validateFingerprint(input = {}) {
  const base = clone(DEFAULT_FINGERPRINT);
  const fp = { ...base, ...input, proxy: { ...base.proxy, ...(input.proxy || {}) } };
  fp.language = safeText(fp.language, 32) || base.language;
  fp.timezone = safeText(fp.timezone, 64) || base.timezone;
  fp.width = Math.min(7680, Math.max(800, Number(fp.width) || base.width));
  fp.height = Math.min(4320, Math.max(600, Number(fp.height) || base.height));
  fp.scaleFactor = Math.min(3, Math.max(0.5, Number(fp.scaleFactor) || 1));
  fp.cpuCores = Math.min(64, Math.max(1, Number(fp.cpuCores) || base.cpuCores));
  fp.memoryGB = Math.min(128, Math.max(1, Number(fp.memoryGB) || base.memoryGB));
  fp.userAgent = safeText(fp.userAgent, 512);
  fp.webglVendor = safeText(fp.webglVendor, 120) || base.webglVendor;
  fp.webglRenderer = safeText(fp.webglRenderer, 240) || base.webglRenderer;
  fp.webRTCPolicy = ['default', 'disable_non_proxied_udp'].includes(fp.webRTCPolicy) ? fp.webRTCPolicy : base.webRTCPolicy;
  fp.latitude = Math.min(90, Math.max(-90, Number(fp.latitude) || 0));
  fp.longitude = Math.min(180, Math.max(-180, Number(fp.longitude) || 0));
  fp.proxy.mode = ['direct', 'http', 'https', 'socks5'].includes(fp.proxy.mode) ? fp.proxy.mode : 'direct';
  fp.proxy.server = safeText(fp.proxy.server, 300);
  fp.proxy.username = safeText(fp.proxy.username, 120);
  fp.proxy.password = String(fp.proxy.password || '').slice(0, 300);
  return fp;
}

class ServiceStore {
  constructor(userData) {
    this.userData = userData;
    this.file = path.join(userData, 'services.json');
    this.backup = path.join(userData, 'services.backup.json');
    this.settingsFile = path.join(userData, 'platform-settings.json');
    this.services = [];
    this.settings = {
      startAtLogin: false, minimizeToTray: true, closeToTray: true,
      defaultMute: false, defaultNotifications: true, locale: 'zh-CN'
    };
    this.load();
  }
  loadJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }
  atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, file);
  }
  load() {
    const raw = this.loadJson(this.file, this.loadJson(this.backup, []));
    this.services = Array.isArray(raw) ? raw.map((s, i) => this.normalize(s, i)).filter(Boolean) : [];
    this.settings = { ...this.settings, ...this.loadJson(this.settingsFile, {}) };
  }
  normalize(s, index = 0) {
    if (!s || !safeId(s.id)) return null;
    const recipeId = ['signal', 'whatsapp'].includes(s.recipeId) ? s.recipeId : '';
    if (!recipeId) return null;
    return {
      id: s.id, recipeId, kind: recipeId === 'signal' ? 'native' : 'web',
      url: recipeId === 'whatsapp' ? 'https://web.whatsapp.com/' : '',
      name: safeText(s.name, 60) || (recipeId === 'signal' ? 'Signal' : 'WhatsApp'),
      note: safeText(s.note, 240), color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : (recipeId === 'signal' ? '#3a76f0' : '#13a45a'),
      enabled: s.enabled !== false, muted: Boolean(s.muted), notifications: s.notifications !== false,
      unread: Math.max(0, Math.floor(Number(s.unread) || 0)), order: Number.isFinite(s.order) ? s.order : index,
      crashed: false, lastOpenedAt: Number(s.lastOpenedAt) || 0, fingerprint: validateFingerprint(s.fingerprint)
    };
  }
  persist() {
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
    this.atomicWrite(this.file, this.services);
  }
  list() { return this.services.slice().sort((a, b) => a.order - b.order); }
  add(recipe) {
    const count = this.services.filter(s => s.recipeId === recipe.id).length + 1;
    const service = this.normalize({
      id: crypto.randomUUID(), recipeId: recipe.id,
      name: count === 1 ? recipe.name : recipe.name + ' ' + count,
      color: recipe.color, muted: this.settings.defaultMute,
      notifications: this.settings.defaultNotifications, order: this.services.length
    }, this.services.length);
    this.services.push(service); this.persist(); return service;
  }
  get(id) { return this.services.find(s => s.id === id); }
  update(id, patch = {}) {
    const s = this.get(id); if (!s) throw new Error('服务账号不存在');
    if ('name' in patch) s.name = safeText(patch.name, 60) || s.name;
    if ('note' in patch) s.note = safeText(patch.note, 240);
    if ('color' in patch && /^#[0-9a-f]{6}$/i.test(patch.color)) s.color = patch.color;
    for (const key of ['enabled', 'muted', 'notifications']) if (key in patch) s[key] = Boolean(patch[key]);
    if ('unread' in patch) s.unread = Math.max(0, Math.floor(Number(patch.unread) || 0));
    if (patch.fingerprint) s.fingerprint = validateFingerprint({ ...s.fingerprint, ...patch.fingerprint });
    this.persist(); return s;
  }
  remove(id) {
    const index = this.services.findIndex(s => s.id === id);
    if (index < 0) return false;
    this.services.splice(index, 1);
    this.services.forEach((s, i) => { s.order = i; });
    this.persist(); return true;
  }
  move(id, direction) {
    const list = this.list(); const from = list.findIndex(s => s.id === id);
    const to = Math.max(0, Math.min(list.length - 1, from + (direction < 0 ? -1 : 1)));
    if (from < 0 || from === to) return list;
    [list[from], list[to]] = [list[to], list[from]];
    list.forEach((s, i) => { s.order = i; });
    this.services = list; this.persist(); return this.list();
  }
  platformSettings(patch) {
    if (!patch) return { ...this.settings };
    for (const key of ['startAtLogin', 'minimizeToTray', 'closeToTray', 'defaultMute', 'defaultNotifications']) {
      if (key in patch) this.settings[key] = Boolean(patch[key]);
    }
    this.atomicWrite(this.settingsFile, this.settings);
    return { ...this.settings };
  }
  async configureSession(service) {
    if (!service || service.kind !== 'web') return null;
    const fp = service.fingerprint;
    const ses = session.fromPartition(servicePartition(service.id), { cache: true });
    if (fp.userAgent) ses.setUserAgent(fp.userAgent, fp.language);
    if (fp.proxy.mode === 'direct' || !fp.proxy.server) await ses.setProxy({ mode: 'direct' });
    else {
      const scheme = fp.proxy.mode === 'socks5' ? 'socks5' : fp.proxy.mode;
      const rule = fp.proxy.server.includes('://') ? fp.proxy.server : scheme + '://' + fp.proxy.server;
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: rule });
    }
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['notifications', 'media', 'clipboard-read'].includes(permission));
    });
    return ses;
  }
  async clearAccount(id) {
    const s = this.get(id); if (!s || s.kind !== 'web') return;
    const ses = session.fromPartition(servicePartition(id));
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  }
}

module.exports = { ServiceStore, DEFAULT_FINGERPRINT, servicePartition, validateFingerprint };
