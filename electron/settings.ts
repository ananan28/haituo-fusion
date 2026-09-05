import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';

export type WhatsAppSession = {
  id: string;
  name: string;
  enabled: boolean;
  partition: string;
};
export type WebPlatformSession = WhatsAppSession;

export type AppSettings = {
  translateBaseUrl: string;
  translateToken: string;
  translateModel: string;
  translateClientVersion: string;
  translateLocale: string;
  machineId: string;
  defaultSourceLanguage: string;
  defaultTargetLanguage: string;
  autoTranslateIncoming: boolean;
  autoTranslateOutgoing: boolean;
  autoTranslateHistory: boolean;
  efficiencyMode: boolean;
  tripleSpaceTranslate: boolean;
  enableBackTranslation: boolean;
  bilingualDisplay: boolean;
  bilingualSendMode: 'translated' | 'both' | 'original';
  translationFontColor: string;
  translationFontSize: number;
  inlineWhatsAppTranslation: boolean;
  whatsappMode: 'aggregate' | 'pure';
  whatsappSessions: WhatsAppSession[];
  telegramSessions: WebPlatformSession[];
  whatsappCompatibilityMode: boolean;
  whatsappFastAutoRead: boolean;
  whatsappStableVersion: boolean;
  whatsappPreferPhoneId: boolean;
  whatsappRemarkDetails: boolean;
  signalSessions: { id: string; name: string; account: string; enabled: boolean }[];
  signalEnabled: boolean;
  signalBaseUrl: string;
  signalAccount: string;
  signalBubbleColor: string;
  signalTextColor: string;
};

function defaultWhatsAppSession(): WhatsAppSession {
  const id = 'wa-main';
  return { id, name: 'WhatsApp 1', enabled: true, partition: `persist:${id}` };
}

const defaults = (): AppSettings => ({
  translateBaseUrl: 'https://api.trangpt.world',
  translateToken: '',
  translateModel: 'trangpt',
  translateClientVersion: '3.1.174',
  translateLocale: 'zh',
  machineId: randomUUID(),
  defaultSourceLanguage: 'auto',
  defaultTargetLanguage: 'en',
  autoTranslateIncoming: true,
  autoTranslateOutgoing: true,
  autoTranslateHistory: true,
  efficiencyMode: false,
  tripleSpaceTranslate: true,
  enableBackTranslation: false,
  bilingualDisplay: true,
  bilingualSendMode: 'translated',
  translationFontColor: '#0DA5F9',
  translationFontSize: 14,
  inlineWhatsAppTranslation: true,
  whatsappMode: 'aggregate',
  whatsappSessions: [defaultWhatsAppSession()],
  telegramSessions: [{ id: 'tg-main', name: 'Telegram 1', enabled: true, partition: 'persist:caisheng-telegram-tg-main' }],
  whatsappCompatibilityMode: false,
  whatsappFastAutoRead: true,
  whatsappStableVersion: true,
  whatsappPreferPhoneId: false,
  whatsappRemarkDetails: true,
  signalSessions: [{ id: 'signal-main', name: 'Signal 1', account: '', enabled: true }],
  signalEnabled: true,
  signalBaseUrl: 'http://127.0.0.1:7583',
  signalAccount: '',
  signalBubbleColor: '#315fea',
  signalTextColor: '#ffffff'
});

function filePath() { return path.join(app.getPath('userData'), 'settings.json'); }

function normalizeSessions(value: unknown): WhatsAppSession[] {
  if (!Array.isArray(value) || !value.length) return [defaultWhatsAppSession()];
  return value
    .filter(Boolean)
    .map((raw: any, index) => {
      const id = String(raw.id || `wa-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '-');
      return {
        id,
        name: String(raw.name || `WhatsApp ${index + 1}`),
        enabled: raw.enabled !== false,
        partition: String(raw.partition || `persist:${id}`)
      };
    });
}

function normalizeWebSessions(value: unknown, prefix: string, label: string): WebPlatformSession[] {
  const source = Array.isArray(value) && value.length ? value : [{ id: `${prefix}-main`, name: `${label} 1`, enabled: true }];
  const seen = new Set<string>();
  return source.filter(Boolean).map((raw: any, index) => {
    let id = String(raw.id || `${prefix}-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!id.startsWith(`${prefix}-`)) id = `${prefix}-${id}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return { id, name: String(raw.name || `${label} ${index + 1}`).slice(0, 80), enabled: raw.enabled !== false, partition: `persist:caisheng-${label.toLowerCase()}-${id}` };
  });
}

export function loadSettings(): AppSettings {
  const d = defaults();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as Partial<AppSettings>;
    return {
      ...d,
      ...parsed,
      machineId: parsed.machineId || d.machineId,
      whatsappSessions: normalizeSessions(parsed.whatsappSessions),
      telegramSessions: normalizeWebSessions(parsed.telegramSessions, 'tg', 'Telegram'),
      signalSessions: parsed.signalSessions ?? [{ id: 'signal-main', name: 'Signal 1', account: parsed.signalAccount || '', enabled: true }],
      signalEnabled: parsed.signalEnabled !== false
    };
  } catch {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(d, null, 2));
    return d;
  }
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const merged = {
    ...loadSettings(),
    ...next,
    whatsappSessions: normalizeSessions(next.whatsappSessions ?? loadSettings().whatsappSessions),
    telegramSessions: normalizeWebSessions(next.telegramSessions ?? loadSettings().telegramSessions, 'tg', 'Telegram')
  };
  const ids = new Set<string>(); const accounts = new Set<string>();
  for (const session of merged.signalSessions) {
    if (!/^[a-zA-Z0-9_-]+$/.test(session.id) || ids.has(session.id)) throw new Error('Signal 账号 ID 无效或重复');
    ids.add(session.id);
    const account = session.account.trim();
    if (account && accounts.has(account)) throw new Error('同一 Signal 账号不能重复添加');
    if (account) accounts.add(account);
    session.account = account;
  }
  merged.signalAccount = merged.signalSessions.find(x => x.id === 'signal-main')?.account || '';
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(merged, null, 2));
  return merged;
}
