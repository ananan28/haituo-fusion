'use strict';
// The translation cache is rewritten and re-encrypted in full on every save,
// so an unbounded map would keep growing disk and CPU use forever. The cap
// keeps the newest entries and is applied on load, save and in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');
const start = bundle.indexOf('const HaituoTranslationCacheLimit = 2000;');
const end = bundle.indexOf('function haituoTranslationCacheKey(', start);
assert.notEqual(start, -1, 'missing cache limit constants');
assert.notEqual(end, -1, 'missing cache key function');
const cacheCode = bundle.slice(start, end);

function makeCtx(fileCache = {}) {
  const writes = [];
  const ctx = {
    console, JSON, Number, Object, Array, Error,
    HaituoTranslationCachePath: '/Haituo/translation-cache.json',
    haituoProtectedRead: () => fileCache,
    haituoProtectedWrite: (file, data) => { writes.push([file, data]); return true; },
  };
  vm.createContext(ctx);
  vm.runInContext('var HaituoTranslationCache;', ctx);
  vm.runInContext(cacheCode, ctx);
  ctx.__writes = writes;
  return ctx;
}

test('the cache keeps only the newest 2000 entries', () => {
  const ctx = makeCtx();
  vm.runInContext(
    `HaituoTranslationCache = Object.fromEntries(Array.from({ length: 2005 }, (_, i) => ['k' + i, { text: 't' + i, updatedAt: i }]))`,
    ctx
  );
  vm.runInContext('haituoTrimTranslationCache()', ctx);
  assert.equal(vm.runInContext('Object.keys(HaituoTranslationCache).length', ctx), 2000);
  const boundary = vm.runInContext(
    `HaituoTranslationCache.k4 === undefined && HaituoTranslationCache.k5?.text === 't5' && HaituoTranslationCache.k2004?.text === 't2004'`,
    ctx
  );
  assert.equal(boundary, true, 'the five oldest entries are evicted, the newest are kept');
});

test('loading an oversized cache file trims it before first use', () => {
  const fileCache = Object.fromEntries(Array.from({ length: 2100 }, (_, i) => ['k' + i, { updatedAt: i }]));
  const ctx = makeCtx(fileCache);
  assert.equal(vm.runInContext('Object.keys(loadHaituoTranslationCache()).length', ctx), 2000);
});

test('saving persists the trimmed cache, not the oversized in-memory map', () => {
  const ctx = makeCtx();
  vm.runInContext(
    `HaituoTranslationCache = Object.fromEntries(Array.from({ length: 2003 }, (_, i) => ['k' + i, { updatedAt: i }])); saveHaituoTranslationCache()`,
    ctx
  );
  assert.equal(ctx.__writes.length, 1, 'the trimmed cache is written once');
  assert.equal(ctx.__writes[0][0], '/Haituo/translation-cache.json');
  assert.equal(Object.keys(ctx.__writes[0][1]).length, 2000);
});
