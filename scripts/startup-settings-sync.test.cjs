'use strict';
// Execution-level regression tests for audit batch 2 of 1.5.0:
//   R2: per-stage startup diagnostics (settings decrypt retry logs, sql.init
//       watchdog dialog instead of an endless loading spinner),
//   R3: monotonic config version stamp rejects stale write-back from child
//       windows instead of racing over newer settings.
// Real code is sliced out of the shipped minified bundle and run in a vm
// context, so the tests exercise production code, not re-implementations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

// P0-02: the old blocking pre-ready retry (haituoDecryptWithStartupRetry +
// Atomics.wait) froze the ready event and wiped settings on every restart.
// The bundle must now defer encrypted reads pre-ready (never blocking, never
// even attempting decrypt) and only decrypt single-shot once ready.
const readyCode = sliceFn('function haituoAppReady', 'function haituoDecryptProtectedPayload');
const describeCode = sliceFn('function haituoProtectedDescribeError', 'function haituoAppReady');
const decryptPayloadCode = sliceFn('function haituoDecryptProtectedPayload', 'async function haituoDecryptAfterReady');
const protectedReadCode = sliceFn('function haituoProtectedRead(file, fallback)', 'function haituoProtectedWrite');
const watchdogCode = sliceBalanced('function haituoArmSqlInitWatchdog');
const versionCode = `var HaituoConfigVersion = 0;\n` + sliceBalanced('function haituoNextConfigVersion');
const setHandlerCode = sliceFn(
  'p.ipcMain.handle(`caisheng:set-translation-config`',
  ', p.ipcMain.removeHandler(`caisheng:get-translation-config`)'
);
const childHandlerCode = sliceFn(
  'if ($u !== `signal-main`) process.on(`message`, value => {',
  '\nif(process.env.HAITUO_SETTINGS_TEST'
).trim();
const applyCode = sliceBalanced('function haituoApplyTranslationConfig');

function recorder() {
  const entries = [];
  return {
    entries,
    warn: (...args) => entries.push(['warn', ...args]),
    info: (...args) => entries.push(['info', ...args]),
    error: (...args) => entries.push(['error', ...args]),
  };
}

function makeProtectedReadCtx({ appReady = false, decryptError = null } = {}) {
  const log = recorder();
  let decryptCalls = 0;
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Buffer, Promise, setTimeout, clearTimeout,
    p: {
      app: { isReady: () => appReady },
      safeStorage: {
        decryptString: data => {
          decryptCalls += 1;
          if (decryptError) throw decryptError;
          return `{"chatTranslationProvider":"deepl","targetLanguage":"fr","__real":1}`;
        },
      },
    },
    m: { readFileSync: null },
    s: { basename: f => String(f).split('/').pop(), dirname: f => String(f).slice(0, String(f).lastIndexOf('/')) || '/', join: (...parts) => parts.join('/') },
    X: log,
    __files: new Map(),
  };
  ctx.m.readFileSync = file => {
    if (!ctx.__files.has(file)) {
      const error = new Error(`ENOENT: no such file`);
      error.code = 'ENOENT';
      throw error;
    }
    return ctx.__files.get(file);
  };
  ctx.__log = log;
  ctx.__decryptCalls = () => decryptCalls;
  vm.createContext(ctx);
  vm.runInContext(
    `var HaituoProtectedBlockedFiles = new Set(), HaituoProtectedReadOk = new Set(), HaituoProtectedDeferred = new Map();\n` +
    describeCode + readyCode + decryptPayloadCode + protectedReadCode,
    ctx
  );
  return ctx;
}

