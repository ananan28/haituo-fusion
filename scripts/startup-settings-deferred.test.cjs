'use strict';
// Execution-level regression tests for P0-02 of 1.5.0:
//   pre-ready encrypted settings reads must DEFER (return the fallback and
//   register the file for post-ready recovery) instead of running the old
//   synchronous retry loop that froze app ready for ~2.75s and made every
//   restart wipe settings; writes must be gated behind a successful read so
//   an unreadable ciphertext can never be "repaired" by overwriting it with
//   in-memory defaults; once the app is ready, deferred/undecryptable files
//   must be recovered — from the main file or from an `.unreadable-*` backup —
//   without ever blocking the event loop (no Atomics.wait / sleepSync).
// Real code is sliced out of the shipped minified bundle and run in a vm
// context, so the tests exercise production code, not re-implementations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');

function sliceFn(startMarker, endMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = bundle.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end ${endMarker} after ${startMarker}`);
  return bundle.slice(start, end);
}

function sliceBalanced(startMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  let depth = 0, inString = null, inTemplate = false;
  for (let i = start; i < bundle.length; i += 1) {
    const ch = bundle[i], prev = bundle[i - 1];
    if (inString) { if (ch === inString && prev !== '\\') inString = null; continue; }
    if (inTemplate) { if (ch === '`' && prev !== '\\') inTemplate = false; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return bundle.slice(start, i + 1); }
  }
  throw Error(`unbalanced ${startMarker}`);
}

const decryptPayloadCode = sliceFn('function haituoDecryptProtectedPayload', 'async function haituoDecryptAfterReady');
const decryptAfterReadyCode = sliceFn('async function haituoDecryptAfterReady', 'function haituoArmSqlInitWatchdog');
const listBackupsCode = sliceFn('function haituoListProtectedBackups', 'async function haituoRecoverProtectedFile');
const recoverFileCode = sliceFn('async function haituoRecoverProtectedFile', 'async function haituoRecoverDeferredProtectedReads');
const recoverDeferredCode = sliceFn('async function haituoRecoverDeferredProtectedReads', 'function haituoProtectedRead');
const protectedReadCode = sliceFn('function haituoProtectedRead', 'function haituoProtectedWrite');
const protectedWriteCode = sliceFn('function haituoProtectedWrite', 'let HaituoTranslationCache;');
void sliceBalanced; // same slicing toolkit as startup-settings-sync.test.cjs

const slicedCode = `var HaituoTranslationCache;\n` + [
  decryptPayloadCode,
  decryptAfterReadyCode,
  listBackupsCode,
  recoverFileCode,
  recoverDeferredCode,
  protectedReadCode,
  protectedWriteCode,
].join(`\n`);

function recorder() {
  const entries = [];
  return {
    entries,
    warn: (...args) => entries.push(['warn', ...args]),
    info: (...args) => entries.push(['info', ...args]),
    error: (...args) => entries.push(['error', ...args]),
  };
}

function b64tag(tag) {
  return Buffer.from(tag, 'utf8').toString('base64');
}

function writeEncrypted(file, tag) {
  fs.writeFileSync(file, JSON.stringify({ haituoEncrypted: 1, data: b64tag(tag) }));
}

// Tag-based fake keychain: 'FAIL...' payloads simulate a keychain denial,
// 'CFG:<json>' payloads simulate a successful decrypt of <json>.
function tagDecrypt(data) {
  const tag = data.toString('utf8');
  if (tag.startsWith('FAIL')) throw Error('keychain denied (mock)');
  if (tag.startsWith('CFG:')) return tag.slice(4);
  throw Error(`unexpected payload: ${tag}`);
}

