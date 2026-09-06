import type { WebContents } from 'electron';
import type { AccountFingerprintProfile } from './types';

export function fingerprintBootstrap(profile: AccountFingerprintProfile): string {
  // JSON serialization makes this safe to inject before any service page script.
  const json = JSON.stringify(profile).replaceAll('<', '\\u003c');
  return `(() => {
    const p = ${json};
    const def = (target, name, value) => { try { Object.defineProperty(target, name, { configurable: true, get: () => value }); } catch {} };
    def(Navigator.prototype, 'language', p.language);
    def(Navigator.prototype, 'languages', [p.language, p.language.split('-')[0]]);
    def(Navigator.prototype, 'hardwareConcurrency', p.hardwareConcurrency);
    def(Navigator.prototype, 'deviceMemory', p.deviceMemory);
    def(Navigator.prototype, 'webdriver', undefined);
    def(Screen.prototype, 'width', p.screen.width);
    def(Screen.prototype, 'availWidth', p.screen.width);
    def(Screen.prototype, 'height', p.screen.height);
    def(Screen.prototype, 'availHeight', p.screen.height - 40);
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function() { return { ...resolved.call(this), timeZone: p.timezone }; };
    const patchWebgl = proto => {
      if (!proto) return;
      const original = proto.getParameter;
      proto.getParameter = function(key) {
        if (key === 37445) return p.webgl.vendor;
        if (key === 37446) return p.webgl.renderer;
        return original.call(this, key);
      };
    };
    patchWebgl(globalThis.WebGLRenderingContext?.prototype);
    patchWebgl(globalThis.WebGL2RenderingContext?.prototype);
    globalThis.__CAISHENG_PROFILE_READY__ = true;
  })();`;
}

export async function attachAccountFingerprint(
  contents: WebContents,
  profile: AccountFingerprintProfile,
): Promise<void> {
  contents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      'Chrome/128.0.0.0 Safari/537.36',
  );
  // Call this on did-frame-finish-load for every frame. Production service
  // containers should also install the same bootstrap through their preload so
  // it executes before page JavaScript.
  await contents.executeJavaScript(fingerprintBootstrap(profile), true);
}
