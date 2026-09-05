export type WebviewLike = HTMLElement & {
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
  reload(): void;
  focus?(): void;
};

export type WhatsAppMessage = {
  key: string;
  locatorType: 'data-id' | 'pre' | 'text';
  locator: string;
  chatId: string;
  chatTitle: string;
  direction: 'in' | 'out';
  text: string;
  at: number;
};

export type WhatsAppChatPreview = {
  id: string;
  title: string;
  subtitle: string;
  unread: number;
  active: boolean;
  phoneHint?: string;
};

export type WhatsAppChatInfo = {
  id: string;
  title: string;
  phoneHint?: string;
};

const normalizeIdScript = `
  const clean = value => String(value || '').replace(/\\u200e|\\u200f/g, '').trim();
  const phoneFrom = value => {
    const s = clean(value);
    const m = s.match(/\\+?\\d[\\d\\s().-]{6,}\\d/);
    return m ? m[0].replace(/[^+\\d]/g, '') : '';
  };
`;

export async function readCurrentWhatsAppChat(view: WebviewLike, preferPhoneId = false): Promise<WhatsAppChatInfo> {
  return view.executeJavaScript<WhatsAppChatInfo>(`(() => {
    ${normalizeIdScript}
    const title = clean(
      document.querySelector('#main header [title]')?.getAttribute('title') ||
      document.querySelector('#main header span[dir="auto"]')?.textContent ||
      document.querySelector('header [title]')?.getAttribute('title') ||
      'WhatsApp'
    );
    const headerText = clean(document.querySelector('#main header')?.textContent || title);
    const phoneHint = phoneFrom(headerText) || phoneFrom(title);
    return { id: ${preferPhoneId ? 'phoneHint || title' : 'title'}, title, phoneHint: phoneHint || undefined };
  })()`);
}

export async function readWhatsAppChatList(view: WebviewLike, preferPhoneId = false, showRemarks = true): Promise<WhatsAppChatPreview[]> {
  return view.executeJavaScript<WhatsAppChatPreview[]>(`(() => {
    ${normalizeIdScript}
    const rows = [...document.querySelectorAll('[role="listitem"], [role="row"]')]
      .filter(row => row.querySelector('span[title], span[dir="auto"]'))
      .slice(0, 120);
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      const titleNode = row.querySelector('span[title]') || row.querySelector('span[dir="auto"]');
      const title = clean(titleNode?.getAttribute?.('title') || titleNode?.textContent);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      const allText = [...row.querySelectorAll('span')].map(x => clean(x.textContent)).filter(Boolean);
      const subtitle = ${showRemarks ? 'allText.filter(x => x !== title).slice(-2).join(" · ")' : 'allText.filter(x => x !== title).slice(-1).join(" · ")'};
      const phoneHint = phoneFrom(allText.join(' ')) || phoneFrom(title);
      const badgeText = clean(
        row.querySelector('[aria-label*="unread" i]')?.getAttribute('aria-label') ||
        row.querySelector('[aria-label*="未读"]')?.getAttribute('aria-label') ||
        row.querySelector('[data-testid*="unread"]')?.textContent || ''
      );
      const countMatch = badgeText.match(/\\d+/);
      const unread = countMatch ? Number(countMatch[0]) : (badgeText ? 1 : 0);
      const active = row.getAttribute('aria-selected') === 'true' || !!row.querySelector('[aria-selected="true"]');
      out.push({
        id: ${preferPhoneId ? 'phoneHint || title' : 'title'},
        title,
        subtitle,
        unread,
        active,
        phoneHint: phoneHint || undefined
      });
    }
    return out;
  })()`);
}

export async function openWhatsAppChat(view: WebviewLike, title: string): Promise<boolean> {
  const t = JSON.stringify(title);
  return view.executeJavaScript<boolean>(`(() => {
    const clean = value => String(value || '').replace(/\\u200e|\\u200f/g, '').trim();
    const target = ${t};
    const nodes = [...document.querySelectorAll('span[title], span[dir="auto"]')];
    const node = nodes.find(x => clean(x.getAttribute?.('title') || x.textContent) === target);
    if (!node) return false;
    const row = node.closest('[role="listitem"], [role="row"]') || node.parentElement;
    row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    row?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`, true);
}

export async function readRecentWhatsAppMessages(view: WebviewLike, limit = 12, preferPhoneId = false): Promise<WhatsAppMessage[]> {
  return view.executeJavaScript<WhatsAppMessage[]>(`(() => {
    ${normalizeIdScript}
    const chatTitle = clean(
      document.querySelector('#main header [title]')?.getAttribute('title') ||
      document.querySelector('#main header span[dir="auto"]')?.textContent ||
      document.querySelector('header [title]')?.getAttribute('title') ||
      'WhatsApp'
    );
    const headerText = clean(document.querySelector('#main header')?.textContent || chatTitle);
    const phoneHint = phoneFrom(headerText) || phoneFrom(chatTitle);
    const chatId = ${preferPhoneId ? 'phoneHint || chatTitle' : 'chatTitle'};

    let bubbles = [...document.querySelectorAll('#main .message-in, #main .message-out')];
    if (!bubbles.length) {
      const dataNodes = [...document.querySelectorAll('#main [data-id]')];
      const unique = [];
      const seen = new Set();
      for (const node of dataNodes) {
        const bubble = node.closest('.message-in, .message-out') || node;
        if (!seen.has(bubble)) { seen.add(bubble); unique.push(bubble); }
      }
      bubbles = unique;
    }

    const messages = [];
    for (let i = Math.max(0, bubbles.length - ${Math.max(1, Math.min(limit, 80))}); i < bubbles.length; i++) {
      const bubble = bubbles[i];
      const preNode = bubble.querySelector('[data-pre-plain-text]') || (bubble.matches?.('[data-pre-plain-text]') ? bubble : null);
      const textNode =
        bubble.querySelector('span.selectable-text') ||
        bubble.querySelector('[data-testid="msg-container"] span[dir]') ||
        preNode ||
        bubble;
      const text = clean(textNode?.innerText || textNode?.textContent);
      if (!text) continue;

      const dataIdNode = bubble.matches?.('[data-id]') ? bubble : bubble.querySelector('[data-id]');
      const dataId = clean(dataIdNode?.getAttribute?.('data-id'));
      const pre = clean(preNode?.getAttribute?.('data-pre-plain-text'));
      const direction =
        bubble.classList?.contains('message-out') || bubble.closest?.('.message-out') ? 'out' : 'in';

      let locatorType = 'text';
      let locator = text;
      if (dataId) { locatorType = 'data-id'; locator = dataId; }
      else if (pre) { locatorType = 'pre'; locator = pre; }

      let at = Date.now() - (bubbles.length - i) * 20;
      const timeMatch = pre.match(/\\[(\\d{1,2}:\\d{2})(?:,|\\s)/);
      if (timeMatch) {
        const [hh, mm] = timeMatch[1].split(':').map(Number);
        const d = new Date(); d.setHours(hh, mm, 0, 0); at = d.getTime();
      }
      const key = [chatId, locatorType, locator, direction, text].join('|');
      messages.push({ key, locatorType, locator, chatId, chatTitle, direction, text, at });
    }
    return messages;
  })()`);
}

