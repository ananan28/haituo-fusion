// Sandboxed preload for our local chat document, not an injection into official Signal Desktop.
import { ipcRenderer } from 'electron';
type Message = { id: string; direction: 'in' | 'out'; text: string; originalText?: string; translatedText?: string; sender: string; at: number };
let conversationId = ''; let bilingual = true;
const pending = new Set<string>(); const attempted = new Set<string>();
function insertTranslation(bubble: HTMLElement, value: string) {
  let node = bubble.querySelector<HTMLElement>('.translation');
  if (!node) { node = document.createElement('div'); node.className = 'translation'; bubble.append(node); }
  node.textContent = value; node.hidden = !bilingual || !value;
}
async function translate(bubble: HTMLElement) {
  const id = bubble.dataset.messageId; if (!id || pending.has(id) || attempted.has(id) || bubble.dataset.direction !== 'in' || bubble.dataset.translated === 'yes') return;
  const currentConversation = conversationId;
  pending.add(id); attempted.add(id);
  try {
    // Send only identifiers. The main process obtains trusted original text from its own store.
    const out = await ipcRenderer.invoke('signal:surface-translate', currentConversation, id);
    if (bubble.isConnected && conversationId === currentConversation && out.translatedText) {
      insertTranslation(bubble, out.translatedText); bubble.dataset.translated = 'yes';
    }
  } catch {
    if (bubble.isConnected && conversationId === currentConversation && !bubble.querySelector('.retry')) {
      const retry = document.createElement('button'); retry.className = 'retry'; retry.textContent = '重新翻译';
      retry.onclick = () => { retry.remove(); attempted.delete(id); void translate(bubble); }; bubble.append(retry);
    }
  } finally { pending.delete(id); }
}
window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('messages')!;
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches('[data-message-id][data-observe="yes"]')) void translate(node);
      node.querySelectorAll<HTMLElement>('[data-message-id][data-observe="yes"]').forEach(bubble => void translate(bubble));
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  const receive = (_event: unknown, data: { conversationId: string; messages: Message[]; bilingual: boolean; color: string; fontSize: number; autoHistory: boolean }) => {
    const changed = data.conversationId !== conversationId;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    if (changed) { conversationId = data.conversationId; container.replaceChildren(); attempted.clear(); pending.clear(); }
    bilingual = data.bilingual;
    document.documentElement.style.setProperty('--translation-color', data.color);
    document.documentElement.style.setProperty('--translation-size', `${data.fontSize}px`);
    const historyCandidates = new Set(data.autoHistory ? data.messages.filter(m => m.direction === 'in' && !m.translatedText).slice(-6).map(m => m.id) : []);
    const nodes = new Map([...container.querySelectorAll<HTMLElement>('[data-message-id]')].map(n => [n.dataset.messageId, n]));
    const ids = new Set(data.messages.map(m => m.id));
    for (const [id, node] of nodes) if (id && !ids.has(id)) node.remove();
    for (const msg of data.messages) {
      let bubble = nodes.get(msg.id);
      if (!bubble) {
        bubble = document.createElement('article'); bubble.className = `bubble ${msg.direction}`;
        bubble.dataset.messageId = msg.id; bubble.dataset.direction = msg.direction;
        bubble.dataset.observe = !changed || historyCandidates.has(msg.id) ? 'yes' : 'no';
        const sender = document.createElement('small'); sender.className = 'sender'; sender.textContent = msg.direction === 'in' ? msg.sender : '我';
        const original = document.createElement('div'); original.className = 'original';
        const body = document.createElement('div'); body.className = 'body';
        const time = document.createElement('small'); time.className = 'time'; time.textContent = new Date(msg.at).toLocaleTimeString();
        bubble.append(sender, original, body, time);
        bubble.ondblclick = () => { void ipcRenderer.invoke('signal:surface-copy', conversationId, msg.id).catch(() => {}); };
        container.append(bubble);
      }
      bubble.querySelector('.body')!.textContent = msg.text;
      const original = bubble.querySelector<HTMLElement>('.original')!; original.textContent = msg.originalText && msg.originalText !== msg.text ? msg.originalText : ''; original.hidden = !bilingual || !original.textContent;
      if (msg.translatedText) { bubble.dataset.translated = 'yes'; bubble.querySelector('.retry')?.remove(); }
      insertTranslation(bubble, msg.translatedText && msg.translatedText !== msg.text ? msg.translatedText : '');
    }
    document.getElementById('empty')!.hidden = data.messages.length > 0;
    if (changed || nearBottom) container.scrollTop = container.scrollHeight;
  };
  ipcRenderer.on('signal:surface-messages', receive);
  window.addEventListener('unload', () => { observer.disconnect(); ipcRenderer.removeListener('signal:surface-messages', receive); });
});
