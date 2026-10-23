'use strict';
// User report: three configured APIs where API1 and API2 are empty must not
// stop dispatch — the pool has to skip them, use API3, and only then fall to
// the backup group. Chat, input and AI retranslate all share this same order.
const test = require('node:test');
const assert = require('node:assert/strict');
const pools = require('../src/app/js/haituo-translation-pools.js');

const NO_SLEEP = () => Promise.resolve();

function entry(provider, apiKey, suffix, overrides = {}) {
  return {
    provider,
    apiKey,
    endpoint: 'https://' + suffix + '.test/v1',
    model: 'model-' + suffix,
    enabled: true,
    ...overrides,
  };
}

test('empty API1/API2 are skipped and API3 is used', async () => {
  const calls = [];
  const cfg = {
    primary: [entry('openai', '', 'api1'), entry('openai', '', 'api2'), entry('deepseek', 'key-3', 'api3')],
    backup: [entry('glm', 'key-backup', 'backup')],
  };
  const result = await pools.run(cfg, { text: '你好', targetLanguage: 'en' }, async req => {
    calls.push(req);
    return { text: 'hello' };
  }, NO_SLEEP);
  assert.equal(calls.length, 1, 'empty entries must not send a request and must not stop the loop');
  assert.equal(calls[0].apiKey, 'key-3', 'API3 credentials are used');
  assert.equal(calls[0].endpoint, 'https://api3.test/v1');
  assert.equal(calls[0].model, 'model-api3');
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.pool, 'primary');
});

test('when every primary entry is empty the backup group is used', async () => {
  const calls = [];
  const cfg = {
    primary: [entry('openai', '', 'api1'), entry('openai', '', 'api2')],
    backup: [entry('glm', 'key-backup', 'backup')],
  };
  const result = await pools.run(cfg, { text: '你好' }, async req => {
    calls.push(req);
    return { text: 'hello' };
  }, NO_SLEEP);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'key-backup');
  assert.equal(result.pool, 'backup');
  assert.equal(result.fallbackFrom, 'openai', 'the attempted primary provider is reported');
});

test('a failing API3 falls over to the backup group and reports the real failing provider', async () => {
  const calls = [];
  const cfg = {
    primary: [entry('openai', '', 'api1'), entry('deepseek', 'key-3', 'api3')],
    backup: [entry('glm', 'key-backup', 'backup')],
  };
  const result = await pools.run(cfg, { text: '你好' }, async req => {
    calls.push(req);
    if (req.apiKey === 'key-3') {
      const error = new Error('read ECONNRESET');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { text: 'hello' };
  }, NO_SLEEP);
  assert.deepEqual(calls.map(call => call.apiKey), ['key-3', 'key-3', 'key-backup']);
  assert.equal(result.pool, 'backup');
  assert.equal(result.fallbackFrom, 'deepseek', 'fallbackFrom must name the provider that actually failed');
  assert.match(result.fallbackReason, /ECONNRESET/);
});

test('paused entries are skipped without a request', async () => {
  const calls = [];
  const cfg = {
    primary: [entry('deepseek', 'key-paused', 'paused', { enabled: false }), entry('glm', 'key-live', 'live')],
    backup: [],
  };
  const result = await pools.run(cfg, { text: '你好' }, async req => {
    calls.push(req);
    return { text: 'hello' };
  }, NO_SLEEP);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'key-live');
  assert.equal(result.provider, 'glm');
});

test('AI retranslate keeps its request (forceRefresh, purpose) but runs through primary then backup', async () => {
  const calls = [];
  const cfg = {
    primary: [entry('openai', '', 'api1'), entry('deepseek', 'key-3', 'api3')],
    backup: [entry('glm', 'key-backup', 'backup')],
  };
  const result = await pools.run(cfg, {
    text: '你好',
    targetLanguage: 'en',
    provider: 'smart-retranslate',
    purpose: 'input',
    forceRefresh: true,
  }, async req => {
    calls.push(req);
    return { text: 'hello there' };
  }, NO_SLEEP);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'key-3', 'retranslate uses the first configured primary model');
  assert.equal(calls[0].forceRefresh, true, 'retranslate must not silently reuse the cache');
  assert.equal(calls[0].purpose, 'input');
  assert.equal(calls[0].translationPools, undefined, 'pool dispatch must not recurse into itself');
  assert.equal(result.provider, 'deepseek');
});
