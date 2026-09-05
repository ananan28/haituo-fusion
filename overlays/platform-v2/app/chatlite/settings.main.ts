// SPDX-License-Identifier: AGPL-3.0-only
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
export type AppSettings = {
  translateBaseUrl: string;
  translateToken: string;
  translateModel: string;
  defaultSourceLanguage: string;
  defaultTargetLanguage: string;
  autoTranslateIncoming: boolean;
  autoTranslateOutgoing: boolean;
  bilingualDisplay: boolean;
  translateClientVersion: string;
  translateLocale: string;
  machineId: string;
};
const defaults: AppSettings = {
  translateBaseUrl: '',
  translateToken: '',
  translateModel: '',
  defaultSourceLanguage: 'auto',
  defaultTargetLanguage: 'zh',
  autoTranslateIncoming: false,
  autoTranslateOutgoing: false,
  bilingualDisplay: false,
  translateClientVersion: '',
  translateLocale: 'zh',
  machineId: '',
};
function filename(): string {
  return path.join(app.getPath('userData'), 'chatlite-ui-settings.json');
}
export function loadSettings(): AppSettings {
  try {
    return {
      ...defaults,
      ...JSON.parse(fs.readFileSync(filename(), 'utf8')),
      translateBaseUrl: '',
      translateToken: '',
      translateModel: '',
      autoTranslateIncoming: false,
      autoTranslateOutgoing: false,
      bilingualDisplay: false,
    };
  } catch {
    return { ...defaults };
  }
}
export function saveSettings(_value: Partial<AppSettings>): AppSettings {
  const settings = { ...defaults };
  fs.mkdirSync(path.dirname(filename()), { recursive: true });
  fs.writeFileSync(filename(), JSON.stringify(settings, null, 2));
  return settings;
}
