// wrapper.js executes bundles/preload/main.js via vm.Script and calls the
// script's completion value as the preload entry: u = script.runInThisContext();
// u(require, __dirname, {}). The completion value is the value of the last
// value-producing top-level statement. The Signal preload is one giant function
// expression statement; any top-level *expression statement* appended after it
// (e.g. an IIFE call) replaces the completion value with undefined and the app
// hangs on the loading screen with "u is not a function" (1.4.5/1.4.6 outage).
// Everything appended at top level must be a declaration.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert');

const PRELOAD = path.join(__dirname, '..', 'src', 'app', 'bundles', 'preload', 'main.js');
const ANCHOR = 'function haituoApplyNativeRendererAppearance';

function tailAfterSignalFunction() {
  const lines = fs.readFileSync(PRELOAD, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '});' && lines[i + 1] === '' && (lines[i + 2] || '').startsWith(ANCHOR)) {
      return lines.slice(i + 1).join('\n');
    }
  }
  throw new Error(`boundary not found: expected "${ANCHOR}" after the Signal function's closing "});" — update this test if the anchor moved`);
}

test('appended top-level code keeps the completion value callable', () => {
  globalThis.window = { addEventListener() {}, SignalContext: undefined };
  globalThis.document = { addEventListener() {}, querySelector() { return null; } };
  const src = '(function(){return 42});\n' + tailAfterSignalFunction();
  const entry = new vm.Script(src).runInThisContext();
  assert.equal(typeof entry, 'function', 'completion value must stay a function; a top-level expression statement after the Signal IIFE clobbered it');
  assert.equal(entry(), 42);
});
