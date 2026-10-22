"""Keep the underlying Signal protocol version separate from Haituo branding."""
from pathlib import Path
import json
app=Path('macos/staging/app')
pkg=json.loads((app/'package.json').read_text(encoding='utf-8'))
assert pkg['signalProtocolVersion']=='8.29.0-alpha.1'
p=app/'bundles/main.js';s=p.read_text(encoding='utf-8')
old='        version: p.app.getVersion(),'
assert s.count(old)==1
s=s.replace(old,'        version: re.signalProtocolVersion,',1)
old='"User-Agent": n.Ot(re.version)'
assert s.count(old)==1
s=s.replace(old,'"User-Agent": n.Ot(re.signalProtocolVersion)',1)
p.write_text(s,encoding='utf-8')
print('Signal protocol version preserved independently of Haituo release version')
