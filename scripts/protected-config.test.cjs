'use strict';
// Regression tests for haituoProtectedRead/haituoProtectedWrite
// (src/app/bundles/main.js). The whole point of these tests is executing the
// real bundle code, not a re-implementation: every safeStorage failure mode
// must end with either a verified encrypted file or a readable plaintext
// file — and a file that could not be decrypted must never be overwritten.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync(__dirname+'/../src/app/bundles/main.js','utf8');
const start=code.indexOf('const HaituoProtectedBlockedFiles');
const end=code.indexOf('\nlet HaituoTranslationCache',start);
assert.ok(start>=0&&end>start,'protected read/write slice found');
const slice=code.slice(start,end);

const FILE='/data/Haituo/translation-settings.json';

function enoent(){const e=new Error('no such file');e.code='ENOENT';return e}

function memfs(initial={}){
  const files=new Map(Object.entries(initial));
  return {
    files,
    readFileSync:p=>{if(!files.has(p))throw enoent();return files.get(p)},
    writeFileSync:(p,c)=>files.set(p,String(c)),
    renameSync:(a,b)=>{if(!files.has(a))throw enoent();files.set(b,files.get(a));files.delete(a)},
    mkdirSync:()=>{},
  };
}

function makeCtx({files,safeStorage,warns}){
  const mem=memfs(files);
  const s={dirname:p=>p.split('/').slice(0,-1).join('/')||'/',basename:p=>String(p).split('/').pop()};
  const ctx={
    Buffer,console,JSON,
    process:{platform:'darwin',pid:4242},
    p:{safeStorage},
    m:mem,
    s,
    X:{info(){},warn(...a){warns.push(a.join(' '))},error(){}},
  };
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  return {ctx,mem};
}

function goodStorage(){
  return {
    isEncryptionAvailable:()=>true,
    encryptString:v=>Buffer.from('ENC:'+v),
    decryptString:b=>{const t=Buffer.isBuffer(b)?b.toString():String(b);return t.startsWith('ENC:')?t.slice(4):''},
  };
}
const SECRET='sk-live-abcdef1234567890';
const SETTINGS=JSON.stringify({apiKey:SECRET,model:'gpt-4.1-mini',chatTranslationProvider:'openai'});
const ENCRYPTED_SETTINGS=JSON.stringify({haituoEncrypted:1,data:Buffer.from('ENC:'+SETTINGS).toString('base64')});

test('missing file reads as fallback; a working keychain encrypts the first save',()=>{
  const warns=[];
  const {ctx,mem}=makeCtx({files:{},safeStorage:goodStorage(),warns});
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{fresh:1}),{fresh:1});
  assert.equal(ctx.haituoProtectedWrite(FILE,{apiKey:SECRET}),true);
  const parsed=JSON.parse(mem.files.get(FILE));
  assert.equal(parsed.haituoEncrypted,1,'a proven keychain stores settings encrypted');
  assert.equal(mem.files.get(FILE).includes(SECRET),false);
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{apiKey:SECRET},'the encrypted file reads back');
});

test('plaintext file reads back unchanged',()=>{
  const warns=[];
  const {ctx}=makeCtx({files:{[FILE]:SETTINGS}},warns);
  const value=ctx.haituoProtectedRead(FILE,{});
  assert.equal(value.apiKey,SECRET);
  assert.equal(value.model,'gpt-4.1-mini');
});

test('verified encryption round-trip upgrades a plaintext file (macOS migration)',()=>{
  const warns=[];
  const {ctx,mem}=makeCtx({files:{[FILE]:SETTINGS},safeStorage:goodStorage(),warns});
  const value=ctx.haituoProtectedRead(FILE,{});
  assert.equal(ctx.haituoProtectedWrite(FILE,value),true);
  const onDisk=mem.files.get(FILE);
  const parsed=JSON.parse(onDisk);
  assert.equal(parsed.haituoEncrypted,1,'plaintext settings must be upgraded to ciphertext once the keychain proves itself');
  assert.notEqual(onDisk.includes(SECRET),true,'ciphertext must not contain the API key verbatim');
  // And the very next boot reads the encrypted file back to the same value.
  const again=ctx.haituoProtectedRead(FILE,{});
  assert.equal(again.apiKey,SECRET);
  assert.equal(again.model,'gpt-4.1-mini');
});

