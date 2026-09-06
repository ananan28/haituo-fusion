import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AccountFingerprintProfile } from './types';
import { createProfile, validateProfile } from './profile';

export class FingerprintProfileStore {
  constructor(private readonly userDataPath: string) {}

  private path(accountId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(accountId)) throw new Error('账号标识无效');
    return join(this.userDataPath, 'account-profiles', `${accountId}.json`);
  }

  async get(accountId: string): Promise<AccountFingerprintProfile> {
    const file = this.path(accountId);
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as AccountFingerprintProfile;
      validateProfile(parsed);
      return parsed;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const profile = createProfile(accountId);
      await this.save(profile);
      return profile;
    }
  }

  async save(profile: AccountFingerprintProfile): Promise<AccountFingerprintProfile> {
    const next = { ...structuredClone(profile), updatedAt: new Date().toISOString() };
    validateProfile(next);
    const file = this.path(next.accountId);
    const temporary = `${file}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    return next;
  }
}

