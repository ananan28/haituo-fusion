import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import type {
  SignalMethod,
  SignalRequestMap,
  SignalResponseMap,
  SignalRuntimeEvent,
} from './types';

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/**
 * Owns one headless native Signal runtime. It intentionally has no Electron
 * BrowserWindow/WebContents dependency. UI is always rendered by Caisheng.
 */
export class SignalNativeProcess extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(
    readonly accountId: string,
    private readonly executable: string,
    private readonly dataDir: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.executable, ['--stdio-json-rpc', '--data-dir', this.dataDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { PATH: process.env.PATH },
    });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => this.onLine(line));
    child.stderr.on('data', data => this.emit('diagnostic', String(data)));
    child.once('error', error => this.failAll(error));
    child.once('exit', (code, signal) => {
      this.child = undefined;
      this.failAll(new Error(`Signal 后台服务已退出 (${code ?? signal ?? 'unknown'})`));
      this.emit('exit', code);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try { await this.call('stop', { accountId: this.accountId }, 5_000); } catch { /* force below */ }
    if (this.child) child.kill();
  }

  async call<M extends SignalMethod>(
    method: M,
    params: SignalRequestMap[M],
    timeoutMs = 30_000,
  ): Promise<SignalResponseMap[M]> {
    if (!this.child) throw new Error('Signal 后台服务尚未启动');
    const id = ++this.sequence;
    return new Promise<SignalResponseMap[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Signal 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private onLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { this.emit('diagnostic', line); return; }
    if (message.event) {
      this.emit('event', message.event as SignalRuntimeEvent);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'Signal 后台请求失败'));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
