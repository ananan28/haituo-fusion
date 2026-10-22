import argparse,json,os,pathlib,subprocess,sys,tempfile
ROOT=pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)
parser=argparse.ArgumentParser();parser.add_argument('--target',choices=['windows','macos'],required=True)
args=parser.parse_args()
if args.target=='macos':
    # A native ordering regression was intermittent; require two complete runs.
    for attempt in range(2):
        subprocess.run([sys.executable,'repair/test-runtime.py'],check=True,timeout=900)
    subprocess.run([sys.executable,'repair/test-fixtures.py'],check=True,timeout=300)
else:
    app=(ROOT/'windows/out/win-unpacked').resolve()
    out=ROOT/'windows/verification';out.mkdir(parents=True,exist_ok=True)
    probe=out/'native-probe.cjs'
    probe.write_text("const path=require('path');const load=require('module').createRequire(path.join(process.env.HAITUO_PACKED_APP,'resources','app.asar','package.json'));for(const name of ['@signalapp/sqlcipher','@signalapp/libsignal-client','@signalapp/ringrtc','@indutny/simple-windows-notifications']){load(name);console.log('Native OK:',name)}",encoding='utf-8')
    exe=app/'海拓.exe'
    env={**os.environ,'HAITUO_PACKED_APP':str(app),'ELECTRON_RUN_AS_NODE':'1'}
    subprocess.run([str(exe),str(probe)],check=True,env=env,timeout=60)
    env['HAITUO_NETWORK_REPORT']=str(out/'network-report.json')
    subprocess.run([str(exe),str(ROOT/'windows/network-probe.cjs')],check=True,env=env,timeout=120)
    env.pop('ELECTRON_RUN_AS_NODE',None)
    report=out/'runtime.json'
    env.update(HAITUO_WINDOWS_RUNTIME='1',HAITUO_WINDOWS_REPORT=str(report))
    with tempfile.TemporaryDirectory(prefix='haituo-portable-') as profile:
        subprocess.run([str(exe),'--user-data-dir='+profile],check=True,env=env,timeout=240)
    data=json.loads(report.read_text(encoding='utf-8'));assert data['ok'],data
    print(json.dumps(data,ensure_ascii=False))

    env.pop('HAITUO_WINDOWS_RUNTIME',None)
    fixture=out/'message.json'
    env.update(HAITUO_MESSAGE_TEST='1',HAITUO_MESSAGE_TEST_RESULT=str(fixture))
    with tempfile.TemporaryDirectory(prefix='haituo-message-') as profile:
        subprocess.run([str(exe),'--user-data-dir='+profile],check=True,env=env,timeout=240)
    assert json.loads(fixture.read_text(encoding='utf-8'))['ok']

    env.pop('HAITUO_MESSAGE_TEST',None)
    fixture=out/'settings.json'
    env.update(HAITUO_SETTINGS_TEST='1',HAITUO_SETTINGS_TEST_RESULT=str(fixture))
    with tempfile.TemporaryDirectory(prefix='haituo-settings-') as profile:
        subprocess.run([str(exe),'--user-data-dir='+profile],check=True,env=env,timeout=240)
    assert json.loads(fixture.read_text(encoding='utf-8'))['ok']
