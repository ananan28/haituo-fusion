// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only

import { isAllowedCaishengPlatformUrl } from '../ts/services/caishengPlatformRegistry.std.ts';
import { parseCaishengWorkspacePartition } from '../ts/services/caishengWorkspace.std.ts';

export type CaishengWebviewRequest = Readonly<{
  partition: string;
  src: string;
}>;

export type CaishengWebviewNavigation =
  | Readonly<{ action: 'allow' }>
  | Readonly<{ action: 'external'; url: string }>
  | Readonly<{ action: 'deny' }>;

const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:', 'tel:']);

/** Strip application markers while retaining the bundled Chromium version. */
export function createCaishengWebviewUserAgent(
  defaultUserAgent: string
): string {
  return defaultUserAgent
    .replace(/\sElectron\/[^\s]+/giu, '')
    .replace(/\sSignal\/[^\s]+/giu, '')
    .replace(/\sChatTranslatorLite(?:-Native)?\/[^\s]+/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

/**
 * Single policy used by will-attach-webview. It admits any number of account
 * instances, but only for a registered platform and that platform's origin.
 */
export function validateCaishengWebviewRequest({
  partition,
  src,
}: CaishengWebviewRequest): boolean {
  const workspace = parseCaishengWorkspacePartition(partition);
  if (!workspace || workspace.platformId === 'signal') {
    return false;
  }
  return isAllowedCaishengPlatformUrl(workspace.platformId, src);
}

export function classifyCaishengWebviewNavigation(
  partition: string,
  rawUrl: string
): CaishengWebviewNavigation {
  const workspace = parseCaishengWorkspacePartition(partition);
  if (!workspace || workspace.platformId === 'signal') {
    return { action: 'deny' };
  }
  if (isAllowedCaishengPlatformUrl(workspace.platformId, rawUrl)) {
    return { action: 'allow' };
  }
  try {
    const url = new URL(rawUrl);
    if (SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return { action: 'external', url: url.href };
    }
  } catch {
    // Invalid URLs are denied below.
  }
  return { action: 'deny' };
}

export function isAllowedCaishengWebviewPermission(
  permission: string
): boolean {
  return new Set([
    'clipboard-sanitized-write',
    'fullscreen',
    'media',
    'notifications',
  ]).has(permission);
}
