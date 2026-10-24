'use strict';
// 1.5.10: the message composer and the quick translation box below it are a
// pair once a translation has been filled in. Emptying either side must clear
// the other; programmatic translation writes, sends and manually edited
// translations must never trigger the sync.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'js', 'caisheng-webview-preload.js'), 'utf8');
const start = source.indexOf('function haituoPairQuickComposer');
const end = source.indexOf('function countMatchingOutgoingMessages', start);
assert.ok(start >= 0 && end > start, 'quick/composer sync slice found');
const slice = source.slice(start, end);

function fakeElement(value) {
  return {
    value,
    isConnected: true,
    focused: false,
    __haituoPairedComposer: null,
    focus() {
      this.focused = true;
    }
  };
}

function boot({quickValue = '你好，明天见', composerValue = 'Hello, see you tomorrow'} = {}) {
  const quick = fakeElement(quickValue);
  quick.id = 'haituo-whatsapp-quick-input';
  const composer = fakeElement(composerValue);
  const events = [];
  const documentStub = {
    activeElement: quick,
    getElementById(id) {
      return id === quick.id ? quick : null;
    }
  };
  const timeouts = [];
  const ctx = {
    console,
    Error,
    String,
    Date,
    document: documentStub,
    setTimeout(fn) {
      timeouts.push(fn);
      return timeouts.length;
    },
    clearTimeout() {}
  };
  vm.createContext(ctx);
  vm.runInContext(`let quickComposerSyncLock = 0;
let activeComposer = null;
function findComposer() {
    return null;
}
function normalized(value) {
    return String(value || "").replace(/\\s+/gu, " ").trim();
}
function read(element) {
    return String(element.value || "").replace(/\\u00a0/g, " ").replace(/[\\u200b-\\u200d\\ufeff]/g, "");
}
function clearComposer(element) {
    __events.push("clear-composer");
    element.value = "";
}
function hideBackTranslation() {
    __events.push("hide-preview");
}
${slice}`, ctx);
  ctx.__timeouts = timeouts;
  ctx.__events = events;
  return {
    quick,
    composer,
    events,
    ctx,
    pair(translation = composerValue) {
      ctx.haituoPairQuickComposer(quick, composer, translation);
    },
    quickInput(value) {
      quick.value = value;
      return ctx.haituoQuickEmptied(quick);
    },
    composerInput(value) {
      composer.value = value;
      return ctx.haituoComposerEmptied(composer);
    },
    withoutSync(action) {
      return ctx.haituoWithoutQuickComposerSync(action);
    }
  };
}

test('clearing the quick translation box clears a translation still in the composer', () => {
  const app = boot();
  app.pair();
  assert.equal(app.quickInput(''), true, 'the emptied quick box must be handled');
  assert.equal(app.composer.value, '', 'deleting the original in the lower box must delete the translation above');
  assert.deepEqual(app.events, ['hide-preview', 'clear-composer']);
  assert.equal(app.quick.__haituoPairedComposer, null, 'the pair is consumed so it cannot clear a later draft');
  assert.equal(app.quick.focused, true, 'focus stays in the quick box instead of jumping to the composer');
});

test('clearing the message composer clears the quick translation box', () => {
  const app = boot();
  app.pair();
  assert.equal(app.composerInput(''), true);
  assert.equal(app.quick.value, '', 'deleting the translation above must delete the original below');
  assert.deepEqual(app.events, ['hide-preview']);
  assert.equal(app.quick.__haituoPairedComposer, null);
  assert.equal(app.quick.focused, false, 'clearing the composer must not steal focus into the quick box');
});

test('whitespace and zero-width leftovers count as an empty field in both directions', () => {
  const app = boot({quickValue: '你好'});
  app.pair();
  app.composer.value = ' \n\t\u200b';
  assert.equal(app.ctx.haituoComposerEmptied(app.composer), true);
  assert.equal(app.quick.value, '');

  const app2 = boot({quickValue: '  \n '});
  app2.pair();
  assert.equal(app2.ctx.haituoQuickEmptied(app2.quick), true);
  assert.equal(app2.composer.value, '');
});

test('a translation the user rewrote is preserved when the original is deleted', () => {
  const app = boot();
  app.pair();
  app.composer.value = 'Hello, see you tomorrow — edited';
  assert.equal(app.quickInput(''), false, 'the paired translation no longer matches, so it is not cleared');
  assert.equal(app.composer.value, 'Hello, see you tomorrow — edited', 'a manual edit is never destroyed');
  assert.equal(app.quick.__haituoPairedComposer, null, 'the stale pair is discarded');
  assert.deepEqual(app.events, ['hide-preview']);
});

test('unpaired fields never clear each other', () => {
  const app = boot();
  assert.equal(app.quickInput(''), false);
  assert.equal(app.composer.value, 'Hello, see you tomorrow', 'a draft is kept when the lower box was never paired');

  const app2 = boot();
  assert.equal(app2.composerInput(''), false);
  assert.equal(app2.quick.value, '你好，明天见', 'manually typed source is kept when it was never paired');
});

