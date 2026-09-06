'use strict';

const { BrowserView, shell } = require('electron');
const crypto = require('crypto');
const path = require('path');
const { servicePartition } = require('./service-store');
const { findRecipe, isAllowedNavigation } = require('./service-catalog');

const RETRY_DELAYS = [1200, 3000, 8000];

function chineseNetworkError(code, description = '') {
  const messages = {
    '-2': '网络请求失败，请检查网络或代理设置。',
    '-3': '',
    '-6': '无法连接服务器，请检查网络、DNS 或代理设置。',
    '-7': '连接超时，请检查网络或代理后重试。',
    '-21': '网络连接已改变，正在重新连接。',
    '-105': '域名解析失败，请检查 DNS 或代理设置。',
    '-106': '当前未连接网络。',
    '-109': '无法访问代理服务器，请检查代理地址。',
    '-111': '代理通道建立失败，请检查代理账号和密码。',
    '-118': '连接超时，请稍后重试。',
    '-130': '代理服务器连接失败。',
    '-137': '代理名称解析失败。'
  };
  return messages[String(code)] ?? `页面加载失败（错误 ${code}）：${description || '未知网络错误'}`;
}

function publicProfile(service) {
  const fp = service.fingerprint;
  const digest = crypto.createHash('sha256').update(service.id).digest();
  return {
    language: fp.language, timezone: fp.timezone, width: fp.width, height: fp.height,
    scaleFactor: fp.scaleFactor, cpuCores: fp.cpuCores, memoryGB: fp.memoryGB,
    userAgent: fp.userAgent, webglVendor: fp.webglVendor, webglRenderer: fp.webglRenderer,
    canvasNoise: fp.canvasNoise !== false, audioNoise: fp.audioNoise !== false,
    webRTCPolicy: fp.webRTCPolicy, latitude: fp.latitude, longitude: fp.longitude,
    noise: digest[0] % 2
  };
}

class WebServiceRuntime {
  constructor(store, sendState) {
    this.store = store;
    this.sendState = sendState;
    this.window = null;
    this.currentId = '';
    this.accounts = new Map();
    this.locks = new Map();
  }

  setWindow(window) { this.window = window; }

  isAlive(account) {
    try { return Boolean(account?.view?.webContents && !account.view.webContents.isDestroyed()); }
    catch { return false; }
  }

  takeAlive(id) {
    const account = this.accounts.get(id);
    if (this.isAlive(account)) return account;
    if (account) {
      this.accounts.delete(id);
      try { this.window?.removeBrowserView(account.view); } catch {}
    }
    return null;
  }

  async locked(id, task) {
    const previous = this.locks.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.locks.set(id, current);
    try { return await current; }
    finally { if (this.locks.get(id) === current) this.locks.delete(id); }
  }

