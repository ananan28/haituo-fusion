// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Platform capabilities live here instead of in the shell. Adding a platform
 * therefore does not require another branch in the UI or Electron main process.
 */
export type CaishengPlatformId = 'signal' | 'whatsapp' | 'telegram';

export type CaishengPlatformAdapter = Readonly<{
  id: CaishengPlatformId;
  label: string;
  runtime: 'native' | 'web';
  startUrl?: string;
  allowedHosts: ReadonlyArray<string>;
  defaultIcon: string;
}>;

const REGISTRY: Readonly<Record<CaishengPlatformId, CaishengPlatformAdapter>> =
  Object.freeze({
    signal: {
      id: 'signal',
      label: 'Signal',
      runtime: 'native',
      allowedHosts: [],
      defaultIcon: 'signal',
    },
    whatsapp: {
      id: 'whatsapp',
      label: 'WhatsApp',
      runtime: 'web',
      startUrl: 'https://web.whatsapp.com/',
      allowedHosts: ['web.whatsapp.com'],
      defaultIcon: 'whatsapp',
    },
    telegram: {
      id: 'telegram',
      label: 'Telegram',
      runtime: 'web',
      startUrl: 'https://web.telegram.org/k/',
      allowedHosts: ['web.telegram.org'],
      defaultIcon: 'telegram',
    },
  });

export const CAISHENG_PLATFORM_IDS = Object.freeze(
  Object.keys(REGISTRY) as Array<CaishengPlatformId>
);

export function getCaishengPlatformAdapter(
  id: CaishengPlatformId
): CaishengPlatformAdapter {
  return REGISTRY[id];
}

export function getCaishengPlatformAdapters(): ReadonlyArray<CaishengPlatformAdapter> {
  return CAISHENG_PLATFORM_IDS.map(id => REGISTRY[id]);
}

export function isCaishengPlatformId(
  value: string
): value is CaishengPlatformId {
  return Object.hasOwn(REGISTRY, value);
}

export function isAllowedCaishengPlatformUrl(
  platformId: CaishengPlatformId,
  value: string
): boolean {
  const adapter = getCaishengPlatformAdapter(platformId);
  if (adapter.runtime !== 'web') {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      adapter.allowedHosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
