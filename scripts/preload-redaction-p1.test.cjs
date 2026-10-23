'use strict';
// Execution-level regression tests for audit P1-04/P1-05 (renderer side of
// STORE-03):
//   P1-04: the flat secret-field list missed translationPools.primary/backup
//          and screenshotApiPool, so pool API keys reached renderer storage
//          and the wire in plaintext.
//   P1-05: bounced sentinels were resolved by value matching / dedup, merging
//          distinct keys or dropping sentinel entries wholesale.
// The real functions are sliced out of the shipped minified preload bundle
// and run in a vm context, so the tests exercise production code, not
// re-implementations. Sentinels embed the stable config path they replace
// (__HAITUO_REDACTED__:<dotted.path>), mirrored by the main process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'preload', 'main.js'), 'utf8');

function sliceFn(startMarker, endMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = bundle.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end ${endMarker} after ${startMarker}`);
  return bundle.slice(start, end);
}

const redactionCode = sliceFn('const haituoRedactedSecretV', 'function x_()');

const PREFIX = '__HAITUO_REDACTED__';
const sentinel = path => `${PREFIX}:${path}`;

const TOP_LEVEL_SECRET_FIELDS = [ 'apiKey', 'groqApiKey', 'deepLApiKey', 'kepplApiKey', 'deepseekApiKey', 'deepseekApiKeys', 'googleCloudApiKey', 'screenshotApiKey', 'openaiVoiceApiKey' ];

const ORIGINAL = {
  provider: 'deepseek',
  apiKey: 'sk-main-0123456789abcdef',
  groqApiKey: 'gsk-groq-0123456789abcdef',
  deepLApiKey: 'dl-deepl-0123456789abcdef',
  kepplApiKey: 'kp-keppl-0123456789abcdef',
  deepseekApiKey: 'ds-deepseek-0123456789abcdef',
  deepseekApiKeys: 'ds-plural-0123456789abcdef',
  googleCloudApiKey: 'gc-google-0123456789abcdef',
  screenshotApiKey: 'sh-shotkey-0123456789abcdef',
  openaiVoiceApiKey: 'v-voice-0123456789abcdef',
  openaiApiKeys: [ 'sk-openai-aaaaaaaa', 'sk-openai-bbbbbbbb', '' ],
  openaiApiProfiles: [
    { apiKey: 'sk-profile-11111111', endpoint: 'https://a.example.test/v1', model: 'm1' },
    { apiKey: '', endpoint: 'https://b.example.test/v1', model: 'm2' },
    { apiKey: 'sk-profile-33333333', endpoint: '', model: '' }
  ],
  translationPools: {
    primary: [
      { provider: 'openai', apiKey: 'sk-pool-primary-0', endpoint: 'https://p0.example.test/v1', model: 'pm0' },
      { provider: 'deepseek', apiKey: '', endpoint: '', model: '' }
    ],
    backup: [
      { provider: 'groq', apiKey: 'sk-pool-backup-0', endpoint: 'https://b0.example.test/v1', model: 'bm0' }
    ]
  },
  screenshotApiPool: [
    { provider: 'openai', apiKey: 'sk-shot-pool-0', endpoint: 'https://s0.example.test/v1', model: 'sm0' },
    { provider: 'glm', apiKey: '', endpoint: '', model: '' }
  ],
  targetLanguage: 'en',
  chatFontSize: 17,
  nativeTheme: 'dark'
};

const ALL_SECRETS = [
  ORIGINAL.apiKey, ORIGINAL.groqApiKey, ORIGINAL.deepLApiKey, ORIGINAL.kepplApiKey,
  ORIGINAL.deepseekApiKey, ORIGINAL.deepseekApiKeys, ORIGINAL.googleCloudApiKey,
  ORIGINAL.screenshotApiKey, ORIGINAL.openaiVoiceApiKey,
  ...ORIGINAL.openaiApiKeys.filter(Boolean),
  ...ORIGINAL.openaiApiProfiles.map(p => p.apiKey).filter(Boolean),
  ...ORIGINAL.translationPools.primary.map(p => p.apiKey).filter(Boolean),
  ...ORIGINAL.translationPools.backup.map(p => p.apiKey).filter(Boolean),
  ...ORIGINAL.screenshotApiPool.map(p => p.apiKey).filter(Boolean)
];

function makeCtx() {
  const ctx = { console, JSON };
  vm.createContext(ctx);
  vm.runInContext(redactionCode, ctx);
  return ctx;
}

const clone = value => JSON.parse(JSON.stringify(value));

function redact(ctx, cfg) {
  return ctx.haituoRedactConfigSecrets(clone(cfg));
}

function noSentinelLeft(value) {
  assert.ok(!JSON.stringify(value).includes(PREFIX), 'no sentinel string may survive in the output');
}

test('P1-04: every non-empty pool apiKey redacts to a stable path sentinel, never plaintext', () => {
  const ctx = makeCtx();
  const out = redact(ctx, ORIGINAL);
  assert.equal(out.translationPools.primary[0].apiKey, sentinel('translationPools.primary.0'));
  assert.equal(out.translationPools.backup[0].apiKey, sentinel('translationPools.backup.0'));
  assert.equal(out.screenshotApiPool[0].apiKey, sentinel('screenshotApiPool.0'));
  // empty keys stay empty — no sentinel is minted for a missing value
  assert.equal(out.translationPools.primary[1].apiKey, '');
  assert.equal(out.screenshotApiPool[1].apiKey, '');
  const blob = JSON.stringify(out);
  for (const secret of ALL_SECRETS) assert.ok(!blob.includes(secret), `plaintext key leaked into redacted config: ${secret.slice(0, 6)}…`);
});

test('top-level scalar secrets still redact to path sentinels (regression)', () => {
  const ctx = makeCtx();
  const out = redact(ctx, ORIGINAL);
  for (const field of TOP_LEVEL_SECRET_FIELDS) assert.equal(out[field], sentinel(field), field);
  assert.equal(out.openaiApiKeys[0], sentinel('openaiApiKeys.0'));
  assert.equal(out.openaiApiKeys[1], sentinel('openaiApiKeys.1'));
  assert.equal(out.openaiApiProfiles[0].apiKey, sentinel('openaiApiProfiles.0'));
  assert.equal(out.openaiApiProfiles[1].apiKey, '');
  assert.equal(out.openaiApiProfiles[2].apiKey, sentinel('openaiApiProfiles.2'));
  // non-secret fields pass through untouched
  assert.equal(out.targetLanguage, 'en');
  assert.equal(out.chatFontSize, 17);
  assert.equal(out.translationPools.primary[0].endpoint, 'https://p0.example.test/v1');
  assert.equal(out.translationPools.primary[0].model, 'pm0');
});

test('redaction preserves array lengths exactly', () => {
  const ctx = makeCtx();
  const out = redact(ctx, ORIGINAL);
  assert.equal(out.openaiApiKeys.length, 3);
  assert.equal(out.openaiApiProfiles.length, 3);
  assert.equal(out.translationPools.primary.length, 2);
  assert.equal(out.translationPools.backup.length, 1);
  assert.equal(out.screenshotApiPool.length, 2);
  assert.equal(out.openaiApiKeys[2], '', 'empty slot keeps its default, no sentinel');
});

test('P1-05: mixed real and sentinel array entries restore by position, real keys untouched', () => {
  const ctx = makeCtx();
  const cached = { openaiApiKeys: [ 'cached-key-A', 'cached-key-B' ], apiKey: 'cached-main' };
  const out = ctx.haituoUnredactConfigSecrets({
    openaiApiKeys: [ sentinel('openaiApiKeys.0'), 'brand-new-real-key' ],
    apiKey: sentinel('apiKey')
  }, cached);
  assert.deepEqual(JSON.parse(JSON.stringify(out.openaiApiKeys)), [ 'cached-key-A', 'brand-new-real-key' ]);
  assert.equal(out.apiKey, 'cached-main');
  noSentinelLeft(out);
});

test('P1-05: distinct key sentinels are never merged into one', () => {
  const ctx = makeCtx();
  const cached = {
    openaiApiKeys: [ 'key-alpha-unique', 'key-beta-unique' ],
    translationPools: { primary: [ { apiKey: 'pool-alpha-unique' }, { apiKey: 'pool-beta-unique' } ] }
  };
  const out = ctx.haituoUnredactConfigSecrets({
    openaiApiKeys: [ sentinel('openaiApiKeys.0'), sentinel('openaiApiKeys.1') ],
    translationPools: { primary: [ { apiKey: sentinel('translationPools.primary.0') }, { apiKey: sentinel('translationPools.primary.1') } ] }
  }, cached);
  assert.deepEqual(JSON.parse(JSON.stringify(out.openaiApiKeys)), [ 'key-alpha-unique', 'key-beta-unique' ]);
  assert.equal(out.translationPools.primary[0].apiKey, 'pool-alpha-unique');
  assert.equal(out.translationPools.primary[1].apiKey, 'pool-beta-unique');
  noSentinelLeft(out);
});

test('P1-05: a sentinel whose original is gone deletes the field instead of leaking the sentinel', () => {
  const ctx = makeCtx();
  const cached = { deepseekApiKey: 'ds-stored-real', openaiApiKeys: [ 'only-index-0' ] };
  const out = ctx.haituoUnredactConfigSecrets({
    deepseekApiKey: sentinel('deepseekApiKey'),
    groqApiKey: sentinel('groqApiKey'),
    openaiApiKeys: [ sentinel('openaiApiKeys.0'), sentinel('openaiApiKeys.7') ]
  }, cached);
  assert.equal(out.deepseekApiKey, 'ds-stored-real');
  assert.ok(!('groqApiKey' in out), 'field with no cached original must be deleted from the patch');
  assert.deepEqual(JSON.parse(JSON.stringify(out.openaiApiKeys)), [ 'only-index-0' ], 'orphaned sentinel element drops, real neighbor keeps its position');
  noSentinelLeft(out);
});

test('full-config round trip: unredact(redact(original), original) deep-equals the original', () => {
  const ctx = makeCtx();
  const redacted = redact(ctx, ORIGINAL);
  const restored = ctx.haituoUnredactConfigSecrets(clone(redacted), ORIGINAL);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), ORIGINAL);
  noSentinelLeft(restored);
});
