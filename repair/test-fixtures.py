import json,os,pathlib,subprocess,tempfile
app=pathlib.Path('macos/out/海拓-darwin-arm64/海拓.app/Contents/MacOS/海拓').resolve()
out=pathlib.Path('macos/verification').resolve()
for name in ['message','settings']:
 result=out/f'{name}.json'
 with tempfile.TemporaryDirectory(prefix=f'haituo-{name}-') as profile, (out/f'{name}.log').open('w') as log:
  env={**os.environ,f'HAITUO_{name.upper()}_TEST':'1',f'HAITUO_{name.upper()}_TEST_RESULT':str(result)}
  proc=subprocess.Popen([str(app),'--user-data-dir='+profile],env=env,stdout=log,stderr=subprocess.STDOUT)
  try:
   code=proc.wait(timeout=240)
   data=json.loads(result.read_text()) if result.exists() else {'ok':False,'error':'No report'}
   print(json.dumps(data,ensure_ascii=False))
   if code!=0 or not data['ok']: print((out/f'{name}.log').read_text(errors='replace')[-8000:])
   assert code==0 and data['ok'],f'{name} fixture failed'
  finally:
   if proc.poll() is None:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)
