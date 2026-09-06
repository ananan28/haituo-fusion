'use strict';
const { ipcRenderer } = require('electron');

const accountId = process.argv.find(x => x.startsWith('--caisheng-account='))?.slice(20) || '';
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const originals = new WeakMap();
let composing = false;
let translating = false;
let scope = null;
let scopeKey = '';

function conversationId() {
  const title = document.querySelector('#main header [title]')?.getAttribute('title') ||
    document.querySelector('#main header span[dir="auto"]')?.textContent || '当前会话';
  return String(title).trim().slice(0, 180) || '当前会话';
}
function composerFrom(target) {
  const node = target?.closest?.('[contenteditable="true"]');
  if (!node || !document.querySelector('#main')?.contains(node)) return null;
  return node;
}
function setComposer(node, text) {
  node.focus();
  const selection = window.getSelection(), range = document.createRange();
  range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range);
  if (!document.execCommand('insertText', false, text)) {
    node.textContent = text;
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}
function notice(message, bad = false) {
  let node = document.getElementById('caisheng-translate-notice');
  if (!node) {
    node = document.createElement('div'); node.id = 'caisheng-translate-notice';
    Object.assign(node.style, { position:'fixed', right:'24px', bottom:'82px', zIndex:'2147483647',
      padding:'10px 16px', borderRadius:'8px', color:'#fff', font:'14px Microsoft YaHei UI',
      boxShadow:'0 8px 28px #0004', transition:'opacity .2s' });
    document.documentElement.append(node);
  }
  node.textContent = message; node.style.background = bad ? '#c93838' : '#4f46d8'; node.style.opacity = '1';
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { node.style.opacity = '0'; }, 2800);
}
async function currentScope() {
  const conversation = conversationId(), key = accountId + '\n' + conversation;
  if (!scope || scopeKey !== key) {
    scope = await ipcRenderer.invoke('translation:scope:get', accountId, conversation);
    scopeKey = key;
  }
  return { ...scope, conversation };
}
async function translateComposer(node) {
  if (translating) return;
  const text = node.innerText || node.textContent || '';
  if (!text.trim()) return;
  translating = true; originals.set(node, text);
  try {
    const settings = await currentScope();
    const result = await ipcRenderer.invoke('translation:translate', {
      accountId, conversationId: settings.conversation, text,
      target: HAN.test(text) ? (settings.target || settings.defaultTarget || 'en') : 'zh-CN'
    });
    setComposer(node, result.translatedText);
    notice('空格翻译完成（' + (result.provider === 'google-cn' ? 'Google 备用线路' : result.provider === 'google' ? 'Google' : result.provider) + '）');
    if (settings.autoSend) setTimeout(() => document.querySelector('#main [data-testid="compose-btn-send"], #main button[aria-label*="Send"], #main button[aria-label*="发送"]')?.click(), 80);
  } catch (error) { notice(error.message || '翻译失败，已保留原文', true); }
  finally { translating = false; }
}
async function translateMessage(textNode, button) {
  const text = textNode.textContent || '';
  if (!text.trim() || button.disabled) return;
  button.disabled = true;
  try {
    const settings = await currentScope();
    const result = await ipcRenderer.invoke('translation:translate', {
      accountId, conversationId: settings.conversation, text,
      target: HAN.test(text) ? (settings.target || settings.defaultTarget || 'en') : 'zh-CN'
    });
    let translated = button.parentElement.querySelector(':scope > .caisheng-translation-result');
    if (!translated) {
      translated = document.createElement('div'); translated.className = 'caisheng-translation-result';
      Object.assign(translated.style, { marginTop:'5px', paddingTop:'5px', borderTop:'1px solid #9995', color:'inherit', fontSize:'13px' });
      button.parentElement.append(translated);
    }
    translated.textContent = '译文：' + result.translatedText;
    textNode.style.display = settings.showOriginal === false ? 'none' : '';
  } catch (error) { notice(error.message || '消息翻译失败', true); }
  finally { button.disabled = false; }
}
function decorateMessages(root = document) {
  root.querySelectorAll?.('#main [data-pre-plain-text]').forEach(container => {
    if (container.dataset.caishengTranslationReady) return;
    const textNode = container.querySelector('.selectable-text span, span.selectable-text, [dir="ltr"], [dir="auto"]');
    if (!textNode?.textContent?.trim()) return;
    container.dataset.caishengTranslationReady = '1';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '翻译'; button.className = 'caisheng-translate-button';
    Object.assign(button.style, { border:'0', background:'transparent', color:'#635bdb', cursor:'pointer', padding:'3px 0', font:'12px Microsoft YaHei UI' });
    button.addEventListener('click', event => { event.stopPropagation(); translateMessage(textNode, button); });
    container.append(button);
    currentScope().then(settings => { if (settings.autoTranslateIncoming) translateMessage(textNode, button); }).catch(() => {});
  });
}
function install() {
  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  document.addEventListener('focusin', () => { scope = null; currentScope().catch(() => {}); }, true);
  document.addEventListener('keydown', event => {
    const input = composerFrom(event.target); if (!input) return;
    const text = input.innerText || input.textContent || '';
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && scope?.blockChinese && HAN.test(text)) {
      event.preventDefault(); event.stopImmediatePropagation(); notice('检测到中文，请先翻译后再发送', true); return;
    }
    if (event.code !== 'Space' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || composing || event.isComposing || translating || !text.trim()) return;
    currentScope().then(settings => {
      if (!settings.spaceTranslate) return;
      event.preventDefault(); event.stopImmediatePropagation(); translateComposer(input);
    }).catch(error => notice(error.message || '翻译设置读取失败', true));
  }, true);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      const input = composerFrom(event.target), original = input && originals.get(input);
      if (original) { event.preventDefault(); setComposer(input, original); originals.delete(input); notice('已恢复翻译前原文'); }
    }
  }, true);
  const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorateMessages(node); });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  decorateMessages(); currentScope().catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true }); else install();
