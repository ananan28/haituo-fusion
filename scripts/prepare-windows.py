from pathlib import Path
import json,runpy
version=json.loads(Path('project.json').read_text(encoding='utf-8'))['versions']['windows']
app=Path('macos/staging/app')
p=app/'package.json';pkg=json.loads(p.read_text(encoding='utf-8'))
pkg['signalProtocolVersion']=pkg['version'];pkg['version']=version
p.write_text(json.dumps(pkg,ensure_ascii=False,indent=2),encoding='utf-8')
runpy.run_path('scripts/patch-network.py',run_name='__main__')
runpy.run_path('scripts/patch-startup.py',run_name='__main__')
# The runtime test hook is injected by build.py into a separate test build
# after the release package is verified clean; release staging never has it.