function jsonEq(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function makeCtx({ platform = 'darwin' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haituo-p002-'));
  const log = recorder();
  const state = { appReady: false };
  const controller = { decrypt: () => { throw Error('keychain unavailable (mock)'); } };
  const applyCalls = [];
  const dialogs = [];
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Buffer, Promise, Map, Set, Symbol,
    setTimeout, clearTimeout,
    Atomics: new Proxy({}, {
      get(target, prop) {
        if (prop === 'wait') throw Error('Atomics.wait must not be used by the deferred read path');
        return Reflect.get(target, prop);
      },
    }),
    process: { pid: 987654, platform },
    $u: 'signal-main',
    $p: () => ({ provider: 'google-free', chatTranslationProvider: 'google-free' }),
    X: log,
    m: {
      readFileSync: fs.readFileSync,
      mkdirSync: fs.mkdirSync,
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
      renameSync: fs.renameSync,
      copyFileSync: fs.copyFileSync,
      writeFileSync: fs.writeFileSync,
    },
    s: { basename: path.basename, dirname: path.dirname, join: path.join },
    p: {
      app: { isReady: () => state.appReady, getPath: () => tmp },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: plain => Buffer.concat([Buffer.from('enc:'), Buffer.from(String(plain))]),
        decryptString: data => controller.decrypt(data),
      },
      dialog: { showMessageBox: opts => { dialogs.push(opts); return Promise.resolve({ response: 0 }); } },
    },
    haituoAppReady: () => state.appReady,
    haituoProtectedDescribeError: error => String(error && error.code || error && error.message || error || ''),
    haituoApplyTranslationConfig: value => { applyCalls.push(value); return { ok: true }; },
    haituoSleepSync: () => { throw Error('haituoSleepSync must not be used by the deferred read path'); },
    Qp: path.join(tmp, 'translation-settings.json'),
    HaituoTranslationCachePath: path.join(tmp, 'translation-cache.json'),
    HaituoProtectedDeferred: new Map(),
    HaituoProtectedBlockedFiles: new Set(),
    HaituoProtectedReadOk: new Set(),
    HaituoProtectedBackupDone: new Set(),
    HaituoTranslationCache: undefined,
  };
  ctx.__tmp = tmp;
  ctx.__state = state;
  ctx.__controller = controller;
  ctx.__log = log;
  ctx.__applyCalls = applyCalls;
  ctx.__dialogs = dialogs;
  vm.createContext(ctx);
  vm.runInContext(slicedCode, ctx);
  return ctx;
}

function cleanup(ctx) {
  fs.rmSync(ctx.__tmp, { recursive: true, force: true });
}

function warns(ctx) {
  return ctx.__log.entries.filter(e => e[0] === 'warn').map(e => String(e[1]));
}

function warnsOrErrors(ctx) {
  return ctx.__log.entries.filter(e => e[0] === 'warn' || e[0] === 'error').map(e => String(e[1]));
}

function infos(ctx) {
  return ctx.__log.entries.filter(e => e[0] === 'info').map(e => String(e[1]));
}

test('P0-02 pre-ready encrypted read: immediate fallback, deferred registration, no blocking, disk untouched', () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    writeEncrypted(file, 'FAIL:whatever');
    const before = fs.readFileSync(file, 'utf8');
    const fallback = { provider: 'fallback-provider' };
    const started = Date.now();
    const result = vm.runInContext(`haituoProtectedRead(Qp, ${JSON.stringify(fallback)})`, ctx);
    const elapsed = Date.now() - started;
    jsonEq(result, fallback, 'read must return the fallback immediately');
    assert.ok(elapsed < 300, `read took ${elapsed}ms; the deferred path must not block`);
    assert.ok(ctx.HaituoProtectedDeferred.has(file), 'file must be registered for post-ready recovery');
    assert.ok(!ctx.HaituoProtectedReadOk.has(file), 'a deferred read must not unlock writes');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'ciphertext on disk must be untouched');
    assert.ok(infos(ctx).some(m => m.includes('read deferred until app ready')), 'deferral must be logged');
  } finally { cleanup(ctx); }
});

test('P0-02 audit reproduction: pre-ready read plus ready-time recovery finish far below the old 2.75s freeze', async () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    const realConfig = { provider: 'deepl', chatTextColor: '#123abc' };
    writeEncrypted(file, `CFG:${JSON.stringify(realConfig)}`);
    const started = Date.now();
    vm.runInContext('haituoProtectedRead(Qp, { provider: `fallback-provider` })', ctx);
    assert.ok(ctx.HaituoProtectedDeferred.has(file), 'pre-ready read must defer');
    setTimeout(() => { ctx.__state.appReady = true; }, 100);
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.equal(ctx.__state.appReady, true, 'app must be ready before recovery runs');
    ctx.__controller.decrypt = tagDecrypt;
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 400, `full cycle took ${elapsed}ms; the old blocking implementation needed ~2.75s`);
    assert.equal(ctx.__applyCalls.length, 1, 'recovered config must be applied exactly once');
    jsonEq(ctx.__applyCalls[0], realConfig, 'applied config must be the real on-disk config, not defaults');
    assert.equal(ctx.HaituoProtectedDeferred.size, 0, 'deferred set must be drained after recovery');
    assert.ok(ctx.HaituoProtectedReadOk.has(file));
  } finally { cleanup(ctx); }
});

test('P0-02 write gate: a deferred file is refused with "refusing to overwrite" and bytes stay identical', () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    writeEncrypted(file, 'FAIL:whatever');
    const before = fs.readFileSync(file, 'utf8');
    vm.runInContext('haituoProtectedRead(Qp, { provider: `fallback-provider` })', ctx);
    assert.ok(ctx.HaituoProtectedDeferred.has(file));
    const ok = vm.runInContext('haituoProtectedWrite(Qp, { provider: `new-provider` })', ctx);
    assert.equal(ok, false, 'write must be refused while the file is deferred');
    assert.ok(warns(ctx).some(m => m.includes('refusing to overwrite')), 'refusal must be logged');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'refused write must leave bytes untouched');
  } finally { cleanup(ctx); }
});

