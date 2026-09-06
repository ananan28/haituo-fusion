import type { FingerprintSettingsApi } from './preload';

declare global {
  interface Window {
    caishengFingerprint: FingerprintSettingsApi;
  }
}

export {};

