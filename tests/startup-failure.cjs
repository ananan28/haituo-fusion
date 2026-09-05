const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const Module = require('node:module'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlite-no-core-')); const load = Module._load;
Module._load = function(name,...args) { if (name === 'electron') return { app: { getPath: () => dir, getAppPath: () => dir, isPackaged: false } }; return load.call(this,name,...args); };
const bridge = require('../dist-electron/signalBridge');
(async () => {
  const states = await Promise.all([bridge.ensureSignal('signal-main'),bridge.ensureSignal('signal-main')]);
  for (const s of states) { assert.equal(s.phase, 'error'); assert.equal(s.code, 'RUNTIME_MISSING'); assert.ok(!s.message.includes('Bridge')); assert.ok(!s.message.includes('signal-cli')); }
  const retry = await bridge.retrySignal('signal-main'); assert.equal(retry.code, 'RUNTIME_MISSING');
  console.log('PASS: missing runtime fails visibly without exposing manual daemon commands, concurrent failure settles, retry remains available.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await bridge.stopAllSignals(); Module._load = load; fs.rmSync(dir,{recursive:true,force:true}); });
