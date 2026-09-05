export type SignalPhase = 'idle' | 'starting' | 'pairing' | 'ready' | 'retrying' | 'error' | 'stopped';
export type SignalStatus = { sessionId: string; phase: SignalPhase; account?: string; qrUri?: string; message?: string; code?: string };
export type SignalProfile = { sessionId: string; port: number; configDir: string; account: string; legacyAccount?: string };
export type SignalConversation = { id: string; kind: 'contact' | 'group'; title: string; subtitle: string; recipient?: string; groupId?: string; lastText?: string; lastAt?: number; unread?: number };