test('P0-02: pre-ready encrypted read defers without blocking and never attempts decrypt', () => {
  const ctx = makeProtectedReadCtx({ appReady: false, decryptError: Error('safeStorage cannot be used before app is ready') });
  ctx.__files.set('/cfg/translation-settings.json', JSON.stringify({ haituoEncrypted: 1, data: 'AAAA' }));
  const started = Date.now();
  const result = vm.runInContext(`haituoProtectedRead('/cfg/translation-settings.json', {})`, ctx);
  const elapsed = Date.now() - started;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {}, 'fallback returned immediately');
  assert.ok(elapsed < 300, `pre-ready read must not block (took ${elapsed}ms; the old loop burned 2.75s)`);
  assert.equal(ctx.__decryptCalls(), 0, 'pre-ready read must not even attempt decrypt');
  const deferred = vm.runInContext(`HaituoProtectedDeferred.has('/cfg/translation-settings.json')`, ctx);
  assert.equal(deferred, true, 'file must be registered for post-ready recovery');
  const readOk = vm.runInContext(`HaituoProtectedReadOk.has('/cfg/translation-settings.json')`, ctx);
  assert.equal(readOk, false, 'a deferred file must not be writable');
  const infos = ctx.__log.entries.filter(e => e[0] === 'info').map(e => String(e[1]));
  assert.ok(infos.some(w => w.includes('read deferred until app ready')), 'deferral must be logged');
});

test('P0-02: post-ready encrypted read decrypts single-shot and opens the write gate', () => {
  const ctx = makeProtectedReadCtx({ appReady: true });
  ctx.__files.set('/cfg/translation-settings.json', JSON.stringify({ haituoEncrypted: 1, data: 'AAAA' }));
  const result = vm.runInContext(`haituoProtectedRead('/cfg/translation-settings.json', {})`, ctx);
  assert.equal(result.__real, 1, 'real decrypted config returned');
  assert.equal(result.targetLanguage, 'fr');
  assert.equal(ctx.__decryptCalls(), 1, 'single-shot decrypt once ready');
  const readOk = vm.runInContext(`HaituoProtectedReadOk.has('/cfg/translation-settings.json')`, ctx);
  assert.equal(readOk, true);
});

test('P0-02: post-ready keychain denial keeps the file untouched and unwritable', () => {
  const ctx = makeProtectedReadCtx({ appReady: true, decryptError: Error('Keychain denies access') });
  ctx.__files.set('/cfg/translation-settings.json', JSON.stringify({ haituoEncrypted: 1, data: 'AAAA' }));
  const result = vm.runInContext(`haituoProtectedRead('/cfg/translation-settings.json', { marker: 1 })`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { marker: 1 }, 'fallback returned');
  assert.equal(ctx.__decryptCalls(), 1, 'no retry loop masking a real post-ready failure');
  const blocked = vm.runInContext(`HaituoProtectedBlockedFiles.has('/cfg/translation-settings.json')`, ctx);
  assert.equal(blocked, true, 'denied file marked blocked');
  const deferred = vm.runInContext(`HaituoProtectedDeferred.has('/cfg/translation-settings.json')`, ctx);
  assert.equal(deferred, true, 'denied file stays in recovery set');
});

function makeWatchdogCtx() {
  const log = recorder();
  const dialogs = [];
  const exits = [];
  const timers = [];
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Promise, clearTimeout,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { id: timers.length }; },
    X: log,
    p: {
      dialog: { showMessageBox: opts => { dialogs.push(opts); return Promise.resolve({ response: 1 }); } },
      app: { exit: code => exits.push(code) },
    },
  };
  ctx.__log = log;
  ctx.__dialogs = dialogs;
  ctx.__exits = exits;
  ctx.__timers = timers;
  vm.createContext(ctx);
  vm.runInContext(watchdogCode, ctx);
  return ctx;
}

test('R2: watchdog cleared without dialog when sql.initialize resolves in time', async () => {
  const ctx = makeWatchdogCtx({ resolve: true });
  vm.runInContext(`__watched = haituoArmSqlInitWatchdog(Promise.resolve())`, ctx);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(ctx.__dialogs.length, 0, 'no dialog on the fast path');
  const infos = ctx.__log.entries.filter(e => e[0] === 'info').map(e => String(e[1]));
  assert.ok(infos.some(w => w.includes('sql.initialize resolved in')), 'resolution must be logged with elapsed ms');
});

