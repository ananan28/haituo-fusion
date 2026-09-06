import { app } from 'electron';
import path from 'node:path';
import { SignalAccountStore } from './SignalAccountStore';
import { SignalNativeProcess } from './SignalNativeProcess';
import type { SignalMethod, SignalRequestMap, SignalResponseMap, SignalRuntimeEvent } from './types';

export class SignalServiceManager {
  readonly accounts: SignalAccountStore;
  private readonly instances = new Map<string, SignalNativeProcess>();

  constructor(
    root = path.join(app.getPath('userData'), 'services', 'signal'),
    private readonly executable = path.join(process.resourcesPath, 'signal-runtime', process.platform === 'win32' ? 'caisheng-signal-runtime.exe' : 'caisheng-signal-runtime'),
    private readonly publish: (event: SignalRuntimeEvent) => void = () => undefined,
  ) {
    this.accounts = new SignalAccountStore(root);
  }

  async start(accountId: string): Promise<void> {
    if (this.instances.has(accountId)) return;
    const known = (await this.accounts.list()).some(account => account.id === accountId);
    if (!known) throw new Error('Signal 账号不存在');
    const runtime = new SignalNativeProcess(accountId, this.executable, this.accounts.dataDir(accountId));
    runtime.on('event', event => this.publish(event));
    runtime.on('exit', () => this.instances.delete(accountId));
    this.instances.set(accountId, runtime);
    try { await runtime.start(); } catch (error) { this.instances.delete(accountId); throw error; }
  }

  async stop(accountId: string): Promise<void> {
    const runtime = this.instances.get(accountId);
    if (!runtime) return;
    await runtime.stop();
    this.instances.delete(accountId);
  }

  async call<M extends SignalMethod>(method: M, params: SignalRequestMap[M]): Promise<SignalResponseMap[M]> {
    if (method === 'stop') {
      await this.stop(params.accountId);
      return undefined as SignalResponseMap[M];
    }
    if (method === 'start') {
      await this.start(params.accountId);
    }
    const runtime = this.instances.get(params.accountId);
    if (!runtime) throw new Error('请先启动该 Signal 账号');
    return runtime.call(method, params);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.instances.values()].map(instance => instance.stop()));
    this.instances.clear();
  }
}
