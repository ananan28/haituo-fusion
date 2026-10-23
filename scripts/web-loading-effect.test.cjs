// The serial web-account-loading useEffect in bundles/preload/main.js once
// assigned `i` before its own `let i` declaration (TDZ): clicking/opening a
// WhatsApp or Telegram workspace put an account into qLoaded while qReady was
// still empty, the effect hit the `n` branch, and the renderer died with
// "Cannot access 'i' before initialization" — a black window that re-occurred
// on every launch because qLoaded is restored from localStorage. This test
// executes the real effect body in all three branches to prove it runs clean.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const PRELOAD = path.join(__dirname, '..', 'src', 'app', 'bundles', 'preload', 'main.js');
const START = '// Weak networks: web accounts';
const END = '}, [ r, t, qLoaded, qReady ]),';

function effectBody() {
  const lines = fs.readFileSync(PRELOAD, 'utf8').split(/\r?\n/);
  const start = lines.findIndex(l => l.includes(START));
  assert.notEqual(start, -1, 'serial-loading effect marker not found — update this test if it moved');
  const open = lines[start - 1];
  assert.ok(open.trim().endsWith('useEffect)(() => {'), 'unexpected effect opening line');
  const end = lines.findIndex((l, i) => i > start && l.trim().startsWith(END));
  assert.notEqual(end, -1, 'effect closing line not found');
  return lines.slice(start, end).join('\n');
}

function runEffect(overrides) {
  const timers = [];
  const deps = {
    r: [
      { id: 'w1', platformId: 'whatsapp' },
      { id: 'tg1', platformId: 'telegram' },
      { id: 'sg1', platformId: 'signal' },
    ],
    t: 'dark',
    qLoaded: [],
    qReady: [],
    qSetLoaded: () => {},
    qSetReady: () => {},
    bCr: () => true,
    setTimeout: (fn, delay) => (timers.push({ fn, delay }), timers.length),
    clearTimeout: () => {},
    ...overrides,
  };
  const fn = new Function(
    'r', 't', 'qLoaded', 'qReady', 'qSetLoaded', 'qSetReady', 'bCr', 'setTimeout', 'clearTimeout',
    effectBody()
  );
  // A TDZ bug or reference error inside the body throws here — exactly the
  // production crash, so no try/catch on purpose.
  const cleanup = fn(deps.r, deps.t, deps.qLoaded, deps.qReady, deps.qSetLoaded,
    deps.qSetReady, deps.bCr, deps.setTimeout, deps.clearTimeout);
  return { cleanup, timers };
}

test('loaded-but-not-ready web account schedules the 45s ready timer without throwing', () => {
  // This is the exact state that crashed 1.4.7: WhatsApp restored from
  // localStorage into qLoaded with qReady still empty.
  const { cleanup, timers } = runEffect({ qLoaded: ['w1'] });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 45000);
  assert.equal(typeof cleanup, 'function');
});

test('next unloaded web account schedules the 3.5s load timer without throwing', () => {
  const { cleanup, timers } = runEffect({});
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 3500);
  assert.equal(typeof cleanup, 'function');
});

test('the serial-loading effect never reaches for Electron IPC from the renderer', () => {
  // The 1.5.3 build on the reporter's machine called
  // require(`electron`).ipcRenderer.invoke inside this effect; the renderer has
  // no such module, so it threw "Cannot read properties of undefined (reading
  // 'invoke')" whenever a web account was waiting to load and took the window
  // down. Timer-only scheduling is the supported design; a visibility poll
  // belongs in the preload bridge.
  const body = effectBody();
  assert.doesNotMatch(body, /require\([`'"]electron[`'"]\)|ipcRenderer/);
});

test('nothing to do when every web account is loaded and ready', () => {
  const { cleanup, timers } = runEffect({ qLoaded: ['w1', 'tg1'], qReady: ['w1', 'tg1'] });
  assert.equal(timers.length, 0);
  assert.equal(cleanup, undefined);
});
