import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class SignalNativeProcess extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(readonly accountId: string, private readonly runtimeRoot: string, private readonly dataDir: string) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    const windows = process.platform === 'win32';
    const command = windows
      ? path.join(this.runtimeRoot, 'jre', 'bin', 'java.exe')
      : path.join(this.runtimeRoot, 'jre', 'bin', 'java');
    const separator = windows ? ';' : ':';
    const args = [
      '-Djava.awt.headless=true',
      '-cp', `${path.join(this.runtimeRoot, 'signal-cli', 'lib', '*')}${separator}${path.join(this.runtimeRoot, 'signal-cli', 'lib')}`,
      'org.asamk.signal.Main', '--scrub-log', '--data-dir', this.dataDir,
      'jsonRpc', '--receive-mode', 'on-start',
    ];
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, JAVA_HOME: path.join(this.runtimeRoot, 'jre') },
    });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => this.onLine(line));
    child.stderr.on('data', data => this.emit('diagnostic', String(data)));
    child.once('exit', (code, signal) => {
      this.child = undefined;
      this.failAll(new Error(`Signal 服务退出 (${code ?? signal ?? 'unknown'})`));
      this.emit('exit', code);
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    // A malformed request is a cheap readiness probe and must receive an RPC response.
    await this.rpc('listAccounts', {}, 60_000);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    await Promise.race([
      new Promise<void>(resolve => child.once('exit', () => resolve())),
      new Promise<void>(resolve => setTimeout(() => { child.kill(); resolve(); }, 4_000)),
    ]);
  }

  rpc(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
    if (!this.child) return Promise.reject(new Error('Signal 服务尚未启动'));
    const id = `${this.accountId}:${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Signal 请求超时：${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private onLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { this.emit('diagnostic', line); return; }
    if (message.method === 'receive') {
      const payload = message.params?.result ?? message.params;
      this.emit('receive', payload);
      return;
    }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(String(message.id));
    if (message.error) pending.reject(new Error(message.error.message || 'Signal 请求失败'));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
}
