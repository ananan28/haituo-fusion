// Copyright 2026 Caisheng; ChatTranslatorLite integration
// SPDX-License-Identifier: AGPL-3.0-only
import {
  ipcMain,
  shell,
  type BrowserWindow,
  type WebContents,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  createCaishengWebviewUserAgent,
  isAllowedCaishengWebviewPermission,
} from './caishengWebviewPolicy.main.ts';
import {
  isAllowedCaishengPlatformUrl,
  type CaishengPlatformId,
} from '../ts/services/caishengPlatformRegistry.std.ts';
import { loadSettings } from './chatlite/settings.main.ts';
import type { ChatLiteConfig } from '../ts/types/ChatLite.std.ts';

export function registerChatLiteGuest(
  contents: WebContents,
  _sessionId: string
): void {
  contents.setUserAgent(
    createCaishengWebviewUserAgent(contents.session.getUserAgent())
  );
  const platformId: CaishengPlatformId = contents.getURL().includes('telegram')
    ? 'telegram'
    : 'whatsapp';
  contents.session.setPermissionRequestHandler(
    (requestingContents, permission, callback) => {
      callback(
        requestingContents === contents &&
          isAllowedCaishengWebviewPermission(permission)
      );
    }
  );
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedCaishengPlatformUrl(platformId, url)) {
      return { action: 'allow' };
    }
    try {
      const protocol = new URL(url).protocol;
      if (protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid links remain blocked.
    }
    return { action: 'deny' };
  });
  const guard = (event: Electron.Event, url: string): void => {
    try {
      if (isAllowedCaishengPlatformUrl(platformId, url)) return;
      const protocol = new URL(url).protocol;
      if (protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') {
        void shell.openExternal(url);
      }
    } catch {
      /* reject */
    }
    event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
}
export function installCaishengWebviewTranslation(
  getMainWindow: () => BrowserWindow | undefined
): void {
  const shell = (event: IpcMainInvokeEvent): void => {
    if (
      event.sender !== getMainWindow()?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('FORBIDDEN');
  };
  const config = (): ChatLiteConfig => {
    const s = loadSettings();
    return {
      translateBaseUrl: '',
      translateModel: '',
      defaultSourceLanguage: s.defaultSourceLanguage,
      defaultTargetLanguage: s.defaultTargetLanguage,
      autoTranslateIncoming: false,
      autoTranslateOutgoing: false,
      bilingualDisplay: false,
      tokenConfigured: false,
    };
  };
  ipcMain.handle('chatlite:config:get', event => {
    shell(event);
    return config();
  });
  ipcMain.handle('chatlite:config:save', event => {
    shell(event);
    throw new Error('本版未接入翻译服务');
  });
  ipcMain.handle('chatlite:config:import', event => {
    shell(event);
    throw new Error('本版不导入翻译接口或 Token');
  });
  ipcMain.handle('chatlite:history', event => {
    shell(event);
    return [];
  });
  // Existing optional UI entry points fail locally; no fallback providers.
  ipcMain.handle('caisheng:translate', () => {
    throw new Error('本版未接入翻译服务');
  });
  ipcMain.handle('caisheng:webview-translate', () => {
    throw new Error('本版未接入翻译服务');
  });
}
