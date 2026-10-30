"""Run screenshot UI against the exact packaged resources using a raw Electron runtime."""
import json,os,pathlib,subprocess,sys,zipfile,tempfile,struct
ROOT=pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)
mac=sys.platform=='darwin'
cfg=json.loads((ROOT/'project.json').read_text())
get=ROOT/'.build/tools/node_modules/@electron/get'
code="require(process.argv[1]).downloadArtifact({version:process.argv[2],artifactName:'electron',platform:process.platform,arch:process.arch}).then(p=>console.log(p)).catch(e=>{console.error(e);process.exit(1)})"
result=subprocess.run(['node','-e',code,str(get),cfg['tools']['electron']],capture_output=True,text=True,check=True,timeout=180)
archive=pathlib.Path(result.stdout.strip().splitlines()[-1]);dest=ROOT/'.build/capture-qa-runtime';dest.mkdir(parents=True,exist_ok=True)
if mac:
 subprocess.run(['/usr/bin/ditto','-x','-k',str(archive),str(dest)],check=True,timeout=90)
 runtime=dest/'Electron.app/Contents/MacOS/Electron'
 resources=ROOT/'macos/out/海拓-darwin-arm64/海拓.app/Contents/Resources/app.asar'
else:
 with zipfile.ZipFile(archive) as z:z.extractall(dest)
 runtime=dest/'electron.exe';resources=ROOT/'windows/out/win-unpacked/resources/app.asar'
env={**os.environ};env.pop('ELECTRON_RUN_AS_NODE',None)
report_file=ROOT/'audit-results/capture-ui-report.json'
report_file.unlink(missing_ok=True)
subprocess.run([str(runtime),str(ROOT/'scripts/capture-ui-electron.cjs'),str(resources),str(ROOT/'audit-results')],env=env,check=True,timeout=120)
if not report_file.exists():
 raise SystemExit('Capture UI exited without writing its report; not a passing test.')
report=json.loads(report_file.read_text())
assert report.get('ok') and report.get('ui',{}).get('captureClipboard'), report
if mac and not any(c['id']=='MAC-NATIVE-SCREEN-CAPTURE-CLI' and c.get('ok') for c in report['checks']):
 # CI grants screen recording to its responsible runner process. Test the
 # same packaged helper directly there; this is not installed-app TCC proof.
 helper=resources.parent/'app.asar.unpacked/native/haituo-screen-capture'
 probe=json.loads(subprocess.run([str(helper),'--probe'],check=True,capture_output=True,text=True,timeout=15).stdout)
 report['standalonePermission']=probe
 if probe['permission']=='granted':
  display=report['primaryDisplay'];width=round(display['bounds']['width']*display['scaleFactor']);height=round(display['bounds']['height']*display['scaleFactor'])
  with tempfile.TemporaryDirectory(prefix='haituo-capture-ci-') as temp:
   image=pathlib.Path(temp)/'screen.png'
   capture=json.loads(subprocess.run([str(helper),str(display['id']),str(width),str(height),str(image)],check=True,capture_output=True,text=True,timeout=35).stdout)
   data=image.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n' and capture['ok'], capture
   dimensions=struct.unpack('>II',data[16:24]);assert dimensions[0]>0 and dimensions[1]>0
   report['checks'].append({'id':'MAC-NATIVE-SCREEN-CAPTURE-CI-PROCESS','ok':True,'size':dimensions,'context':'CI responsible process, not installed application'})
 report_file.write_text(json.dumps(report,indent=2))
print('CAPTURE_UI_VERIFIED',json.dumps(report,ensure_ascii=False))
