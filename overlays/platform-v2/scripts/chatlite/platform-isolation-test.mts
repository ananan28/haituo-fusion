// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createCaishengWorkspaceId,
  getCaishengWorkspacePartition,
  parseCaishengWorkspacePartition,
} from '../../ts/services/caishengWorkspace.std.ts';

const source = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

// One account must always produce one stable, unique runtime identity.
const wa1 = {
  id: createCaishengWorkspaceId('whatsapp', 'account-a'),
  platformId: 'whatsapp' as const,
};
const wa2 = {
  id: createCaishengWorkspaceId('whatsapp', 'account-b'),
  platformId: 'whatsapp' as const,
};
const tg1 = {
  id: createCaishengWorkspaceId('telegram', 'account-a'),
  platformId: 'telegram' as const,
};
const signal1 = {
  id: createCaishengWorkspaceId('signal', 'account-a'),
  platformId: 'signal' as const,
};
const signal2 = {
  id: createCaishengWorkspaceId('signal', 'account-b'),
  platformId: 'signal' as const,
};

const partitions = [wa1, wa2, tg1, signal1, signal2].map(account =>
  getCaishengWorkspacePartition(account)
);
assert.equal(new Set(partitions).size, partitions.length);
for (const [index, partition] of partitions.entries()) {
  const account = [wa1, wa2, tg1, signal1, signal2][index];
  assert.deepEqual(parseCaishengWorkspacePartition(partition), {
    platformId: account.platformId,
    workspaceId: account.id,
  });
}
assert.throws(
  () =>
    getCaishengWorkspacePartition({
      id: 'whatsapp-account-a',
      platformId: 'telegram',
    }),
  /does not match platform/
);

const shell = source('ts/components/CaishengPlatformShell.dom.tsx');
assert.match(shell, /useState\(['"]home['"]\)/, 'platform must open on the Caisheng home');
assert.doesNotMatch(
  shell,
  /platformId === ['"]signal['"]\s*\?\s*accounts\.find/,
  'the shell must not impose a one-Signal-account limit'
);
assert.doesNotMatch(
  shell,
  /createCaishengWorkspaceId\(platformId,\s*platformId === ['"]signal['"]\s*\?\s*['"]main['"]:/,
  'Signal accounts must not reuse the fixed signal-main id'
);

const manager = source('app/caishengSignalInstances.main.ts');
assert.match(manager, /Map<string, ChildProcess>/);
assert.match(manager, /--caisheng-signal-instance=/);
assert.match(manager, /this\.#children\.get\(id\)/);

const userConfig = source('app/user_config.main.ts');
assert.match(userConfig, /--caisheng-signal-instance=/);
assert.match(userConfig, /signal-instances/);
assert.match(userConfig, /caishengSignalInstance/);
assert.match(userConfig, /app\.setPath\(['"]userData['"], userData\)/);

const main = source('app/main.main.ts');
assert.match(main, /contentProtection === true/);
assert.doesNotMatch(
  main.slice(main.indexOf('const contentProtection = ephemeralConfig.get'), main.indexOf('await zoomFactorService')),
  /isContentProtectionEnabledByDefault/,
  'the platform window must not inherit Signal screenshot protection by default'
);

console.log(
  'PASS: Caisheng home, account identities, web partitions, Signal profile roots and screenshot default are isolated'
);
