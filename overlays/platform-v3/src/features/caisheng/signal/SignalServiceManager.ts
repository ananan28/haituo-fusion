import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import path from 'node:path';
import { SignalAccountStore } from './SignalAccountStore';
import { SignalHistoryStore } from './SignalHistoryStore';
import { SignalNativeProcess } from './SignalNativeProcess';
import type { SignalConversation, SignalLinkState, SignalMessage, SignalRequestMap, SignalResponseMap, SignalRuntimeEvent, SignalMethod } from './types';

const directId = (value: string) => `direct:${value}`;
const groupId = (value: string) => `group:${value}`;

export class SignalServiceManager {
  readonly accounts: SignalAccountStore;
  private readonly instances = new Map<string, SignalNativeProcess>();
  private readonly numbers = new Map<string, string>();
  private readonly histories = new Map<string, SignalHistoryStore>();

  constructor(root = path.join(app.getPath('userData'), 'services', 'signal'), private readonly runtimeRoot = path.join(process.resourcesPath, 'signal-runtime'), private readonly publish: (event: SignalRuntimeEvent) => void = () => undefined) {
    this.accounts = new SignalAccountStore(root);
  }

  private history(id: string) { let value = this.histories.get(id); if (!value) { value = new SignalHistoryStore(this.accounts.dataDir(id)); this.histories.set(id, value); } return value; }

  async start(accountId: string): Promise<void> {
    if (this.instances.has(accountId)) return;
    if (!(await this.accounts.list()).some(item => item.id === accountId)) throw new Error('Signal 账号不存在');
    const runtime = new SignalNativeProcess(accountId, this.runtimeRoot, this.accounts.dataDir(accountId));
    runtime.on('receive', payload => { void this.receive(accountId, payload); });
    runtime.on('exit', () => this.instances.delete(accountId));
    this.instances.set(accountId, runtime);
    try {
      await runtime.start();
      const accounts = await runtime.rpc('listAccounts');
      const number = accounts?.[0]?.number ?? accounts?.[0]?.account ?? accounts?.[0];
      if (typeof number === 'string') this.numbers.set(accountId, number);
    } catch (error) { this.instances.delete(accountId); throw error; }
  }

  async beginLink(accountId: string, deviceName: string): Promise<SignalLinkState> {
    await this.start(accountId);
    const runtime = this.instances.get(accountId)!;
    const started = await runtime.rpc('startLink', {}, 30_000);
    const uri = started?.deviceLinkUri;
    if (!uri) throw new Error('Signal 未返回配对二维码');
    const link: SignalLinkState = { accountId, state: 'waiting', uri, expiresAt: Date.now() + 120_000 };
    this.publish({ type: 'link', link });
    void runtime.rpc('finishLink', { deviceLinkUri: uri, deviceName: deviceName || '财盛聚合聊天' }, 180_000)
      .then(async () => {
        const accounts = await runtime.rpc('listAccounts');
        const number = accounts?.[0]?.number ?? accounts?.[0]?.account ?? accounts?.[0];
        if (typeof number === 'string') this.numbers.set(accountId, number);
        this.publish({ type: 'link', link: { accountId, state: 'linked' } });
        await runtime.rpc('sendSyncRequest', { account: number });
      })
      .catch(error => this.publish({ type: 'link', link: { accountId, state: 'failed', error: String(error.message || error) } }));
    return link;
  }

  private params(accountId: string, params: Record<string, unknown> = {}) {
    const account = this.numbers.get(accountId);
    return account ? { ...params, account } : params;
  }

