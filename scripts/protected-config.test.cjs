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
    copyFileSync:(a,b)=>{if(!files.has(a))throw enoent();files.set(b,files.get(a))},
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

test('decryption failure keeps the file; the next save backs it up instead of clobbering',()=>{
  const warns=[];
  const files={[FILE]:ENCRYPTED_SETTINGS};
  const broken=goodStorage();
  broken.decryptString=()=>{throw Error('keychain denied')};
  const first=makeCtx({files,safeStorage:broken,warns});
  assert.deepEqual(first.ctx.haituoProtectedRead(FILE,{}),{},'unreadable config must fall back to defaults for this boot');
  assert.equal(first.mem.files.get(FILE),ENCRYPTED_SETTINGS,'the encrypted file must be preserved byte for byte');
  warns.length=0;
  // Settings must remain changeable: the original is backed up once, then the
  // new save lands. (The pre-1.5.0 "refuse forever" behavior bricked every
  // later settings change until manual cleanup.)
  assert.equal(first.ctx.haituoProtectedWrite(FILE,{apiKey:'new-key'}),true);
  const backup=[...first.mem.files.keys()].find(p=>p.startsWith(FILE+'.unreadable-'));
  assert.ok(backup,'an unreadable original must be backed up before being replaced');
  assert.equal(first.mem.files.get(backup),ENCRYPTED_SETTINGS,'backup holds the original bytes');
  assert.equal(JSON.parse(first.mem.files.get(FILE)).apiKey,'new-key','the new save lands');
  assert.ok(warns.some(w=>/backed up to/.test(w)),'the backup must be announced');
  for(const w of warns) assert.ok(!w.includes(SECRET)&&!w.includes('new-key'),'logs must never contain secret material: '+w);
  const backupsBefore=[...first.mem.files.keys()].filter(p=>p.startsWith(FILE+'.unreadable-')).length;
  first.ctx.haituoProtectedWrite(FILE,{apiKey:'newer-key'});
  const backupsAfter=[...first.mem.files.keys()].filter(p=>p.startsWith(FILE+'.unreadable-')).length;
  assert.equal(backupsAfter,backupsBefore,'one backup per session, no backup spam');
  // Keychain healed after restart: a later boot reads the fresh file fine.
  const healed=makeCtx({files:Object.fromEntries(first.mem.files),safeStorage:goodStorage(),warns:[]});
  assert.equal(healed.ctx.haituoProtectedRead(FILE,{}).apiKey,'newer-key');
});

test('decrypt refuses during startup are retried until the app is ready (no settings reset)',()=>{
  const warns=[];
  const files={[FILE]:ENCRYPTED_SETTINGS};
  const flaky=goodStorage();
  let failures=3;
  const storage={
    isEncryptionAvailable:()=>true,
    encryptString:v=>flaky.encryptString(v),
    decryptString:b=>{ if(failures>0){failures--;throw Error('not ready yet')} return flaky.decryptString(b) },
  };
  const ctx={Buffer,console,JSON,Date,
    process:{platform:'win32',pid:4242},
    p:{app:{isReady:()=>false},safeStorage:storage},
    m:memfs(files),
    s:{dirname:p=>p.split('/').slice(0,-1).join('/')||'/',basename:p=>String(p).split('/').pop()},
    X:{info(){},warn(...a){warns.push(a.join(' '))},error(){}},
  };
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  assert.equal(ctx.haituoProtectedRead(FILE,{}).apiKey,SECRET,'startup decrypt hiccups must not reset settings');
});

test('after the app is ready a decrypt failure is real: blocked at once, no retry storm',()=>{
  const warns=[];
  const files={[FILE]:ENCRYPTED_SETTINGS};
  const broken=goodStorage();
  let calls=0;
  broken.decryptString=()=>{calls++;throw Error('keychain denied')};
  const ctx={Buffer,console,JSON,Date,
    process:{platform:'win32',pid:4242},
    p:{app:{isReady:()=>true},safeStorage:broken},
    m:memfs(files),
    s:{dirname:p=>p.split('/').slice(0,-1).join('/')||'/',basename:p=>String(p).split('/').pop()},
    X:{info(){},warn(...a){warns.push(a.join(' '))},error(){}},
  };
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{});
  assert.equal(calls,1,'ready-state failures must not be retried');
});

test('corrupt JSON is an unreadable original: kept, backed up on save, never silently replaced',()=>{
  const warns=[];
  const files={[FILE]:'{"apiKey":"'+SECRET+'", broken'};
  const {ctx,mem}=makeCtx({files,safeStorage:goodStorage(),warns});
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{ok:1}),{ok:1});
  assert.equal(mem.files.get(FILE),files[FILE],'corrupt file stays untouched on read');
  warns.length=0;
  assert.equal(ctx.haituoProtectedWrite(FILE,{fresh:true}),true,'save still lands');
  const backup=[...mem.files.keys()].find(p=>p.startsWith(FILE+'.unreadable-'));
  assert.ok(backup,'corrupt original must be backed up before replacement');
  assert.equal(mem.files.get(backup),files[FILE]);
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{fresh:true},'fresh settings land and read back');
});

test('empty decryption result is a failure, not an empty config',()=>{
  const warns=[];
  const storage=goodStorage();
  storage.decryptString=()=>'';
  const {ctx,mem}=makeCtx({files:{[FILE]:ENCRYPTED_SETTINGS},safeStorage:storage,warns});
  assert.deepEqual(ctx.haituoProtectedRead(FILE,{}),{});
  assert.equal(mem.files.get(FILE),ENCRYPTED_SETTINGS);
  // A later save backs the empty-decrypt file up and proceeds.
  assert.equal(ctx.haituoProtectedWrite(FILE,{x:1}),true);
  const backup=[...mem.files.keys()].find(p=>p.startsWith(FILE+'.unreadable-'));
  assert.ok(backup);
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
