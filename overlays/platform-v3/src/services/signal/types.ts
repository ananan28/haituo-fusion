export type SignalConnectionState = 'unlinked' | 'linking' | 'ready' | 'offline';

export interface SignalAccountSummary {
  id: string;
  label: string;
  connectionState: SignalConnectionState;
  qrCodeDataUrl?: string;
}

export interface SignalConversation {
  id: string;
  title: string;
  avatarUrl?: string;
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
}

export interface SignalMessage {
  id: string;
  conversationId: string;
  body: string;
  sentAt: number;
  direction: 'incoming' | 'outgoing';
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  translatedBody?: string;
}

/**
 * UI 只依赖这层接口，不依赖 Signal Desktop 的窗口、Redux 或组件。
 * 后台可由 signal-cli/libsignal 适配器实现，并按 accountId 绑定独立进程。
 */
export interface SignalServiceAdapter {
  getAccount(accountId: string): Promise<SignalAccountSummary>;
  beginLink(accountId: string): Promise<void>;
  refreshQrCode(accountId: string): Promise<SignalAccountSummary>;
  listConversations(accountId: string): Promise<SignalConversation[]>;
  listMessages(
    accountId: string,
    conversationId: string,
    before?: number,
  ): Promise<SignalMessage[]>;
  sendMessage(
    accountId: string,
    conversationId: string,
    body: string,
  ): Promise<SignalMessage>;
  markRead(accountId: string, conversationId: string): Promise<void>;
  subscribe(
    accountId: string,
    listener: (event: SignalServiceEvent) => void,
  ): () => void;
}

export type SignalServiceEvent =
  | { type: 'account'; account: SignalAccountSummary }
  | { type: 'conversation'; conversation: SignalConversation }
  | { type: 'message'; message: SignalMessage };