  async listConversations(accountId: string): Promise<{ items: SignalConversation[] }> {
    const runtime = this.instances.get(accountId)!;
    const [contacts, groups, latest] = await Promise.all([
      runtime.rpc('listContacts', this.params(accountId, { allRecipients: true })),
      runtime.rpc('listGroups', this.params(accountId)), this.history(accountId).latestByConversation(),
    ]);
    const items: SignalConversation[] = [];
    for (const contact of contacts ?? []) {
      const id = directId(contact.number ?? contact.uuid ?? contact.recipient);
      const message = latest.get(id);
      items.push({ id, title: contact.name || contact.profileName || contact.number || contact.uuid, unreadCount: 0, isGroup: false, lastMessage: message?.body, lastMessageAt: message?.sentAt });
    }
    for (const group of groups ?? []) {
      const id = groupId(group.id); const message = latest.get(id);
      items.push({ id, title: group.name || 'Signal 群聊', unreadCount: 0, isGroup: true, lastMessage: message?.body, lastMessageAt: message?.sentAt });
    }
    return { items: items.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)) };
  }

  async send(accountId: string, conversationId: string, body: string): Promise<SignalMessage> {
    const runtime = this.instances.get(accountId)!;
    const isGroup = conversationId.startsWith('group:'); const recipient = conversationId.slice(conversationId.indexOf(':') + 1);
    const result = await runtime.rpc('send', this.params(accountId, isGroup ? { groupId: recipient, message: body } : { recipient: [recipient], message: body }));
    const message: SignalMessage = { id: randomUUID(), conversationId, senderId: this.numbers.get(accountId) || 'self', body, sentAt: result.timestamp ?? Date.now(), direction: 'outgoing', status: 'sent' };
    await this.history(accountId).append(message); this.publish({ type: 'message', accountId, message }); return message;
  }

  async avatar(accountId: string, conversationId: string) {
    const runtime = this.instances.get(accountId)!; const value = conversationId.slice(conversationId.indexOf(':') + 1);
    const result = await runtime.rpc('getAvatar', this.params(accountId, conversationId.startsWith('group:') ? { groupId: value } : { profile: value }));
    const bytesBase64 = result?.data ?? result?.base64 ?? result;
    return typeof bytesBase64 === 'string' ? { contentType: 'image/jpeg', bytesBase64 } : undefined;
  }

  private async receive(accountId: string, payload: any): Promise<void> {
    const envelope = payload?.envelope; if (!envelope) return;
    const data = envelope.dataMessage ?? envelope.syncMessage?.sentMessage; if (!data?.message) return;
    const group = data.groupInfo?.groupId ?? data.groupInfo?.groupIdV2;
    const peer = envelope.sourceNumber ?? envelope.sourceUuid ?? data.destinationNumber ?? data.destinationUuid;
    const message: SignalMessage = { id: randomUUID(), conversationId: group ? groupId(group) : directId(peer), senderId: envelope.sourceUuid ?? envelope.sourceNumber ?? 'self', senderName: envelope.sourceName, body: data.message, sentAt: data.timestamp ?? envelope.timestamp ?? Date.now(), receivedAt: Date.now(), direction: envelope.syncMessage ? 'outgoing' : 'incoming', status: envelope.syncMessage ? 'sent' : 'delivered', attachments: (data.attachments ?? []).map((x: any) => ({ id: String(x.id), fileName: x.filename, contentType: x.contentType, size: x.size })) };
    await this.history(accountId).append(message); this.publish({ type: 'message', accountId, message });
  }

  async stop(accountId: string) { const item = this.instances.get(accountId); if (item) await item.stop(); this.instances.delete(accountId); }
  async shutdown() { await Promise.allSettled([...this.instances.values()].map(item => item.stop())); this.instances.clear(); }

  async call<M extends SignalMethod>(method: M, p: SignalRequestMap[M]): Promise<SignalResponseMap[M]> {
    if (method === 'start') { await this.start(p.accountId); return (await this.accounts.list()).find(x => x.id === p.accountId) as SignalResponseMap[M]; }
    if (method === 'stop') { await this.stop(p.accountId); return undefined as SignalResponseMap[M]; }
    if (!this.instances.has(p.accountId)) await this.start(p.accountId);
    if (method === 'beginLink') return this.beginLink(p.accountId, (p as any).deviceName) as Promise<SignalResponseMap[M]>;
    if (method === 'listConversations') return this.listConversations(p.accountId) as Promise<SignalResponseMap[M]>;
    if (method === 'listMessages') return this.history(p.accountId).list((p as any).conversationId, (p as any).before, (p as any).limit).then(items => ({ items })) as Promise<SignalResponseMap[M]>;
    if (method === 'sendMessage') return this.send(p.accountId, (p as any).conversationId, (p as any).body) as Promise<SignalResponseMap[M]>;
    if (method === 'getAvatar') return this.avatar(p.accountId, (p as any).conversationId) as Promise<SignalResponseMap[M]>;
    if (method === 'markRead') {
      const conversationId = (p as any).conversationId as string;
      if (conversationId.startsWith('direct:')) {
        const recipient = conversationId.slice('direct:'.length);
        await this.instances.get(p.accountId)!.rpc('sendReceipt', this.params(p.accountId, {
          recipient: [recipient], targetTimestamp: [(p as any).through], type: 'read',
        }));
      }
      return undefined as SignalResponseMap[M];
    }
    throw new Error('不支持的 Signal 操作');
  }
}
