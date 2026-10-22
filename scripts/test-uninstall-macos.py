import pathlib,tempfile,subprocess,plistlib
with tempfile.TemporaryDirectory(prefix='haituo-uninstall-test-') as folder:
 root=pathlib.Path(folder)
 for name in ['Library/Application Support/Haituo/SignalProfiles/signal-old/db.sqlite','Library/Application Support/海拓/settings.json','Library/Caches/com.haituo.desktop/cache','Library/Application Support/Signal/keep','Library/Application Support/WhatsApp/keep']:
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('fixture')
 for name,identifier in [('Haituo-1.4.1.app','com.haituo.desktop'),('Other.app','com.example.other')]:
  p=root/'Applications'/name/'Contents/Info.plist';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(plistlib.dumps({'CFBundleIdentifier':identifier}))
 subprocess.run(['/bin/sh','src/app/native/haituo-uninstall-macos.sh',str(root/'Applications/Haituo-1.4.1.app'),str(root)],check=True)
 assert not (root/'Library/Application Support/Haituo').exists()
 assert not (root/'Library/Application Support/海拓').exists()
 assert not (root/'Applications/Haituo-1.4.1.app').exists()
 assert (root/'Library/Application Support/Signal/keep').exists()
 assert (root/'Library/Application Support/WhatsApp/keep').exists()
 assert (root/'Applications/Other.app').exists()
 print('macOS full uninstall cleanup fixture passed; independent applications preserved')
