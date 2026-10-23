'use strict';
// NET-01: a deterministic BAD_JSON from a billed 200 response must not be
// retried at the outer layer (each retry re-bills the paid endpoint).
// NET-02: system SOCKS5 proxy routes must be honoured, not dropped to direct.
// Both run against the real src/app/js/haituo-network.js module.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const HaituoNetwork = require(path.join(__dirname, '..', 'src', 'app', 'js', 'haituo-network.js'));

test('NET-01: TRANSLATION_BAD_JSON is not retried by retryTranslation', async () => {
  let calls = 0;
  const badJson = Error('翻译服务返回了无法解析的内容（HTTP 200）');
  badJson.code = 'TRANSLATION_BAD_JSON';
  badJson.status = 200;
  const work = async () => { calls += 1; throw badJson; };
  await assert.rejects(() => HaituoNetwork.retryTranslation(work, () => Promise.resolve()), /无法解析/u);
  assert.equal(calls, 1, 'a billed 200 parse failure must not be re-requested');
});

test('NET-01: transient network errors are still retried', async () => {
  let calls = 0;
  const down = Error('fetch failed');
  const work = async () => { calls += 1; if (calls < 3) throw down; return { text: 'ok' }; };
  const result = await HaituoNetwork.retryTranslation(work, () => Promise.resolve());
  assert.equal(result.text, 'ok');
  assert.equal(calls, 3);
});

test('NET-01: requestJSON tags unparseable 200 bodies as TRANSLATION_BAD_JSON', async () => {
  const fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  const error = await HaituoNetwork.requestJSON(fetcher, 'https://api.example.com/v1/chat/completions', {}, 1000, () => Promise.resolve(), 1).catch(e => e);
  assert.equal(error.code, 'TRANSLATION_BAD_JSON');
  assert.equal(error.status, 200);
});

test('NET-02: SOCKS5 system proxy routes resolve to a socks5:// URL', async () => {
  const session = { resolveProxy: async () => 'SOCKS5 127.0.0.1:1080;DIRECT' };
  const url = await HaituoNetwork.resolveSignalProxy(session, 'https://example.com');
  assert.equal(url, 'socks5://127.0.0.1:1080');
});

test('NET-02: PROXY and HTTPS routes keep working', async () => {
  const proxySession = { resolveProxy: async () => 'PROXY 10.0.0.1:8080' };
  assert.equal(await HaituoNetwork.resolveSignalProxy(proxySession, 'https://example.com'), 'http://10.0.0.1:8080');
  const httpsSession = { resolveProxy: async () => 'HTTPS 10.0.0.2:8443' };
  assert.equal(await HaituoNetwork.resolveSignalProxy(httpsSession, 'https://example.com'), 'https://10.0.0.2:8443');
});

test('NET-02: DIRECT routes resolve to undefined (explicit direct, not silent guess)', async () => {
  const session = { resolveProxy: async () => 'DIRECT' };
  assert.equal(await HaituoNetwork.resolveSignalProxy(session, 'https://example.com'), undefined);
});
