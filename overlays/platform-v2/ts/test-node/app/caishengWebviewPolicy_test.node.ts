// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  classifyCaishengWebviewNavigation,
  createCaishengWebviewUserAgent,
  isAllowedCaishengWebviewPermission,
  validateCaishengWebviewRequest,
} from '../../../app/caishengWebviewPolicy.main.ts';

describe('caishengWebviewPolicy', () => {
  it('allows multiple isolated accounts for a registered web platform', () => {
    assert.isTrue(
      validateCaishengWebviewRequest({
        partition: 'persist:caisheng-whatsapp-account_01',
        src: 'https://web.whatsapp.com/',
      })
    );
    assert.isTrue(
      validateCaishengWebviewRequest({
        partition: 'persist:caisheng-whatsapp-account_02',
        src: 'https://web.whatsapp.com/',
      })
    );
  });

  it('prevents platform/URL mismatch and unknown partitions', () => {
    assert.isFalse(
      validateCaishengWebviewRequest({
        partition: 'persist:caisheng-telegram-account_01',
        src: 'https://web.whatsapp.com/',
      })
    );
    assert.isFalse(
      validateCaishengWebviewRequest({
        partition: 'persist:default',
        src: 'https://web.whatsapp.com/',
      })
    );
  });

  it('keeps platform navigation internal and sends safe links external', () => {
    assert.deepEqual(
      classifyCaishengWebviewNavigation(
        'persist:caisheng-telegram-account_01',
        'https://web.telegram.org/k/#@example'
      ),
      { action: 'allow' }
    );
    assert.deepEqual(
      classifyCaishengWebviewNavigation(
        'persist:caisheng-telegram-account_01',
        'https://example.com/path'
      ),
      { action: 'external', url: 'https://example.com/path' }
    );
    assert.deepEqual(
      classifyCaishengWebviewNavigation(
        'persist:caisheng-whatsapp-account_01',
        'javascript:alert(1)'
      ),
      { action: 'deny' }
    );
  });

  it('uses current Chromium UA without Electron application markers', () => {
    assert.equal(
      createCaishengWebviewUserAgent(
        'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Electron/38.0.0 Signal/8.0.0'
      ),
      'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'
    );
  });

  it('allows only permissions required by chat services', () => {
    assert.isTrue(isAllowedCaishengWebviewPermission('media'));
    assert.isTrue(isAllowedCaishengWebviewPermission('notifications'));
    assert.isFalse(isAllowedCaishengWebviewPermission('geolocation'));
    assert.isFalse(isAllowedCaishengWebviewPermission('openExternal'));
  });
});
