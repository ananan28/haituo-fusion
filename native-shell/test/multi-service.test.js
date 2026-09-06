'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
  SERVICE_CATALOG, findRecipe, publicCatalog, isAllowedNavigation
} = require('../src/service-catalog');
const { AdapterRegistry } = require('../src/adapter-registry');

test('本地目录包含平级 native 与常用 web 服务', () => {
  assert.equal(findRecipe('signal').adapter, 'signal');
  assert.equal(findRecipe('whatsapp').adapter, 'whatsapp');
  for (const id of ['telegram', 'messenger', 'instagram', 'discord', 'slack', 'teams', 'google-chat', 'gmail']) {
    const recipe = findRecipe(id);
    assert.ok(recipe, id);
    assert.equal(recipe.kind, 'web');
    assert.equal(recipe.adapter, 'web');
    assert.match(recipe.startUrl, /^https:\/\//);
  }
  assert.ok(SERVICE_CATALOG.length >= 10);
  assert.ok(publicCatalog().every(x => !('allowedHosts' in x)), '渲染层不暴露安全白名单');
});

test('导航严格限制在服务自己的 HTTPS 域名白名单', () => {
  assert.equal(isAllowedNavigation('telegram', 'https://web.telegram.org/k/'), true);
  assert.equal(isAllowedNavigation('telegram', 'http://web.telegram.org/k/'), false);
  assert.equal(isAllowedNavigation('telegram', 'https://telegram.org.evil.example/'), false);
  assert.equal(isAllowedNavigation('gmail', 'https://accounts.google.com/signin'), true);
  assert.equal(isAllowedNavigation('teams', 'https://login.microsoftonline.com/common/'), true);
  assert.equal(isAllowedNavigation('discord', 'javascript:alert(1)'), false);
  assert.equal(isAllowedNavigation('unknown', 'https://example.com/'), false);
});

test('适配器注册表把 Signal、WhatsApp、其他网页服务平级路由', async () => {
  const calls = [];
  const runtime = name => ({
    hide: () => calls.push(name + ':hide'),
    resizeAll: () => calls.push(name + ':resize'),
    setWindow: () => calls.push(name + ':window'),
    open: id => calls.push(name + ':open:' + id),
    refresh: (id, mode) => calls.push(name + ':refresh:' + id + ':' + mode),
    destroy: (id, purge) => calls.push(name + ':destroy:' + id + ':' + purge),
    update: s => calls.push(name + ':update:' + s.id),
    stopAll: () => calls.push(name + ':stopAll'),
    accountForWebContents: () => null
  });
  const signal = runtime('signal');
  signal.reconnect = id => calls.push('signal:reconnect:' + id);
  signal.removeAccount = id => calls.push('signal:remove:' + id);
  signal.stop = id => calls.push('signal:stop:' + id);
  const registry = new AdapterRegistry({
    signal, whatsapp: runtime('whatsapp'), web: runtime('web'),
    sendSignalRefresh: x => calls.push('signal:event:' + x.id)
  });
  await registry.open({ id: 'a', recipeId: 'telegram' });
  await registry.open({ id: 'b', recipeId: 'whatsapp' });
  await registry.open({ id: 'c', recipeId: 'signal' });
  await registry.refresh({ id: 'a', recipeId: 'discord' }, 'hard');
  assert.ok(calls.includes('web:open:a'));
  assert.ok(calls.includes('whatsapp:open:b'));
  assert.ok(!calls.includes('signal:open:c'));
  assert.ok(calls.includes('web:refresh:a:hard'));
});

test('同服务 N 账号获得独立持久分区和独立配置', () => {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') {
      return { session: { fromPartition: () => ({}) } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const storePath = require.resolve('../src/service-store');
  delete require.cache[storePath];
  const { ServiceStore, servicePartition } = require('../src/service-store');
  Module._load = originalLoad;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caisheng-services-'));
  try {
    const store = new ServiceStore(dir);
    const recipe = findRecipe('telegram');
    const one = store.add(recipe);
    const two = store.add(recipe);
    const three = store.add(recipe);
    assert.equal(store.list().length, 3);
    assert.equal(new Set([one.id, two.id, three.id]).size, 3);
    assert.equal(new Set([servicePartition(one.id), servicePartition(two.id), servicePartition(three.id)]).size, 3);
    store.update(two.id, { note: '客服二号', muted: true, unread: 7 });
    assert.equal(store.get(one.id).note, '');
    assert.equal(store.get(two.id).note, '客服二号');
    assert.equal(store.get(two.id).muted, true);
    assert.equal(store.get(two.id).unread, 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

