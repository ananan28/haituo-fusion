'use strict';
// P1-07 regression: an exception from safeStorage.encryptString during the
// getSQLKey key-upgrade must not abort startup. The encrypt call sits outside
// the round-trip try/catch; if it throws (keychain locked mid-boot on macOS,
// DPAPI hiccup on Windows) the whole boot died with an unhandled rejection
// even though a perfectly usable plaintext recovery key was in config.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
const start=code.indexOf('function Fv()');
const end=code.indexOf('\nfunction Lv()',start);
assert.ok(start>=0&&end>start,'getSQLKey slice found');
const slice=code.slice(start,end);

const KEY='a'.repeat(64);

function makeCtx({config={},encrypt,decrypt,isAvailable=true}){
  const warns=[],infos=[];
  const writes=[];
  const ctx={
    Buffer,console,JSON,process:{platform:'win32',env:{}},
    f:{randomBytes:n=>Buffer.alloc(n,7)},
    n:{Lt:{isLinux:()=>false}},
    p:{app:{isPackaged:true},safeStorage:{
      isEncryptionAvailable:()=>isAvailable,
      encryptString:encrypt,
      decryptString:decrypt,
    }},
    a:{S:()=>false,y:()=>'test'},
    $u:'signal-main',
    lg:class extends Error{},
    ug:class extends Error{},
    X:{info(...a){infos.push(a.join(' '))},warn(...a){warns.push(a.join(' '))},error(){}},
    fd:(k,v)=>{writes.push([k,v])},
    Lv:()=>'continue',
  };
  ctx.ud=k=>config[k];
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  return {ctx,warns,infos,writes};
}

test('encryptString throwing during upgrade keeps the plaintext key and still returns it',()=>{
  const {ctx,warns,writes}=makeCtx({
    config:{key:KEY},
    encrypt:()=>{throw Error('keychain locked')},
    decrypt:()=>KEY,
  });
  assert.equal(ctx.Iv(),KEY,'boot must not die on an encrypt exception');
  assert.ok(writes.some(([k])=>k==='key'),'plaintext recovery key must be (re)written');
  assert.ok(!writes.some(([k])=>k==='encryptedKey'),'no ciphertext may be stored when encrypt failed');
  assert.ok(warns.some(w=>/encrypt threw/.test(w)),'the degradation must be logged');
});

test('normal upgrade still stores the encrypted key and drops the plaintext one',()=>{
  const {ctx,writes}=makeCtx({
    config:{key:KEY},
    encrypt:v=>Buffer.from('ENC:'+v),
    decrypt:b=>{const t=b.toString();return t.startsWith('ENC:')?t.slice(4):''},
  });
  assert.equal(ctx.Iv(),KEY);
  const enc=writes.find(([k])=>k==='encryptedKey');
  assert.ok(enc&&typeof enc[1]==='string'&&enc[1].length>0,'ciphertext must be persisted');
  assert.ok(writes.some(([k,v])=>k==='key'&&v===undefined),'plaintext key dropped after a verified upgrade on win32');
});

test('a throwing round-trip check still counts as a failed check, not a crashed boot',()=>{
  const {ctx,warns,writes}=makeCtx({
    config:{key:KEY},
    encrypt:()=>Buffer.from('ENC:x'),
    decrypt:()=>{throw Error('decrypt exploded')},
  });
  assert.equal(ctx.Iv(),KEY);
  assert.ok(writes.some(([k,v])=>k==='key'&&v===KEY),'plaintext key kept when the round-trip cannot prove itself');
  assert.ok(warns.some(w=>/round-trip/.test(w)));
});
