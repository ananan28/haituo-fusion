import { randomUUID } from 'node:crypto';
import type {
  AccountFingerprintProfile,
  EditableFingerprintProfile,
} from './types';

export const DEFAULT_EDITABLE_PROFILE: EditableFingerprintProfile = {
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  screen: { width: 1920, height: 1080, scaleFactor: 1 },
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webgl: {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)',
  },
  proxy: {
    enabled: false,
    scheme: 'http',
    host: '',
    port: 7890,
    username: '',
    password: '',
  },
};

export function createProfile(accountId: string): AccountFingerprintProfile {
  return {
    version: 1,
    accountId,
    ...structuredClone(DEFAULT_EDITABLE_PROFILE),
    seed: randomUUID(),
    updatedAt: new Date().toISOString(),
  };
}

export function validateProfile(input: AccountFingerprintProfile): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(input.accountId)) {
    throw new Error('账号标识无效');
  }
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.language)) {
    throw new Error('语言格式无效，例如 zh-CN');
  }
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: input.timezone });
  } catch {
    throw new Error('时区无效');
  }
  const { width, height, scaleFactor } = input.screen;
  if (width < 800 || width > 7680 || height < 600 || height > 4320) {
    throw new Error('分辨率超出允许范围');
  }
  if (scaleFactor < 0.5 || scaleFactor > 4) throw new Error('缩放比例无效');
  if (![1, 2, 4, 6, 8, 12, 16, 24, 32].includes(input.hardwareConcurrency)) {
    throw new Error('CPU 核心数无效');
  }
  if (![1, 2, 4, 8, 16, 32].includes(input.deviceMemory)) {
    throw new Error('内存容量无效');
  }
  if (!input.webgl.vendor.trim() || !input.webgl.renderer.trim()) {
    throw new Error('WebGL 信息不能为空');
  }
  if (input.proxy.enabled) {
    if (!input.proxy.host.trim()) throw new Error('代理地址不能为空');
    if (!Number.isInteger(input.proxy.port) || input.proxy.port < 1 || input.proxy.port > 65535) {
      throw new Error('代理端口无效');
    }
  }
}

