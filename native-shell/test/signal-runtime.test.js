'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SignalRuntime, signalErrorMessage } = require('../src/signal-runtime');

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caisheng-signal-test-'));
  return { value: new SignalRuntime(root, root), root };
}

test('三个及以上 Signal 账号的状态与历史完全隔离', async t => {
  const { value, root } = runtime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = ['signal_account_01', 'signal_account_02', 'signal_account_03'];
  for (const id of ids) value.saveState(id, { linked: true, status: '在线' });
  await Promise.all(ids.map((id, index) => value.record(id, {
    id: String(index), accountId: id, conversationId: 'direct:+' + index,
    sender: '自己', text: '消息' + index, timestamp: index + 1, status: '已发送'
  })));
  assert.deepEqual(ids.map(id => value.history(id).length), [1, 1, 1]);
  assert.equal(value.state(ids[1]).id, ids[1]);
  assert.notEqual(value.paths(ids[0]).config, value.paths(ids[1]).config);
  assert.notEqual(value.paths(ids[0]).attachments, value.paths(ids[1]).attachments);
});

test('收件、已读、回应、编辑和撤回会更新独立历史', async t => {
  const { value, root } = runtime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = 'signal_account_10';
  await value.record(id, {
    id: 'm1', accountId: id, conversationId: 'direct:+100', sender: '自己',
    author: 'self', text: '原文', timestamp: 100, status: '已发送', reactions: []
  });
  await value.ingest(id, { receiptMessage: { type: 'READ', timestamps: [100] } });
  assert.equal(value.history(id)[0].status, '已读');
  await value.ingest(id, { sourceNumber: '+100', dataMessage: {
    reaction: { targetSentTimestamp: 100, emoji: '👍', isRemove: false }
  }});
  assert.equal(value.history(id)[0].reactions[0].emoji, '👍');
  await value.ingest(id, { sourceNumber: '+100', dataMessage: {
    targetSentTimestamp: 100, timestamp: 101, message: '编辑后'
  }});
  assert.equal(value.history(id)[0].text, '编辑后');
  await value.ingest(id, { sourceNumber: '+100', dataMessage: {
    remoteDelete: { timestamp: 100 }
  }});
  assert.equal(value.history(id)[0].deleted, true);
});

test('同账号重复启动合并，群聊与私聊路由不会混用', async t => {
  const { value, root } = runtime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let starts = 0;
  value.startAccount = async id => {
    starts += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    value.processes.set(id, { child: { stdin: { writable: true } } });
    return value.state(id);
  };
  await Promise.all([value.start('signal_account_20'), value.start('signal_account_20')]);
  assert.equal(starts, 1);
  assert.deepEqual(value.target('group:abc'), { groupId: 'abc' });
  assert.deepEqual(value.target('direct:+123'), { recipient: ['+123'] });
});


test('Signal 分发包使用完整 lib classpath 并强制 UTF-8', t => {
  const { value, root } = runtime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'signal-runtime');
  const java = path.join(runtimeRoot, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const lib = path.join(runtimeRoot, 'signal-cli', 'lib');
  fs.mkdirSync(path.dirname(java), { recursive: true });
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(java, '');
  fs.writeFileSync(path.join(lib, 'signal-cli-0.14.7.jar'), '');
  fs.writeFileSync(path.join(lib, 'argparse4j-0.9.0.jar'), '');
  const binary = value.binary();
  const args = value.javaArguments(binary, ['--version']);
  assert.equal(binary.mainClass, 'org.asamk.signal.Main');
  assert.equal(binary.classpath, path.join(lib, '*'));
  assert.ok(args.includes('-Dfile.encoding=UTF-8'));
  assert.ok(args.includes('-classpath'));
  assert.ok(args.includes('org.asamk.signal.Main'));
  assert.equal(args.includes('-jar'), false);
});

test('Signal 缺少依赖时给出中文错误', t => {
  const { value, root } = runtime();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const java = path.join(root, 'signal-runtime', 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const lib = path.join(root, 'signal-runtime', 'signal-cli', 'lib');
  fs.mkdirSync(path.dirname(java), { recursive: true });
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(java, '');
  fs.writeFileSync(path.join(lib, 'signal-cli-0.14.7.jar'), '');
  assert.throws(() => value.binary(), /运行环境不完整/);
  assert.match(signalErrorMessage('java.lang.NoClassDefFoundError: net/sourceforge/argparse4j/inf/ArgumentParserException'), /缺少依赖/);
});
