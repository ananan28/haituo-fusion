'use strict';

// Copyright 2020 Signal Messenger, LLC
// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only
//
// Renderer-only port of the supplied Signal ConversationView, Timeline,
// ConversationListItem and CompositionArea components. Signal's window shell,
// menus, updater and application lifecycle are deliberately not included.

(function exposeSignalContent(global) {
  const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
  const LANGUAGE_OPTIONS = [['en','英语'],['zh-CN','简体中文'],['ja','日语'],['ko','韩语'],['es','西班牙语'],['fr','法语'],['de','德语'],['ru','俄语']];
  const uiByAccount = new Map();
  const translations = new Map();
  let compositionActive = false;
  let translationBusy = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function iconButton(label, title, className = '') {
    const button = el('button', `AxoIconButton ${className}`.trim(), label);
    button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
    return button;
  }
  function modelFor(id) {
    if (!uiByAccount.has(id)) uiByAccount.set(id, { conversationId: '', conversations: [], messages: [], status: '未连接', quote: null, search: '' });
    return uiByAccount.get(id);
  }
  function friendly(error, fallback = '操作失败，请稍后重试') {
    const raw = String(error?.message || error || '').replace(/^Error:\s*/i, '').trim();
    if (!raw) return fallback;
    if (/ClassNotFound|NoClassDefFound|org\.asamk|signal\.Main/i.test(raw)) return 'Signal 运行组件未正确安装，请重新安装最新版财盛聚合聊天。';
    if (/timeout|timed out/i.test(raw)) return '连接超时，请检查网络或代理后重试。';
    if (/offline|未在线|not linked/i.test(raw)) return 'Signal 尚未连接，请先扫码连接。';
    return raw.replace(/ERR_[A-Z_]+/g, '网络连接异常').slice(0, 180);
  }
  function timeLabel(timestamp) {
    if (!timestamp) return '';
    const date = new Date(Number(timestamp));
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (now - date < 7 * 86400000) return ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()];
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
  function dayLabel(timestamp) {
    const date = new Date(Number(timestamp));
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return '今天';
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function avatar(name, source, size = 'md') {
    const box = el('div', `Avatar Avatar--${size}`);
    if (source) { const image = el('img'); image.src = source; image.alt = ''; box.append(image); }
    else box.textContent = String(name || '?').trim().charAt(0).toUpperCase();
    return box;
  }
  async function scopeFor(service, conversationId) {
    return global.caisheng.translation.getScope(service.id, conversationId || '当前会话');
  }
  async function translate(service, conversationId, text) {
    const scope = await scopeFor(service, conversationId);
    return global.caisheng.translation.translate({
      accountId: service.id, conversationId: conversationId || '当前会话', text,
      target: HAN.test(text) ? (scope.target || scope.defaultTarget || 'en') : 'zh-CN'
    });
  }

  function createConversationListItem(conversation, selected, onSelect) {
    const button = el('button', `module-conversation-list__item module-conversation-list__item--contact-or-conversation${selected ? ' is-selected' : ''}`);
    button.type = 'button'; button.dataset.search = `${conversation.name || ''} ${conversation.last || ''}`.toLocaleLowerCase('zh-CN');
    button.append(avatar(conversation.name, conversation.avatar));
    const content = el('span', 'module-conversation-list__item__content');
    const first = el('span', 'module-conversation-list__item__header');
    first.append(el('strong', 'module-conversation-list__item__contact-or-conversation__name', conversation.name || '未知联系人'));
    first.append(el('time', 'module-conversation-list__item__timestamp', timeLabel(conversation.timestamp)));
    const second = el('span', 'module-conversation-list__item__message-row');
    second.append(el('span', 'module-conversation-list__item__message', conversation.last || '暂无消息'));
    if (conversation.unread) second.append(el('em', 'module-conversation-list__item__unread', conversation.unread > 99 ? '99+' : String(conversation.unread)));
    content.append(first, second); button.append(content); button.onclick = onSelect;
    return button;
  }

  function createAttachment(attachment) {
    const type = String(attachment.contentType || '');
    const src = attachment.dataUrl || attachment.localPath || attachment.path || '';
    if (type.startsWith('image/') && src) { const image = el('img', 'module-image'); image.src = src; image.alt = attachment.filename || '图片'; return image; }
    if (type.startsWith('video/') && src) { const video = el('video', 'module-video'); video.src = src; video.controls = true; return video; }
    if (type.startsWith('audio/') && src) { const audio = el('audio', 'module-audio'); audio.src = src; audio.controls = true; return audio; }
    const file = el('a', 'module-file'); file.textContent = `📄 ${attachment.filename || '附件'}`;
    if (attachment.dataUrl) { file.href = attachment.dataUrl; file.download = attachment.filename || '附件'; }
    else { file.href = '#'; file.onclick = event => event.preventDefault(); file.title = '附件保存在该账号的独立缓存中'; }
    return file;
  }

  function createTimelineMessage(message, service, model, rerender, notify) {
    const outgoing = message.direction === 'outgoing';
    const row = el('div', `Timeline__message-row ${outgoing ? 'Timeline__message-row--outgoing' : 'Timeline__message-row--incoming'}`);
    const article = el('article', `module-message module-message--${outgoing ? 'outgoing' : 'incoming'}`);
    if (!outgoing) article.append(el('div', 'module-message__author', message.sender || '联系人'));
    if (message.quote) {
      const quote = el('blockquote', 'module-quote');
      quote.append(el('strong', '', message.quote.author || '引用消息'), el('span', '', message.quote.text || message.quote.message || '消息'));
      article.append(quote);
    }
    const body = el('div', `module-message__text${message.deleted ? ' is-deleted' : ''}`, message.deleted ? '消息已撤回' : (message.text || ''));
    if (body.textContent) article.append(body);
    const media = el('div', 'module-message__attachments');
    for (const attachment of message.attachments || []) media.append(createAttachment(attachment));
    if (media.childNodes.length) article.append(media);
    const key = `${service.id}:${message.conversationId}:${message.id}`;
    if (translations.has(key)) article.append(el('div', 'CaishengMessageTranslation', `译文：${translations.get(key)}`));
    if (message.reactions?.length) {
      const reactions = el('div', 'module-message__reactions');
      for (const reaction of message.reactions) reactions.append(el('span', '', reaction.emoji));
      article.append(reactions);
    }
    const meta = el('div', 'module-message__metadata');
    if (message.edited) meta.append(el('span', '', '已编辑'));
    meta.append(el('time', '', timeLabel(message.timestamp)), el('span', 'module-message__status', outgoing ? (message.status || '已发送') : ''));
    article.append(meta);
    const actions = el('div', 'module-message__actions');
    const action = (label, title, handler) => { const b = iconButton(label, title); b.onclick = () => Promise.resolve(handler()).catch(e => notify(friendly(e), true)); actions.append(b); };
    action('↩', '回复', () => { model.quote = { timestamp: message.timestamp, author: message.author || message.sender, text: message.text }; rerender(); });
    action('👍', '回应', () => global.caisheng.signal.reaction(service.id, model.conversationId, '👍', { timestamp: message.timestamp, author: message.author || message.sender }, false));
    if (message.text) action('译', '翻译', async () => { const result = await translate(service, message.conversationId, message.text); translations.set(key, result.translatedText); rerender(); });
    if (outgoing && !message.deleted) {
      action('✎', '编辑', async () => { const next = prompt('编辑消息', message.text || ''); if (next !== null && next !== message.text) { await global.caisheng.signal.edit(service.id, model.conversationId, message.timestamp, next); await rerender(true); } });
      action('⌫', '撤回', async () => { if (confirm('确定为所有人撤回这条消息吗？')) { await global.caisheng.signal.delete(service.id, model.conversationId, message.timestamp); await rerender(true); } });
    }
    row.append(article, actions); return row;
  }

  function createEmptyConversation() {
    const empty = el('section', 'ConversationView__empty');
    empty.append(el('div', 'ConversationView__empty-icon', '💬'), el('h2', '', '选择一个会话'), el('p', '', '从左侧选择联系人或群聊开始聊天'));
    return empty;
  }

  function createLinkScreen(service, model, mount, notify) {
    const screen = el('section', 'InstallScreenQrCodeNotScannedStep');
    const logo = el('div', 'InstallScreenSignalLogo'); logo.append(el('span', '', 'Signal'));
    const card = el('div', 'InstallScreenQrCodeNotScannedStep__card');
    const title = el('h1', '', '连接 Signal');
    const hint = el('p', '', '在手机 Signal 中打开“设置 → 已关联的设备”，扫描这里的二维码。');
    const qrFrame = el('div', 'InstallScreenQrCodeNotScannedStep__qr');
    qrFrame.append(el('div', 'InstallScreenQrCodeNotScannedStep__placeholder', '等待生成二维码'));
    const state = el('div', 'InstallScreenQrCodeNotScannedStep__state', model.status || '尚未连接');
    const button = el('button', 'AxoButton AxoButton--primary', '生成二维码'); button.type = 'button';
    button.onclick = async () => {
      button.disabled = true; state.textContent = '正在生成二维码…'; qrFrame.classList.add('is-loading');
      try {
        const result = await global.caisheng.signal.link(service.id);
        qrFrame.replaceChildren();
        if (result.dataUrl) { const image = el('img'); image.src = result.dataUrl; image.alt = 'Signal 关联二维码'; qrFrame.append(image); }
        else qrFrame.append(el('div', 'InstallScreenQrCodeNotScannedStep__placeholder', '二维码生成失败，请重试'));
        state.textContent = '请在两分钟内完成扫码'; model.status = '等待扫码';
      } catch (error) {
        model.status = '连接失败'; state.textContent = friendly(error, '二维码生成失败，请重试'); notify(state.textContent, true);
      } finally { button.disabled = false; qrFrame.classList.remove('is-loading'); }
    };
    const retry = el('button', 'AxoButton AxoButton--secondary', '重新检测连接'); retry.type = 'button'; retry.onclick = () => mount(true);
    card.append(title, hint, qrFrame, state, el('div', 'InstallScreenQrCodeNotScannedStep__actions')); card.lastChild.append(button, retry);
    screen.append(logo, card); return screen;
  }

  async function mount({ service, root, notify }) {
    const model = modelFor(service.id);
    root.replaceChildren(el('section', 'SignalContentHost'));
    const host = root.firstChild;
    const remount = () => mount({ service, root, notify });
    try {
      const currentState = await global.caisheng.signal.state(service.id);
      model.status = currentState.status || '未连接';
      const notLinked = currentState.linked === false || ['未连接','等待扫码','连接失败'].includes(model.status);
      if (notLinked) { host.replaceChildren(createLinkScreen(service, model, remount, notify)); return; }
      await global.caisheng.signal.start(service.id);
      model.conversations = await global.caisheng.signal.conversations(service.id);
    } catch (error) {
      const message = friendly(error);
      if (/尚未连接|扫码|运行组件未正确安装/.test(message)) { host.replaceChildren(createLinkScreen(service, model, remount, notify)); notify(message, true); return; }
      notify(message, true);
    }

    const inbox = el('section', 'Inbox');
    const pane = el('aside', 'module-left-pane');
    const paneHeader = el('header', 'module-left-pane__header');
    paneHeader.append(el('h1', '', '聊天'));
    const paneActions = el('div', 'module-left-pane__header__actions');
    const refresh = iconButton('↻', '刷新会话'); refresh.onclick = () => remount();
    const more = iconButton('⋯', '账号状态'); more.onclick = () => notify(`${service.name}：${model.status}`);
    paneActions.append(refresh, more); paneHeader.append(paneActions);
    const searchWrap = el('div', 'module-LeftPaneSearchInput');
    const search = el('input'); search.type = 'search'; search.placeholder = '搜索'; search.setAttribute('aria-label', '搜索会话');
    searchWrap.append(el('span', '', '⌕'), search);
    const list = el('div', 'module-conversation-list');
    const renderList = () => {
      list.replaceChildren();
      const query = model.search.trim().toLocaleLowerCase('zh-CN');
      const rows = model.conversations.filter(x => !query || `${x.name || ''} ${x.last || ''}`.toLocaleLowerCase('zh-CN').includes(query));
      if (!rows.length) list.append(el('div', 'module-conversation-list__empty-results', query ? '没有找到会话' : '暂无会话，连接后消息会显示在这里'));
      for (const conversation of rows) list.append(createConversationListItem(conversation, model.conversationId === conversation.id, () => selectConversation(conversation)));
    };
    search.value = model.search; search.oninput = () => { model.search = search.value; renderList(); };
    pane.append(paneHeader, searchWrap, list);
    const panel = el('main', 'ConversationPanel'); inbox.append(pane, panel); host.replaceChildren(inbox); renderList();

    const refreshMessages = async keepPosition => {
      if (!model.conversationId) { panel.replaceChildren(createEmptyConversation()); return; }
      const scroll = panel.querySelector('.Timeline'); const before = keepPosition && scroll ? scroll.scrollHeight - scroll.scrollTop : 0;
      model.messages = await global.caisheng.signal.history(service.id, model.conversationId, 500);
      renderConversation();
      const next = panel.querySelector('.Timeline'); if (next) next.scrollTop = keepPosition ? Math.max(0, next.scrollHeight - before) : next.scrollHeight;
    };
    const selectConversation = async conversation => {
      model.conversationId = conversation.id; model.quote = null; renderList();
      panel.replaceChildren(el('section', 'ConversationView__loading', '正在载入历史消息…'));
      try { await refreshMessages(false); } catch (error) { notify(friendly(error), true); panel.replaceChildren(createEmptyConversation()); }
    };
    const renderConversation = () => {
      const conversation = model.conversations.find(x => x.id === model.conversationId);
      if (!conversation) { panel.replaceChildren(createEmptyConversation()); return; }
      const view = el('section', 'ConversationView');
      const header = el('header', 'module-ConversationHeader');
      header.append(avatar(conversation.name, conversation.avatar, 'sm'));
      const info = el('div', 'module-ConversationHeader__header__info');
      info.append(el('strong', 'module-ConversationHeader__header__info__title', conversation.name || '未知联系人'), el('span', '', conversation.group ? '群聊' : (model.status === '在线' ? 'Signal · 在线' : `Signal · ${model.status}`)));
      const headerActions = el('div', 'module-ConversationHeader__header__actions');
      const searchChat = iconButton('⌕', '搜索此会话'), details = iconButton('⋯', '会话详情');
      searchChat.onclick = () => { const q = prompt('搜索当前会话'); if (!q) return; const found = [...view.querySelectorAll('.module-message__text')].find(x => x.textContent.includes(q)); found?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!found) notify('当前会话中没有找到相关消息', true); };
      details.onclick = () => notify(conversation.group ? '群聊详情与成员管理入口' : '联系人详情入口');
      headerActions.append(searchChat, details); header.append(info, headerActions);

      const timeline = el('div', 'Timeline'); const stream = el('div', 'Timeline__messages');
      let day = '';
      for (const message of model.messages) {
        const nextDay = dayLabel(message.timestamp);
        if (nextDay !== day) { day = nextDay; stream.append(el('div', 'TimelineDateHeader', day)); }
        stream.append(createTimelineMessage(message, service, model, refreshMessages, notify));
      }
      if (!model.messages.length) {
        const hero = el('section', 'ConversationHero'); hero.append(avatar(conversation.name, conversation.avatar, 'lg'), el('h2', '', conversation.name || '未知联系人'), el('p', '', '还没有消息，发送第一条消息开始对话。')); stream.append(hero);
      }
      timeline.append(stream);

      const composition = el('form', 'CompositionArea');
      if (model.quote) {
        const quote = el('div', 'CompositionArea__quote'); quote.append(el('div', '', `回复 ${model.quote.author || '消息'}\n${model.quote.text || ''}`));
        const close = iconButton('×', '取消回复'); close.onclick = () => { model.quote = null; renderConversation(); }; quote.append(close); composition.append(quote);
      }
      const staged = el('div', 'CompositionArea__staged');
      const row = el('div', 'CompositionArea__row');
      const file = el('input'); file.type = 'file'; file.multiple = true; file.hidden = true;
      const attach = iconButton('＋', '添加附件', 'CompositionArea__button'); attach.onclick = () => file.click();
      const inputWrap = el('div', 'CompositionInput'); const textarea = el('textarea'); textarea.rows = 1; textarea.placeholder = '发送消息'; textarea.setAttribute('aria-label', '输入消息');
      const emoji = iconButton('☺', '表情', 'CompositionArea__emoji'); emoji.onclick = () => { textarea.value += '😊'; textarea.focus(); };
      inputWrap.append(textarea, emoji);
      const voice = iconButton('●', '语音消息', 'CompositionArea__button CompositionArea__voice'); voice.onclick = () => notify('按住录音功能正在接入系统麦克风');
      const send = iconButton('➤', '发送', 'CompositionArea__send'); send.type = 'submit';
      row.append(attach, inputWrap, voice, send); composition.append(staged, file, row);
      const tools = el('div', 'CaishengComposerTranslator');
      const target = el('select'); for (const [value,label] of LANGUAGE_OPTIONS) { const option = el('option', '', label); option.value = value; target.append(option); }
      const spaceLabel = el('label'); const space = el('input'); space.type = 'checkbox'; spaceLabel.append(space, document.createTextNode(' 空格翻译'));
      const blockLabel = el('label'); const block = el('input'); block.type = 'checkbox'; blockLabel.append(block, document.createTextNode(' 禁止中文'));
      const translateButton = el('button', '', '翻译输入'); translateButton.type = 'button';
      const undo = el('button', '', '撤销翻译'); undo.type = 'button'; undo.disabled = true;
      const preview = el('span', 'CaishengComposerTranslator__preview'); tools.append(target, spaceLabel, blockLabel, translateButton, undo, preview); composition.append(tools);
      let original = '';
      const updateDraftFiles = () => { staged.replaceChildren(); for (const item of file.files) staged.append(el('span', 'CompositionUpload', `${item.type.startsWith('image/') ? '🖼' : '📎'} ${item.name}`)); };
      file.onchange = updateDraftFiles;
      const updateScope = () => global.caisheng.translation.updateScope(service.id, model.conversationId, { target: target.value, spaceTranslate: space.checked, blockChinese: block.checked }).catch(e => notify(friendly(e), true));
      target.onchange = updateScope; space.onchange = updateScope; block.onchange = updateScope;
      const translateDraft = async () => {
        if (translationBusy || !textarea.value.trim()) return false;
        translationBusy = true; translateButton.disabled = true; original = textarea.value; preview.textContent = '正在翻译…';
        try { const result = await translate(service, model.conversationId, textarea.value); textarea.value = result.translatedText; preview.textContent = `原文：${original}`; undo.disabled = false; return true; }
        catch (error) { preview.textContent = '翻译失败，已保留原文'; notify(friendly(error, '翻译失败，已保留原文'), true); return false; }
        finally { translationBusy = false; translateButton.disabled = false; }
      };
      translateButton.onclick = translateDraft; undo.onclick = () => { if (!original) return; textarea.value = original; original = ''; preview.textContent = ''; undo.disabled = true; textarea.focus(); };
      textarea.addEventListener('compositionstart', () => { compositionActive = true; }); textarea.addEventListener('compositionend', () => { compositionActive = false; });
      textarea.addEventListener('input', () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(140, textarea.scrollHeight)}px`; });
      textarea.addEventListener('keydown', async event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !compositionActive) { event.preventDefault(); composition.requestSubmit(); return; }
        if (event.code !== 'Space' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || compositionActive || translationBusy || !textarea.value.trim()) return;
        const scope = await scopeFor(service, model.conversationId); if (!scope.spaceTranslate) return;
        event.preventDefault(); const ok = await translateDraft(); if (ok && scope.autoSend) composition.requestSubmit();
      });
      view.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
      view.addEventListener('drop', event => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); file.files = event.dataTransfer.files; updateDraftFiles(); });
      view.addEventListener('paste', event => { const files = [...(event.clipboardData?.items || [])].filter(x => x.kind === 'file').map(x => x.getAsFile()).filter(Boolean); if (!files.length) return; const transfer = new DataTransfer(); files.forEach(x => transfer.items.add(x)); file.files = transfer.files; updateDraftFiles(); event.preventDefault(); });
      composition.onsubmit = async event => {
        event.preventDefault(); const text = textarea.value; const files = [...file.files].map(x => global.caisheng.signal.filePath(x)).filter(Boolean);
        if (!text.trim() && !files.length) return;
        send.disabled = true;
        try {
          const check = await global.caisheng.translation.validate({ accountId: service.id, conversationId: model.conversationId, text, quote: model.quote });
          if (!check.allowed) { notify(check.message, true); return; }
          await global.caisheng.signal.send(service.id, model.conversationId, text, files, model.quote);
          textarea.value = ''; file.value = ''; staged.replaceChildren(); model.quote = null; original = ''; preview.textContent = ''; await refreshMessages(false);
        } catch (error) { notify(`发送失败：${friendly(error)}`, true); }
        finally { send.disabled = false; }
      };
      view.append(header, timeline, composition); panel.replaceChildren(view);
      scopeFor(service, model.conversationId).then(scope => { target.value = scope.target || scope.defaultTarget || 'en'; space.checked = Boolean(scope.spaceTranslate); block.checked = Boolean(scope.blockChinese); });
      requestAnimationFrame(() => { timeline.scrollTop = timeline.scrollHeight; textarea.focus(); });
    };
    if (model.conversationId && model.conversations.some(x => x.id === model.conversationId)) await refreshMessages(false); else panel.replaceChildren(createEmptyConversation());
  }

  global.CaishengSignalRenderer = { mount, modelFor };
})(window);
