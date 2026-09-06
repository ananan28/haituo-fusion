import { contextBridge, ipcRenderer } from 'electron';
import type { AccountFingerprintProfile } from './types';

export interface FingerprintSettingsApi {
  get(accountId: string): Promise<AccountFingerprintProfile>;
  save(profile: AccountFingerprintProfile): Promise<AccountFingerprintProfile>;
}

contextBridge.exposeInMainWorld('caishengFingerprint', {
  get: (accountId: string) => ipcRenderer.invoke('caisheng:fingerprint:get', accountId),
  save: (profile: AccountFingerprintProfile) =>
    ipcRenderer.invoke('caisheng:fingerprint:save', profile),
} satisfies FingerprintSettingsApi);

