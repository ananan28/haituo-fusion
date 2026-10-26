'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app/bundles/main.js'),'utf8');
const mode=source.slice(source.indexOf('// Embedded child accounts'),source.indexOf('const haituoInprocessBackend'));
function launch(argv=[],env={}){const process={argv,env:{...env}};vm.runInNewContext(mode,{process});return process.env.HAITUO_INPROCESS}
test('ordinary launch embeds child accounts on both desktop platforms without flags',()=>{assert.equal(launch(['海拓.exe']),'1');assert.equal(launch(['/Applications/海拓.app/Contents/MacOS/海拓']),'1')});
test('explicit troubleshooting opt-out remains available and propagates to backends',()=>{assert.equal(launch(['海拓.exe','--haituo-legacy-windows']),'0');assert.equal(launch(['海拓.exe'],{HAITUO_INPROCESS:'0'}),'0')});
test('old embedded shortcut flags remain compatible',()=>assert.equal(launch(['海拓.exe','--haituo-inprocess']),'1'));
