import { app, ipcMain, type BrowserWindow } from 'electron';
import { SignalServiceManager } from '../../features/caisheng/signal/SignalServiceManager';
import type { SignalMethod, SignalRequestMap } from '../../features/caisheng/signal/types';

export default ({ mainWindow }: { mainWindow: BrowserWindow }) => {
  const manager = new SignalServiceManager(
    undefined,
    undefined,
    event => mainWindow.webContents.send('caisheng:signal:event', event),
  );

  ipcMain.handle('caisheng:signal:accounts:list', () => manager.accounts.list());
  ipcMain.handle('caisheng:signal:accounts:create', (_event, label: string) => manager.accounts.create(label));
  ipcMain.handle('caisheng:signal:accounts:remove', async (_event, accountId: string) => {
    await manager.stop(accountId);
    await manager.accounts.remove(accountId);
  });
  ipcMain.handle('caisheng:signal:call', (_event, method: SignalMethod, params: SignalRequestMap[SignalMethod]) =>
    manager.call(method as any, params as any),
  );
  app.once('before-quit', () => { void manager.shutdown(); });
};
