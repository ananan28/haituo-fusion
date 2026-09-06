'use strict';
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const safeId = id => {
  const value = String(id || '');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new Error('Signal 账号标识无效');
  return value;
};
const jsonRead = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const atomicWrite = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
};
const cleanName = value => path.basename(String(value || '附件'))
  .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || '附件';

class SignalRuntime extends EventEmitter {
  constructor(userData, resourcesPath) {
    super();
    this.root = path.join(userData, 'signal-accounts');
    this.resources = path.join(resourcesPath, 'signal-runtime');
    this.processes = new Map();
    this.linking = new Map();
    this.pending = new Map();
    this.historyLocks = new Map();
    this.starting = new Map();
    this.retries = new Map();
    this.retryCount = new Map();
    this.seq = 0;
    this.stopping = false;
    fs.mkdirSync(this.root, { recursive: true });
  }

  paths(id) {
    id = safeId(id);
    const root = path.join(this.root, id);
    return {
      root,
      config: path.join(root, 'config'),
      state: path.join(root, 'state.json'),
      history: path.join(root, 'history.jsonl'),
      attachments: path.join(root, 'attachments'),
    };
  }
  state(id) {
    return jsonRead(this.paths(id).state, {
      id, status: '未连接', linked: false, phone: '', deviceName: '财盛聚合聊天',
    });
  }
  saveState(id, patch) {
    const next = { ...this.state(id), ...patch, id, updatedAt: Date.now() };
    atomicWrite(this.paths(id).state, next);
    this.emit('state', next);
    return next;
  }
  binary() {
    const java = path.join(this.resources, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const jar = path.join(this.resources, 'signal-cli', 'lib', 'signal-cli-0.14.7.jar');
    if (!fs.existsSync(java) || !fs.existsSync(jar)) throw new Error('内置 Signal 运行环境不完整');
    return { java, jar };
  }
  killTree(child) {
    return new Promise(resolve => {
      if (!child || child.exitCode !== null || !child.pid) return resolve();
      const done = () => resolve();
      child.once('exit', done);
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], done);
      else { try { child.kill('SIGTERM'); } catch {} }
      setTimeout(done, 3000).unref?.();
    });
  }

  async link(id) {
    id = safeId(id);
    const running = this.linking.get(id);
    if (running?.result) return running.result;
    if (running) return running.ready;
    const p = this.paths(id), b = this.binary();
    fs.mkdirSync(p.config, { recursive: true });
    this.saveState(id, { status: '正在生成二维码', error: '' });
    let settleReady;
    const ready = new Promise((resolve, reject) => { settleReady = { resolve, reject }; });
    const child = spawn(b.java, ['-jar', b.jar, '--config', p.config, 'link', '-n', '财盛聚合聊天'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const task = { child, ready, result: null, timer: null, settled: false };
    this.linking.set(id, task);
    let output = '';
    const inspect = chunk => {
      output = (output + String(chunk)).slice(-16_000);
      const uri = output.match(/sgnl:\/\/linkdevice\?[^\s"'<>]+/i)?.[0];
      if (!uri || task.settled) return;
      task.settled = true;
      const result = { uri, expiresAt: Date.now() + 120_000 };
      task.result = result;
      this.saveState(id, { status: '等待扫码', linkUri: uri });
      QRCode.toDataURL(uri, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
        .then(dataUrl => { result.dataUrl = dataUrl; settleReady.resolve(result); })
        .catch(() => settleReady.resolve(result));
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', error => {
      if (!task.settled) { task.settled = true; settleReady.reject(new Error('启动 Signal 扫码失败：' + error.message)); }
    });
    child.once('exit', code => {
      clearTimeout(task.timer);
      if (this.linking.get(id) === task) this.linking.delete(id);
      if (code === 0) {
        this.retryCount.delete(id);
        this.saveState(id, { status: '已连接', linked: true, linkUri: '', error: '' });
        this.start(id).catch(() => {});
      } else {
        this.saveState(id, { status: '连接失败', linked: false, error: output.slice(-500) });
      }
      if (!task.settled) {
        task.settled = true;
        settleReady.reject(new Error(code === 0 ? '没有读取到二维码' : '生成二维码失败：' + output.slice(-300)));
      }
    });
    task.timer = setTimeout(() => {
      if (task.settled) return;
      task.settled = true;
      settleReady.reject(new Error('生成 Signal 二维码超时'));
      this.killTree(child);
    }, 30_000);
    task.timer.unref?.();
    return ready;
  }

  async start(id) {
    id = safeId(id);
    if (this.processes.has(id)) return this.state(id);
    if (this.starting.has(id)) return this.starting.get(id);
    const task = this.startAccount(id).finally(() => this.starting.delete(id));
    this.starting.set(id, task);
    return task;
  }
  async startAccount(id) {
    if (this.stopping) throw new Error('平台正在退出');
    const p = this.paths(id), b = this.binary();
    fs.mkdirSync(p.config, { recursive: true });
    fs.mkdirSync(p.attachments, { recursive: true });
    const child = spawn(b.java, [
      '-Xms32m', '-Xmx256m', '-jar', b.jar, '--config', p.config,
      'jsonRpc', '--receive-mode', 'on-start',
    ], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JAVA_HOME: path.dirname(path.dirname(b.java)) },
    });
    const rt = { child, buffer: '', intentional: false };
    this.processes.set(id, rt);
    this.saveState(id, { status: '正在连接', error: '' });
    child.stdout.on('data', data => this.consume(id, String(data)));
    child.stderr.on('data', data => this.emit('log', { id, message: String(data).slice(-4000) }));
    child.once('error', error => this.emit('log', { id, message: error.message }));
    child.once('exit', code => this.processExit(id, rt, code));
    try {
      await this.rpc(id, 'listAccounts', {}, 60_000);
      this.retryCount.delete(id);
      return this.saveState(id, { status: '在线', linked: true, error: '', linkUri: '' });
    } catch (error) {
      rt.intentional = true;
      await this.killTree(child);
      if (this.processes.get(id) === rt) this.processes.delete(id);
      this.saveState(id, { status: '连接错误', error: error.message });
      throw error;
    }
  }
  processExit(id, rt, code) {
    if (this.processes.get(id) === rt) this.processes.delete(id);
    for (const [key, request] of this.pending) {
      if (!key.startsWith(id + ':')) continue;
      request.reject(new Error('Signal 后台已退出'));
      this.pending.delete(key);
    }
    if (rt.intentional || this.stopping) return;
    this.saveState(id, { status: '离线', error: code ? '后台退出：' + code : '' });
    if (this.state(id).linked) this.scheduleReconnect(id);
  }
  scheduleReconnect(id) {
    if (this.stopping) return;
    clearTimeout(this.retries.get(id));
    const attempt = Math.min((this.retryCount.get(id) || 0) + 1, 8);
    this.retryCount.set(id, attempt);
    const timer = setTimeout(() => {
      this.retries.delete(id);
      if (this.state(id).linked && !this.stopping) this.start(id).catch(() => {});
    }, Math.min(60_000, 2_000 * 2 ** (attempt - 1)));
    timer.unref?.();
    this.retries.set(id, timer);
  }
  restoreAll() {
    let entries = [];
    try { entries = fs.readdirSync(this.root, { withFileTypes: true }); } catch {}
    return Promise.allSettled(entries.filter(x => x.isDirectory())
      .map(x => x.name).filter(id => this.state(id).linked).map(id => this.start(id)));
  }

  consume(id, data) {
    const rt = this.processes.get(id);
    if (!rt) return;
    rt.buffer += data;
    let index;
    while ((index = rt.buffer.indexOf('\n')) >= 0) {
      const line = rt.buffer.slice(0, index).trim();
      rt.buffer = rt.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id != null) {
        const key = id + ':' + message.id, request = this.pending.get(key);
        if (!request) continue;
        this.pending.delete(key);
        message.error ? request.reject(new Error(message.error.message || 'Signal 请求失败')) : request.resolve(message.result);
        continue;
      }
      if (message.method !== 'receive') continue;
      const envelope = message.params?.result?.envelope || message.params?.envelope || message.params;
      this.ingest(id, envelope).catch(error => this.emit('log', { id, message: error.message }));
    }
  }
  rpc(id, method, params = {}, timeout = 30_000) {
    const rt = this.processes.get(id);
    if (!rt?.child.stdin.writable) throw new Error('Signal 账号未在线');
    const number = ++this.seq, key = id + ':' + number;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('Signal 请求超时：' + method));
      }, timeout);
      this.pending.set(key, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      rt.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: number, method, params }) + '\n', error => {
        if (!error) return;
        const request = this.pending.get(key);
        this.pending.delete(key);
        request?.reject(error);
      });
    });
  }

  historyLock(id, action) {
    const next = (this.historyLocks.get(id) || Promise.resolve()).then(action);
    this.historyLocks.set(id, next.catch(() => {}));
    return next;
  }
  rawHistory(id) {
    let text = '';
    try { text = fs.readFileSync(this.paths(id).history, 'utf8'); } catch {}
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
    return rows;
  }
  record(id, message) {
    return this.historyLock(id, () => {
      fs.mkdirSync(this.paths(id).root, { recursive: true });
      fs.appendFileSync(this.paths(id).history, JSON.stringify(message) + '\n');
      this.emit('message', message);
      return message;
    });
  }
  updateMessage(id, timestamp, update) {
    return this.historyLock(id, () => {
      const rows = this.rawHistory(id);
      const message = [...rows].reverse().find(x => Number(x.timestamp) === Number(timestamp));
      if (!message) return null;
      update(message);
      fs.writeFileSync(this.paths(id).history, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
      this.emit('message', { ...message, updated: true });
      return message;
    });
  }
  target(conversationId) {
    const value = String(conversationId || '');
    if (value.startsWith('group:')) return { groupId: value.slice(6) };
    return { recipient: [value.startsWith('direct:') ? value.slice(7) : value] };
  }
  attachmentPath(id, attachment) {
    const p = this.paths(id), raw = attachment.storedFilename || attachment.localPath || attachment.path || '';
    if (!raw) return '';
    const candidates = [
      path.resolve(raw),
      path.resolve(p.config, raw),
      path.resolve(p.config, 'attachments', raw),
    ];
    return candidates.find(candidate => candidate.startsWith(path.resolve(p.root) + path.sep) && fs.existsSync(candidate)) || '';
  }
  normalizeAttachments(id, attachments) {
    return (attachments || []).map(item => ({
      id: item.id || item.attachmentId || '',
      filename: cleanName(item.filename || item.fileName || item.name || '附件'),
      contentType: item.contentType || item.type || 'application/octet-stream',
      size: Number(item.size || 0),
      localPath: this.attachmentPath(id, item),
      voiceNote: Boolean(item.voiceNote),
    }));
  }
  conversation(envelope, data, sent) {
    const groupId = data.groupInfo?.groupId || data.groupInfo?.groupIdV2 || data.groupId;
    if (groupId) return 'group:' + groupId;
    const peer = sent
      ? (data.destinationNumber || data.destinationUuid || data.destination)
      : (envelope.sourceNumber || envelope.sourceUuid || envelope.source);
    return peer ? 'direct:' + peer : '';
  }
  async ingest(id, envelope) {
    if (!envelope) return;
    const receipt = envelope.receiptMessage;
    if (receipt?.timestamps?.length) {
      const status = String(receipt.type || '').toUpperCase() === 'READ' ? '已读' : '已送达';
      await Promise.all(receipt.timestamps.map(timestamp =>
        this.updateMessage(id, timestamp, message => { message.status = status; })));
      return;
    }
    const sent = envelope.syncMessage?.sentMessage;
    const data = envelope.dataMessage || sent;
    if (!data) return;
    if (data.remoteDelete?.timestamp) {
      await this.updateMessage(id, data.remoteDelete.timestamp, message => {
        message.text = ''; message.attachments = []; message.deleted = true; message.status = '已撤回';
      });
      return;
    }
    if (data.reaction?.targetSentTimestamp) {
      await this.updateMessage(id, data.reaction.targetSentTimestamp, message => {
        const sender = envelope.sourceUuid || envelope.sourceNumber || '自己';
        message.reactions = (message.reactions || [])
          .filter(x => x.sender !== sender || x.emoji !== data.reaction.emoji);
        if (!data.reaction.isRemove) message.reactions.push({ sender, emoji: data.reaction.emoji });
      });
      return;
    }
    const editTarget = data.targetSentTimestamp || data.editTimestamp || data.editedMessage?.targetSentTimestamp;
    const editText = data.editedMessage?.message ?? data.message;
    if (editTarget && editText !== undefined) {
      await this.updateMessage(id, editTarget, message => {
        message.text = editText; message.edited = true; message.editedAt = data.timestamp || Date.now();
      });
      return;
    }
    const conversationId = this.conversation(envelope, data, sent);
    if (!conversationId) return;
    await this.record(id, {
      id: crypto.randomUUID(), accountId: id, conversationId,
      sender: sent ? '自己' : (envelope.sourceName || envelope.sourceNumber || envelope.sourceUuid || '未知联系人'),
      author: envelope.sourceUuid || envelope.sourceNumber || (sent ? 'self' : ''),
      text: data.message || '', timestamp: Number(data.timestamp || envelope.timestamp || Date.now()),
      direction: sent ? 'outgoing' : 'incoming',
      attachments: this.normalizeAttachments(id, data.attachments),
      quote: data.quote || null, reactions: [], deleted: false,
      status: sent ? '已发送' : '已送达',
    });
  }

  async conversations(id) {
    await this.start(id);
    const [contacts, groups] = await Promise.all([
      this.rpc(id, 'listContacts', { allRecipients: true, detailed: true }),
      this.rpc(id, 'listGroups', { detailed: true }),
    ]);
    const last = new Map();
    for (const message of this.rawHistory(id)) last.set(message.conversationId, message);
    const out = [];
    for (const contact of contacts || []) {
      const recipient = contact.number || contact.uuid || contact.recipient;
      if (!recipient) continue;
      const conversationId = 'direct:' + recipient, recent = last.get(conversationId);
      out.push({
        id: conversationId, name: contact.name || contact.profileName || recipient, group: false,
        avatar: contact.profile?.avatar || contact.profileAvatar || contact.avatar || '',
        last: recent?.deleted ? '[消息已撤回]' : recent?.text || (recent?.attachments?.length ? '[附件]' : ''),
        timestamp: recent?.timestamp || 0,
      });
    }
    for (const group of groups || []) {
      const groupId = group.id || group.groupId;
      if (!groupId) continue;
      const conversationId = 'group:' + groupId, recent = last.get(conversationId);
      out.push({
        id: conversationId, name: group.name || '未命名群组', group: true,
        avatar: group.avatar || '', members: group.members || [],
        last: recent?.deleted ? '[消息已撤回]' : recent?.text || (recent?.attachments?.length ? '[附件]' : ''),
        timestamp: recent?.timestamp || 0,
      });
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }
  history(id, conversationId, limit = 300) {
    const rows = this.rawHistory(id).filter(x => !conversationId || x.conversationId === conversationId);
    return rows.slice(-Math.min(1000, Math.max(1, Number(limit) || 300)));
  }
  async send(id, to, text, files = [], quote) {
    await this.start(id);
    const target = this.target(to), params = { ...target, message: String(text || '') };
    if (files.length) params.attachment = files.map(String);
    if (quote) {
      params.quoteTimestamp = Number(quote.timestamp);
      params.quoteAuthor = quote.author;
      params.quoteMessage = quote.text || '';
    }
    const result = await this.rpc(id, 'send', params, 120_000);
    return this.record(id, {
      id: crypto.randomUUID(), accountId: id, conversationId: to, sender: '自己', author: 'self',
      text: String(text || ''), timestamp: Number(result?.timestamp || Date.now()), direction: 'outgoing',
      attachments: files.map(file => ({
        filename: cleanName(file), contentType: 'application/octet-stream', localPath: String(file),
      })),
      quote: quote || null, reactions: [], deleted: false, status: '已发送',
    });
  }
  async react(id, to, emoji, target, remove = false) {
    await this.rpc(id, 'sendReaction', {
      ...this.target(to), emoji, targetAuthor: target.author,
      targetTimestamp: Number(target.timestamp), remove,
    });
    return this.updateMessage(id, target.timestamp, message => {
      message.reactions = (message.reactions || []).filter(x => x.sender !== '自己' || x.emoji !== emoji);
      if (!remove) message.reactions.push({ sender: '自己', emoji });
    });
  }
  async edit(id, to, targetTimestamp, text) {
    const result = await this.rpc(id, 'send', {
      ...this.target(to), message: text, editTimestamp: Number(targetTimestamp),
    });
    return this.updateMessage(id, targetTimestamp, message => {
      message.text = text; message.edited = true; message.editedAt = result?.timestamp || Date.now();
      message.status = '已编辑';
    });
  }
  async remove(id, to, targetTimestamp) {
    await this.rpc(id, 'remoteDelete', {
      ...this.target(to), targetTimestamp: Number(targetTimestamp),
    });
    return this.updateMessage(id, targetTimestamp, message => {
      message.text = ''; message.attachments = []; message.deleted = true; message.status = '已撤回';
    });
  }
  async cleanupAttachments(id, olderThanDays = 30) {
    const root = this.paths(id).attachments;
    const cutoff = Date.now() - Math.max(1, Number(olderThanDays) || 30) * 86400000;
    let removed = 0;
    const visit = folder => {
      let entries = [];
      try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (fs.statSync(full).mtimeMs < cutoff) { fs.rmSync(full, { force: true }); removed += 1; }
      }
    };
    visit(root);
    return { removed };
  }
  async reconnect(id) {
    await this.stop(id);
    return this.start(id);
  }
  async stop(id) {
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    this.retryCount.delete(id);
    const link = this.linking.get(id);
    if (link) { clearTimeout(link.timer); this.linking.delete(id); await this.killTree(link.child); }
    const rt = this.processes.get(id);
    if (!rt) return;
    rt.intentional = true;
    this.processes.delete(id);
    await this.killTree(rt.child);
  }
  async removeAccount(id) {
    await this.stop(id);
    fs.rmSync(this.paths(id).root, { recursive: true, force: true });
  }
  async stopAll() {
    this.stopping = true;
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    await Promise.allSettled([
      ...[...this.linking.keys()].map(id => this.stop(id)),
      ...[...this.processes.keys()].map(id => this.stop(id)),
    ]);
  }
}
module.exports = { SignalRuntime };
