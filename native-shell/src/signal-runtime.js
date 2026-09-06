'use strict';
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const safeId = id => {
  const value=String(id||'');
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new Error('Signal 账号标识无效');
  return value;
};
const jsonRead=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}};
const atomicWrite=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file)};
class SignalRuntime extends EventEmitter {
 constructor(userData,resourcesPath){super();this.root=path.join(userData,'signal-accounts');this.resources=path.join(resourcesPath,'signal-runtime');this.processes=new Map();this.pending=new Map();this.seq=0;fs.mkdirSync(this.root,{recursive:true});}
 paths(id){id=safeId(id);const root=path.join(this.root,id);return{root,config:path.join(root,'config'),state:path.join(root,'state.json'),history:path.join(root,'history.jsonl'),attachments:path.join(root,'attachments')}}
 state(id){return jsonRead(this.paths(id).state,{id,status:'未连接',phone:'',deviceName:'财盛聚合聊天'})}
 saveState(id,patch){const next={...this.state(id),...patch,id,updatedAt:Date.now()};atomicWrite(this.paths(id).state,next);this.emit('state',next);return next}
 binary(){const java=path.join(this.resources,'jre','bin',process.platform==='win32'?'java.exe':'java');const jar=path.join(this.resources,'signal-cli','lib','signal-cli-0.14.7.jar');if(!fs.existsSync(java)||!fs.existsSync(jar))throw new Error('内置 Signal 运行环境不完整');return{java,jar}}
 async link(id){const p=this.paths(id),b=this.binary();fs.mkdirSync(p.config,{recursive:true});this.saveState(id,{status:'等待扫码'});return new Promise((resolve,reject)=>{execFile(b.java,['-jar',b.jar,'--config',p.config,'link','-n','财盛聚合聊天'],{windowsHide:true,timeout:120000,maxBuffer:2e6},(e,out,err)=>{const uri=(String(out)+'\n'+String(err)).match(/sgnl:\/\/linkdevice\?[^\s]+/i)?.[0];if(e&&!uri)return reject(new Error('生成二维码失败：'+(err||e.message)));if(!uri)return reject(new Error('未获得 Signal 二维码'));this.saveState(id,{status:'等待扫码',linkUri:uri});resolve({uri})})})}
 async start(id){if(this.processes.has(id))return this.state(id);const p=this.paths(id),b=this.binary();fs.mkdirSync(p.attachments,{recursive:true});const child=spawn(b.java,['-Xms32m','-Xmx256m','-jar',b.jar,'--config',p.config,'jsonRpc','--receive-mode','on-start'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,JAVA_HOME:path.dirname(path.dirname(b.java))}});const rt={child,buffer:''};this.processes.set(id,rt);child.stdout.on('data',d=>this.consume(id,String(d)));child.stderr.on('data',d=>this.emit('log',{id,message:String(d)}));child.on('exit',(code)=>{this.processes.delete(id);this.saveState(id,{status:'离线',error:code?'后台退出：'+code:''});for(const [k,v] of this.pending)if(k.startsWith(id+':')){v.reject(new Error('Signal 后台已退出'));this.pending.delete(k)}});this.saveState(id,{status:'在线',error:'',linkUri:''});return this.state(id)}
 consume(id,data){const rt=this.processes.get(id);if(!rt)return;rt.buffer+=data;let i;while((i=rt.buffer.indexOf('\n'))>=0){const line=rt.buffer.slice(0,i).trim();rt.buffer=rt.buffer.slice(i+1);if(!line)continue;try{const m=JSON.parse(line);if(m.id!=null){const key=id+':'+m.id,p=this.pending.get(key);if(p){this.pending.delete(key);m.error?p.reject(new Error(m.error.message||'Signal 请求失败')):p.resolve(m.result)}}else if(m.method){const msg=this.normalize(id,m.params?.envelope||m.params||m);if(msg){fs.appendFileSync(this.paths(id).history,JSON.stringify(msg)+'\n');this.emit('message',msg)}}}catch{}}}
 rpc(id,method,params={}){if(!this.processes.has(id))throw new Error('Signal 账号未在线');const n=++this.seq,key=id+':'+n,rt=this.processes.get(id);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(key);reject(new Error('Signal 请求超时'))},30000);this.pending.set(key,{resolve:x=>{clearTimeout(timer);resolve(x)},reject:x=>{clearTimeout(timer);reject(x)}});rt.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n')})}
 normalize(accountId,e){const d=e.dataMessage||e.syncMessage?.sentMessage;if(!d)return null;return{id:String(d.timestamp||Date.now()),accountId,conversationId:e.sourceNumber||e.sourceUuid||d.groupInfo?.groupId||'未知会话',sender:e.sourceName||e.sourceNumber||'未知联系人',text:d.message||'',timestamp:Number(d.timestamp||Date.now()),attachments:d.attachments||[],quote:d.quote||null,reaction:d.reaction||null,remoteDelete:d.remoteDelete||null}}
 async conversations(id){await this.start(id);const [contacts,groups]=await Promise.allSettled([this.rpc(id,'listContacts'),this.rpc(id,'listGroups')]);const out=[];for(const c of contacts.value||[])out.push({id:c.number||c.uuid,name:c.name||c.number,avatar:c.profile?.avatar||''});for(const g of groups.value||[])out.push({id:g.id,name:g.name||'未命名群组',group:true,avatar:g.avatar||''});return out}
 history(id,conversationId,limit=300){let lines=[];try{lines=fs.readFileSync(this.paths(id).history,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)}catch{}return lines.filter(x=>!conversationId||x.conversationId===conversationId).slice(-Math.min(1000,Math.max(1,limit)))}
 async send(id,to,text,files=[],quote){await this.start(id);const params={recipient:[to],message:text||''};if(files.length)params.attachments=files.map(String);if(quote)params.quoteTimestamp=Number(quote.timestamp),params.quoteAuthor=quote.author,params.quoteMessage=quote.text||'';return this.rpc(id,'send',params)}
 react(id,to,emoji,target,remove=false){return this.rpc(id,'sendReaction',{recipient:[to],emoji,targetAuthor:target.author,targetTimestamp:Number(target.timestamp),remove})}
 edit(id,to,targetTimestamp,text){return this.rpc(id,'send',{recipient:[to],message:text,editTimestamp:Number(targetTimestamp)})}
 remove(id,to,targetTimestamp){return this.rpc(id,'sendRemoteDelete',{recipient:[to],targetTimestamp:Number(targetTimestamp)})}
 async reconnect(id){await this.stop(id);return this.start(id)}
 stop(id){const rt=this.processes.get(id);if(!rt)return Promise.resolve();return new Promise(resolve=>{rt.child.once('exit',resolve);if(process.platform==='win32')execFile('taskkill',['/pid',String(rt.child.pid),'/t','/f'],()=>resolve());else rt.child.kill('SIGTERM');setTimeout(resolve,3000)})}
 async stopAll(){await Promise.all([...this.processes.keys()].map(id=>this.stop(id)))}
}
module.exports={SignalRuntime};
