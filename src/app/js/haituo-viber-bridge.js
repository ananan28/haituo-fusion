'use strict';
// Private native-helper pipe. Neither images nor OCR text are written to logs or account files.
const {EventEmitter}=require('node:events');
const validID=id=>typeof id==='string'&&/^viber-[a-z0-9][a-z0-9_-]{0,47}$/.test(id);
function createBridge({binary,platform=process.platform,spawn=require('node:child_process').spawn,exists=require('node:fs').existsSync,readAccounts=()=>({}),saveAccounts=()=>{},hostBounds,onEvent=()=>{},recognize=require('./haituo-ocr').recognize}){
 let child=null,epoch=0,active=null,ready=false,lastFrame=null,buffer='',closed=false;
 const saved=readAccounts(),accounts=new Map();
 for(const [id,slot] of Object.entries(saved||{}))if(validID(id)&&Number.isInteger(slot)&&slot>=1&&slot<=5&&![...accounts.values()].includes(slot))accounts.set(id,slot);
 const events=new EventEmitter();events.on('event',onEvent);
 function publish(value){events.emit('event',{accountId:active,epoch,...value})}
 function available(){return platform==='darwin'&&exists(binary)}
 function write(value){if(!child||!child.stdin?.writable)throw Error('Viber 捕获助手未连接');child.stdin.write(JSON.stringify(value)+'\n')}
 function reset(message){ready=false;lastFrame=null;publish({type:'clear'});if(message)publish({type:'state',ready:false,pending:false,status:message})}
 function retire(proc){if(child!==proc)return;child=null;buffer='';reset('Viber 捕获助手已退出，请重新选择账号')}
 function start(){
  if(closed)throw Error('Viber bridge closed');if(child)return;
  if(!available())throw Error('当前安装包尚不支持 Viber 原生融合（需要 macOS 捕获助手）');
  const proc=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});child=proc;buffer='';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data',chunk=>{
   if(child!==proc)return;buffer+=chunk;
   if(buffer.length>9*1024*1024){proc.kill();retire(proc);return}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let event;try{event=JSON.parse(line)}catch{continue}
    if(!active||event.epoch!==epoch||event.type==='frame'&&event.slot!==accounts.get(active))continue;
    if(event.type==='clear'){reset();continue}
    if(event.type==='state'){ready=event.ready===true;publish({type:'state',ready,pending:event.pending===true,status:String(event.status||'').slice(0,2000)});continue}
    if(event.type==='frame'&&typeof event.image==='string'&&event.image.length<8*1024*1024&&/^[A-Za-z0-9+/]+={0,2}$/.test(event.image)&&Number.isFinite(event.width)&&Number.isFinite(event.height)&&event.width>0&&event.height>0&&event.width*event.height<40e6){lastFrame={image:event.image,epoch};publish({type:'frame',image:'data:image/jpeg;base64,'+event.image,width:event.width,height:event.height})}
   }
  });
  // Drain diagnostics without recording paths, image data, QR codes, or chat text.
  proc.stderr.on('data',()=>{});proc.on('error',()=>retire(proc));proc.on('exit',()=>retire(proc));proc.stdin.on('error',()=>retire(proc));
 }
 function bounds(){const r=hostBounds();if(!r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0)throw Error('无法获取主窗口几何');return{x:r.x,y:r.y,width:r.width,height:r.height}}
 function select(id){
  if(!validID(id))throw Error('Viber 账号标识无效');
  const rect=bounds();if(!available())throw Error('当前安装包尚不支持 Viber 原生融合（需要 macOS 捕获助手）');
  if(!accounts.has(id)){const slot=[1,2,3,4,5].find(slot=>![...accounts.values()].includes(slot));if(!slot)throw Error('Viber 原型最多保留五个独立账号目录；删除标签不会复用其他账号的数据');const next=Object.fromEntries([...accounts,[id,slot]]);saveAccounts(next);accounts.set(id,slot)}
  start();active=id;epoch++;reset();write({type:'select',slot:accounts.get(id),epoch,bounds:rect});return{epoch,slot:accounts.get(id)}
 }
 function current(id,token){return active===id&&token===epoch&&!!child}
 function hide(id,token){if(!current(id,token))return;write({type:'hide',epoch:++epoch});reset();active=null}
 function geometry(){if(active&&child)write({type:'bounds',epoch,bounds:bounds()})}
 function click(id,token,x,y){if(!current(id,token)||!ready)return false;if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)throw Error('点击坐标无效');write({type:'click',epoch,x,y});return true}
 async function ocr(id,token){if(!current(id,token)||!ready||lastFrame?.epoch!==epoch)throw Error('当前 Viber 画面尚未就绪');const snapshot=lastFrame;const result=await recognize(Buffer.from(snapshot.image,'base64'));if(!current(id,token)||!ready)throw Error('账号已切换，已丢弃旧画面识字结果');return{original:result.original}}
 function close(){if(closed)return;closed=true;const proc=child;child=null;epoch++;ready=false;lastFrame=null;active=null;if(proc){proc.stdin.end();const timer=setTimeout(()=>proc.kill(),2000);timer.unref?.();proc.once('exit',()=>clearTimeout(timer))}events.removeAllListeners()}
 return{available,select,hide,geometry,click,ocr,close,onEvent(fn){events.on('event',fn);return()=>events.removeListener('event',fn)}};
}
module.exports={createBridge,validID};
