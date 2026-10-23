'use strict';
// Audit P2-09 / P2-10 execution-level smoke tests for src/app/js/haituo-translation-pools.js
const test = require('node:test');
const assert = require('node:assert/strict');
const pools = require('../src/app/js/haituo-translation-pools.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const NO_SLEEP = () => Promise.resolve();

function entry(provider, overrides = {}) {
  return { provider, apiKey: 'key-' + provider, endpoint: 'https://endpoint.' + provider, model: 'model-' + provider, enabled: true, vision: false, ...overrides };
}

test('P2-09 fromLegacy: groq migration uses groq defaults, never borrows openai endpoint/model/apiKey', () => {
  const cfg = {
    chatTranslationProvider: 'groq',
    apiKey: 'sk-openai-should-not-bleed',
    endpoint: 'https://openai-proxy.example.com/v1',
    model: 'gpt-4-custom-openai-only',
    groqApiKey: 'gsk_groq_own_key'
  };
  const result = pools.fromLegacy(cfg);
  assert.equal(result.primary.length, 1, 'only the groq entry should be migrated');
  const item = result.primary[0];
  assert.equal(item.provider, 'groq');
  assert.equal(item.endpoint, GROQ_ENDPOINT, 'endpoint must be the groq official OpenAI-compatible endpoint');
  assert.equal(item.model, GROQ_MODEL, 'model must be the in-file groq default');
  assert.equal(item.apiKey, 'gsk_groq_own_key', 'apiKey must come from the groq-specific field only');
  assert.ok(!JSON.stringify(result).includes('sk-openai-should-not-bleed'), 'openai apiKey must not pollute the groq pool item');
  assert.ok(!JSON.stringify(result).includes('openai-proxy.example.com'), 'openai endpoint must not pollute the groq pool item');
  assert.ok(!JSON.stringify(result).includes('gpt-4-custom-openai-only'), 'openai model must not pollute the groq pool item');
  assert.deepEqual(result.backup, []);
});

test('P2-09 fromLegacy: existing translationPools pass through without re-migrating or overwriting keys', () => {
  const existing = {
    primary: [{ provider: 'groq', apiKey: 'gsk_existing_key', endpoint: 'https://custom.groq.example/v1', model: 'llama-3.3-70b-versatile', enabled: false, vision: true }],
    backup: [{ provider: 'openai', apiKey: 'sk_backup_key', endpoint: '', model: '' }]
  };
  const result = pools.fromLegacy({
    chatTranslationProvider: 'openai',
    apiKey: 'sk_legacy_openai',
    endpoint: 'https://legacy-openai.example/v1',
    model: 'legacy-model',
    openaiApiKeys: ['sk_extra_should_not_appear'],
    translationPools: existing
  });
  assert.equal(result.primary.length, 1, 'must not re-migrate legacy openai keys into the pool');
  assert.equal(result.primary[0].provider, 'groq');
  assert.equal(result.primary[0].apiKey, 'gsk_existing_key', 'existing pool key must be preserved');
  assert.equal(result.primary[0].endpoint, 'https://custom.groq.example/v1', 'existing pool endpoint must be preserved');
  assert.equal(result.primary[0].model, 'llama-3.3-70b-versatile', 'existing pool model must be preserved');
  assert.equal(result.primary[0].enabled, false, 'existing enabled flag must be preserved');
  assert.equal(result.primary[0].vision, true, 'existing vision flag must be preserved');
  assert.equal(result.backup.length, 1);
  assert.equal(result.backup[0].apiKey, 'sk_backup_key', 'backup pool key must be preserved');
  assert.ok(!JSON.stringify(result).includes('sk_legacy_openai'), 'legacy cfg.apiKey must not be re-migrated');
  assert.ok(!JSON.stringify(result).includes('sk_extra_should_not_appear'), 'legacy openaiApiKeys must not be re-migrated');
});

test('P2-10 run: TRANSLATION_BAD_JSON (error.code) rethrows immediately, single member call, no failover', async () => {
  const badJson = Object.assign(new Error('翻译服务返回了无法解析的内容（HTTP 200）'), { code: 'TRANSLATION_BAD_JSON', status: 200 });
  const calls = [];
  const translate = async req => { calls.push(req.model); throw badJson; };
  const cfg = { primary: [entry('groq'), entry('openai')], backup: [] };
  await assert.rejects(() => pools.run(cfg, { text: 'hello' }, translate, NO_SLEEP), err => err === badJson);
  assert.deepEqual(calls, ['model-groq'], 'exactly one call, no member switch, no in-place retry');
});

test('P2-10 run: TRANSLATION_BAD_JSON (message-string form) also rethrows immediately', async () => {
  const badJson = new Error('upstream marked this failure as TRANSLATION_BAD_JSON');
  const calls = [];
  const translate = async () => { calls.push(1); throw badJson; };
  const cfg = { primary: [entry('groq'), entry('deepseek')], backup: [entry('openai')] };
  await assert.rejects(() => pools.run(cfg, { text: 'hello' }, translate, NO_SLEEP), err => err === badJson);
  assert.equal(calls.length, 1, 'bad JSON must not be retried across pool members');
});

test('P2-10 run: network errors (ECONNRESET) still fail over across members and throw aggregate 422 (regression)', async () => {
  const calls = [];
  const translate = async req => { calls.push(req.model); const err = new Error('read ECONNRESET'); err.code = 'ECONNRESET'; throw err; };
  const cfg = { primary: [entry('groq'), entry('deepseek')], backup: [] };
  await assert.rejects(
    () => pools.run(cfg, { text: 'hello' }, translate, NO_SLEEP),
    err => {
      assert.equal(err.status, 422, 'aggregate failure keeps its 422 status');
      assert.match(err.message, /主翻译和备用翻译均未成功/);
      assert.match(err.message, /ECONNRESET/);
      return true;
    }
  );
  assert.deepEqual(calls, ['model-groq', 'model-groq', 'model-deepseek', 'model-deepseek'], 'each member still gets its in-place retry before failover');
});

test('sanitize smoke: fills defaults for missing fields, trims, drops bad entries, caps shape', () => {
  const result = pools.sanitize({
    primary: [
      { provider: 'groq', apiKey: '  gsk_trim_me  ' },
      { provider: 'not-a-provider', apiKey: 'bad' },
      null,
      { provider: 'openai' }
    ],
    backup: 'not-an-array'
  });
  assert.equal(result.primary.length, 2, 'invalid provider and null entries are dropped');
  assert.equal(result.primary[0].apiKey, 'gsk_trim_me', 'apiKey is trimmed');
  assert.equal(result.primary[0].endpoint, '');
  assert.equal(result.primary[0].model, '');
  assert.equal(result.primary[0].region, '');
  assert.equal(result.primary[0].enabled, true, 'enabled defaults to true');
  assert.equal(result.primary[0].vision, false, 'vision defaults to false');
  assert.equal(result.primary[1].provider, 'openai');
  assert.equal(result.primary[1].apiKey, '');
  assert.deepEqual(result.backup, [], 'non-array backup normalizes to empty array');
  assert.equal(pools.sanitize(null), undefined);
  assert.equal(pools.sanitize('nope'), undefined);
  const capped = pools.sanitize({ primary: Array.from({ length: 15 }, () => ({ provider: 'groq' })), backup: [] });
  assert.equal(capped.primary.length, 12, 'pool entries capped at 12');
});
