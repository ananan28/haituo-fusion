import { contextBridge, ipcRenderer } from 'electron';
import type { AiModelSettingsPatch, AiModelSettingsView, TranslationRequest, TranslationResult } from './types';

export interface CaishengTranslationApi {
  translate(request: TranslationRequest): Promise<TranslationResult>;
  getAiSettings(): Promise<AiModelSettingsView>;
  saveAiSettings(patch: AiModelSettingsPatch): Promise<AiModelSettingsView>;
}

export const translationApi: CaishengTranslationApi = {
  translate: request => ipcRenderer.invoke('caisheng:translation:run', request),
  getAiSettings: () => ipcRenderer.invoke('caisheng:translation:ai:get'),
  saveAiSettings: patch => ipcRenderer.invoke('caisheng:translation:ai:save', patch),
};

contextBridge.exposeInMainWorld('caishengTranslation', translationApi);
