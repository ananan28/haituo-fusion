'use strict';
// SHOT-01: bare api.openai.com screenshot endpoints get /v1.
// SHOT-04: shortcut swap is transactional — self-swap works, failure rolls back.
// CLIP-01: synthetic select-all uses Command (meta) on macOS, Ctrl elsewhere.
// Slices run against the real shipped code (vm execution-level checks).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shotSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'js', 'haituo-screenshot.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');

function sliceOf(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return src.slice(start, end);
}

const endpointCode = sliceOf(shotSrc, 'function endpoint(', '\nfunction cropRect');

test('SHOT-01: bare api.openai.com gains /v1 for chat/completions', () => {
  const ctx = { URL, Error, console };
  vm.createContext(ctx);
  vm.runInContext(endpointCode, ctx);
  assert.equal(vm.runInContext(`endpoint('https://api.openai.com')`, ctx), 'https://api.openai.com/v1/chat/completions');
  assert.equal(vm.runInContext(`endpoint('https://api.openai.com/')`, ctx), 'https://api.openai.com/v1/chat/completions');
  assert.equal(vm.runInContext(`endpoint('https://api.openai.com/v1')`, ctx), 'https://api.openai.com/v1/chat/completions');
  assert.equal(vm.runInContext(`endpoint('https://custom.example.com')`, ctx), 'https://custom.example.com/chat/completions');
  assert.equal(vm.runInContext(`endpoint('')`, ctx), 'https://api.openai.com/v1/chat/completions');
});

const configureCode = sliceOf(shotSrc, 'function configure(config)', `e.ipcMain.handle('haituo:screenshot-select'`);

function makeShortcutCtx(failKeys = new Set()) {
  const registered = [], unregistered = [];
  const ctx = {
    console, Error, JSON, String, RegExp,
    __registered: registered,
    __unregistered: unregistered,
    e: {
      globalShortcut: {
        register: value => { if (failKeys.has(value)) return false; registered.push(value); return true; },
        unregister: value => { unregistered.push(value); },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`
let shortcut = 'CommandOrControl+Alt+O', copyShortcut = 'CommandOrControl+Alt+S', shortcutPaused = false;
const start = async () => {};
${configureCode}
globalThis.__configure = configure;
globalThis.__state = () => [shortcut, copyShortcut];
  `, ctx);
  return ctx;
}

test('SHOT-04: swapping the two shortcuts onto each other succeeds', () => {
  const ctx = makeShortcutCtx();
  vm.runInContext(`__configure({
    screenshotEnabled: true, screenshotShortcut: 'CommandOrControl+Alt+S',
    screenshotCopyEnabled: true, screenshotCopyShortcut: 'CommandOrControl+Alt+O'
  })`, ctx);
  assert.deepEqual(ctx.__registered, ['CommandOrControl+Alt+S', 'CommandOrControl+Alt+O']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.__state())), ['CommandOrControl+Alt+S', 'CommandOrControl+Alt+O']);
  assert.ok(ctx.__unregistered.includes('CommandOrControl+Alt+O'));
  assert.ok(ctx.__unregistered.includes('CommandOrControl+Alt+S'));
});

test('SHOT-04: failed registration rolls back to the previous shortcuts', () => {
  const ctx = makeShortcutCtx(new Set(['CommandOrControl+Alt+P']));
  assert.throws(() => vm.runInContext(`__configure({
    screenshotEnabled: true, screenshotShortcut: 'CommandOrControl+Alt+P',
    screenshotCopyEnabled: true, screenshotCopyShortcut: 'CommandOrControl+Alt+S'
  })`, ctx), /不可用或已被占用/u);
  // rollback re-registers the old pair, in-memory state unchanged
  assert.deepEqual(ctx.__registered.slice(-2), ['CommandOrControl+Alt+O', 'CommandOrControl+Alt+S']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.__state())), ['CommandOrControl+Alt+O', 'CommandOrControl+Alt+S']);
});

test('SHOT-04: identical non-empty shortcuts are still rejected', () => {
  const ctx = makeShortcutCtx();
  assert.throws(() => vm.runInContext(`__configure({
    screenshotEnabled: true, screenshotShortcut: 'CommandOrControl+Alt+K',
    screenshotCopyEnabled: true, screenshotCopyShortcut: 'CommandOrControl+Alt+K'
  })`, ctx), /不能使用同一快捷键/u);
});

const replaceTextRaw = sliceOf(mainSrc, 'p.ipcMain.removeHandler(`caisheng:webview-replace-text`)', 'p.ipcMain.removeHandler(`caisheng:activate-voice-control`)');
const replaceTextCode = replaceTextRaw.replace(/,\s*$/, '');

async function runReplaceText(platform) {
  const events = [];
  const ctx = {
    console, Error, String, setTimeout, Promise,
    process: { platform },
    Jp: () => {},
    p: {
      ipcMain: { removeHandler: () => {}, handle: (name, fn) => { ctx.__handler = fn; } },
      clipboard: { readText: async () => 'clipboard-backup', writeText: async () => {} },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(replaceTextCode, ctx);
  const sender = { focus: () => {}, sendInputEvent: ev => events.push(ev), paste: () => {} };
  const result = await ctx.__handler({ sender, senderFrame: { url: 'https://web.whatsapp.com/' } }, '译文内容');
  return { events, result };
}

test('CLIP-01: macOS sends Command+A (meta) for select-all', async () => {
  const { events, result } = await runReplaceText('darwin');
  assert.equal(JSON.parse(JSON.stringify(result)).ok, true);
  const keyA = events.filter(ev => ev.keyCode === 'A');
  assert.equal(keyA.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(keyA[0].modifiers)), ['meta']);
});

test('CLIP-01: Windows keeps Control+A for select-all', async () => {
  const { events } = await runReplaceText('win32');
  const keyA = events.filter(ev => ev.keyCode === 'A');
  assert.deepEqual(JSON.parse(JSON.stringify(keyA[0].modifiers)), ['control']);
});
