'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const mac=process.platform==='darwin';const app=path.resolve(mac?'macos/out/海拓-darwin-arm64/海拓.app':'windows/out/win-unpacked');
const exe=mac?path.join(app,'Contents/MacOS/海拓'):path.join(app,'海拓.exe');
const packed=mac?path.join(app,'Contents/Resources/app.asar'):path.join(app,'resources/app.asar');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-native-records-'));const probe=path.join(directory,'probe.cjs');
const script=String.raw`
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('node:module').createRequire(path.join(process.env.HAITUO_RECORDS_PACKED,'package.json'));
const {createStore}=load('./js/haituo-local-chat-records.js');
const directory=path.join(process.env.HAITUO_RECORDS_TMP,'database');
// This probes actual production SQLCipher encryption/native ABI. The key vault
// is a test double; this does not claim to test the user's OS keychain prompt.
const key=crypto.randomBytes(32);
const vault={isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},decryptString(blob){const decipher=crypto.createDecipheriv('aes-256-gcm',key,blob.subarray(0,12));decipher.setAuthTag(blob.subarray(-16));return Buffer.concat([decipher.update(blob.subarray(12,-16)),decipher.final()]).toString('utf8')}};
const id='false_123@c.us_native';let store=createStore({directory,safeStorage:vault});store.observe('A',[{id,source:'Native private original'}]);store.put('A',id,'Native private original','zh-CN',{text:'同一条消息内的译文'});
const history=n=>({id:'false_123@c.us_rank'+n,source:'History '+n});store.observe('A',[history(0),history(101)]);for(let start=1;start<=100;start+=20)store.observe('A',[history(start-1),...Array.from({length:20},(_,j)=>history(start+j)),history(101)]);assert.equal(store.page('A','123@c.us').total,103);store.close();
let raw=fs.readFileSync(path.join(directory,'messages.sqlite'));assert.notEqual(raw.subarray(0,16).toString(),'SQLite format 3\0');assert.equal(raw.includes(Buffer.from('Native private original')),false);
store=createStore({directory,safeStorage:vault});const record=store.page('A','123@c.us').messages[0];assert.equal(record.source,'Native private original');assert.equal(record.translations['zh-CN'].text,'同一条消息内的译文');assert.equal(store.page('B','123@c.us').total,0);store.close();
console.log('LOCAL_CHAT_NATIVE_SQLCIPHER_OK');`;
fs.writeFileSync(probe,script);try{const result=cp.spawnSync(exe,[probe],{encoding:'utf8',timeout:45000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HAITUO_RECORDS_PACKED:packed,HAITUO_RECORDS_TMP:directory}});fs.mkdirSync('audit-results',{recursive:true});fs.writeFileSync('audit-results/local-chat-native.json',JSON.stringify({platform:process.platform,status:result.status,stdout:result.stdout,stderr:result.stderr},null,2));if(result.error)throw result.error;if(result.status!==0||!result.stdout.includes('LOCAL_CHAT_NATIVE_SQLCIPHER_OK'))throw Error('Native SQLite verification failed: '+result.stderr);console.log(result.stdout);}finally{fs.rmSync(directory,{recursive:true,force:true})}
