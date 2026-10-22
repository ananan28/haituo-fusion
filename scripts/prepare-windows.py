from pathlib import Path
import json,os,runpy
version=json.loads(Path('project.json').read_text(encoding='utf-8'))['versions']['windows']
app=Path('macos/staging/app')
p=app/'package.json';pkg=json.loads(p.read_text(encoding='utf-8'))
pkg['signalProtocolVersion']=pkg['version'];pkg['version']=version
p.write_text(json.dumps(pkg,ensure_ascii=False,indent=2),encoding='utf-8')
runpy.run_path('scripts/patch-network.py',run_name='__main__')
runpy.run_path('scripts/patch-startup.py',run_name='__main__')
if os.environ.get('HAITUO_INCLUDE_TEST_HOOK')=='1':
    p=app/'bundles/main.js'
    p.write_text(p.read_text(encoding='utf-8')+'\n'+Path('windows/runtime-test-hook.js').read_text(encoding='utf-8'),encoding='utf-8')