test('R2: watchdog fires a continue/quit dialog after 30s and quit exits', async () => {
  const ctx = makeWatchdogCtx({ resolve: true });
  vm.runInContext(`__watched = haituoArmSqlInitWatchdog(new Promise(() => {}))`, ctx);
  assert.equal(ctx.__timers.length, 1);
  assert.equal(ctx.__timers[0].ms, 30000, 'watchdog must not fire early');
  ctx.__timers[0].fn();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(ctx.__dialogs.length, 1, 'stuck init must surface a dialog, not a silent spinner');
  assert.equal(ctx.__dialogs[0].buttons.length, 2);
  assert.deepEqual(ctx.__exits, [1], 'choosing 退出海拓 must exit');
  const errors = ctx.__log.entries.filter(e => e[0] === 'error').map(e => String(e[1]));
  assert.ok(errors.some(w => w.includes('sql.initialize watchdog')), 'watchdog firing must be logged');
});

function makeSetHandlerCtx() {
  const handled = {};
  const applied = [];
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Promise, setTimeout, clearTimeout,
    Jp: () => {},
    haituoUnredactConfigPatch: patch => patch,
    $p: () => ({ provider: 'google-free' }),
    haituoApplyTranslationConfig: patch => { applied.push(patch); return { ok: true }; },
    p: { ipcMain: { handle: (channel, fn) => { handled[channel] = fn; } } },
  };
  ctx.__handled = handled;
  ctx.__applied = applied;
  vm.createContext(ctx);
  vm.runInContext(versionCode + setHandlerCode + ';', ctx);
  return ctx;
}

test('R3: set handler rejects a stale version stamp from an old window', async () => {
  const ctx = makeSetHandlerCtx();
  vm.runInContext('HaituoConfigVersion = 1000;', ctx);
  const handler = ctx.__handled['caisheng:set-translation-config'];
  await assert.rejects(
    () => handler({ senderFrame: { url: 'https://web.whatsapp.com/' } }, { provider: 'deepl', __v: 999 }),
    /已被其他窗口更新/u);
  assert.equal(ctx.__applied.length, 0, 'stale patch must never reach apply');
});

test('R3: set handler accepts equal/current stamps and version-less legacy patches', async () => {
  const ctx = makeSetHandlerCtx();
  vm.runInContext('HaituoConfigVersion = 1000;', ctx);
  const handler = ctx.__handled['caisheng:set-translation-config'];
  await handler({ senderFrame: { url: 'https://web.whatsapp.com/' } }, { provider: 'deepl', __v: 1000 });
  await handler({ senderFrame: { url: 'https://web.whatsapp.com/' } }, { provider: 'deepl' });
  await handler({ senderFrame: { url: 'https://web.whatsapp.com/' } }, { provider: 'deepl', __v: 5000 });
  assert.equal(ctx.__applied.length, 3, 'current/newer/legacy patches all apply');
  assert.equal(ctx.__applied[0].provider, 'deepl');
});

function makeChildCtx() {
  const broadcasts = [];
  const themeWrites = [];
  const childHandler = {};
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Promise, setTimeout, clearTimeout, Map,
    Qg: null,
    Z: null,
    n_: () => {},
    Pm: (key, value) => themeWrites.push([key, value]),
    haituoBroadcastTranslationConfig: cfg => broadcasts.push(cfg),
    haituoPendingGlobalSettings: new Map(),
    process: { on: (event, fn) => { childHandler[event] = fn; } },
    p: { nativeTheme: {}, ipcMain: { handle: () => {} } },
  };
  vm.createContext(ctx);
  vm.runInContext(`$u = 'haituo-child';`, ctx);
  vm.runInContext(`Zp = { __v: 100, nativeTheme: 'dark', chatTextColor: '#111111' };`, ctx);
  vm.runInContext(versionCode + childHandlerCode, ctx);
  ctx.__broadcasts = broadcasts;
  ctx.__themeWrites = themeWrites;
  ctx.__child = msg => childHandler['message'](msg);
  return ctx;
}

