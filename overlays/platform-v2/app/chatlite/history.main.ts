// ChatTranslatorLite integration. SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type HistoryItem = {
  id: string;
  at: string;
  service: 'whatsapp' | 'signal' | 'manual';
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  direction?: 'in' | 'out' | 'manual';
  conversationId?: string;
  conversationTitle?: string;
  sessionId?: string;
  model?: string;
};

function filePath() {
  return path.join(app.getPath('userData'), 'translation-history.json');
}

export function readHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addHistory(item: HistoryItem) {
  const list = readHistory();
  list.unshift(item);
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(list.slice(0, 5000), null, 2));
}

export function clearHistory() {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), '[]');
}
