"""Run screenshot UI against the exact packaged resources using a raw Electron runtime."""
import json,os,pathlib,subprocess,sys,zipfile
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
subprocess.run([str(runtime),str(ROOT/'scripts/capture-ui-electron.cjs'),str(resources),str(ROOT/'audit-results')],env=env,check=True,timeout=120)
