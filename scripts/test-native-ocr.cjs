'use strict';
const path=require('node:path'),fs=require('node:fs');
const app=path.resolve(process.argv[2]);
const {recognize}=require(path.join(app,'js/haituo-ocr.js'));
(async()=>{
 for(const [file,expected] of [['ocr-fixture.png',/HELLO\s*1234/i],['ocr-dark-line.png',/curious.*number.*phone/i]]){
  const result=await recognize(fs.readFileSync(path.join(app,'native',file)));
  if(!expected.test(result.original))throw Error('OCR fixture mismatch: '+file+' '+result.original);
  console.log('Native offline OCR passed:',process.platform,file,result.blocks.length,'blocks');
 }
})().catch(error=>{console.error(error);process.exitCode=1});