export async function readLastWhatsAppMessage(view: WebviewLike, preferPhoneId = false): Promise<string> {
  const list = await readRecentWhatsAppMessages(view, 10, preferPhoneId);
  return list.length ? list[list.length - 1].text : '';
}

export async function renderWhatsAppInlineTranslation(
  view: WebviewLike,
  message: WhatsAppMessage,
  translatedText: string,
  styleOptions?: { color?: string; fontSize?: number; label?: string }
): Promise<boolean> {
  const payload = JSON.stringify(message);
  const translated = JSON.stringify(translatedText);
  const color = JSON.stringify(styleOptions?.color || '#0DA5F9');
  const fontSize = Number(styleOptions?.fontSize || 14);
  const labelText = JSON.stringify(styleOptions?.label || '译');
  return view.executeJavaScript<boolean>(`(() => {
    const message = ${payload};
    const translatedText = ${translated};
    const clean = value => String(value || '').replace(/\\u200e|\\u200f/g, '').trim();

    let style = document.getElementById('chatlite-inline-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'chatlite-inline-style';
      document.head.appendChild(style);
    }
    style.textContent = \
      '.chatlite-inline-translation{margin-top:5px;padding:6px 8px;border-radius:7px;line-height:1.45;white-space:pre-wrap;background:rgba(9,20,32,.08);border-left:3px solid ' + ${color} + ';font-size:' + ${fontSize} + 'px;color:' + ${color} + ';}' +
      '.chatlite-inline-translation b{font-size:10px;opacity:.72;margin-right:5px;}';

    let bubble = null;
    if (message.locatorType === 'data-id') {
      const node = [...document.querySelectorAll('#main [data-id]')]
        .find(x => clean(x.getAttribute('data-id')) === message.locator);
      bubble = node?.closest('.message-in, .message-out') || node;
    } else if (message.locatorType === 'pre') {
      const node = [...document.querySelectorAll('#main [data-pre-plain-text]')]
        .find(x => clean(x.getAttribute('data-pre-plain-text')) === message.locator);
      bubble = node?.closest('.message-in, .message-out') || node;
    } else {
      const candidates = [...document.querySelectorAll('#main .message-in, #main .message-out')];
      bubble = [...candidates].reverse().find(x => {
        const node = x.querySelector('span.selectable-text') || x.querySelector('[data-pre-plain-text]') || x;
        return clean(node?.innerText || node?.textContent) === message.text;
      });
    }
    if (!bubble) return false;

    const token = btoa(unescape(encodeURIComponent(message.key))).replace(/=+$/,'').slice(-48);
    let box = bubble.querySelector('[data-chatlite-translation="' + token + '"]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'chatlite-inline-translation';
      box.setAttribute('data-chatlite-translation', token);
      const host = bubble.querySelector('[data-pre-plain-text]') || bubble;
      host.appendChild(box);
    }
    box.textContent = '';
    const label = document.createElement('b');
    label.textContent = ${labelText};
    box.appendChild(label);
    box.appendChild(document.createTextNode(translatedText));
    return true;
  })()`, true);
}

export async function touchWhatsAppReadState(view: WebviewLike): Promise<boolean> {
  return view.executeJavaScript<boolean>(`(() => {
    const main = document.querySelector('#main');
    if (!main) return false;
    window.focus();
    main.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    return true;
  })()`, true);
}

export async function writeWhatsAppComposer(view: WebviewLike, text: string, send = false): Promise<boolean> {
  const encoded = JSON.stringify(text);
  return view.executeJavaScript<boolean>(`(() => {
    const candidates = [...document.querySelectorAll('[contenteditable="true"]')];
    const editor =
      candidates.find(el => el.closest('#main footer')) ||
      candidates.find(el => el.closest('footer')) ||
      candidates[candidates.length - 1];
    if (!editor) return false;

    editor.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, ${encoded});
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: ${encoded}
    }));

    if (${send ? 'true' : 'false'}) {
      const sendButton =
        document.querySelector('#main [data-icon="send"]')?.closest('button') ||
        document.querySelector('#main button[aria-label*="Send"]') ||
        document.querySelector('#main button[aria-label*="发送"]');
      if (sendButton) sendButton.click();
      else editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true
      }));
    }
    return true;
  })()`, true);
}
