'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
const start=code.indexOf('function Fv()'),end=code.indexOf('\nfunction Lv',start);
assert.ok(start>=0&&end>start,'getSQLKey slice found');
const slice=code.slice(start,end);

function makeContext({platform='darwin',config=new Map(),safeStorage}){
  const store=config;
  const ctx={
    Buffer,console,
    process:{platform,env:{}},
    n:{Lt:{isLinux:()=>false}},
    a:{S:()=>true,y:()=>'production'},
    $u:'signal-main',
    p:{app:{isPackaged:true},safeStorage},
    f:{randomBytes:n=>crypto.randomBytes(n)},
    X:{info(){},warn(){},error(){}},
    lg:class SafeStorageBackendChange extends Error{},
    ug:class SafeStorageDecryptionError extends Error{},
    Lv:()=>'continue',
    ud:key=>store.get(key),
    fd:(key,value)=>{value===void 0?store.delete(key):store.set(key,value)},
  };
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  return ctx;
}
function goodStorage(){
  return {
    isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from('ENC:'+value),
    decryptString:blob=>{const text=Buffer.isBuffer(blob)?blob.toString():String(blob);return text.startsWith('ENC:')?text.slice(4):''},
  };
}

test('keychain failure with a recovery key keeps the app bootable',()=>{
  const storage=goodStorage();
  storage.decryptString=()=>{throw Error('keychain denied')};
  // throwing failure
  let ctx=makeContext({config:new Map([['key','a'.repeat(64)],['encryptedKey','deadbeef']]),safeStorage:storage});
  assert.equal(ctx.Iv(),'a'.repeat(64));
  assert.equal(ctx.Iv(),'a'.repeat(64));
  // silent empty failure must be treated the same way
  const silent=goodStorage();
  silent.decryptString=()=>'';
  ctx=makeContext({config:new Map([['key','b'.repeat(64)],['encryptedKey','deadbeef']]),safeStorage:silent});
  assert.equal(ctx.Iv(),'b'.repeat(64));
});

test('keychain failure without a recovery key surfaces a hard error instead of an empty key',()=>{
  const storage=goodStorage();
  storage.decryptString=()=>{throw Error('keychain denied')};
  const ctx=makeContext({config:new Map([['encryptedKey','deadbeef']]),safeStorage:storage});
  assert.throws(()=>ctx.Iv(),/keychain denied/);
});

test('fresh install on broken keychain persists a plaintext recovery key',()=>{
  const storage=goodStorage();
  storage.encryptString=()=>Buffer.from('');
  const config=new Map();
  const ctx=makeContext({config,safeStorage:storage});
  const key=ctx.Iv();
  assert.match(key,/^[0-9a-f]{64}$/);
  assert.equal(config.get('key'),key);
  assert.equal(config.has('encryptedKey'),false);
});

test('fresh install on macOS keeps the plaintext recovery key next to the encrypted key',()=>{
  const config=new Map();
  const ctx=makeContext({platform:'darwin',config,safeStorage:goodStorage()});
  const key=ctx.Iv();
  assert.equal(config.get('key'),key);
  assert.equal(Buffer.from(config.get('encryptedKey'),'hex').toString(),'ENC:'+key);
});

test('windows drops the plaintext key only after a verified round-trip',()=>{
  const config=new Map([['key','c'.repeat(64)]]);
  const ctx=makeContext({platform:'win32',config,safeStorage:goodStorage()});
  const key=ctx.Iv();
  assert.equal(key,'c'.repeat(64));
  assert.equal(config.get('key'),undefined);
  assert.equal(Buffer.from(config.get('encryptedKey'),'hex').toString(),'ENC:'+key);
  // A broken round-trip keeps the recovery key on windows too.
  const storage=goodStorage();
  storage.encryptString=()=>Buffer.from('ENC:gibberish');
  const config2=new Map([['key','d'.repeat(64)]]);
  const ctx2=makeContext({platform:'win32',config:config2,safeStorage:storage});
  assert.equal(ctx2.Iv(),'d'.repeat(64));
  assert.equal(config2.get('key'),'d'.repeat(64));
  assert.equal(config2.has('encryptedKey'),false);
});

test('windows keeps the recovery key after a decryption failure (repeat failure must not brick)',()=>{
  const storage=goodStorage();
  storage.decryptString=()=>{throw Error('DPAPI unavailable')};
  const config=new Map([['key','f'.repeat(64)],['encryptedKey','deadbeef']]);
  const ctx=makeContext({platform:'win32',config,safeStorage:storage});
  assert.equal(ctx.Iv(),'f'.repeat(64));
  assert.equal(config.get('key'),'f'.repeat(64),'boot that used the recovery key must not delete it');
  const ctx2=makeContext({platform:'win32',config,safeStorage:storage});
  assert.equal(ctx2.Iv(),'f'.repeat(64),'second boot with decryption still failing must recover again');
  assert.equal(config.get('key'),'f'.repeat(64));
});

test('windows drops the plaintext key again once decryption genuinely succeeds',()=>{
  const config=new Map([['key','f'.repeat(64)]]);
  const failing=goodStorage();
  failing.decryptString=()=>{throw Error('DPAPI unavailable')};
  const ctx=makeContext({platform:'win32',config,safeStorage:failing});
  assert.equal(ctx.Iv(),'f'.repeat(64));
  assert.equal(config.get('key'),'f'.repeat(64));
  // DPAPI healthy again on the next boot: the encrypted key decrypts, so the
  // plaintext recovery key may be dropped as usual.
  const healthy=makeContext({platform:'win32',config,safeStorage:goodStorage()});
  assert.equal(healthy.Iv(),'f'.repeat(64));
  assert.equal(config.get('key'),undefined);
});

test('empty ciphertext left by an older build never becomes the database key',()=>{
  const config=new Map([['encryptedKey','']]);
  const ctx=makeContext({config,safeStorage:goodStorage()});
  const key=ctx.Iv();
  assert.match(key,/^[0-9a-f]{64}$/);
  assert.notEqual(key,'');
});

test('recovery key verification drops plaintext only off darwin',()=>{
  const key='e'.repeat(64),encrypted='ENC:'+key;
  for(const [platform,drops] of [['win32',true],['darwin',false]]){
    const config=new Map([['key',key],['encryptedKey',Buffer.from(encrypted).toString('hex')]]);
    const ctx=makeContext({platform,config,safeStorage:goodStorage()});
    assert.equal(ctx.Iv(),key);
    assert.equal(config.get('key')===undefined,drops,platform);
  }
});
