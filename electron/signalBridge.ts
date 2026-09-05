import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { loadSettings } from './settings';
import { signalProfile, updateSignalProfile } from './signalStore';
import { runtimeCommand } from './signalRuntime';
import type { SignalStatus } from './signalTypes';

export const signalEvents = new EventEmitter();
signalEvents.setMaxListeners(100);
type Runtime = { id: string; child?: ChildProcess; port: number; life: AbortController; events?: AbortController; status: SignalStatus; opening?: Promise<void>; pairing?: Promise<void>; failures: number; desired: boolean; restart?: ReturnType<typeof setTimeout> };
const runtimes = new Map<string, Runtime>();
const reserved = new Set<number>();
let stopping = false;
function checkSession(id: string) {
  const s = loadSettings();
  if (!s.signalEnabled || !s.signalSessions.some(x => x.id === id && x.enabled)) throw new Error('SIGNAL_DISABLED');
}
function instance(id: string) {
  checkSession(id);
  let r = runtimes.get(id);
  if (!r) { r = { id, port: 0, life: new AbortController(), status: { sessionId: id, phase: 'idle' }, failures: 0, desired: true }; runtimes.set(id, r); }
  return r;
}
function status(r: Runtime, patch: Omit<SignalStatus, 'sessionId'>) {
  r.status = { sessionId: r.id, ...patch }; signalEvents.emit('status', r.status);
}
export function signalStatus(id: string): SignalStatus { return runtimes.get(id)?.status || { sessionId: id, phase: 'idle' }; }
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('STOPPED'));
    const abort = () => { clearTimeout(timer); reject(new Error('STOPPED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function free(port: number) {
  return new Promise<boolean>(resolve => {
    const server = net.createServer(); server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
async function allocate(preferred: number) {
  for (let port = preferred; port <= 65535; port++) {
    if (reserved.has(port)) continue;
    reserved.add(port);
    if (await free(port)) return port;
    reserved.delete(port);
  }
  throw new Error('NO_PORT');
}
async function request(r: Runtime, method: string, params: Record<string, unknown>, timeout = 30000, signal = r.life.signal): Promise<any> {
  if (!r.child || r.child.exitCode !== null || signal.aborted) throw new Error('SERVICE_STOPPED');
  const response = await fetch(`http://127.0.0.1:${r.port}/api/v1/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params })
  });
  const data = await response.json() as any;
  if (!response.ok || data.error) throw new Error(data.error?.message || `HTTP_${response.status}`);
  return data.result;
}
async function terminate(r: Runtime) {
  const child = r.child; if (!child) return;
  r.child = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    child.once('exit', finish);
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, 2500);
    child.kill('SIGTERM');
  });
}
async function connectEvents(r: Runtime) {
  r.events?.abort(); const control = new AbortController(); r.events = control;
  const signal = AbortSignal.any([r.life.signal, control.signal]);
  while (!signal.aborted && r.desired) {
    try {
      const response = await fetch(`http://127.0.0.1:${r.port}/api/v1/events`, { signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok || !response.body) throw new Error('EVENT_STREAM');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      try {
        while (!signal.aborted) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 4_000_000) throw new Error('EVENT_TOO_LARGE');
          const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
          for (const frame of frames) {
            const raw = frame.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
            if (!raw) continue;
            try {
              const payload = JSON.parse(raw); const root = payload?.params?.result || payload?.params || payload;
              const account = signalProfile(r.id).account;
              // Each process owns exactly one profile. Explicit foreign account events are still rejected.
              if (root.account && root.account !== account) continue;
              signalEvents.emit('event', { sessionId: r.id, payload });
            } catch { /* Ignore invalid frames, never execute payloads. */ }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { if (signal.aborted) return; }
    try { await delay(1500, signal); } catch { return; }
  }
}
function accountList(raw: any): string[] {
  return (Array.isArray(raw) ? raw : raw?.accounts || []).map((x: any) => typeof x === 'string' ? x : x.number || x.account || '').filter(Boolean);
}
async function finishPairing(r: Runtime, uri: string) {
  try {
    await request(r, 'finishLink', { deviceLinkUri: uri, deviceName: 'ChatTranslatorLite' }, 180000);
    const accounts = accountList(await request(r, 'listAccounts', {}));
    if (accounts.length !== 1) throw new Error('PAIR_ACCOUNT_COUNT');
    const profile = signalProfile(r.id);
    // Old externally hosted credentials are never silently reassigned to another identity.
    if (profile.legacyAccount && profile.legacyAccount !== accounts[0]) throw new Error('ACCOUNT_MISMATCH');
    updateSignalProfile(r.id, { account: accounts[0] });
    r.failures = 0;
    status(r, { phase: 'ready', account: accounts[0] });
    void connectEvents(r);
    await request(r, 'sendSyncRequest', { account: accounts[0] }).catch(() => {});
  } catch (e: any) {
    if (!r.life.signal.aborted && r.desired) status(r, { phase: 'error', code: e.message === 'ACCOUNT_MISMATCH' ? 'ACCOUNT_MISMATCH' : 'PAIRING_EXPIRED', message: e.message === 'ACCOUNT_MISMATCH' ? '请使用此账号原来的手机扫码，或添加一个新账号。' : '本次配对未完成，点击重新生成二维码。' });
  }
}
async function boot(r: Runtime) {
  const command = runtimeCommand();
  let profile = signalProfile(r.id);
  const legacy = loadSettings().signalSessions.find(x => x.id === r.id)?.account;
  if (!profile.account && legacy && !profile.legacyAccount) profile = updateSignalProfile(r.id, { legacyAccount: legacy });
  r.life = new AbortController(); r.desired = true;
  status(r, { phase: 'starting', message: '正在准备安全连接…' });
  r.port = await allocate(profile.port); updateSignalProfile(r.id, { port: r.port });
  if (r.life.signal.aborted || stopping || !r.desired) { reserved.delete(r.port); throw new Error('STOPPED'); }
  const child = spawn(command.executable, [...command.args, '--config', profile.configDir, '--scrub-log', 'daemon', '--http', `127.0.0.1:${r.port}`], {
    cwd: command.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
  });
  r.child = child;
  // Drain streams to avoid process stalls; do not persist decrypted content or QR credentials.
  child.stdout?.resume(); child.stderr?.resume();
  let spawnFailure = false; child.once('error', () => { spawnFailure = true; });
  child.once('exit', () => {
    if (r.child !== child || !r.desired || stopping) return;
    r.events?.abort(); r.life.abort(); r.child = undefined; reserved.delete(r.port);
    if (r.opening) return; // readiness loop owns startup failures
    if (++r.failures <= 3) {
      status(r, { phase: 'retrying', message: '正在恢复连接…' });
      r.restart = setTimeout(() => { r.restart = undefined; void ensureSignal(r.id).catch(() => {}); }, Math.min(1000 * 2 ** r.failures, 8000));
    } else status(r, { phase: 'error', code: 'CORE_EXIT', message: '连接恢复未完成，请点击重试。' });
  });
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline && !r.life.signal.aborted) {
    if (spawnFailure || child.exitCode !== null || child.signalCode !== null) throw new Error('CORE_EXIT');
    try {
      const response = await fetch(`http://127.0.0.1:${r.port}/api/v1/check`, { signal: AbortSignal.any([r.life.signal, AbortSignal.timeout(800)]) });
      if (response.ok) { ready = true; break; }
    } catch { /* readiness polling */ }
    await delay(250, r.life.signal);
  }
  if (!ready) throw new Error('START_TIMEOUT');
  const accounts = accountList(await request(r, 'listAccounts', {}));
  if (accounts.length > 1) throw new Error('PROFILE_HAS_MULTIPLE_ACCOUNTS');
  if (accounts.length === 1) {
    if ((profile.account || profile.legacyAccount) && accounts[0] !== (profile.account || profile.legacyAccount)) throw new Error('ACCOUNT_MISMATCH');
    updateSignalProfile(r.id, { account: accounts[0] });
    status(r, { phase: 'ready', account: accounts[0] }); void connectEvents(r); return;
  }
  const link = await request(r, 'startLink', {});
  if (typeof link?.deviceLinkUri !== 'string' || !link.deviceLinkUri.startsWith('sgnl://linkdevice?')) throw new Error('INVALID_QR');
  status(r, { phase: 'pairing', qrUri: link.deviceLinkUri, message: profile.legacyAccount ? '请用原账号手机重新连接。旧聊天记录会保留。' : '请用手机 Signal 扫码连接。' });
  // Must begin waiting immediately; user is never required to click “finishLink”.
  r.pairing = finishPairing(r, link.deviceLinkUri).finally(() => { r.pairing = undefined; });
}
export async function ensureSignal(id: string): Promise<SignalStatus> {
  if (stopping) throw new Error('STOPPED');
  const r = instance(id);
  if (r.opening) { await r.opening; return r.status; }
  if (r.child && ['ready', 'pairing'].includes(r.status.phase)) return r.status;
  if (r.restart) { clearTimeout(r.restart); r.restart = undefined; }
  r.opening = (async () => {
    try {
      if (r.child) { r.life.abort(); r.events?.abort(); await terminate(r); await r.pairing; reserved.delete(r.port); }
      await boot(r);
    }
    catch (e: any) {
      r.life.abort(); r.events?.abort(); await terminate(r); reserved.delete(r.port);
      if (!r.desired || stopping) return;
      const known = new Set(['RUNTIME_MISSING','ACCOUNT_MISMATCH','PROFILE_HAS_MULTIPLE_ACCOUNTS','CORE_EXIT','NO_PORT','START_TIMEOUT','INVALID_QR']);
      const code = known.has(e?.message) ? e.message : 'START_FAILED';
      status(r, { phase: 'error', code, message: code === 'RUNTIME_MISSING' ? '应用组件不完整，请安装包含 Signal 组件的完整版本。' : code === 'ACCOUNT_MISMATCH' ? '此账号身份与原记录不一致，请使用原账号或新增账号。' : '暂时无法建立连接，请点击重试。' });
    }
  })().finally(() => { r.opening = undefined; });
  await r.opening; return r.status;
}
export async function stopSignal(id: string) {
  const r = runtimes.get(id); if (!r) return;
  r.desired = false; if (r.restart) clearTimeout(r.restart);
  r.life.abort(); r.events?.abort(); await r.opening; await terminate(r); await r.pairing;
  reserved.delete(r.port); status(r, { phase: 'stopped' }); runtimes.delete(id);
}
export async function retrySignal(id: string) { await stopSignal(id); return ensureSignal(id); }
export async function stopAllSignals() { stopping = true; await Promise.all([...runtimes.keys()].map(stopSignal)); }
export async function signalRpc(method: string, params: Record<string, unknown> = {}, id = 'signal-main') {
  const allowed = new Set(['listContacts', 'listGroups', 'send', 'sendSyncRequest']);
  if (!allowed.has(method)) throw new Error('RPC_NOT_ALLOWED');
  const r = instance(id); const state = await ensureSignal(id);
  if (state.phase !== 'ready') throw new Error('请先用手机完成扫码连接');
  return request(r, method, { ...params, account: signalProfile(id).account });
}
