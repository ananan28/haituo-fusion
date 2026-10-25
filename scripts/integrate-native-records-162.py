from pathlib import Path
import subprocess
root=Path(__file__).resolve().parent.parent
markers={"src/app/bundles/main.js":"function haituoLocalChatStore()", "src/app/bundles/preload/main.js":"const records = require('../../js/haituo-signal-message-record.js')", "src/app/js/caisheng-webview-preload.js":"function haituoInstallLocalChatView("}
found=[marker in (root/name).read_text(encoding="utf-8") for name,marker in markers.items()]
if all(found):
 print("Native message record source already integrated")
elif any(found):
 raise SystemExit("Partial integration: inspect source rather than patch twice")
else:
 subprocess.run(["git","apply","--check","scripts/native-records-162.patch"],cwd=root,check=True)
 subprocess.run(["git","apply","scripts/native-records-162.patch"],cwd=root,check=True)
 print("Integrated full editable message record and gated child-view source")
