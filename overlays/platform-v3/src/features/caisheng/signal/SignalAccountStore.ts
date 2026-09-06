import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SignalAccount } from './types';

const ACCOUNT_ID = /^[a-zA-Z0-9_-]{8,80}$/;

export class SignalAccountStore {
  private readonly accountsFile: string;
  private mutation = Promise.resolve();

  constructor(private readonly root: string) { this.accountsFile = path.join(root, 'accounts.json'); }

  async initialize(): Promise<void> { await mkdir(this.root, { recursive: true, mode: 0o700 }); }

  async list(): Promise<SignalAccount[]> {
    await this.initialize();
    try { return JSON.parse(await readFile(this.accountsFile, 'utf8')) as SignalAccount[]; }
    catch (error: any) { if (error?.code === 'ENOENT') return []; throw error; }
  }

  async create(label: string): Promise<SignalAccount> {
    return this.mutate(async accounts => {
      const account: SignalAccount = { id: randomUUID(), label: label.trim() || `Signal ${accounts.length + 1}`, status: 'stopped' };
      accounts.push(account); await mkdir(this.dataDir(account.id), { recursive: true, mode: 0o700 }); return account;
    });
  }

  async ensure(accountId: string, label = 'Signal'): Promise<SignalAccount> {
    this.assertId(accountId);
    return this.mutate(async accounts => {
      const existing = accounts.find(account => account.id === accountId);
      if (existing) return existing;
      const account: SignalAccount = { id: accountId, label, status: 'stopped' };
      accounts.push(account); await mkdir(this.dataDir(accountId), { recursive: true, mode: 0o700 }); return account;
    });
  }

  async update(accountId: string, patch: Partial<Omit<SignalAccount, 'id'>>): Promise<SignalAccount> {
    this.assertId(accountId);
    return this.mutate(async accounts => {
      const index = accounts.findIndex(account => account.id === accountId);
      if (index < 0) throw new Error('Signal 账号不存在');
      accounts[index] = { ...accounts[index], ...patch, id: accountId }; return accounts[index];
    });
  }

  async remove(accountId: string): Promise<void> {
    this.assertId(accountId);
    await this.mutate(async accounts => { const index = accounts.findIndex(x => x.id === accountId); if (index >= 0) accounts.splice(index, 1); });
  }

  dataDir(accountId: string): string { this.assertId(accountId); return path.join(this.root, 'instances', accountId); }
  private assertId(accountId: string): void { if (!ACCOUNT_ID.test(accountId)) throw new Error('Signal 账号编号无效'); }

  private mutate<T>(operation: (accounts: SignalAccount[]) => Promise<T>): Promise<T> {
    const run = this.mutation.then(async () => { const accounts = await this.list(); const result = await operation(accounts); await this.write(accounts); return result; });
    this.mutation = run.then(() => undefined, () => undefined); return run;
  }

  private async write(accounts: SignalAccount[]): Promise<void> {
    await this.initialize();
    const temp = `${this.accountsFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.accountsFile);
  }
}
