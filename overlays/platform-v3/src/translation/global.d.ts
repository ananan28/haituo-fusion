import type { CaishengTranslationApi } from './preload';

declare global {
  interface Window {
    caishengTranslation: CaishengTranslationApi;
  }
}

export {};
