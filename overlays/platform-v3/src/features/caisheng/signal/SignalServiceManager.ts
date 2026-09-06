import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { SignalAccountStore } from './SignalAccountStore';
import { SignalHistoryStore } from './SignalHistoryStore';
import { SignalNativeProcess } from './SignalNativeProcess';
import type { SignalConversation, SignalLinkState, SignalMessage, SignalOutgoingAttachment, SignalQuote, SignalRequestMap, SignalResponseMap, SignalRuntimeEvent, SignalMethod } from './types';

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
    await this.accounts.update(accountId, { status: 'starting', lastError: undefined });
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
      await this.accounts.update(accountId, { status: 'ready', phoneNumber: typeof number === 'string' ? number : undefined, lastError: undefined });
    } catch (error: any) { this.instances.delete(accountId); await this.accounts.update(accountId, { status: 'error', lastError: String(error?.message || error) }); throw error; }
  }

  async beginLink(accountId: string, deviceName: string): Promise<SignalLinkState> {
    await this.start(accountId);
    await this.accounts.update(accountId, { status: 'linking', deviceName: deviceName || '财盛聚合聊天', lastError: undefined });
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
        await this.accounts.update(accountId, { status: 'ready', phoneNumber: typeof number === 'string' ? number : undefined, deviceName: deviceName || '财盛聚合聊天', lastError: undefined });
        this.publish({ type: 'link', link: { accountId, state: 'linked' } });
        await runtime.rpc('sendSyncRequest', { account: number });
      })
      .catch(async error => { const message=String(error.message||error); await this.accounts.update(accountId,{status:'error',lastError:message}); this.publish({ type: 'link', link: { accountId, state: 'failed', error: message } }); });
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

  private recipient(conversationId:string){const value=conversationId.slice(conversationId.indexOf(':')+1);return conversationId.startsWith('group:')?{groupId:value}:{recipient:[value]};}
  private async materialize(accountId:string, attachments:SignalOutgoingAttachment[]=[]){const dir=path.join(this.accounts.dataDir(accountId),'caisheng-outbox');await mkdir(dir,{recursive:true,mode:0o700});const files:string[]=[];let voiceNote=false;for(const item of attachments){const safe=(item.fileName||'attachment').replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(-120);const file=path.join(dir,`${randomUUID()}-${safe}`);await writeFile(file,Buffer.from(item.bytesBase64,'base64'),{mode:0o600});files.push(file);voiceNote ||= !!item.voiceNote;}return{files,voiceNote};}

  async send(accountId: string, conversationId: string, body: string, attachments:SignalOutgoingAttachment[]=[], quote?:SignalQuote, editTimestamp?:number): Promise<SignalMessage> {
    const runtime = this.instances.get(accountId)!;
    const staged=await this.materialize(accountId,attachments);try{const q=quote?{quoteTimestamp:quote.sentAt,quoteAuthor:quote.authorId,quoteMessage:quote.body??'',quoteAttachment:quote.attachments?.map(x=>`${x.contentType||'application/octet-stream'}:${x.fileName||''}`)}:{};
      const result=await runtime.rpc('send',this.params(accountId,{...this.recipient(conversationId),message:body,attachment:staged.files,voiceNote:staged.voiceNote||undefined,...q,editTimestamp}));
      const message:SignalMessage={id:randomUUID(),conversationId,senderId:this.numbers.get(accountId)||'self',body,sentAt:result.timestamp??Date.now(),direction:'outgoing',status:'sent',attachments:attachments.map((x,i)=>({id:path.basename(staged.files[i]),fileName:x.fileName,contentType:x.contentType,size:Buffer.byteLength(x.bytesBase64,'base64'),kind:x.voiceNote?'voice':x.contentType.startsWith('image/')?'image':x.contentType.startsWith('video/')?'video':x.contentType.startsWith('audio/')?'audio':'file'})),quote,editedAt:editTimestamp?Date.now():undefined};
      if(editTimestamp)await this.history(accountId).edit(editTimestamp,message);else await this.history(accountId).append(message);this.publish({type:'message',accountId,message});return message;
    }finally{await Promise.allSettled(staged.files.map(x=>rm(x,{force:true})));}
  }

  async react(accountId:string,conversationId:string,targetAuthor:string,targetSentAt:number,emoji:string,remove=false){await this.instances.get(accountId)!.rpc('sendReaction',this.params(accountId,{...this.recipient(conversationId),targetAuthor,targetTimestamp:targetSentAt,emoji,remove}));}
  async remoteDelete(accountId:string,conversationId:string,targetSentAt:number){await this.instances.get(accountId)!.rpc('remoteDelete',this.params(accountId,{...this.recipient(conversationId),targetTimestamp:targetSentAt}));await this.history(accountId).remove(targetSentAt);}
  async getAttachment(accountId:string,conversationId:string,attachmentId:string,fileName?:string,contentType='application/octet-stream'){
    const target=conversationId.startsWith('group:')?{groupId:conversationId.slice(6)}:{recipient:conversationId.slice(7)};const result=await this.instances.get(accountId)!.rpc('getAttachment',this.params(accountId,{id:attachmentId,...target}));const bytesBase64=result?.data??result?.base64??result;if(typeof bytesBase64!=='string')throw new Error('Signal 附件数据无效');
    const dir=this.history(accountId).attachmentsDir;await mkdir(dir,{recursive:true,mode:0o700});const safe=(fileName||attachmentId).replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(-120),localPath=path.join(dir,`${attachmentId.replace(/[^a-zA-Z0-9_-]/g,'_')}-${safe}`);await writeFile(localPath,Buffer.from(bytesBase64,'base64'),{mode:0o600});return{id:attachmentId,fileName,contentType,size:Buffer.byteLength(bytesBase64,'base64'),localPath,bytesBase64};
  }

  async avatar(accountId: string, conversationId: string) {
    const runtime = this.instances.get(accountId)!; const value = conversationId.slice(conversationId.indexOf(':') + 1);
    const result = await runtime.rpc('getAvatar', this.params(accountId, conversationId.startsWith('group:') ? { groupId: value } : { profile: value }));
    const bytesBase64 = result?.data ?? result?.base64 ?? result;
    return typeof bytesBase64 === 'string' ? { contentType: 'image/jpeg', bytesBase64 } : undefined;
  }

  private async receive(accountId: string, payload: any): Promise<void> {
    const envelope = payload?.envelope; if (!envelope) return;
    const data = envelope.dataMessage ?? envelope.syncMessage?.sentMessage; if (!data || (!data.message && !(data.attachments?.length) && !data.reaction && !data.remoteDelete && !data.editMessage)) return;
    const group = data.groupInfo?.groupId ?? data.groupInfo?.groupIdV2;
    const peer = envelope.sourceNumber ?? envelope.sourceUuid ?? data.destinationNumber ?? data.destinationUuid;
    const message: SignalMessage = { id: randomUUID(), conversationId: group ? groupId(group) : directId(peer), senderId: envelope.sourceUuid ?? envelope.sourceNumber ?? 'self', senderName: envelope.sourceName, body: data.message??'', sentAt: data.timestamp ?? envelope.timestamp ?? Date.now(), receivedAt: Date.now(), direction: envelope.syncMessage ? 'outgoing' : 'incoming', status: envelope.syncMessage ? 'sent' : 'delivered', attachments: (data.attachments ?? []).map((x: any) => ({ id: String(x.id), fileName: x.filename, contentType: x.contentType, size: x.size, kind:x.voiceNote?'voice':x.contentType?.startsWith('image/')?'image':x.contentType?.startsWith('video/')?'video':x.contentType?.startsWith('audio/')?'audio':'file' })), quote:data.quote?{authorId:data.quote.authorNumber??data.quote.authorUuid,sentAt:data.quote.id??data.quote.timestamp,body:data.quote.text,attachments:data.quote.attachments}:undefined };
    await this.history(accountId).append(message); this.publish({ type: 'message', accountId, message });
  }

  async stop(accountId: string) { const item = this.instances.get(accountId); if (item) await item.stop(); this.instances.delete(accountId); this.numbers.delete(accountId); await this.accounts.update(accountId,{status:'stopped',lastError:undefined}); }
  async shutdown() { await Promise.allSettled([...this.instances.values()].map(item => item.stop())); this.instances.clear(); }

  async call<M extends SignalMethod>(method: M, p: SignalRequestMap[M]): Promise<SignalResponseMap[M]> {
    if (method === 'start') { await this.start(p.accountId); return (await this.accounts.list()).find(x => x.id === p.accountId) as SignalResponseMap[M]; }
    if (method === 'stop') { await this.stop(p.accountId); return undefined as SignalResponseMap[M]; }
    if (!this.instances.has(p.accountId)) await this.start(p.accountId);
    if (method === 'beginLink') return this.beginLink(p.accountId, (p as any).deviceName) as Promise<SignalResponseMap[M]>;
    if (method === 'listConversations') return this.listConversations(p.accountId) as Promise<SignalResponseMap[M]>;
    if (method === 'listMessages') return this.history(p.accountId).list((p as any).conversationId, (p as any).before, (p as any).limit).then(items => ({ items })) as Promise<SignalResponseMap[M]>;
    if (method === 'sendMessage') return this.send(p.accountId,(p as any).conversationId,(p as any).body,(p as any).attachments,(p as any).quote) as Promise<SignalResponseMap[M]>;
    if (method === 'sendAttachment') { const a=(p as any).attachment; const bytesBase64=(await readFile(a.path)).toString('base64'); return this.send(p.accountId,(p as any).conversationId,a.caption??'',[{fileName:a.name,contentType:a.type,bytesBase64,voiceNote:a.voiceNote}]) as Promise<SignalResponseMap[M]>; }
    if (method === 'editMessage') return this.send(p.accountId,(p as any).conversationId,(p as any).body,[],undefined,(p as any).targetTimestamp) as Promise<SignalResponseMap[M]>;
    if (method === 'reactMessage') { const target=await this.history(p.accountId).find((p as any).conversationId,(p as any).targetTimestamp); if(!target)throw new Error('找不到要回应的消息'); await this.react(p.accountId,(p as any).conversationId,target.senderId,(p as any).targetTimestamp,(p as any).emoji,(p as any).remove); return undefined as SignalResponseMap[M]; }
    if (method === 'deleteMessage') { await this.remoteDelete(p.accountId,(p as any).conversationId,(p as any).targetTimestamp); return undefined as SignalResponseMap[M]; }
    if (method === 'getAttachment') return this.getAttachment(p.accountId,(p as any).conversationId,(p as any).attachmentId,(p as any).fileName,(p as any).contentType) as Promise<SignalResponseMap[M]>;
    if (method === 'cleanupAttachments') return this.history(p.accountId).cleanup((p as any).olderThan,(p as any).maxBytes) as Promise<SignalResponseMap[M]>;
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
