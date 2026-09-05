import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type StoredSignalMessage = {
  id: string;
  conversationId: string;
  conversationKind: 'contact' | 'group';
  peer: string;
  sender: string;
  direction: 'in' | 'out';
  text: string;
  originalText?: string;
  translatedText?: string;
  attachments?: string[];
  at: number;
};

function storePath(sessionId = 'signal-main') {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid Signal session');
  return path.join(app.getPath('userData'), sessionId === 'signal-main' ? 'signal-message-cache.json' : `signal-${sessionId}-messages.json`);
}

function readAll(sessionId = 'signal-main'): StoredSignalMessage[] {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(sessionId), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(items: StoredSignalMessage[], sessionId = 'signal-main') {
  fs.mkdirSync(path.dirname(storePath(sessionId)), { recursive: true });
  const tmp = `${storePath(sessionId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  try {
    fs.renameSync(tmp, storePath(sessionId));
  } catch {
    fs.copyFileSync(tmp, storePath(sessionId));
    fs.unlinkSync(tmp);
  }
}

export function upsertSignalMessage(item: StoredSignalMessage, sessionId = 'signal-main'): StoredSignalMessage {
  const list = readAll(sessionId);
  const index = list.findIndex(x => x.id === item.id);
  if (index >= 0) list[index] = { ...list[index], ...item };
  else list.push(item);
  list.sort((a, b) => a.at - b.at);
  writeAll(list.slice(-4000), sessionId);
  return item;
}

export function readSignalMessages(conversationId?: string, limit = 300, sessionId = 'signal-main'): StoredSignalMessage[] {
  const list = readAll(sessionId)
    .filter(x => !conversationId || x.conversationId === conversationId)
    .sort((a, b) => a.at - b.at);
  return list.slice(-Math.max(1, Math.min(limit, 4000)));
}

export function clearSignalMessages(conversationId?: string, sessionId = 'signal-main') {
  if (!conversationId) return writeAll([], sessionId);
  writeAll(readAll(sessionId).filter(x => x.conversationId !== conversationId), sessionId);
}

// This store owns runtime identity, separate from editable presentation settings.
export function signalProfile(sessionId: string): import('./signalTypes').SignalProfile {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw new Error('Invalid Signal session');
  const file = path.join(app.getPath('userData'), 'signal-profiles.json');
  let all: Record<string, import('./signalTypes').SignalProfile> = {};
  if (fs.existsSync(file)) all = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!all[sessionId]) {
    const ports = new Set(Object.values(all).map(x => x.port));
    let port = 7503; while (ports.has(port) && port < 65535) port++;
    all[sessionId] = { sessionId, port, configDir: path.join(app.getPath('userData'), 'signal-accounts', sessionId), account: '' };
    atomicProfiles(file, all);
  }
  if (!Number.isInteger(all[sessionId].port) || all[sessionId].port < 1024 || all[sessionId].port > 65535) throw new Error('INVALID_PROFILE_PORT');
  all[sessionId].configDir = path.join(app.getPath('userData'), 'signal-accounts', sessionId);
  fs.mkdirSync(all[sessionId].configDir, { recursive: true, mode: 0o700 });
  return all[sessionId];
}
function atomicProfiles(file: string, all: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
export function updateSignalProfile(sessionId: string, patch: Partial<Pick<import('./signalTypes').SignalProfile, 'port' | 'account' | 'legacyAccount'>>) {
  signalProfile(sessionId);
  const file = path.join(app.getPath('userData'), 'signal-profiles.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all[sessionId] = { ...all[sessionId], ...patch };
  atomicProfiles(file, all);
  return all[sessionId] as import('./signalTypes').SignalProfile;
}
