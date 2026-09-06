import { ipcMain } from 'electron';
import type { AiModelSettingsPatch, TranslationRequest } from './types';
import type { TranslationService } from './service';
import type { SecureAiSettingsStore } from './SecureAiSettingsStore.main';

export function registerTranslationIpc(service: TranslationService, settings: SecureAiSettingsStore): void {
  ipcMain.removeHandler('caisheng:translation:run');
  ipcMain.removeHandler('caisheng:translation:ai:get');
  ipcMain.removeHandler('caisheng:translation:ai:save');
  ipcMain.handle('caisheng:translation:run', (_event, request: TranslationRequest) => service.translate(request));
  ipcMain.handle('caisheng:translation:ai:get', () => settings.view());
  ipcMain.handle('caisheng:translation:ai:save', (_event, patch: AiModelSettingsPatch) => settings.save(patch));
}
