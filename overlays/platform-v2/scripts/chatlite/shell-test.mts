// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createCaishengWorkspaceId,
  getCaishengWorkspacePartition,
} from '../../ts/services/caishengWorkspace.std.ts';

const source = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const shell = source('ts/components/CaishengPlatformShell.dom.tsx');
const root = source('ts/state/roots/createApp.preload.tsx');
const main = source('app/main.main.ts');
const userConfig = source('app/user_config.main.ts');

// The primary process must show Caisheng, while an explicitly launched Signal
// account process goes straight to that account's native Signal tree.
assert.match(shell, /useState\(['"]home['"]\)/);
assert.match(shell, /caishengSignalInstances\.current\(\)/);
assert.match(shell, /currentSignalInstance !== null/);
assert.match(shell, /return <>{renderSignal\(\)}<\/>/);
assert.match(shell, /聚合聊天工作台/);
assert.match(root, /<CaishengPlatformShell renderSignal=\{\(\) => <SmartApp \/>\} \/>/);

// Signal is created on demand and there is no renderer-side singleton cap.
assert.match(shell, /caishengSignalInstances\.start\(id\)/);
assert.match(shell, /caishengSignalInstances\.start\(account\.id\)/);
assert.doesNotMatch(shell, /仅支持一个账户/);
assert.doesNotMatch(shell, /signal-main/);

// Web accounts receive independent persistent Electron partitions.
const whatsappA = {
  id: createCaishengWorkspaceId('whatsapp', 'a'),
  platformId: 'whatsapp' as const,
};
const whatsappB = {
  id: createCaishengWorkspaceId('whatsapp', 'b'),
  platformId: 'whatsapp' as const,
};
const telegramA = {
  id: createCaishengWorkspaceId('telegram', 'a'),
  platformId: 'telegram' as const,
};
assert.notEqual(
  getCaishengWorkspacePartition(whatsappA),
  getCaishengWorkspacePartition(whatsappB)
);
assert.notEqual(
  getCaishengWorkspacePartition(whatsappA),
  getCaishengWorkspacePartition(telegramA)
);
assert.match(shell, /partition: getCaishengWorkspacePartition\(account\)/);

// Each Signal child selects a profile-specific userData root before Signal's
// single-instance lock and database initialization run.
assert.match(userConfig, /--caisheng-signal-instance=/);
assert.match(userConfig, /signal-instances/);
assert.match(userConfig, /app\.setPath\(['"]userData['"], userData\)/);
assert.match(main, /caishengSignalInstances\.start\(id\)/);
assert.match(main, /app\.on\(['"]will-quit['"], \(\) => caishengSignalInstances\.stopAll\(\)\)/);

// Screenshot protection is opt-in for the platform window, not inherited from
// Signal's Windows default.
const protectionStart = main.indexOf(
  'const contentProtection = ephemeralConfig.get("contentProtection")'
);
const protectionEnd = main.indexOf('await zoomFactorService', protectionStart);
assert(protectionStart >= 0 && protectionEnd > protectionStart);
const startupProtection = main.slice(protectionStart, protectionEnd);
assert.match(startupProtection, /contentProtection === true/);
assert.doesNotMatch(startupProtection, /isContentProtectionEnabledByDefault/);

console.log(
  'PASS: Caisheng is primary; Signal is on-demand and multi-profile; web sessions are isolated; screenshots default to allowed'
);
