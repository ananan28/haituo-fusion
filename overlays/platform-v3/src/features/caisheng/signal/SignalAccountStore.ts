import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SignalAccount } from './types';

const ACCOUNT_ID = /^[a-zA-Z0-9_-]{8,80}$/;

export class SignalAccountStore {
  private readonly accountsFile: string;

  constructor(private readonly root: string) {
    this.accountsFile = path.join(root, 'accounts.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async list(): Promise<SignalAccount[]> {
    await this.initialize();
    try {
      const parsed = JSON.parse(await readFile(this.accountsFile, 'utf8')) as SignalAccount[];
      return parsed.map(account => ({ ...account, status: 'stopped', lastError: undefined }));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async create(label: string): Promise<SignalAccount> {
    const accounts = await this.list();
    const account: SignalAccount = {
      id: randomUUID(),
      label: label.trim() || `Signal ${accounts.length + 1}`,
      status: 'stopped',
    };
    accounts.push(account);
    await this.write(accounts);
    await mkdir(this.dataDir(account.id), { recursive: true, mode: 0o700 });
    return account;
  }

  async remove(accountId: string): Promise<void> {
    this.assertId(accountId);
    // Account data is deliberately not deleted here. Destructive deletion must be
    // a separate, confirmed UI action so an accidental click cannot erase keys.
    await this.write((await this.list()).filter(item => item.id !== accountId));
  }

  dataDir(accountId: string): string {
    this.assertId(accountId);
    return path.join(this.root, 'instances', accountId);
  }

  private assertId(accountId: string): void {
    if (!ACCOUNT_ID.test(accountId)) throw new Error('Signal 账号编号无效');
  }

  private async write(accounts: SignalAccount[]): Promise<void> {
    await this.initialize();
    const temp = `${this.accountsFile}.tmp`;
    await writeFile(temp, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(temp, this.accountsFile);
  }
}