test('programmatic translation writes never trigger the sync', () => {
  const app = boot();
  app.pair();
  assert.equal(app.withoutSync(() => {
    app.composer.value = '';
    return app.ctx.haituoComposerEmptied(app.composer);
  }), false);
  assert.equal(app.quick.value, '你好，明天见', 'the source survives clearComposer() inside runQuick');

  app.composer.value = 'Hello, see you tomorrow';
  assert.equal(app.withoutSync(() => {
    app.quick.value = '';
    return app.ctx.haituoQuickEmptied(app.quick);
  }), false);
  assert.equal(app.composer.value, 'Hello, see you tomorrow', 'the translation is untouched inside the lock');
  assert.deepEqual(app.events, [], 'neither direction runs while the lock is held');
});

test('an already empty composer is not cleared again or refocused', () => {
  const app = boot();
  app.pair();
  app.composer.value = '';
  assert.equal(app.quickInput(''), true);
  assert.deepEqual(app.events, ['hide-preview'], 'no redundant clearComposer/focus pass');
  assert.equal(app.quick.focused, false);
});

test('a disconnected composer is never touched', () => {
  const app = boot();
  app.pair();
  app.composer.isConnected = false;
  assert.equal(app.quickInput(''), false);
  assert.equal(app.composer.value, 'Hello, see you tomorrow');
  assert.equal(app.quick.__haituoPairedComposer, null);
});

test('quick listeners call the sync for every edit and the composer listener calls it on input', () => {
  assert.ok(slice.includes('function haituoPairQuickComposer'), 'pairing helper must ship');
  assert.ok(source.includes('quick.addEventListener("input", () => haituoQuickEmptied(quick), !0);'), 'quick box input is wired');
  assert.ok(source.includes('t && (syncPanel(t), haituoComposerEmptied(t), scheduleComposerEmptyCheck(t)'), 'composer input is wired');
  const settleIndex = source.indexOf('await settleComposer(composer, translated, direct)');
  assert.ok(settleIndex > 0, 'runQuick settles the composer');
  const pairIndex = source.indexOf('haituoPairQuickComposer(quick, composer, translated)', settleIndex);
  assert.ok(pairIndex > settleIndex, 'the pair is created only after the translation is confirmed in the composer');
});

test('every composer clear/write goes through the sync lock', () => {
  const clears = [...source.matchAll(/(?<!function )clearComposer\([a-z]+\)/gu)];
  assert.ok(clears.length >= 3, 'composer clears exist in settleComposer, run and runQuick');
  for (const match of clears) {
    const before = source.slice(Math.max(0, match.index - 180), match.index);
    assert.match(before, /haituoWithoutQuickComposerSync/u, `clearComposer at ${match.index} must be locked`);
  }
  const writes = [...source.matchAll(/(?<!function )\bwrite\([a-z]+, [a-zA-Z.]+\)/gu)];
  assert.ok(writes.length >= 3, 'composer writes exist in settleComposer, run and runQuick');
  for (const match of writes) {
    const before = source.slice(Math.max(0, match.index - 180), match.index);
    assert.match(before, /haituoWithoutQuickComposerSync/u, `write at ${match.index} must be locked`);
  }
});

test('send cleanup drops the pair before clearing the quick box', () => {
  const marker = 'currentQuick.__haituoPairedComposer = null, currentQuick.value = ""';
  assert.ok(source.includes(marker), 'runQuick send clears the pair before the quick box');
  const clearFn = source.slice(source.indexOf('function clearQuickTranslatorAfterSend'), source.indexOf('function watchNativeSendAndClearQuick'));
  const pairAt = clearFn.indexOf('quick.__haituoPairedComposer = null');
  const clearAt = clearFn.indexOf('quick.value = ""');
  assert.ok(pairAt >= 0 && clearAt > pairAt, 'native send clears the pair first, protecting a new draft');
});

test('deleting the composer is caught even when WhatsApp defers the DOM update', () => {
  const app = boot();
  app.pair();
  app.composer.value = 'Hello, see you tomorrow';
  app.ctx.findComposer = () => app.composer;
  app.ctx.activeComposer = app.composer;
  app.ctx.scheduleComposerEmptyCheck(app.composer);
  assert.ok(app.ctx.__timeouts.length >= 1, 'a follow-up check is scheduled while the composer still holds text');
  app.composer.value = '';
  let ran = 0;
  while (app.ctx.__timeouts.length && ran < 20) {
    app.ctx.__timeouts.shift()();
    ran += 1;
  }
  assert.equal(app.quick.value, '', 'the delayed check clears the quick box once the composer is truly empty');
  assert.equal(app.quick.__haituoPairedComposer, null);
});

test('delete/cut keys and delayed checks are wired to the composer sync', () => {
  assert.ok(source.includes('scheduleComposerEmptyCheck(t)'), 'delayed check helper is referenced');
  assert.ok(source.includes('/^delete/u.test(String(e.inputType || "")) && scheduleComposerEmptyCheck(t)'), 'beforeinput delete schedules a check');
  assert.ok(source.includes('"keyup", e => {'), 'keyup is listened');
  assert.ok(source.includes('"cut", e => {'), 'cut is listened');
  assert.ok(source.includes('("Backspace" === e.key || "Delete" === e.key) && t && scheduleComposerEmptyCheck(t)'), 'backspace/delete keydown schedules a check');
  assert.ok(source.includes('syncPanel(t), haituoComposerEmptied(t), scheduleComposerEmptyCheck(t)'), 'input also schedules a follow-up check');
});
