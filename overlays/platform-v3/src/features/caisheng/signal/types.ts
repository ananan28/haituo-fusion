export type SignalAccountStatus =
  | 'stopped'
  | 'starting'
  | 'linking'
  | 'ready'
  | 'error';

export type SignalAccount = {
  id: string;
  label: string;
  status: SignalAccountStatus;
  phoneNumber?: string;
  deviceName?: string;
  lastError?: string;
};

export type SignalConversation = {
  id: string;
  title: string;
  avatarVersion?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  isGroup: boolean;
};

export type SignalMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  body: string;
  sentAt: number;
  receivedAt?: number;
  direction: 'incoming' | 'outgoing';
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  attachments?: Array<{
    id: string;
    fileName?: string;
    contentType?: string;
    size?: number;
  }>;
};

export type SignalLinkState = {
  accountId: string;
  state: 'waiting' | 'linked' | 'expired' | 'failed';
  /** Signal device-link URI. The renderer turns this into a QR image. */
  uri?: string;
  expiresAt?: number;
  error?: string;
};

export type SignalRuntimeEvent =
  | { type: 'account'; account: SignalAccount }
  | { type: 'link'; link: SignalLinkState }
  | { type: 'conversation'; accountId: string; conversation: SignalConversation }
  | { type: 'message'; accountId: string; message: SignalMessage }
  | { type: 'avatar'; accountId: string; conversationId: string; version: string };

export type SignalRequestMap = {
  start: { accountId: string };
  stop: { accountId: string };
  beginLink: { accountId: string; deviceName: string };
  listConversations: { accountId: string; cursor?: string; limit?: number };
  listMessages: {
    accountId: string;
    conversationId: string;
    before?: number;
    limit?: number;
  };
  sendMessage: { accountId: string; conversationId: string; body: string };
  markRead: { accountId: string; conversationId: string; through: number };
  getAvatar: { accountId: string; conversationId: string };
};

export type SignalResponseMap = {
  start: SignalAccount;
  stop: undefined;
  beginLink: SignalLinkState;
  listConversations: { items: SignalConversation[]; cursor?: string };
  listMessages: { items: SignalMessage[]; cursor?: string };
  sendMessage: SignalMessage;
  markRead: undefined;
  getAvatar: { contentType: string; bytesBase64: string; version?: string } | undefined;
};

export type SignalMethod = keyof SignalRequestMap;