test('P0-02 ENOENT: absent file joins ReadOk so the first real save is allowed and lands on disk', () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    const fallback = { provider: 'fallback-provider' };
    const result = vm.runInContext(`haituoProtectedRead(Qp, ${JSON.stringify(fallback)})`, ctx);
    jsonEq(result, fallback);
    assert.ok(ctx.HaituoProtectedReadOk.has(file), 'a genuinely absent file must not gate writes');
    const ok = vm.runInContext('haituoProtectedWrite(Qp, { provider: `written-provider` })', ctx);
    assert.equal(ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ provider: 'written-provider' }), 'write must really land on disk');
  } finally { cleanup(ctx); }
});

test('P0-02 plaintext JSON object: joins ReadOk and unlocks an overwrite', () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    fs.writeFileSync(file, JSON.stringify({ provider: 'google-free', chatTextColor: '#111111' }));
    const result = vm.runInContext('haituoProtectedRead(Qp, { provider: `fallback-provider` })', ctx);
    jsonEq(result, { provider: 'google-free', chatTextColor: '#111111' });
    assert.ok(ctx.HaituoProtectedReadOk.has(file));
    assert.ok(!ctx.HaituoProtectedBlockedFiles.has(file));
    const ok = vm.runInContext('haituoProtectedWrite(Qp, { provider: `deepl` })', ctx);
    assert.equal(ok, true);
    jsonEq(JSON.parse(fs.readFileSync(file, 'utf8')), { provider: 'deepl' }, 'new value must replace the plaintext');
    assert.ok(ctx.HaituoProtectedReadOk.has(file), 'file stays writable after a verified read');
  } finally { cleanup(ctx); }
});

test('P0-02 post-ready recovery: deferred settings file decrypts and haituoApplyTranslationConfig receives the real config', async () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    const realConfig = { provider: 'openai', endpoint: 'https://example.test' };
    writeEncrypted(file, `CFG:${JSON.stringify(realConfig)}`);
    vm.runInContext('haituoProtectedRead(Qp, { provider: `fallback-provider` })', ctx);
    assert.ok(ctx.HaituoProtectedDeferred.has(file));
    ctx.__state.appReady = true;
    ctx.__controller.decrypt = tagDecrypt;
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    assert.equal(ctx.__applyCalls.length, 1, 'recovered config must be applied exactly once');
    jsonEq(ctx.__applyCalls[0], realConfig);
    assert.ok(ctx.HaituoProtectedReadOk.has(file), 'recovered file joins ReadOk');
    assert.equal(ctx.HaituoProtectedDeferred.size, 0, 'deferred set must be drained');
    assert.ok(!ctx.HaituoProtectedBlockedFiles.has(file));
    assert.ok(infos(ctx).some(m => m.includes('recovered encrypted translation settings')), 'recovery must be logged');
  } finally { cleanup(ctx); }
});

test('P0-02 backup recovery: undecryptable main file is restored from .unreadable-1000 with a "settings restored from backup" dialog', async () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    const backupConfig = { provider: 'backup-provider' };
    writeEncrypted(file, 'FAIL:main');
    fs.writeFileSync(`${file}.unreadable-1000`, JSON.stringify({ haituoEncrypted: 1, data: b64tag(`CFG:${JSON.stringify(backupConfig)}`) }));
    ctx.__state.appReady = true;
    ctx.__controller.decrypt = tagDecrypt;
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    assert.equal(ctx.__applyCalls.length, 1, 'backup content must be applied');
    jsonEq(ctx.__applyCalls[0], backupConfig, 'applied config must come from the backup');
    assert.ok(warns(ctx).some(m => m.includes('restoring settings from backup')), 'backup restore must be logged');
    assert.equal(ctx.__dialogs.length, 1, 'user must be told the settings came from a backup');
    assert.ok(String(ctx.__dialogs[0].title).includes('设置已从备份恢复'), `dialog title was: ${ctx.__dialogs[0].title}`);
    assert.ok(ctx.HaituoProtectedReadOk.has(file));
  } finally { cleanup(ctx); }
});

