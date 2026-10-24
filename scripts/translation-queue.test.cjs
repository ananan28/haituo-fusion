'use strict';
// User-typed input and connection tests must not wait behind two slow
// background translations. The queue keeps two background slots and lets a
// priority task take one reserved third slot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'bundles', 'main.js'), 'utf8');
const start = bundle.indexOf('function haituoPumpRequests');
assert.notEqual(start, -1, 'scheduler not found');
const end = bundle.indexOf('async function haituoTranslateWithMode', start);
assert.notEqual(end, -1, 'scheduler end not found');
const code = bundle.slice(start, end);

function makeCtx() {
  const ctx = { Date, Promise };
  vm.createContext(ctx);
  vm.runInContext('var HaituoRequestQueue = []; var HaituoActiveRequests = 0;' + code, ctx);
  vm.runInContext(`
    globalThis.__started = [];
    globalThis.__resolvers = {};
    globalThis.__schedule = (id, priority) => haituoScheduleRequest(
      () => new Promise(resolve => { __started.push(id); __resolvers[id] = resolve; }), priority);
  `, ctx);
  return ctx;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const run = (ctx, expression) => vm.runInContext(expression, ctx);
const started = ctx => JSON.parse(JSON.stringify(run(ctx, '__started')));

test('two background translations run, a third waits', async () => {
  const ctx = makeCtx();
  run(ctx, `__schedule('A', false); __schedule('B', false); __schedule('C', false)`);
  await tick();
  assert.deepEqual(started(ctx), ['A', 'B']);
});

test('priority input starts immediately with two background jobs in flight', async () => {
  const ctx = makeCtx();
  run(ctx, `__schedule('A', false); __schedule('B', false)`);
  await tick();
  run(ctx, `__schedule('draft', true)`);
  await tick();
  assert.deepEqual(started(ctx), ['A', 'B', 'draft'], 'input must not wait for a background slot');
  run(ctx, `__schedule('C', false)`);
  await tick();
  assert.deepEqual(started(ctx), ['A', 'B', 'draft'], 'background work still respects the cap');
  run(ctx, '__resolvers.draft()');
  await tick();
  assert.ok(!started(ctx).includes('C'), 'the two background slots stay capped after the priority job finishes');
  run(ctx, '__resolvers.A()');
  await tick();
  assert.ok(started(ctx).includes('C'), 'a queued background job starts as soon as a background slot frees');
});

test('a priority job takes the next free slot before queued background work', async () => {
  const ctx = makeCtx();
  run(ctx, `__schedule('A', false); __schedule('draft', true); __schedule('B', false)`);
  await tick();
  assert.deepEqual(started(ctx), ['A', 'draft']);
  run(ctx, '__resolvers.A()');
  await tick();
  assert.deepEqual(started(ctx), ['A', 'draft', 'B']);
});

test('completing every task drains the queue', async () => {
  const ctx = makeCtx();
  run(ctx, `__schedule('A', false); __schedule('B', false); __schedule('draft', true); __schedule('C', false)`);
  await tick();
  run(ctx, '__resolvers.draft()');
  await tick();
  run(ctx, '__resolvers.A()');
  await tick();
  run(ctx, '__resolvers.B()');
  await tick();
  run(ctx, '__resolvers.C()');
  await tick();
  assert.deepEqual(started(ctx), ['A', 'B', 'draft', 'C']);
  assert.equal(run(ctx, 'HaituoActiveRequests'), 0);
  assert.equal(run(ctx, 'HaituoRequestQueue.length'), 0);
});
