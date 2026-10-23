'use strict';
// Window-surfacing regression: a hidden or minimized shell, a refresh/sync and
// the Windows login item must never bring the main window back on screen.
// The real minified handlers are sliced out of the shipped bundle and executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guards = require('../src/app/js/haituo-window-guards.js');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = bundle.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = bundle.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end ${endMarker}`);
  return bundle.slice(start, end);
}

function fakeWindow({ visible = true, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    showInactive: () => calls.push('showInactive'),
    focus: () => calls.push('focus'),
    webContents: { isDestroyed: () => false, once: () => {}, removeListener: () => {}, reloadIgnoringCache: () => calls.push('reload') },
  };
}

test('secondInstanceShouldShow: login item argv never surfaces the window', () => {
  assert.equal(guards.secondInstanceShouldShow([ 'Haituo.exe' ]), true);
  assert.equal(guards.secondInstanceShouldShow([ 'Haituo.exe', '--start-in-tray' ]), false);
  assert.equal(guards.secondInstanceShouldShow([ 'Haituo.exe', '--use-tray-icon' ]), false);
  assert.equal(guards.secondInstanceShouldShow(undefined), true);
  assert.equal(guards.secondInstanceShouldShow('not-an-array'), true);
});

test('keepShellVisibleAllowed: hidden or minimized is never eligible', () => {
  assert.equal(guards.keepShellVisibleAllowed({ visible: true, minimized: false }), true);
  assert.equal(guards.keepShellVisibleAllowed({ visible: false, minimized: false }), false);
  assert.equal(guards.keepShellVisibleAllowed({ visible: true, minimized: true }), false);
  assert.equal(guards.keepShellVisibleAllowed(undefined), false);
});

test('start-in-tray startup gate evaluates true only for the main process with the flag', () => {
  const source = bundle.match(/const haituoMainStartHidden = ([^;]+);/u);
  assert.ok(source, 'startup hidden gate not found');
  const evaluate = ({ isMain, argv, traySetting }) => {
    const ctx = {
      h: isMain,
      process: { argv },
      u: traySetting,
      n: { ot: { MinimizeToAndStartInSystemTray: 'minimize-and-start-in-tray' } },
      HaituoWindowGuards: guards,
    };
    vm.createContext(ctx);
    return vm.runInContext(source[1], ctx);
  };
  assert.equal(evaluate({ isMain: true, argv: [ 'Haituo.exe', '--start-in-tray' ], traySetting: 'use-tray-icon' }), true);
  assert.equal(evaluate({ isMain: true, argv: [ 'Haituo.exe', '--use-tray-icon' ], traySetting: 'use-tray-icon' }), true);
  assert.equal(evaluate({ isMain: true, argv: [ 'Haituo.exe' ], traySetting: 'minimize-and-start-in-tray' }), true);
  assert.equal(evaluate({ isMain: true, argv: [ 'Haituo.exe' ], traySetting: 'do-not-use-tray' }), false);
  assert.equal(evaluate({ isMain: false, argv: [ 'Haituo.exe', '--start-in-tray' ], traySetting: 'minimize-and-start-in-tray' }), false);
  assert.match(bundle, /haituoMainStartHidden \? X\.info\(`haituo: start-in-tray, main window stays hidden`\)/, 'ready-to-show path must honour the gate');
  assert.match(bundle, /haituoMainStartHidden \? X\.info\(`haituo: start-in-tray, skipping startup show`\) : C_\(\)/, 'the delayed startup show must honour the gate');
});

