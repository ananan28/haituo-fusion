import { app, ipcMain, session } from 'electron';
import { FingerprintProfileStore } from './FingerprintProfileStore.main';
import type { AccountFingerprintProfile } from './types';

export const fingerprintStore = new FingerprintProfileStore(app.getPath('userData'));

export function registerFingerprintIpc(): void {
  ipcMain.handle('caisheng:fingerprint:get', (_event, accountId: string) =>
    fingerprintStore.get(accountId),
  );
  ipcMain.handle(
    'caisheng:fingerprint:save',
    async (_event, profile: AccountFingerprintProfile) => {
      const saved = await fingerprintStore.save(profile);
      const accountSession = session.fromPartition(`persist:account-${saved.accountId}`);
      if (saved.proxy.enabled) {
        const credentials = saved.proxy.username
          ? `${encodeURIComponent(saved.proxy.username)}:${encodeURIComponent(saved.proxy.password)}@`
          : '';
        await accountSession.setProxy({
          proxyRules: `${saved.proxy.scheme}://${credentials}${saved.proxy.host}:${saved.proxy.port}`,
        });
      } else {
        await accountSession.setProxy({ mode: 'direct' });
      }
      await accountSession.closeAllConnections();
      return saved;
    },
  );
}

