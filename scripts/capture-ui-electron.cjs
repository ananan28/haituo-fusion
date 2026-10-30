'use strict';
const e=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const resources=process.argv[2],out=process.argv[3],report={checks:[],errors:[],installedAppTCC:'UNTESTED: CI helper/harness permission does not prove installed application permission'};
e.app.on('window-all-closed',()=>{}); // Keep the harness alive until the report is written.
const guard=setTimeout(()=>{console.error('CAPTURE_UI_TIMEOUT');e.app.exit(1)},90000);
(async()=>{await e.app.whenReady();fs.mkdirSync(out,{recursive:true});
 const cfg=JSON.parse(fs.readFileSync(path.join(resources,'package.json'),'utf8'));
 if(cfg.version!=='1.6.8'||cfg.signalProtocolVersion!=='8.29.0-alpha.1')throw Error('Release and protocol versions not separated: '+JSON.stringify(cfg));
 report.checks.push({id:'PACKAGED-VERSION',ok:true,version:cfg.version,signalProtocolVersion:cfg.signalProtocolVersion});
 const {createController}=require(path.join(resources,'js/haituo-screenshot.js'));
 const controller=createController({electron:e,getConfig:()=>({}),requestJSON:async()=>{throw Error('UI test must not call an API')}});
 report.ui=await controller.verifyUI(out);report.checks.push({id:'NATIVE-CAPTURE-EDITOR-AND-BILINGUAL-UI',ok:true,result:report.ui});
 report.primaryDisplay=e.screen.getPrimaryDisplay();
 if(process.platform==='darwin'){
  const binary=path.join(resources.replace(/app\.asar$/,'app.asar.unpacked'),'native/haituo-screen-capture'),run=promisify(execFile);
  const probe=JSON.parse((await run(binary,['--probe'],{timeout:10000,encoding:'utf8'})).stdout);
  report.nativePermission=probe;
  if(probe.permission==='granted'){
   const folder=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-capture-qa-'));
   try{const display=e.screen.getPrimaryDisplay(),file=path.join(folder,'fixture.png');const result=JSON.parse((await run(binary,[String(display.id),String(Math.round(display.bounds.width*display.scaleFactor)),String(Math.round(display.bounds.height*display.scaleFactor)),file],{timeout:30000,encoding:'utf8'})).stdout);const image=e.nativeImage.createFromBuffer(fs.readFileSync(file));if(result.ok!==true||image.isEmpty())throw Error('Native screen capture failed');report.checks.push({id:'MAC-NATIVE-SCREEN-CAPTURE-CLI',ok:true,displayId:result.displayId,size:image.getSize()});}
   finally{fs.rmSync(folder,{recursive:true,force:true})}
  }else report.nativeScreenCapture='UNTESTED: CI screen recording permission not granted';
 }
 report.ok=true;
})().catch(error=>{report.ok=false;report.errors.push(String(error.stack||error))}).finally(()=>{clearTimeout(guard);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'capture-ui-report.json'),JSON.stringify(report,null,2));console.log('CAPTURE_UI_REPORT',JSON.stringify(report));e.app.exit(report.ok?0:1)});
