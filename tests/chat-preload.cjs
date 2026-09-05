const assert = require('node:assert/strict'); const fs = require('node:fs'); const { JSDOM } = require('jsdom'); const { EventEmitter } = require('node:events');
const ipc = new EventEmitter(); const requests = []; const pending = [];
ipc.invoke = async (channel, ...args) => { requests.push({ channel, args }); if (channel === 'signal:surface-translate') return new Promise(resolve => pending.push(resolve)); };
const dom = new JSDOM(fs.readFileSync('public/signal-chat.html', 'utf8'), { runScripts: 'outside-only', url: 'https://local.test/signal-chat.html?sessionId=signal-1' });
const w = dom.window; w.mockRequire = name => { assert.equal(name, 'electron'); return { ipcRenderer: ipc }; };
w.eval('(function(require,exports){' + fs.readFileSync('dist-electron/signalChatPreload.js', 'utf8') + '\n})(window.mockRequire,{})');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function emit(conversationId, messages, extra = {}) { ipc.emit('signal:surface-messages', null, { conversationId, messages, bilingual: true, color: '#55baff', fontSize: 14, autoHistory: true, ...extra }); }
(async () => {
  await tick();
  const msg = { id: 'm1', direction: 'in', text: '<img src=x onerror="alert(1)">', sender: 'Contact', at: 1 };
  emit('contact:1', [msg]); await tick();
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].args, ['contact:1', 'm1']);
  assert.equal(w.document.querySelector('img'), null); assert.ok(w.document.querySelector('.body').textContent.includes('<img'));
  emit('contact:1', [msg]); await tick(); assert.equal(requests.length, 1, 'repeat DOM update does not duplicate translation');
  pending.shift()({ translatedText: '<script>danger()</script>' }); await tick();
  assert.equal(w.document.querySelector('script'), null); assert.equal(w.document.querySelector('.translation').textContent, '<script>danger()</script>');
  emit('contact:1', [{ ...msg, translatedText: '译文' }], { bilingual: false }); await tick(); assert.equal(w.document.querySelector('.translation').hidden, true);
  emit('contact:1', [{ ...msg, id: 'm2', text: 'waiting' }]); await tick();
  emit('contact:2', []); await tick(); pending.shift()({ translatedText: 'old result' }); await tick(); assert.equal(w.document.querySelector('.translation'), null);
  emit('contact:2', [{ ...msg, id: 'history' }], { autoHistory: false }); await tick();
  // Live appended messages still translate even if historical backfill is disabled.
  assert.equal(requests.at(-1).args[1], 'history'); pending.shift()({ translatedText: 'live' }); await tick();
  w.dispatchEvent(new w.Event('unload')); assert.equal(ipc.listenerCount('signal:surface-messages'), 0);
  console.log('PASS: MutationObserver translation, ID-only IPC, duplicate suppression, textContent XSS resistance, bilingual preference, stale result isolation, cleanup.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => w.close());