  bounds(view) {
    if (!this.window || this.window.isDestroyed() || !view || view.webContents.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    view.setBounds({ x: 218, y: 58, width: Math.max(0, width - 274), height: Math.max(0, height - 58) });
    view.setAutoResize({ width: true, height: true });
  }

  resizeAll() {
    for (const account of this.accounts.values()) this.bounds(account.view);
  }

  hide() {
    if (!this.window || this.window.isDestroyed()) return;
    for (const account of this.accounts.values()) {
      try { this.window.removeBrowserView(account.view); } catch {}
    }
  }

  accountForWebContents(webContents) {
    for (const [id, account] of this.accounts) {
      if (!account.view.webContents.isDestroyed() && account.view.webContents.id === webContents.id) {
        return { id, service: this.store.get(id) };
      }
    }
    return null;
  }

  emit(id, patch) {
    const service = this.store.get(id);
    this.sendState({ id, kind: service?.recipeId || 'web', ...patch });
  }

  async applyDevToolsProfile(account, service) {
    const wc = account.view.webContents;
    const fp = publicProfile(service);
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      if (fp.timezone) await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: fp.timezone });
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: fp.width, height: fp.height, deviceScaleFactor: fp.scaleFactor, mobile: false
      });
      await wc.debugger.sendCommand('Emulation.setGeolocationOverride', {
        latitude: fp.latitude, longitude: fp.longitude, accuracy: 25
      });
      // 使用 Chromium 原生 UA/Client Hints，避免两套值不一致导致服务拒绝请求。
    } catch (error) {
      this.emit(service.id, { warning: '部分指纹参数应用失败：' + error.message });
    }
  }

  wire(account, service, recipe) {
    const wc = account.view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(recipe, url)) wc.loadURL(url).catch(() => {});
      else {
        try {
          const parsed = new URL(url);
          if (/^https?:$/.test(parsed.protocol)) shell.openExternal(url).catch(() => {});
        } catch {}
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(recipe, url)) {
        event.preventDefault();
        this.emit(service.id, { warning: '已阻止跳转到未授权域名。' });
      }
    });
    wc.on('did-start-loading', () => {
      clearTimeout(account.loadTimer);
      account.httpError = 0;
      this.emit(service.id, { loading: true, error: '' });
      account.loadTimer = setTimeout(() => {
        this.emit(service.id, {
          loading: false, online: false,
          error: `${service.name} 加载超过 30 秒，请检查网络或代理后重试。`,
          recoverable: true
        });
      }, 30000);
    });
    wc.on('did-finish-load', () => {
      clearTimeout(account.loadTimer);
      account.retries = 0;
      wc.setAudioMuted(Boolean(service.muted));
      if (!account.httpError) this.emit(service.id, { loading: false, error: '', online: true });
    });
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      clearTimeout(account.loadTimer);
      this.emit(service.id, {
        loading: false, online: false, error: chineseNetworkError(code, description), url
      });
    });
    wc.session.webRequest.onCompleted(details => {
      if (details.webContentsId !== wc.id || details.resourceType !== 'mainFrame') return;
      if (details.statusCode >= 400 && details.statusCode < 500) {
        account.httpError = details.statusCode;
        this.emit(service.id, {
          loading: false, online: false, httpStatus: details.statusCode, url: details.url,
          error: `${service.name} 返回 ${details.statusCode}，请求未被接受。请检查系统时间、代理/IP 后重试。`
        });
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      this.scheduleRecovery(service.id, `${service.name} 账号进程异常（${details.reason || '未知原因'}）`);
    });
    wc.on('unresponsive', () => this.scheduleRecovery(service.id, `${service.name} 页面无响应`));
    wc.on('responsive', () => this.emit(service.id, { loading: false, error: '', online: true }));
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        input.shift ? wc.reloadIgnoringCache() : wc.reload();
      }
    });
  }

  scheduleRecovery(id, reason) {
    const account = this.accounts.get(id);
    const service = this.store.get(id);
    if (!account || !service || !service.enabled || account.closing) return;
    clearTimeout(account.recoveryTimer);
    if (account.retries >= RETRY_DELAYS.length) {
      this.emit(id, { loading: false, error: reason + '。自动恢复未成功，请点击“重启服务”。', recoverable: true });
      return;
    }
    const delay = RETRY_DELAYS[account.retries++];
    this.emit(id, { loading: true, error: `${reason}，${Math.ceil(delay / 1000)} 秒后自动恢复……` });
    account.recoveryTimer = setTimeout(() => {
      this.locked(id, async () => {
        const shouldReopen = this.currentId === id;
        await this.destroyInternal(id, false);
        if (shouldReopen) await this.openInternal(id);
      }).catch(error => this.emit(id, { loading: false, error: '自动恢复失败：' + error.message }));
    }, delay);
  }

  async createInternal(id) {
    const service = this.store.get(id);
    const recipe = service && findRecipe(service.recipeId);
    if (!service || !recipe || recipe.adapter !== 'web') throw new Error('网页服务账号不存在');
    await this.store.configureSession(service);
    const profile = Buffer.from(JSON.stringify(publicProfile(service)), 'utf8').toString('base64url');
    const view = new BrowserView({ webPreferences: {
      partition: servicePartition(id),
      preload: path.join(__dirname, 'service-preload.js'),
      additionalArguments: [
        '--caisheng-account=' + id,
        '--caisheng-service=' + recipe.id,
        '--caisheng-profile=' + profile
      ],
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false
    } });
    const account = { view, retries: 0, recoveryTimer: null, loadTimer: null, httpError: 0, closing: false };
    this.accounts.set(id, account);
    this.wire(account, service, recipe);
    view.webContents.once('destroyed', () => {
      if (this.accounts.get(id) === account) this.accounts.delete(id);
      clearTimeout(account.recoveryTimer);
      clearTimeout(account.loadTimer);
    });
    await this.applyDevToolsProfile(account, service);
    return account;
  }

  async openInternal(id) {
    const service = this.store.get(id);
    const recipe = service && findRecipe(service.recipeId);
    if (!service || !recipe || recipe.adapter !== 'web') throw new Error('网页服务账号不存在');
    if (!service.enabled) throw new Error(`该 ${service.name} 账号已停用，请先启用`);
    this.hide();
    this.currentId = id;
    let account = this.takeAlive(id);
    if (!account) account = await this.createInternal(id);
    if (!this.window || this.window.isDestroyed()) throw new Error('平台主窗口尚未就绪');
    try {
      this.window.addBrowserView(account.view);
    } catch (error) {
      if (!this.isAlive(account) || /destroyed child view/i.test(String(error?.message || error))) {
        if (this.accounts.get(id) === account) this.accounts.delete(id);
        account = await this.createInternal(id);
        this.window.addBrowserView(account.view);
      } else {
        throw new Error('无法打开服务内容区，请重启当前账号后重试。');
      }
    }
    this.bounds(account.view);
    if (!account.view.webContents.getURL()) await account.view.webContents.loadURL(service.url || recipe.startUrl);
    account.view.webContents.setAudioMuted(Boolean(service.muted));
    this.store.update(id, { unread: 0, lastOpenedAt: Date.now() });
    return true;
  }

  open(id) { return this.locked(id, () => this.openInternal(id)); }

  async destroyInternal(id, purge = false) {
    const account = this.accounts.get(id);
    if (account) {
      account.closing = true;
      clearTimeout(account.recoveryTimer);
      clearTimeout(account.loadTimer);
      try { this.window?.removeBrowserView(account.view); } catch {}
      if (!account.view.webContents.isDestroyed()) account.view.webContents.destroy();
      this.accounts.delete(id);
    }
    if (this.currentId === id) this.currentId = '';
    if (purge) await this.store.purgeAccount(id);
  }

  destroy(id, purge = false) { return this.locked(id, () => this.destroyInternal(id, purge)); }

  refresh(id, mode = 'normal') {
    return this.locked(id, async () => {
      const service = this.store.get(id);
      const recipe = service && findRecipe(service.recipeId);
      if (!service || !recipe || recipe.adapter !== 'web') throw new Error('网页服务账号不存在');
      let account = this.takeAlive(id);
      if (mode === 'restart' || mode === 'clean') {
        await this.destroyInternal(id, false);
        if (mode === 'clean') await this.store.resetAccountSiteData(id);
        return this.openInternal(id);
      }
      if (!account) return this.openInternal(id);
      account.retries = 0;
      if (mode === 'clear') {
        await this.store.clearAccountCache(id);
        account.view.webContents.reloadIgnoringCache();
      } else if (mode === 'hard') account.view.webContents.reloadIgnoringCache();
      else account.view.webContents.reload();
      return true;
    });
  }

  async update(service) {
    const account = this.accounts.get(service.id);
    if (!service.enabled) return this.destroy(service.id, false);
    if (account && !account.view.webContents.isDestroyed()) account.view.webContents.setAudioMuted(Boolean(service.muted));
    return true;
  }

  async stopAll() {
    await Promise.all([...this.accounts.keys()].map(id => this.destroy(id, false)));
  }
}

module.exports = { WebServiceRuntime, chineseNetworkError, publicProfile };
