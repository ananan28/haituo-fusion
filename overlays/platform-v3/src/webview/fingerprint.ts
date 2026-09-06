/* Account-scoped browser profile. Each service partition owns its localStorage,
 * so the seed is stable for that account and different from every other one. */

const KEY = 'caisheng.device-profile.v1';
const OVERRIDES_KEY = 'caisheng.device-profile.overrides.v1';

type DeviceProfile = Readonly<{
  seed: number;
  language: string;
  languages: ReadonlyArray<string>;
  hardwareConcurrency: number;
  deviceMemory: number;
  timezone: string;
  screenWidth: number;
  screenHeight: number;
}>;

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function profile(): DeviceProfile {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  const seed = hash(id);
  const defaults: DeviceProfile = {
    seed,
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: [4, 8, 12, 16][seed % 4],
    deviceMemory: [4, 8, 16][seed % 3],
    timezone: 'Asia/Shanghai',
    screenWidth: [1366, 1440, 1536, 1920][seed % 4],
    screenHeight: [768, 900, 864, 1080][seed % 4],
  };
  try {
    const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}') as Partial<DeviceProfile>;
    return { ...defaults, ...overrides, seed };
  } catch {
    return defaults;
  }
}

const device = profile();
const define = (target: object, key: string, value: unknown): void => {
  try {
    Object.defineProperty(target, key, { configurable: true, get: () => value });
  } catch {
    // A service may freeze a prototype; isolation still remains at session level.
  }
};

define(Navigator.prototype, 'language', device.language);
define(Navigator.prototype, 'languages', device.languages);
define(Navigator.prototype, 'hardwareConcurrency', device.hardwareConcurrency);
define(Navigator.prototype, 'deviceMemory', device.deviceMemory);
define(Navigator.prototype, 'webdriver', undefined);
define(Screen.prototype, 'width', device.screenWidth);
define(Screen.prototype, 'availWidth', device.screenWidth);
define(Screen.prototype, 'height', device.screenHeight);
define(Screen.prototype, 'availHeight', device.screenHeight - 40);

const nativeResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
  return { ...nativeResolvedOptions.call(this), timeZone: device.timezone };
};

const nativeGetParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function getParameter(parameter) {
  if (parameter === 37445) return 'Google Inc. (Intel)';
  if (parameter === 37446) return `ANGLE (Intel, Intel UHD Graphics ${620 + (device.seed % 4)} Direct3D11)`;
  return nativeGetParameter.call(this, parameter);
};

const nativeToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function toDataURL(...args) {
  const context = this.getContext('2d');
  if (context && this.width > 0 && this.height > 0) {
    const x = device.seed % this.width;
    const y = (device.seed >>> 8) % this.height;
    const pixel = context.getImageData(x, y, 1, 1);
    pixel.data[0] ^= device.seed & 1;
    context.putImageData(pixel, x, y);
  }
  return nativeToDataURL.apply(this, args as Parameters<typeof nativeToDataURL>);
};

// Prevent local-address leakage. Calls still work through the configured
// account proxy, while host ICE candidates are not exposed to page scripts.
if ('RTCPeerConnection' in window) {
  const NativeRtc = window.RTCPeerConnection;
  window.RTCPeerConnection = class CaishengRTCPeerConnection extends NativeRtc {
    constructor(configuration?: RTCConfiguration) {
      super({ ...configuration, iceTransportPolicy: configuration?.iceTransportPolicy ?? 'relay' });
    }
  };
}