test('R3: child skips a stale full-config write-back from the main window', () => {
  const ctx = makeChildCtx();
  ctx.__child({ type: 'haituo-global-settings-update', config: { __v: 50, nativeTheme: 'light', chatTextColor: '#222222' } });
  const cfg = vm.runInContext('Zp', ctx);
  assert.equal(cfg.__v, 100, 'older update must not overwrite newer local config');
  assert.equal(cfg.chatTextColor, '#111111');
  assert.equal(ctx.__broadcasts.length, 0, 'stale update must not be re-broadcast');
});

test('R3: child applies a newer full-config write-back and re-broadcasts it', () => {
  const ctx = makeChildCtx();
  ctx.__child({ type: 'haituo-global-settings-update', config: { __v: 200, nativeTheme: 'light', chatTextColor: '#333333' } });
  const cfg = vm.runInContext('Zp', ctx);
  assert.equal(cfg.__v, 200);
  assert.equal(cfg.chatTextColor, '#333333');
  assert.equal(ctx.__broadcasts.length, 1, 'newer update propagates to renderers');
  assert.deepEqual(ctx.__themeWrites, [['theme-setting', 'light']]);
});

function makeApplyCtx() {
  const persisted = [];
  const broadcasts = [];
  const ctx = {
    console, JSON, Math, Date, RegExp, Error, String, Number, Array, Object, Boolean, Promise, setTimeout, clearTimeout, Map,
    haituoUnredactConfigPatch: patch => patch,
    haituoRequestGlobalSettings: () => ({ ok: 'forwarded-to-main' }),
    haituoPublishGlobalSettings: () => {},
    haituoNativeSettingsCss: () => 'css',
    haituoScreenshotController: null,
    caishengSettingsWindow: null,
    Yg: new Map(),
    $g: () => {},
    Pm: () => {},
    n_: () => {},
    Qg: null,
    Z: null,
    HaituoNetwork: { normalizeBadge: v => String(v ?? 'SVIP').slice(0, 24) },
    p: { nativeTheme: {} },
    require: mod => String(mod).includes('translation-pools')
      ? { sanitize: pools => pools }
      : {},
  };
  ctx.$p = () => ({});
  ctx.em = cfg => persisted.push(cfg);
  ctx.haituoBroadcastTranslationConfig = cfg => broadcasts.push(cfg);
  ctx.__persisted = persisted;
  ctx.__broadcasts = broadcasts;
  vm.createContext(ctx);
  vm.runInContext(versionCode + applyCode, ctx);
  vm.runInContext(`$u = 'signal-main';`, ctx);
  return ctx;
}

test('R3: apply stamps a strictly increasing version on every accepted config', () => {
  const ctx = makeApplyCtx();
  vm.runInContext(`haituoApplyTranslationConfig({ provider: 'deepl', chatTextColor: '#123abc' })`, ctx);
  const first = vm.runInContext('Zp.__v', ctx);
  vm.runInContext(`haituoApplyTranslationConfig({ provider: 'openai', chatTextColor: '#123abc' })`, ctx);
  const second = vm.runInContext('Zp.__v', ctx);
  assert.ok(Number.isFinite(first) && first > 0, 'applied config carries a version stamp');
  assert.ok(second > first, 'version stamp must be strictly increasing');
  assert.equal(ctx.__persisted.length, 2);
  assert.equal(ctx.__persisted[1].__v, second, 'persisted snapshot carries the same stamp');
  assert.equal(ctx.__broadcasts[1].__v, second, 'broadcast snapshot carries the same stamp');
});