test('decryption failure keeps the file, blocks overwrites, and recovers once the keychain heals',()=>{
  const warns=[];
  const files={[FILE]:ENCRYPTED_SETTINGS};
  const broken=goodStorage();
  broken.decryptString=()=>{throw Error('keychain denied')};
  const first=makeCtx({files,safeStorage:broken,warns});
  assert.deepEqual(first.ctx.haituoProtectedRead(FILE,{}),{},'unreadable config must fall back to defaults for this boot');
  assert.equal(first.mem.files.get(FILE),ENCRYPTED_SETTINGS,'the encrypted file must be preserved byte for byte');
  warns.length=0;
  assert.equal(first.ctx.haituoProtectedWrite(FILE,{apiKey:'new-key'}),false,'a save must not clobber a file it could not read');
  assert.equal(first.mem.files.get(FILE),ENCRYPTED_SETTINGS);
  assert.ok(warns.some(w=>/refusing to overwrite/.test(w)),'the refusal must be loud');
  for(const w of warns) assert.ok(!w.includes(SECRET)&&!w.includes('new-key'),'logs must never contain secret material: '+w);
  // Keychain healed after restart: the original settings are back, writable again.
  const healed=makeCtx({files,safeStorage:goodStorage(),warns:[]});
  const value=healed.ctx.haituoProtectedRead(FILE,{});
  assert.equal(value.apiKey,SECRET,'original settings survive the outage');
  assert.equal(healed.ctx.haituoProtectedWrite(FILE,value),true);
});

test('empty decryption result is a failure, not an empty config',()=>{
  const warns=[];
  const storage=goodStorage();
  storage.decryptString=()=>'';
  const {ctx,mem}=makeCtx({files:{[FILE]:ENCRYPTED_SETTINGS},safeStorage:storage,warns});
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{});
  assert.equal(mem.files.get(FILE),ENCRYPTED_SETTINGS);
  assert.equal(ctx.haituoProtectedWrite(FILE,{x:1}),false);
});

test('every encryption failure mode still saves a readable plaintext file',()=>{
  const modes={
    // unavailable keychain is a normal state (no keychain at all), not an error
    'encryption unavailable':{warn:false,make:()=>({isEncryptionAvailable:()=>false,encryptString(){throw Error('unreachable')},decryptString(){throw Error('unreachable')}})},
    'encryptString throws':{warn:true,make:()=>{const s=goodStorage();s.encryptString=()=>{throw Error('DPAPI broken')};return s}},
    'empty ciphertext':{warn:true,make:()=>{const s=goodStorage();s.encryptString=()=>Buffer.from('');return s}},
    'round-trip mismatch':{warn:true,make:()=>{const s=goodStorage();s.decryptString=()=>'something else';return s}},
    'round-trip throws':{warn:true,make:()=>{const s=goodStorage();s.decryptString=()=>{throw Error('decrypt exploded')};return s}},
  };
  for(const [name,{warn,make}] of Object.entries(modes)){
    const warns=[];
    const {ctx,mem}=makeCtx({files:{},safeStorage:make(),warns});
    assert.equal(ctx.haituoProtectedWrite(FILE,{apiKey:SECRET}),true,name+': save must land');
    assert.equal(mem.files.get(FILE),JSON.stringify({apiKey:SECRET}),name+': plaintext fallback expected');
    assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{apiKey:SECRET},name+': fallback file must read back');
    assert.equal(warns.some(w=>/falling back to a plaintext file/.test(w)),warn,name+': fallback logging policy');
    for(const w of warns) assert.ok(!w.includes(SECRET),name+': log leaked the secret: '+w);
  }
});

test('a hard write failure (rename fails) surfaces instead of pretending success',()=>{
  const warns=[];
  const {ctx,mem}=makeCtx({files:{},safeStorage:goodStorage(),warns});
  mem.renameSync=()=>{throw Error('read-only directory')};
  assert.throws(()=>ctx.haituoProtectedWrite(FILE,{apiKey:SECRET}),/read-only directory/);
  assert.equal(mem.files.has(FILE),false);
});

test('corrupt JSON falls back loudly without leaking contents',()=>{
  const warns=[];
  const garbage='{"apiKey":"'+SECRET+'", broken';
  const {ctx}=makeCtx({files:{[FILE]:garbage},safeStorage:goodStorage(),warns});
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{ok:1}),{ok:1});
  assert.ok(warns.some(w=>/not valid JSON/.test(w)));
  for(const w of warns) assert.ok(!w.includes(SECRET),'corrupt-content leak: '+w);
});
