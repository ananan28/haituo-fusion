const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const net = require('node:net'); const Module = require('node:module');
const realSpawn = require('node:child_process').spawn; const originalLoad = Module._load;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlite-managed-')); const launches = [];
Module._load = function(name, ...args) {
  if (name === 'electron') return { app: { getPath: () => dir } };
  if (name === './signalRuntime') return { runtimeCommand: () => ({ executable: process.execPath, args: [path.join(__dirname, 'fake-signal-core.cjs')], cwd: __dirname }) };
  if (name === 'node:child_process') return { spawn: (exe, argv, options) => { launches.push({ argv, options }); return realSpawn(exe, argv, options); } };
  return originalLoad.call(this, name, ...args);
};
const settings = require('../dist-electron/settings'); const store = require('../dist-electron/signalStore'); const bridge = require('../dist-electron/signalBridge'); const pipeline = require('../dist-electron/signalPipeline');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 8000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Test timeout'); await wait(25); } }
const blocker = net.createServer();
(async () => {
  settings.saveSettings({ signalSessions: [{ id: 'signal-1', name: 'One', enabled: true, account: '' }, { id: 'signal-2', name: 'Two', enabled: true, account: '' }] });
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(7503, '127.0.0.1', resolve); });
  pipeline.installSignalPipeline();
  const statuses = []; bridge.signalEvents.on('status', s => statuses.push(s));
  await Promise.all([bridge.ensureSignal('signal-1'), bridge.ensureSignal('signal-1'), bridge.ensureSignal('signal-2')]);
  assert.equal(launches.length, 2, 'single-flight prevents duplicate core processes');
  await until(() => bridge.signalStatus('signal-1').phase === 'ready' && bridge.signalStatus('signal-2').phase === 'ready');
  assert.ok(statuses.some(s => s.phase === 'pairing' && s.qrUri), 'automatic QR published before pairing completion');
  const one = store.signalProfile('signal-1'); const two = store.signalProfile('signal-2');
  assert.notEqual(one.port, two.port); assert.notEqual(one.port, 7503); assert.notEqual(two.port, 7503); assert.notEqual(one.configDir, two.configDir);
  for (const l of launches) { assert.equal(l.options.windowsHide, true); assert.equal(l.options.shell, false); assert.ok(l.argv.includes('--config')); }
  await wait(100); await bridge.signalRpc('send', { recipient: ['+100'], message: 'test', account: 'wrong' }, 'signal-2');
  await until(() => store.readSignalMessages(undefined, 4000, 'signal-2').length === 1);
  assert.equal(store.readSignalMessages(undefined, 4000, 'signal-1').length, 0);
  await assert.rejects(() => bridge.signalRpc('exec', {}, 'signal-1'), /RPC_NOT_ALLOWED/);
  const priorPort = one.port; await bridge.stopSignal('signal-1'); assert.equal(bridge.signalStatus('signal-2').phase, 'ready');
  await bridge.ensureSignal('signal-1'); assert.equal(store.signalProfile('signal-1').port, priorPort); assert.equal(bridge.signalStatus('signal-1').phase, 'ready');
  assert.equal(statuses.filter(s => s.sessionId === 'signal-1' && s.phase === 'pairing').length, 1, 'persisted credentials avoid QR on restart');
  const beforeCrash = launches.length;
  process.kill(Number(fs.readFileSync(path.join(one.configDir, 'test-pid'), 'utf8')), 'SIGKILL');
  await until(() => launches.length > beforeCrash && bridge.signalStatus('signal-1').phase === 'ready');
  assert.equal(bridge.signalStatus('signal-2').phase, 'ready');
  console.log('PASS: silent spawn options, per-profile ports/directories, occupied port recovery, concurrent startup, auto QR/finishLink, account-scoped SSE and RPC, independent stop, restart credentials, crash recovery.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await bridge.stopAllSignals(); blocker.close(); Module._load = originalLoad; fs.rmSync(dir, { recursive: true, force: true });
});
