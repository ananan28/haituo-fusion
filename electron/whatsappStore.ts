import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type StoredWhatsAppMessage = {
  id: string;
  sessionId: string;
  chatId: string;
  chatTitle: string;
  direction: 'in' | 'out';
  text: string;
  originalText?: string;
  translatedText?: string;
  at: number;
  locatorType?: string;
  locator?: string;
};

function filePath() { return path.join(app.getPath('userData'), 'whatsapp-message-cache.json'); }
function readAll(): StoredWhatsAppMessage[] {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function writeAll(items: StoredWhatsAppMessage[]) {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(items.slice(-4000), null, 2));
}

export function readWhatsAppMessages(chatId?: string, limit = 500): StoredWhatsAppMessage[] {
  let items = readAll();
  if (chatId) items = items.filter(x => x.chatId === chatId);
  return items.slice(-Math.max(1, Math.min(limit, 4000)));
}

export function upsertWhatsAppMessage(item: StoredWhatsAppMessage): StoredWhatsAppMessage {
  const items = readAll();
  const index = items.findIndex(x => x.id === item.id);
  if (index < 0) items.push(item);
  else items[index] = { ...items[index], ...item };
  items.sort((a, b) => a.at - b.at);
  writeAll(items);
  return item;
}

export function clearWhatsAppMessages(chatId?: string) {
  if (!chatId) return writeAll([]);
  writeAll(readAll().filter(x => x.chatId !== chatId));
}
