'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const mac=process.platform==='darwin',app=path.resolve(mac?'macos/out/海拓-darwin-arm64/海拓.app/Contents/MacOS/海拓':'windows/out/win-unpacked/海拓.exe'),report=path.resolve('audit-results/wa-guest-startup.json'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-wa-guest-'));
fs.mkdirSync(path.dirname(report),{recursive:true});fs.rmSync(report,{force:true});
const child=cp.spawn(app,['--user-data-dir='+profile],{env:{...process.env,HAITUO_WA_GUEST_TEST:'1',HAITUO_WA_GUEST_REPORT:report},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes.toString()).slice(-100000)});
const timeout=setTimeout(()=>{child.kill();console.error('WA_GUEST_TEST_TIMEOUT',output);process.exitCode=1},90000);
child.on('error',error=>{clearTimeout(timeout);console.error(error);process.exitCode=1});child.on('exit',(code,signal)=>{clearTimeout(timeout);fs.writeFileSync(path.resolve('audit-results/wa-guest-startup.log'),output);let result;try{result=JSON.parse(fs.readFileSync(report,'utf8'))}catch{}console.log('WA_GUEST_NATIVE_RESULT',JSON.stringify(result||{code,signal,tail:output.slice(-8000)}));if(code!==0||!result?.ok)process.exitCode=1});
