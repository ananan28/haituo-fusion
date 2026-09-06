import { ipcRenderer } from 'electron';
import qrcode from 'qrcode-generator';
import { signalClient } from '../../features/caisheng/signal/rendererClient';
import type { SignalRuntimeEvent } from '../../features/caisheng/signal/types';
import type { SignalAccountSummary, SignalConversation, SignalMessage, SignalServiceAdapter, SignalServiceEvent } from './types';

const summaries = new Map<string, SignalAccountSummary>();
function qr(uri: string): string { const code = qrcode(0, 'M'); code.addData(uri); code.make(); return code.createDataURL(6, 4); }
async function ensure(accountId: string): Promise<void> { await ipcRenderer.invoke('caisheng:signal:accounts:ensure', accountId, 'Signal'); }
function summary(accountId: string): SignalAccountSummary { return summaries.get(accountId) ?? { id: accountId, label: 'Signal', connectionState: 'unlinked' }; }

class RendererClientSignalAdapter implements SignalServiceAdapter {
  async getAccount(accountId: string): Promise<SignalAccountSummary> {
    await ensure(accountId);
    const account = (await signalClient.listAccounts()).find(item => item.id === accountId);
    const next: SignalAccountSummary = { id: accountId, label: account?.label ?? 'Signal', connectionState: account?.phoneNumber ? 'ready' : 'unlinked' };
    summaries.set(accountId, next); return next;
  }
  async beginLink(accountId: string): Promise<void> {
    await ensure(accountId);
    const link = await signalClient.call('beginLink', { accountId, deviceName: '财盛聚合聊天' });
    summaries.set(accountId, { ...summary(accountId), connectionState: 'linking', qrCodeDataUrl: link.uri ? qr(link.uri) : undefined });
  }
  async refreshQrCode(accountId: string): Promise<SignalAccountSummary> { await this.beginLink(accountId); return summary(accountId); }
  async listConversations(accountId: string): Promise<SignalConversation[]> {
    const result = await signalClient.call('listConversations', { accountId, limit: 100 });
    return Promise.all(result.items.map(async item => {
      const avatar = await signalClient.call('getAvatar', { accountId, conversationId: item.id }).catch(() => undefined);
      return { id: item.id, title: item.title, avatarUrl: avatar ? `data:${avatar.contentType};base64,${avatar.bytesBase64}` : undefined, lastMessage: item.lastMessage ?? '', lastMessageAt: item.lastMessageAt ?? 0, unreadCount: item.unreadCount };
    }));
  }
  async listMessages(accountId: string, conversationId: string, before?: number): Promise<SignalMessage[]> {
    return (await signalClient.call('listMessages', { accountId, conversationId, before, limit: 100 })).items;
  }
  sendMessage(accountId: string, conversationId: string, body: string): Promise<SignalMessage> {
    return signalClient.call('sendMessage', { accountId, conversationId, body });
  }
  markRead(accountId: string, conversationId: string): Promise<void> {
    return signalClient.call('markRead', { accountId, conversationId, through: Date.now() });
  }
  subscribe(accountId: string, listener: (event: SignalServiceEvent) => void): () => void {
    return signalClient.onEvent((event: SignalRuntimeEvent) => {
      if (event.type === 'link' && event.link.accountId === accountId) {
        const next: SignalAccountSummary = { ...summary(accountId), connectionState: event.link.state === 'linked' ? 'ready' : event.link.state === 'waiting' ? 'linking' : 'offline', qrCodeDataUrl: event.link.uri ? qr(event.link.uri) : summary(accountId).qrCodeDataUrl };
        summaries.set(accountId, next); listener({ type: 'account', account: next });
      } else if (event.type === 'conversation' && event.accountId === accountId) {
        listener({ type: 'conversation', conversation: { ...event.conversation, lastMessage: event.conversation.lastMessage ?? '', lastMessageAt: event.conversation.lastMessageAt ?? 0 } });
      } else if (event.type === 'message' && event.accountId === accountId) listener({ type: 'message', message: event.message });
    });
  }
}
let adapter: SignalServiceAdapter | undefined;
export function getRendererSignalAdapter(): SignalServiceAdapter { adapter ??= new RendererClientSignalAdapter(); return adapter; }
export async function translateWithRendererClient(text: string): Promise<string> {
  const result = await ipcRenderer.invoke('translate', { text, translateToLanguage: 'zh-CN', translatorEngine: 'Google' });
  if (result?.error) throw new Error(result.text || '翻译失败');
  return result?.text ?? '';
}
