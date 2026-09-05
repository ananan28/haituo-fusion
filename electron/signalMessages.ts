import type { StoredSignalMessage } from './signalStore';
import type { SignalConversation as Conversation } from './signalTypes';
function firstText(...values: any[]): string {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function normalizeAccount(item: any): string {
  if (typeof item === 'string') return item.trim();
  return firstText(item?.number, item?.account, item?.username, item?.uuid, item?.aci);
}

export function normalizeContacts(raw: any): Conversation[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((c: any) => {
    const recipient = firstText(c?.number, c?.uuid, c?.aci, c?.username);
    if (!recipient) return null;
    const profileName = [c?.profile?.givenName, c?.profile?.familyName].filter(Boolean).join(' ').trim();
    const contactName = [c?.givenName, c?.familyName].filter(Boolean).join(' ').trim();
    const title = firstText(c?.name, contactName, profileName, c?.nickName, c?.username, recipient);
    const subtitle = c?.username ? `@${c.username} · ${recipient}` : recipient;
    return { id: `contact:${recipient}`, kind: 'contact' as const, title, subtitle, recipient };
  }).filter(Boolean) as Conversation[];
}

export function normalizeGroups(raw: any): Conversation[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((g: any) => g?.id && g?.isMember !== false).map((g: any) => ({
    id: `group:${String(g.id)}`,
    kind: 'group' as const,
    title: firstText(g?.name, 'Signal 群组'),
    subtitle: `${Array.isArray(g?.members) ? g.members.length : 0} 位成员`,
    groupId: String(g.id)
  }));
}

function attachmentNames(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((x: any) => firstText(x?.filename, x?.fileName, x?.path, x?.id)).filter(Boolean);
}

export function parseSignalEvent(payload: any): StoredSignalMessage | null {
  let event = payload;
  if (typeof event === 'string') {
    try { event = JSON.parse(event); } catch { return null; }
  }
  const root = event?.params?.result || event?.params || event;
  const env = root?.envelope;
  if (!env) return null;
  const incoming = env?.dataMessage;
  const outgoing = env?.syncMessage?.sentMessage;

  if (incoming) {
    const attachments = attachmentNames(incoming.attachments);
    const reaction = incoming?.reaction?.emoji ? `回应 ${incoming.reaction.emoji}` : '';
    const body = firstText(incoming.message, reaction, attachments.length ? `[附件 ${attachments.length}]` : '');
    if (!body) return null;
    const groupId = firstText(incoming?.groupInfo?.groupId);
    const peer = groupId || firstText(env.sourceNumber, env.source, env.sourceUuid, env.sourceName, 'Signal');
    const conversationId = groupId ? `group:${groupId}` : `contact:${peer}`;
    const at = Number(incoming.timestamp || env.timestamp || Date.now());
    return {
      id: `in:${conversationId}:${env.sourceUuid || env.sourceNumber || env.source}:${at}`,
      conversationId,
      conversationKind: groupId ? 'group' : 'contact',
      peer,
      sender: firstText(env.sourceName, env.sourceNumber, env.source, env.sourceUuid, peer),
      direction: 'in',
      text: body,
      attachments,
      at
    };
  }

  if (outgoing) {
    const attachments = attachmentNames(outgoing.attachments);
    const body = firstText(outgoing.message, attachments.length ? `[附件 ${attachments.length}]` : '');
    if (!body) return null;
    const groupId = firstText(outgoing?.groupInfo?.groupId);
    const peer = groupId || firstText(outgoing.destinationNumber, outgoing.destination, outgoing.destinationUuid, outgoing.destinationAci, 'Signal');
    const conversationId = groupId ? `group:${groupId}` : `contact:${peer}`;
    const at = Number(outgoing.timestamp || env.timestamp || Date.now());
    return {
      id: `out:${conversationId}:${at}`,
      conversationId,
      conversationKind: groupId ? 'group' : 'contact',
      peer,
      sender: '我',
      direction: 'out',
      text: body,
      attachments,
      at
    };
  }
  return null;
}

