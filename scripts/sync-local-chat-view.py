from pathlib import Path
root=Path(__file__).resolve().parent.parent
source=(root/'src/app/js/caisheng-webview-preload.js').read_text(encoding='utf-8')
assert 'let haituoLocalBilingualView = null;' in source
assert 'haituoInstallLocalChatView(' not in source
assert 'function installResident(' not in source
print('1.6.4 observer rollback active; resident generation intentionally disabled')
