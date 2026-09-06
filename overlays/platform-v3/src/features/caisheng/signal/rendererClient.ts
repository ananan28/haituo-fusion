import { ipcRenderer } from 'electron';
import type { SignalAccount, SignalMethod, SignalRequestMap, SignalResponseMap, SignalRuntimeEvent } from './types';

export const signalClient = {
  listAccounts: (): Promise<SignalAccount[]> => ipcRenderer.invoke('caisheng:signal:accounts:list'),
  createAccount: (label: string): Promise<SignalAccount> => ipcRenderer.invoke('caisheng:signal:accounts:create', label),
  removeAccount: (accountId: string): Promise<void> => ipcRenderer.invoke('caisheng:signal:accounts:remove', accountId),
  call: <M extends SignalMethod>(method: M, params: SignalRequestMap[M]): Promise<SignalResponseMap[M]> =>
    ipcRenderer.invoke('caisheng:signal:call', method, params),
  onEvent: (listener: (event: SignalRuntimeEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SignalRuntimeEvent) => listener(payload);
    ipcRenderer.on('caisheng:signal:event', handler);
    return () => ipcRenderer.removeListener('caisheng:signal:event', handler);
  },
};
