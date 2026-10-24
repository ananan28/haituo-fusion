'use strict';
// 1.6.0: WhatsApp group detection must not treat 1:1 chats as groups. The old
// `#main [data-pre-plain-text]` heuristic matches direct chats too, so turning
// off group back-translation silently disabled translation everywhere. Group is
// now inferred from a sender name shown above an incoming bubble (never present
// in 1:1 chats), excluding quoted/forwarded labels.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'js', 'caisheng-webview-preload.js'), 'utf8');
const start = source.indexOf('function isWhatsAppGroupConversation');
const end = source.indexOf('function recentMessageNodes', start);
assert.ok(start >= 0 && end > start, 'group detection slice found');
const slice = source.slice(start, end);

function matchesSelector(el, sel) {
  if (sel.startsWith('.')) return el.cls.includes(sel.slice(1));
  if (sel.startsWith('[')) {
    const inner = sel.slice(1, -1);
    let m = inner.match(/^([\w-]+)\*="([^"]*)"\s*i$/u);
    if (m) return String(el.attrs[m[1]] || '').toLowerCase().includes(m[2].toLowerCase());
    m = inner.match(/^([\w-]+)="([^"]*)"$/u);
    if (m) return el.attrs[m[1]] === m[2];
    return false;
  }
  const bracket = sel.indexOf('[');
  if (bracket > 0) {
    const tag = sel.slice(0, bracket);
    if (el.tag !== tag) return false;
    return matchesSelector(el, sel.slice(bracket));
  }
  return false;
}

function node({tag = 'div', cls = [], attrs = {}, text = '', children = []} = {}) {
  const el = {
    tag,
    cls,
    attrs,
    textContent: text,
    children,
    parent: null,
    getAttribute(name) {
      return this.attrs[name];
    }
  };
  for (const child of children) child.parent = el;
  el.closest = sel => {
    let current = el;
    while (current) {
      if (sel.split(',').some(s => matchesSelector(current, s))) return current;
      current = current.parent;
    }
    return null;
  };
  el.matches = sel => sel.split(',').some(s => matchesSelector(el, s));
  el.querySelector = sel => {
    const stack = [...el.children];
    while (stack.length) {
      const n = stack.pop();
      if (sel.split(',').some(s => matchesSelector(n, s))) return n;
      stack.push(...n.children);
    }
    return null;
  };
  el.querySelectorAll = sel => {
    const out = [];
    const stack = [...el.children];
    while (stack.length) {
      const n = stack.pop();
      if (sel.split(',').some(s => matchesSelector(n, s))) out.push(n);
      stack.push(...n.children);
    }
    return out;
  };
  return el;
}

function boot(metas) {
  const ctx = {
    console,
    String,
    settings: {
      groupBackTranslationEnabled: true,
      autoTranslateIncoming: true
    },
    document: {querySelectorAll() {
      return metas;
    }}
  };
  vm.createContext(ctx);
  vm.runInContext(`function isTelegram() {
    return false;
}
function isWhatsApp() {
    return true;
}
function isTelegramGroupChat() {
    return false;
}
function webTranslationActive() {
    return true;
}
${slice}`, ctx);
  return ctx;
}

const bodySpan = (text = 'Hello') => node({tag: 'span', cls: ['selectable-text'], text, children: [
  node({tag: 'span', attrs: {dir: 'auto'}, text})
]});

test('a direct chat message with only a selectable text body is not a group', () => {
  const meta = node({
    attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '},
    children: [bodySpan()]
  });
  const ctx = boot([meta]);
  assert.equal(ctx.isWhatsAppGroupConversation(), false);
  assert.equal(ctx.isGroupConversation(), false);
});

test('an incoming group message with a sender label is detected as a group', () => {
  const meta = node({
    attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '},
    children: [
      node({tag: 'span', attrs: {dir: 'auto'}, text: 'Alice'}),
      bodySpan()
    ]
  });
  const ctx = boot([meta]);
  assert.equal(ctx.isWhatsAppGroupConversation(), true);
  assert.equal(ctx.isGroupConversation(), true);
});

test('a forwarded label is not mistaken for a group sender', () => {
  const forwardTag = node({
    tag: 'span',
    attrs: {dir: 'auto', 'data-testid': 'forwarded-tag'},
    text: 'Forwarded',
    children: []
  });
  const meta = node({
    attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '},
    children: [forwardTag, bodySpan()]
  });
  const ctx = boot([meta]);
  assert.equal(ctx.isWhatsAppGroupConversation(), false);
});

test('a quoted-message author label is not mistaken for a group sender', () => {
  const quoted = node({tag: 'span', attrs: {'data-testid': 'quoted-message'}, children: [
    node({tag: 'span', attrs: {dir: 'auto'}, text: 'Alice'})
  ]});
  const meta = node({
    attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '},
    children: [quoted, bodySpan()]
  });
  const ctx = boot([meta]);
  assert.equal(ctx.isWhatsAppGroupConversation(), false);
});

test('outgoing messages never prove a group', () => {
  const outgoing = node({cls: ['message-out'], attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] You: '}, children: [bodySpan()]});
  const author = node({tag: 'span', attrs: {dir: 'auto'}, text: 'Alice'});
  const meta = node({attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '}, children: [author, bodySpan()]});
  outgoing.children = [meta];
  meta.parent = outgoing;
  const ctx = boot([outgoing]);
  assert.equal(ctx.isWhatsAppGroupConversation(), false, 'a message-out wrapper is skipped');
});

test('group toggle only gates group chats; direct chats follow the receive-backtranslation toggle', () => {
  const direct = node({attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '}, children: [bodySpan()]});
  const group = node({attrs: {'data-pre-plain-text': '[12:00, 10/24/2026] Alice: '}, children: [
    node({tag: 'span', attrs: {dir: 'auto'}, text: 'Alice'}),
    bodySpan()
  ]});

  let ctx = boot([direct]);
  ctx.settings.groupBackTranslationEnabled = false;
  ctx.settings.autoTranslateIncoming = true;
  assert.equal(ctx.incomingTranslationOn(), true, 'turning off group translation must keep 1:1 chats translating');

  ctx = boot([group]);
  ctx.settings.groupBackTranslationEnabled = false;
  ctx.settings.autoTranslateIncoming = true;
  assert.equal(ctx.incomingTranslationOn(), false, 'group chats stop translating when group translation is off');

  ctx = boot([group]);
  ctx.settings.groupBackTranslationEnabled = true;
  ctx.settings.autoTranslateIncoming = false;
  assert.equal(ctx.incomingTranslationOn(), true, 'group chats keep translating while 1:1 receive-backtranslation is off');

  ctx = boot([direct]);
  ctx.settings.groupBackTranslationEnabled = true;
  ctx.settings.autoTranslateIncoming = false;
  assert.equal(ctx.incomingTranslationOn(), false, '1:1 chats stop translating when receive-backtranslation is off');
});

test('the old heuristic is gone so 1:1 chats can never be classified as groups by data-pre-plain-text alone', () => {
  assert.ok(!source.includes("return !!document.querySelector('#main [data-pre-plain-text]')"), 'the false-positive heuristic must be removed');
});
