'use strict';
// 1.6.0: Signal's quick translation box and the message composer are a pair once
// a translation has been filled in. Emptying either side must clear the other,
// with the same protections as WhatsApp: manually rewritten translations are
// kept, programmatic/send writes never trigger the sync, and focus stays where
// the user was.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'preload', 'main.js'), 'utf8');

const anchor = 'const pair = haituoQuickPairRef.current;';
const anchorAt = bundle.indexOf(anchor);
assert.ok(anchorAt >= 0, 'pair-sync effect exists in the Signal preload bundle');
const bodyStart = bundle.lastIndexOf('=> {', anchorAt) + '=> {'.length;
const bodyEnd = bundle.indexOf('}, [ haituoQuickText, t ]);', anchorAt);
assert.ok(bodyEnd > bodyStart, 'effect body slice found');
const effectBody = bundle.slice(bodyStart, bodyEnd);

function runEffect({pair, quickText, composerText, activeElement = {}, quickInput = {}}) {
  const state = {quickSet: [], nCalls: [], raf: []};
  const deps = [
    'haituoQuickPairRef', 'haituoQuickText', 't', 'haituoSetQuickText', 'n',
    'requestAnimationFrame', 'document', 'haituoQuickInputRef', 'haituoQuickNormalized'
  ];
  const fn = new Function(...deps, `return function(){${effectBody}}`);
  fn(
    {current: pair ? {...pair} : null},
    quickText,
    composerText,
    value => state.quickSet.push(value),
    value => state.nCalls.push(value),
    fn => state.raf.push(fn),
    {activeElement},
    {current: quickInput},
    value => String(value || '').replace(/\s+/gu, ' ').trim()
  )();
  return state;
}

test('clearing the composer clears a paired quick translation box', () => {
  const state = runEffect({pair: {text: 'Hello, see you tomorrow'}, quickText: '你好，明天见', composerText: '', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.quickSet, [''], 'the lower box is emptied');
  assert.deepEqual(state.nCalls, [], 'the composer is already empty, so it is not written again');
});

test('clearing the quick box clears a translation still in the composer', () => {
  const state = runEffect({pair: {text: 'Hello, see you tomorrow'}, quickText: '', composerText: 'Hello, see you tomorrow', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.nCalls, [''], 'the translation above is deleted');
  assert.deepEqual(state.quickSet, [], 'the quick box is already empty');
  assert.deepEqual(state.raf, [], 'no focus restore when the quick box was not focused');
});

test('focus returns to the quick box after it clears the composer', () => {
  const quickInput = {focus() {}};
  const state = runEffect({pair: {text: 'Hello'}, quickText: '', composerText: 'Hello', activeElement: quickInput, quickInput});
  assert.deepEqual(state.nCalls, ['']);
  assert.equal(state.raf.length, 1, 'a focus restore pass is scheduled');
});

test('a translation the user rewrote is preserved when the original is deleted', () => {
  const state = runEffect({pair: {text: 'Hello'}, quickText: '', composerText: 'Hello — edited', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.nCalls, [], 'the manual edit is never destroyed');
  assert.deepEqual(state.quickSet, []);
});

test('editing the translation drops the pair without clearing anything', () => {
  const state = runEffect({pair: {text: 'Hello'}, quickText: '你好', composerText: 'Hello — edited', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.nCalls, []);
  assert.deepEqual(state.quickSet, []);
});

test('an untouched pair takes no action', () => {
  const state = runEffect({pair: {text: 'Hello'}, quickText: '你好', composerText: 'Hello', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.nCalls, []);
  assert.deepEqual(state.quickSet, []);
  assert.deepEqual(state.raf, []);
});

test('no pair means no sync ever fires', () => {
  const state = runEffect({pair: null, quickText: '', composerText: 'Hello', activeElement: {tag: 'composer'}, quickInput: {tag: 'quick'}});
  assert.deepEqual(state.nCalls, []);
  assert.deepEqual(state.quickSet, []);
});

test('the pair is wired to translation, send and send-ready paths', () => {
  assert.ok(bundle.includes('haituoQuickPairRef = (0, l6.useRef)(null)'), 'pair ref is declared');
  assert.ok(bundle.includes('haituoQuickPairRef.current = { text: haituoQuickNormalized(translated) }'), 'a filled translation creates the pair');
  const nullCount = bundle.split('haituoQuickPairRef.current = null').length - 1;
  assert.ok(nullCount >= 3, `pair is dropped on send, send-ready and effect paths (found ${nullCount})`);
  assert.ok(bundle.includes('}, [ haituoQuickText, t ]);'), 'the sync effect watches quick text and composer text');
});
