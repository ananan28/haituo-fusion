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

export interface SignalAttachment {
  id: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  url?: string;
  bytesBase64?: string;
  voiceNote?: boolean;
}

export interface SignalQuote {
  messageId?: string;
  sentAt: number;
  author?: string;
  body?: string;
}

export interface SignalReaction {
  emoji: string;
  author?: string;
  sentAt?: number;
}

export interface SignalMessage {
  id: string;
  conversationId: string;
  body: string;
  sentAt: number;
  direction: 'incoming' | 'outgoing';
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  translatedBody?: string;
  attachments?: SignalAttachment[];
  quote?: SignalQuote;
  reactions?: SignalReaction[];
  deleted?: boolean;
  editedAt?: number;
}

export interface SignalAttachmentDraft {
  fileName: string;
  contentType: string;
  bytesBase64: string;
  caption?: string;
  voiceNote?: boolean;
}

/**
 * 财盛内嵌界面只依赖本接口，不依赖 Signal Desktop 外壳。
 * 后台按 accountId 绑定独立 signal-cli 进程。
 */
export interface SignalServiceAdapter {
  getAccount(accountId: string): Promise<SignalAccountSummary>;
  beginLink(accountId: string): Promise<void>;
  refreshQrCode(accountId: string): Promise<SignalAccountSummary>;
  listConversations(accountId: string): Promise<SignalConversation[]>;
  listMessages(accountId: string, conversationId: string, before?: number): Promise<SignalMessage[]>;
  sendMessage(accountId: string, conversationId: string, body: string, quote?: SignalQuote): Promise<SignalMessage>;
  sendAttachment(accountId: string, conversationId: string, attachment: SignalAttachmentDraft, quote?: SignalQuote): Promise<SignalMessage>;
  reactMessage(accountId: string, conversationId: string, targetSentAt: number, emoji: string, remove?: boolean): Promise<void>;
  deleteMessage(accountId: string, conversationId: string, targetSentAt: number): Promise<void>;
  editMessage(accountId: string, conversationId: string, targetSentAt: number, body: string): Promise<SignalMessage>;
  markRead(accountId: string, conversationId: string): Promise<void>;
  subscribe(accountId: string, listener: (event: SignalServiceEvent) => void): () => void;
}

export type SignalServiceEvent =
  | { type: 'account'; account: SignalAccountSummary }
  | { type: 'conversation'; conversation: SignalConversation }
  | { type: 'message'; message: SignalMessage };
