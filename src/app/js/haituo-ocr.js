'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
async function recognize(bytes){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'haituo-ocr-'));
 try{const image=path.join(folder,'capture.png');await fs.writeFile(image,bytes,{mode:0o600});let command,args;
  const native=path.join(__dirname,'../native').replace(/app\.asar([/\\])/,'app.asar.unpacked$1');
  if(process.platform==='darwin'){command=path.join(native,'haituo-ocr');args=[image]}
  else if(process.platform==='win32'){command=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(native,'haituo-ocr.ps1'),'-ImagePath',image]}
  else throw Error('本地截图识字仅支持 Windows 和 macOS');
  let data;try{const output=await promisify(execFile)(command,args,{timeout:45000,windowsHide:true,maxBuffer:4*1024*1024,encoding:'utf8'});data=JSON.parse(output.stdout.replace(/^\uFEFF/,''))}catch(error){const failure=Error('系统识字失败（'+String(error.code||'OCR_ERROR').replace(/[^A-Z0-9_-]/gi,'').slice(0,30)+'）。'+(process.platform==='win32'?'请安装对应 OCR 语言包，或切换 AI 识图方式。':'请重新安装最新版，或切换 AI 识图方式。'));failure.cause=error;throw failure;}
  const blocks=(Array.isArray(data.blocks)?data.blocks:[]).filter(b=>typeof b.original==='string'&&b.original.trim()&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))).slice(0,200);
  if(!blocks.length)throw Error('未识别到文字，请框选更清晰的区域或切换 AI 识图');
  return {original:blocks.map(b=>b.original).join('\n'),blocks};
 }finally{await fs.rm(folder,{recursive:true,force:true})}
}
module.exports={recognize};
