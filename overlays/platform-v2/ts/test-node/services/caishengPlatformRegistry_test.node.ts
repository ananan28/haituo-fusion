// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import {
  getCaishengPlatformAdapter,
  isAllowedCaishengPlatformUrl,
  isCaishengPlatformId,
} from '../../services/caishengPlatformRegistry.std.ts';

describe('caishengPlatformRegistry', () => {
  it('resolves adapters without shell-specific branching', () => {
    assert.equal(getCaishengPlatformAdapter('signal').runtime, 'native');
    assert.equal(getCaishengPlatformAdapter('whatsapp').runtime, 'web');
  });

  it('only permits the registered HTTPS service origin', () => {
    assert.isTrue(
      isAllowedCaishengPlatformUrl('whatsapp', 'https://web.whatsapp.com/')
    );
    assert.isFalse(
      isAllowedCaishengPlatformUrl('whatsapp', 'http://web.whatsapp.com/')
    );
    assert.isFalse(
      isAllowedCaishengPlatformUrl(
        'whatsapp',
        'https://web.whatsapp.com.attacker.example/'
      )
    );
    assert.isFalse(
      isAllowedCaishengPlatformUrl(
        'telegram',
        'https://user:password@web.telegram.org/k/'
      )
    );
  });

  it('rejects unknown platform ids', () => {
    assert.isTrue(isCaishengPlatformId('telegram'));
    assert.isFalse(isCaishengPlatformId('unknown'));
  });
});