test('sliced second-instance handler does not restore/show for the login item', () => {
  const code = slice('p.app.on(`second-instance`', ', p.app.on(`open-url`').replace(/,\s*$/, ';');
  const handlers = {};
  const shown = [];
  const window = fakeWindow({ visible: false, minimized: true });
  const ctx = {
    console,
    HaituoWindowGuards: guards,
    X: { info: () => {} },
    p: { app: { on: (event, handler) => { handlers[event] = handler; } } },
    n: { Lt: { isWindows: () => true } },
    I: { sendDummyKeystroke: () => shown.push('keystroke') },
    Z: window,
    C_: () => shown.push('showWindow'),
    t_: () => shown.push('syncChildren'),
    ty: () => null,
    ny: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.ok(handlers['second-instance'], 'handler registered');

  assert.equal(handlers['second-instance']({}, [ 'Haituo.exe', '--start-in-tray' ]), true);
  assert.deepEqual(shown, [], 'login-item second instance must stay in the tray');

  assert.equal(handlers['second-instance']({}, [ 'Haituo.exe', '--use-tray-icon' ]), true);
  assert.deepEqual(shown, [], 'the older tray-icon login item also stays in the tray');

  assert.equal(handlers['second-instance']({}, [ 'Haituo.exe' ]), true);
  assert.deepEqual(shown, [ 'keystroke', 'showWindow', 'syncChildren' ], 'a real user launch still surfaces the window');
});

test('sliced keepVisible does not restore, show or raise a hidden/minimized window', () => {
  const code = slice('let caishengKeepVisibleLogAt = 0;', 'function caishengShowTopMenu');
  const window = fakeWindow({ visible: false, minimized: true });
  const logs = [];
  const ctx = {
    $u: 'signal-main',
    Z: window,
    X: { info: message => logs.push(message) },
    HaituoWindowGuards: guards,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.equal(typeof ctx.caishengKeepMainShellVisible, 'function');

  ctx.caishengKeepMainShellVisible();
  assert.deepEqual(window.calls, [], 'hidden window stays hidden');

  window.isVisible = () => true;
  window.isMinimized = () => true;
  ctx.caishengKeepMainShellVisible();
  assert.deepEqual(window.calls, [], 'minimized window stays minimized');

  window.isMinimized = () => false;
  ctx.caishengKeepMainShellVisible();
  assert.deepEqual(window.calls, [], 'an already visible window is left alone');
  assert.equal(logs.length, 1, 'hidden skips are logged once for diagnostics');
});

test('sliced soft refresh refuses to reload while the shell is hidden', () => {
  const code = slice('function caishengSoftRefreshWindow() {', 'let caishengParentHeartbeat');
  const window = fakeWindow({ visible: false, minimized: false });
  const ctx = {
    Z: window,
    X: { info: () => {}, warn: () => {} },
    HaituoWindowGuards: guards,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    setImmediate,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.equal(ctx.caishengSoftRefreshWindow(), false);
  assert.deepEqual(window.calls, [], 'hidden window is never reloaded behind the user');

  window.isVisible = () => true;
  window.isMinimized = () => true;
  assert.equal(ctx.caishengSoftRefreshWindow(), false);
  assert.deepEqual(window.calls, [], 'minimized window is never reloaded');
});

test('sliced auto-start cleanup removes the legacy Run entry exactly once', () => {
  const code = slice('function haituoDisableLegacyAutoLaunch()', '\nconst Gv');
  const makeContext = ({ markerExists = false, stillEnabled = false } = {}) => {
    const disableCalls = [], settings = { openAtLogin: true }, logs = [];
    let written = null;
    const ctx = {
      $u: 'signal-main',
      n: { Lt: { isWindows: () => true } },
      s: { join: path.join },
      z: { default: { existsSync: () => markerExists, writeFileSync: (_file, value) => { written = value; } } },
      p: { app: {
        getPath: () => '/userData',
        getVersion: () => '1.5.4',
        getLoginItemSettings: () => ({ openAtLogin: settings.openAtLogin }),
        setLoginItemSettings: options => {
          disableCalls.push(options);
          if (options.openAtLogin === false && !stillEnabled) settings.openAtLogin = false;
        },
      } },
      X: { info: message => logs.push(message), warn: message => logs.push(message) },
      Date,
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, disableCalls, logs, written: () => written };
  };

  const first = makeContext();
  first.ctx.haituoDisableLegacyAutoLaunch();
  assert.equal(JSON.stringify(first.disableCalls.map(call => call.args)), JSON.stringify([ [], [ '--start-in-tray' ], [ '--use-tray-icon' ] ]), 'every legacy login-item variant is removed');
  assert.ok(first.disableCalls.every(call => call.openAtLogin === false));
  assert.match(String(first.written()), /disabledAt/, 'cleanup is recorded so a later user opt-in is respected');
  assert.ok(first.logs.some(message => /disabled auto-start/.test(message)));

  const second = makeContext({ markerExists: true });
  second.ctx.haituoDisableLegacyAutoLaunch();
  assert.deepEqual(second.disableCalls, [], 'a completed cleanup never runs again');

  const blocked = makeContext({ stillEnabled: true });
  blocked.ctx.haituoDisableLegacyAutoLaunch();
  assert.equal(blocked.written(), null, 'no marker when the entry could not be removed');
  assert.ok(blocked.logs.some(message => /still enabled/.test(message)));
});

test('sliced refresh handler relaunches only inside the CI probe, never in production', () => {
  const code = slice('p.ipcMain.handle(`caisheng:refresh-signal-profile`', 'p.ipcMain.handle(`caisheng:sync-signal-profile`').replace(/,\s*$/, ';');
  const handlers = {}, relaunched = [], quit = [], refreshed = [];
  const env = {};
  const ctx = {
    console,
    p: {
      ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
      app: { relaunch: options => relaunched.push(options), quit: () => quit.push(true) },
    },
    process: { platform: 'darwin', argv: [ 'Haituo.exe' ], env },
    setTimeout: handler => { handler(); return 1; },
    caishengKeepMainShellVisible: () => {},
    caishengSoftRefreshWindow: () => { refreshed.push(true); return true; },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const handler = handlers['caisheng:refresh-signal-profile'];
  assert.ok(handler, 'refresh handler registered');

  return (async () => {
    assert.equal((await handler({}, 'signal-main')).ok, true);
    assert.deepEqual(relaunched, [], 'a production refresh must not restart the app');
    assert.deepEqual(quit, []);
    assert.equal(refreshed.length, 1, 'the visible shell is soft-refreshed instead');

    env.HAITUO_WINDOW_TEST = '1';
    await handler({}, 'signal-main');
    assert.equal(relaunched.length, 1, 'the CI probe still performs its real relaunch');
    assert.ok(relaunched[0].args.includes('--haituo-verify-main-refresh'));
    assert.deepEqual(quit, [ true ]);
  })();
});