test('P0-02 persistent denial: main file and backup stay on disk, never join ReadOk, and the refusal is logged', async () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    writeEncrypted(file, 'FAIL:main');
    fs.writeFileSync(`${file}.unreadable-1000`, JSON.stringify({ haituoEncrypted: 1, data: b64tag('FAIL:backup') }));
    const beforeMain = fs.readFileSync(file, 'utf8');
    const beforeBackup = fs.readFileSync(`${file}.unreadable-1000`, 'utf8');
    ctx.__state.appReady = true;
    ctx.__controller.decrypt = () => { throw Error('keychain denied (mock)'); };
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    assert.equal(fs.readFileSync(file, 'utf8'), beforeMain, 'main ciphertext must survive a failed recovery');
    assert.equal(fs.readFileSync(`${file}.unreadable-1000`, 'utf8'), beforeBackup, 'backup must survive a failed recovery');
    assert.ok(!ctx.HaituoProtectedReadOk.has(file), 'a never-decryptable file must never unlock writes');
    assert.ok(warnsOrErrors(ctx).some(m => m.includes('and its backups are unreadable')), 'persistent denial must be logged');
  } finally { cleanup(ctx); }
});

test('P0-02b Windows: a settings file that can never decrypt is preserved verbatim and replaced with a fresh saveable config', async () => {
  const ctx = makeCtx({ platform: 'win32' });
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    writeEncrypted(file, 'FAIL:main');
    fs.writeFileSync(`${file}.unreadable-1000`, JSON.stringify({ haituoEncrypted: 1, data: b64tag('FAIL:backup') }));
    const beforeMain = fs.readFileSync(file, 'utf8');
    ctx.__state.appReady = true;
    ctx.__controller.decrypt = () => { throw Error('wrong DPAPI key (mock)'); };
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    assert.equal(fs.existsSync(file), false, 'the poisoned path must be cleared so fresh saves can land');
    const preserved = fs.readdirSync(ctx.__tmp).filter(name => /^translation-settings\.json\.unreadable-\d+$/u.test(name)).sort();
    assert.ok(preserved.length >= 1, 'the undecryptable file must be preserved, never deleted');
    assert.equal(fs.readFileSync(path.join(ctx.__tmp, preserved.at(-1)), 'utf8'), beforeMain, 'preserved copy must be byte-identical');
    assert.ok(ctx.HaituoProtectedReadOk.has(file), 'writes must be allowed again');
    assert.equal(ctx.__applyCalls.length, 1, 'a fresh default config must be applied');
    assert.equal(ctx.__applyCalls[0].provider, 'google-free');
    assert.equal(ctx.__dialogs.length, 1, 'the user must be told the old file is preserved');
    assert.ok(String(ctx.__dialogs[0].title).includes('设置文件无法解密'), `dialog title was: ${ctx.__dialogs[0].title}`);
    assert.ok(warns(ctx).some(m => m.includes('preserved the old file as')), 'quarantine must be logged');
  } finally { cleanup(ctx); }
});

test('P0-02 corrupt JSON: read returns fallback, file joins Blocked, and the write is refused', () => {
  const ctx = makeCtx();
  try {
    const file = path.join(ctx.__tmp, 'translation-settings.json');
    fs.writeFileSync(file, '{ not valid json');
    const before = fs.readFileSync(file, 'utf8');
    const result = vm.runInContext('haituoProtectedRead(Qp, { provider: `fallback-provider` })', ctx);
    jsonEq(result, { provider: 'fallback-provider' });
    assert.ok(ctx.HaituoProtectedBlockedFiles.has(file), 'corrupt file must be marked blocked');
    assert.ok(!ctx.HaituoProtectedReadOk.has(file));
    const ok = vm.runInContext('haituoProtectedWrite(Qp, { provider: `new` })', ctx);
    assert.equal(ok, false, 'corrupt file must not be overwritten');
    assert.ok(warns(ctx).some(m => m.includes('refusing to overwrite')));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'corrupt bytes must stay recoverable by hand');
  } finally { cleanup(ctx); }
});

test('P0-02 deferred translation cache: post-ready recovery fills HaituoTranslationCache with the decrypted value', async () => {
  const ctx = makeCtx();
  try {
    const file = ctx.HaituoTranslationCachePath;
    const cacheValue = { 'zh|en|hello': { text: '你好', provider: 'google-free' } };
    writeEncrypted(file, `CFG:${JSON.stringify(cacheValue)}`);
    vm.runInContext('haituoProtectedRead(HaituoTranslationCachePath, {})', ctx);
    assert.ok(ctx.HaituoProtectedDeferred.has(file), 'pre-ready cache read must defer');
    ctx.__state.appReady = true;
    ctx.__controller.decrypt = tagDecrypt;
    await vm.runInContext('haituoRecoverDeferredProtectedReads()', ctx);
    const cached = vm.runInContext('HaituoTranslationCache', ctx);
    jsonEq(cached, cacheValue, 'in-memory cache must hold the decrypted value');
    assert.equal(ctx.__applyCalls.length, 0, 'cache recovery must not go through apply');
    assert.ok(infos(ctx).some(m => m.includes('recovered encrypted translation cache')), 'cache recovery must be logged');
    assert.ok(ctx.HaituoProtectedReadOk.has(file));
    assert.equal(ctx.HaituoProtectedDeferred.size, 0);
  } finally { cleanup(ctx); }
});
