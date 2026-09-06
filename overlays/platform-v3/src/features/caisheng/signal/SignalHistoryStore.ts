import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SignalMessage } from './types';

/** Durable UI history. signal-cli is a transport and does not expose an old-message query. */
export class SignalHistoryStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'caisheng-history.jsonl');
  }

  async append(message: SignalMessage): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${JSON.stringify(message)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async list(conversationId: string, before = Number.MAX_SAFE_INTEGER, limit = 50): Promise<SignalMessage[]> {
    let content: string;
    try { content = await readFile(this.file, 'utf8'); } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as SignalMessage)
      .filter(item => item.conversationId === conversationId && item.sentAt < before)
      .sort((a, b) => b.sentAt - a.sentAt).slice(0, Math.min(Math.max(limit, 1), 200)).reverse();
  }

  async latestByConversation(): Promise<Map<string, SignalMessage>> {
    let content = '';
    try { content = await readFile(this.file, 'utf8'); } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const latest = new Map<string, SignalMessage>();
    for (const line of content.split('\n')) {
      if (!line) continue;
      const item = JSON.parse(line) as SignalMessage;
      if ((latest.get(item.conversationId)?.sentAt ?? 0) < item.sentAt) latest.set(item.conversationId, item);
    }
    return latest;
  }
}
